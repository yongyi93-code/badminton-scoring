import { lang, pick } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { ReportReason } from '@/lib/report'

/* ------------------------------------------------------------------ *
 * 封号 / 禁言 / 申诉
 *
 * 规则在 supabase/025-bans.sql，那边写了为什么封号不碰打球、为什么
 * 申诉这条路不受封号影响。这一层只管把话说对。
 *
 * -------------------------------------------------------------------
 * 界面上这一道拦不住任何人，真正把门的在数据库
 *
 * 被禁言的人点不到「发」那个按钮，那只是**省得他白写一段字**。
 * 真正挡住的是表上那几个触发器 —— 一个改过的客户端照样发不出来。
 *
 * 所以这个文件里两件事都要做：
 *   1. 事前：拿到自己那条封号，把界面关掉，并且说清楚为什么
 *   2. 事后：数据库抛回来的暗号翻成人话（silencedFrom）——
 *      万一第一道漏了，第二道也不能是一句看不懂的英文
 * ------------------------------------------------------------------ */

export type BanKind = 'mute' | 'ban'

export type Ban = {
  id: string
  uid: string
  kind: BanKind
  reason: ReportReason
  note: string | null
  /** 到什么时候为止。null = 永久 */
  until: string | null
  created_by: string | null
  created_at: string
  lifted_at: string | null
  lifted_by: string | null
}

export type Appeal = {
  id: string
  ban_id: string
  uid: string
  body: string
  status: 'open' | 'accepted' | 'rejected'
  handled_by: string | null
  handled_at: string | null
  created_at: string
}

export type BanResult = { ok: true } | { ok: false; error: string }

const BAN_COLS = 'id, uid, kind, reason, note, until, created_by, created_at, lifted_at, lifted_by'
const APPEAL_COLS = 'id, ban_id, uid, body, status, handled_by, handled_at, created_at'

/** 申诉最多写多少字。和 025 里那条 check 是同一个数 */
export const APPEAL_MAX = 2000

/* ------------------------------------------------------------------ *
 * 纯算的那几块
 * ------------------------------------------------------------------ */

/** 这条现在还生效着吗。和数据库里那个判断是同一句话，两处必须一样 */
export function isActive(b: Pick<Ban, 'until' | 'lifted_at'>, now = Date.now()): boolean {
  if (b.lifted_at) return false
  if (!b.until) return true
  return Date.parse(b.until) > now
}

/**
 * 挑出「现在压着我的那一条」。
 *
 * 排序和 025 里的 active_ban 一样：最重的、最长的排前面。
 * 同时有一条禁言和一条封号的时候，说的必须是封号那条 ——
 * 说成禁言的话，人会以为自己还加得了好友。
 */
export function activeBan(rows: Ban[], now = Date.now()): Ban | null {
  const live = rows.filter((b) => isActive(b, now))
  if (live.length === 0) return null
  return [...live].sort((a, b) => {
    if ((a.kind === 'ban') !== (b.kind === 'ban')) return a.kind === 'ban' ? -1 : 1
    if (!a.until || !b.until) return a.until ? 1 : -1
    return Date.parse(b.until) - Date.parse(a.until)
  })[0]
}

/**
 * 数据库那边抛回来的暗号。
 *
 * 触发器抛的是 `RALLY_SILENCED:mute:2026-09-25T...`，不是人话 ——
 * 数据库不知道这个人用中文还是英文，所以文案留在这一端。
 *
 * 认不出来就返回 null，由调用方原样显示那句错误：看不懂的英文
 * 也好过一句猜出来的中文。
 */
export function silencedFrom(message: string): { kind: BanKind; until: string | null } | null {
  const m = /RALLY_SILENCED:(mute|ban):(.*)$/.exec(message)
  if (!m) return null
  const until = m[2].trim()
  return { kind: m[1] as BanKind, until: until ? until : null }
}

/**
 * 数据库抛回来的那句暗号，翻成一句人话。不是那件事就返回 null。
 *
 * 每一处「发东西」的失败都该先过这一道：界面上那层拦人是**事前**的
 * （按钮变灰、说明摆在上面），而这一道是**事后**的兜底 ——
 * 一台还没刷新的手机、一个刚好在这一秒被封的人，走的都是这条路。
 * 不翻的话他看到的是 `RALLY_SILENCED:ban:2026-...`。
 */
export function silencedText(message: string): string | null {
  const s = silencedFrom(message)
  if (!s) return null
  const zh = lang() === 'zh'
  return zh
    ? `发不出去 —— ${banLine(s, true)}。去「我的」那一屏可以看原因和申诉。`
    : `Could not send — ${banLine(s, false)}. See Me for the reason and to appeal.`
}

/** 到什么时候为止那句话。永久的那种不编一个日期出来 */
export function untilLine(until: string | null, zh: boolean): string {
  if (!until) return zh ? '不会自动解除' : 'Does not expire'
  const d = new Date(until)
  if (Number.isNaN(d.getTime())) return zh ? '不会自动解除' : 'Does not expire'
  const s = d.toLocaleString(zh ? 'zh-CN' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return zh ? `到 ${s} 为止` : `Until ${s}`
}

/** 一句话说清现在是什么状态 */
export function banLine(b: { kind: BanKind; until: string | null }, zh: boolean): string {
  const what = b.kind === 'ban' ? (zh ? '账号被封' : 'Account suspended') : zh ? '被禁言' : 'Muted'
  return `${what} · ${untilLine(b.until, zh)}`
}

/** 被封之后做不了哪几件事。照着说，别让人自己去试 */
export function blockedThings(kind: BanKind, zh: boolean): string[] {
  const speak = zh
    ? ['发私信', '发动态', '给动态点赞']
    : ['Sending messages', 'Posting', 'Liking posts']
  if (kind === 'mute') return speak
  return [
    ...speak,
    ...(zh
      ? ['加好友', '上全国榜', '显示「正在打」', '改名片（名字和照片）']
      : ['Adding friends', 'Joining the national board', 'Showing “now playing”', 'Changing your card']),
  ]
}

/**
 * 封多久那几个选项。
 *
 * 给的是几个按钮而不是一个日期选择器：处理一条举报是几秒钟的事，
 * 而「封他三天还是四天」这个问题没有答案 —— 给出刻度反而让人快。
 */
export const BAN_SPANS: { hours: number | null; zh: string; en: string }[] = [
  { hours: 24, zh: '1 天', en: '1 day' },
  { hours: 24 * 7, zh: '7 天', en: '7 days' },
  { hours: 24 * 30, zh: '30 天', en: '30 days' },
  { hours: null, zh: '永久', en: 'Permanent' },
]

/** 从「封多久」算出到期时间。永久的那种是 null，不是一个很远的日期 */
export function untilFrom(hours: number | null, now = Date.now()): string | null {
  if (hours === null) return null
  return new Date(now + hours * 3600 * 1000).toISOString()
}

/* ------------------------------------------------------------------ *
 * 和云端打交道
 * ------------------------------------------------------------------ */

const noCloud = () => pick('没连上云端', 'Not connected')

/**
 * 我现在被封着吗。
 *
 * 读策略只让人看到自己那几行，所以这一句问不出别人的事。
 * 拿不到（没跑过 025、离线）就当没被封 —— 界面不该因为一次
 * 网络失败就把所有人都关起来；真正把门的在数据库那边。
 */
export async function fetchMyBan(): Promise<Ban | null> {
  if (!supabase) return null
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('bans')
    .select(BAN_COLS)
    .eq('uid', uid)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return null
  return activeBan((data ?? []) as Ban[])
}

/** 某个人被封过几次（管理员看的）。要决定这次封多久，先看他前科 */
export async function fetchBansOf(uid: string): Promise<Ban[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('bans')
    .select(BAN_COLS)
    .eq('uid', uid)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return []
  return (data ?? []) as Ban[]
}

/** 封一个人。只有管理员做得到，而挡住别人的是策略，不是这个函数 */
export async function createBan(input: {
  uid: string
  kind: BanKind
  reason: ReportReason
  note: string
  hours: number | null
}): Promise<BanResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { data: auth } = await supabase.auth.getSession()
  const me = auth.session?.user.id
  if (!me) return { ok: false, error: pick('先登录', 'Sign in first') }

  const { data, error } = await supabase
    .from('bans')
    .insert({
      uid: input.uid,
      kind: input.kind,
      reason: input.reason,
      note: input.note.trim() || null,
      until: untilFrom(input.hours),
      created_by: me,
    })
    .select('id')
  if (error) return { ok: false, error: error.message }
  /* 被策略挡下来的写不报错，只是动了 0 行 —— 这个仓库栽过好几次 */
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没封上 —— 只有管理员可以', 'Not applied — admins only') }
  }
  return { ok: true }
}

/** 解封。不是删掉那一行 —— 发生过的事不能抹掉，只能盖个章 */
export async function liftBan(id: string): Promise<BanResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { data, error } = await supabase
    .from('bans')
    .update({ lifted_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没解开 —— 只有管理员可以', 'Not lifted — admins only') }
  }
  return { ok: true }
}

/** 我为自己那条封号写的申诉。封着也发得出去，那是故意的 */
export async function sendAppeal(banId: string, body: string): Promise<BanResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const text = body.trim()
  if (!text) return { ok: false, error: pick('写点什么再发', 'Write something first') }
  if (text.length > APPEAL_MAX) {
    return { ok: false, error: pick(`最多 ${APPEAL_MAX} 字`, `${APPEAL_MAX} characters max`) }
  }
  const { data, error } = await supabase
    .from('appeals')
    .insert({ ban_id: banId, body: text })
    .select('id')
  if (error) {
    /* 那条唯一索引：同一条封号只能有一条没处理的申诉 */
    if (/duplicate|23505/i.test(error.message)) {
      return {
        ok: false,
        error: pick('你已经申诉过了，等管理员看', 'You already appealed — waiting on an admin'),
      }
    }
    return { ok: false, error: error.message }
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没发出去 —— 只能为自己那条申诉', 'Not sent — your own ban only') }
  }
  return { ok: true }
}

/** 我发过的申诉（看管理员回了没有） */
export async function fetchMyAppeals(): Promise<Appeal[]> {
  if (!supabase) return []
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('appeals')
    .select(APPEAL_COLS)
    .eq('uid', uid)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return (data ?? []) as Appeal[]
}

/** 等着处理的申诉（管理员看的） */
export async function fetchOpenAppeals(): Promise<Appeal[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('appeals')
    .select(APPEAL_COLS)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) return []
  return (data ?? []) as Appeal[]
}

/**
 * 回一条申诉。
 *
 * 接受的那一下**数据库自己会解封**（025 里那个触发器）—— 不用在这儿
 * 再调一次 liftBan。少那一步不是省事：管理员点了「通过」却忘了解封的话，
 * 那个人会看到自己的申诉写着通过了，却还是发不出话，比直接驳回更伤人。
 */
export async function judgeAppeal(id: string, ok: boolean): Promise<BanResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { data, error } = await supabase
    .from('appeals')
    .update({ status: ok ? 'accepted' : 'rejected' })
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没回上 —— 只有管理员可以', 'Not saved — admins only') }
  }
  return { ok: true }
}

/** 下架 / 恢复一条动态。管理员改不了内容，只翻得动这一个开关 */
export async function setPostHidden(id: string, hidden: boolean): Promise<BanResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { data, error } = await supabase
    .from('posts')
    .update({ hidden_at: hidden ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没动 —— 只有管理员可以', 'Nothing changed — admins only') }
  }
  return { ok: true }
}
