import { supabase } from '@/lib/supabase'
import { pick } from '@/lib/i18n'
import { opponentConfirmed } from '@/lib/confirm'
import { chronological, decidedMatches, sideOf } from '@/lib/ranking'
import type { Match } from '@/types'

/* ------------------------------------------------------------------ *
 * 全国榜 —— 和云端打交道的那一层
 *
 * 规则在 supabase/017-leaderboard.sql，那边写了为什么要单开一张表、
 * 为什么是「各自报各自的」。这一层只管把话说对。
 *
 * -------------------------------------------------------------------
 * 上榜是自己决定的
 *
 * 有行 = 在榜上，删掉 = 下榜。没有第三种状态。
 *
 * 默认不在榜上：把名字挂到一个全国范围的公开榜上，是该由本人点头的事。
 * 这一点在数据库那边也是这么设计的 —— 没有「隐藏」开关，
 * 因为一个开关总有一天会和「有没有行」对不上。
 *
 * -------------------------------------------------------------------
 * 只推结果，不推原始记录
 *
 * 推上去的只有：名字、MMR、胜负场次、其中多少场对手确认过、州。
 * 比赛记录、球局、对手是谁，一行都不出自己的球群 ——
 * records 那张表的读策略（只读得到自己在的群）一点没被掀开。
 *
 * -------------------------------------------------------------------
 * 一个人可能有好几行 —— 一个球群一行
 *
 * 手机任何时候只装得下当前那个球群的数据，所以它算得出来的永远只是
 * 「我在这个群的成绩」。第一版拿 uid 当主键，于是串场的人在第二个群
 * 按一次「更新我的成绩」，就把第一个群那一份**悄悄盖掉了**。
 *
 * 现在一个群一行，看榜的时候按人合并（mergePeople）。
 * 行的钥匙是 scope，不是 club_id —— 为什么，见 018-cross-club.sql。
 * ------------------------------------------------------------------ */

export type LeaderRow = {
  uid: string
  /** 这一行是哪个球群的。散列过，看榜的人看不出是哪个群 */
  scope: string
  name: string
  mmr: number
  wins: number
  losses: number
  /** 其中多少场被对手确认过。这张表上唯一一个不容易伪造的数 */
  confirmed: number
  state: string | null
  updated_at: string
}

/** 按人合并之后的一条。榜上显示的是这个，不是 LeaderRow */
export type LeaderPerson = {
  uid: string
  name: string
  mmr: number
  wins: number
  losses: number
  confirmed: number
  state: string | null
  /** 他在几个球群报过成绩。1 是绝大多数 */
  clubs: number
  updated_at: string
}

const COLS = 'uid, scope, name, mmr, wins, losses, confirmed, state, updated_at'

/* ------------------------------------------------------------------ *
 * scope —— 「这一行是哪个群的」
 *
 * 不存 club_id。存了的话，这张谁都读得到的表就顺手泄了一件本来读不到
 * 的事：谁和谁是一个群的。理由完整写在 018-cross-club.sql 里。
 *
 * 用 uid 一起算散列，所以同一个群在两个人身上算出来的值也不一样 ——
 * 拼不出花名册。
 * ------------------------------------------------------------------ */

const SCOPE_SALT = 'rally-club-scope'

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * 退路：跑不了 SubtleCrypto 的时候用（非安全上下文、太老的浏览器）。
 *
 * 强度确实不如 sha256，但它要挡的那件事不需要那个强度 ——
 * 挡的是「把榜上的人按群分堆」，而只要两个人的同一个群算出来的值不同，
 * 堆就分不出来。uid 进了输入，这一点就成立。
 */
function weakScope(input: string): string {
  /* FNV-1a，两条并行跑出 64 位，够一张几千行的表不撞 */
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).padEnd(24, '0')
}

/**
 * 算出「我在这个群」那一行的钥匙。
 *
 * 同一个人 + 同一个群，在任何设备上都算得出同一个值 —— 换手机之后
 * 按「更新我的成绩」，改的还是原来那一行，不会多出一份。
 */
export async function scopeKey(uid: string, clubId: string): Promise<string> {
  const input = `${SCOPE_SALT}:${uid}:${clubId}`
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return weakScope(input)
  try {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(input))
    return hex(new Uint8Array(buf).slice(0, 12))
  } catch {
    return weakScope(input)
  }
}

/* ------------------------------------------------------------------ *
 * 按人合并
 *
 * 场次、胜负、确认数是计数，相加就是对的。
 *
 * **MMR 相加不完全精确，这一点摊开说。** MMR 是个累加量（赢 +10、
 * 输 −10、爆冷碾压翻倍），所以相加是它最自然的合成方式；不精确的只有
 * 一条规矩：「输到 0 就不再往下扣」。那条在每个群里各生效一次，
 * 于是两个群分别算完再相加，会比把所有比赛混在一起重放**略高一点**。
 *
 * 差别只落在净输很多的人身上 —— 而他们本来就在 0 附近，
 * 差的那几分不改变他在榜上的位置。
 *
 * 为什么不干脆把所有比赛拉下来重放一遍：那要把别的球群的比赛记录
 * 整份拉到这台手机上，而「本机只装一个群」是这个 App 的地基
 * （见 useApp.ts 里 setClubId 那段），为一个排行榜掀它不值得。
 *
 * 名字和州取「打得最多的那个群」那一行 —— 一个人在不同群里可能
 * 用的不是同一个名字，总得挑一个，挑他打得最多的地方那个最像他。
 * ------------------------------------------------------------------ */
export function mergePeople(rows: LeaderRow[]): LeaderPerson[] {
  const by = new Map<string, LeaderRow[]>()
  for (const r of rows) {
    const list = by.get(r.uid)
    if (list) list.push(r)
    else by.set(r.uid, [r])
  }

  const out: LeaderPerson[] = []
  for (const [uid, list] of by) {
    /*
     * 挑一行当「代表」。场次最多的那个群优先；一样多就看 MMR，
     * 再一样就看谁报得晚 —— 三层比完还一样的话结果本来就等价，
     * 但顺序必须是确定的，不然同一份数据画两次名字会跳。
     */
    const main = list.reduce((best, r) => {
      const n = (x: LeaderRow) => x.wins + x.losses
      if (n(r) !== n(best)) return n(r) > n(best) ? r : best
      if (r.mmr !== best.mmr) return r.mmr > best.mmr ? r : best
      return r.updated_at > best.updated_at ? r : best
    })
    out.push({
      uid,
      name: main.name,
      state: main.state,
      mmr: list.reduce((s, r) => s + r.mmr, 0),
      wins: list.reduce((s, r) => s + r.wins, 0),
      losses: list.reduce((s, r) => s + r.losses, 0),
      confirmed: list.reduce((s, r) => s + r.confirmed, 0),
      clubs: list.length,
      updated_at: list.reduce((t, r) => (r.updated_at > t ? r.updated_at : t), ''),
    })
  }

  /* 合并完才排得了序 —— 数据库那边按行的 mmr 排，那不是最终顺序 */
  return out.sort((a, b) => b.mmr - a.mmr || a.name.localeCompare(b.name))
}

export type LeaderResult = { ok: true } | { ok: false; error: string }

/**
 * 我要报上去的那几个数。
 *
 * MMR 不在这里算 —— 它由 progressByPlayer 一处算出来（src/lib/avatar.ts），
 * 这个函数只负责数「打了几场、其中几场对手确认过」。
 * 算法只有一份是这整个设计的前提，见 017 开头那段。
 */
export function myTally(matches: Match[], playerId: string): {
  wins: number
  losses: number
  confirmed: number
} {
  let wins = 0
  let losses = 0
  let confirmed = 0
  for (const m of chronological(decidedMatches(matches))) {
    const side = sideOf(m, playerId)
    if (side === null) continue
    const a = m.games.reduce((n, g) => n + (g.a > g.b ? 1 : 0), 0)
    const b = m.games.reduce((n, g) => n + (g.b > g.a ? 1 : 0), 0)
    if (a === b) continue
    if ((a > b) === (side === 'A')) wins++
    else losses++
    if (opponentConfirmed(m)) confirmed++
  }
  return { wins, losses, confirmed }
}

/**
 * 整张榜，已经按人合并、按合计 MMR 从高到低。
 *
 * 州是**合并之后**才筛的，不是在数据库那边筛。
 * 在那边筛的话，一个人在别的州的群里打的那几行会被漏掉 ——
 * 他的合计就少了一截，而他自己一看就知道不对。
 *
 * 取 1000 行才合并，够几百个人用。真到几千人的时候，一个人的小行
 * 会被截断在批次外面，那时候该做的是服务端的一个视图 ——
 * 018-cross-club.sql 里记着这一条。
 */
export async function fetchLeaderboard(state?: string | null): Promise<LeaderPerson[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('leaderboard')
    .select(COLS)
    .order('mmr', { ascending: false })
    .limit(1000)
  if (error) {
    /* 没跑过 017/018 和「榜是空的」在这里是同一个结果：显示空榜 */
    console.warn('全国榜没拿到:', error.message)
    return []
  }
  const people = mergePeople((data ?? []) as LeaderRow[])
  return state ? people.filter((p) => p.state === state) : people
}

/**
 * 我报过成绩的那几行 —— 一个球群一行。
 *
 * 一行都没有 = 不在榜上。这一点没变，只是从「有没有那一行」
 * 变成「有没有行」。
 */
export async function fetchMyRows(): Promise<LeaderRow[]> {
  if (!supabase) return []
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return []
  const { data, error } = await supabase.from('leaderboard').select(COLS).eq('uid', uid)
  if (error) return []
  return (data ?? []) as LeaderRow[]
}

/**
 * 报一次成绩：上榜，或者更新**当前这个球群**那一行。
 *
 * uid 不用传：数据库那条策略是 `with check (uid = auth.uid())`，
 * 传错了会被当场拒掉。这里传的是自己的，取自当前会话。
 *
 * scope 要传 —— 它是「这一行是哪个群的」。没有它的话，
 * 在第二个群按一次更新就把第一个群那一份盖掉了，而且不报错。
 */
export async function publishMe(
  row: {
    name: string
    mmr: number
    wins: number
    losses: number
    confirmed: number
    state: string | null
  },
  clubId: string,
): Promise<LeaderResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }
  const scope = await scopeKey(uid, clubId)
  const { data, error } = await supabase
    .from('leaderboard')
    .upsert({ uid, scope, ...row, name: row.name.slice(0, 24) }, { onConflict: 'uid,scope' })
    .select('uid')
  if (error) return { ok: false, error: error.message }
  /*
   * 和管理员那边同一条：被策略挡下来的写**不报错**，只是动了 0 行。
   * 只看 error 是不是 null 的话，界面会显示「上榜了」，
   * 而刷新一下榜上根本没有你。
   */
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没上成 —— 只能报自己的成绩', 'You can only publish your own') }
  }
  return { ok: true }
}

/**
 * 下榜。把自己**所有**球群那几行一起删掉。
 *
 * 不做成「只下这个群」：上榜是「我愿意让全国看到我」这一个决定，
 * 下榜就该是同一个决定的反面。做成一个群一个开关的话，人会以为
 * 自己下榜了，而榜上还挂着他在另一个群的那一行。
 */
export async function leaveLeaderboard(): Promise<LeaderResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }
  const { data, error } = await supabase
    .from('leaderboard')
    .delete()
    .eq('uid', uid)
    .select('uid')
  if (error) return { ok: false, error: error.message }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('本来就不在榜上', 'You were not on the board') }
  }
  return { ok: true }
}
