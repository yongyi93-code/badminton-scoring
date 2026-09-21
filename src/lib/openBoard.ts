import { stateOf } from '@/lib/region'
import type { Session } from '@/types'

/* ------------------------------------------------------------------ *
 * 公开球局：全 App 看得到的那一张列表
 *
 * 这个文件只管**纯逻辑**：哪一场该出现在公开列表上、它公开出去的那
 * 一行长什么样、手上这份和云端那份差在哪。真正发请求的在
 * lib/openSessions.ts。
 *
 * -------------------------------------------------------------------
 * 为什么不是把 records 读开
 *
 * `records` 的读策略是 `is_club_member(club_id)` —— 那是这个 App 权限
 * 的地基。为了一张列表掀开它，等于所有人都能翻所有球群的比赛、球员、
 * 球局。全国榜（017）当初遇到过一模一样的岔路，走的是另一条：
 * **另开一张自愿的公开表，只放能公开的那几样**。这里照抄。
 *
 * 所以公开出去的就这么点东西：球馆、州、日期时间、几片场、几个人、
 * 上限、谁开的。**比分、球员名单、聊天一样都不出群**。
 *
 * -------------------------------------------------------------------
 * 「私人局」是开局的人自己勾的，默认不勾
 *
 * 默认公开 —— 这个 App 接下来要做的事就是让人找得到局。但勾一下就能
 * 把某一场收回来（朋友之间约的、公司包场的），那一场只有群里的人看得到。
 *
 * **老的球局一条都不会被公开**：这张表是新的，谁也没给它们写过行，
 * 而这份代码只发布「现在还活着的局」（见 shouldPublish）。
 * ------------------------------------------------------------------ */

/**
 * 最后一次有动静之后过了这么久，就当这一局已经散了，从公开列表上撤掉。
 *
 * 和首页那一排「别人开的局」同一个数（components/OpenSessions）：
 * 球局要靠人按「结束」才收摊，而没人记得按。不挡的话，公开列表上会
 * 挂着上个月那些早就散了的局 —— 而这是别人第一眼看到的东西。
 *
 * 这一条同时挡住了一件更要紧的事：升级之后，本机那些还标着 active、
 * 其实早就打完的老局**不会被发布出去**。
 */
export const STALE_MS = 12 * 60 * 60 * 1000

/** 公开列表上的一行。字段名跟数据库那张表走（snake_case） */
export type OpenRow = {
  session_id: string
  host_uid: string
  /** 球群邀请码。想加入的人要靠它进来 —— 没有码这一行等于只能看 */
  club_code: string | null
  venue: string
  /** 州，给「只看雪兰莪」那种筛用。认不出来就是空 */
  state: string | null
  date: string
  time: string | null
  courts: number
  joined: number
  max_players: number | null
  /** 开局的人叫什么。公开列表上总要看得出是谁开的 */
  host_name: string | null
}

/**
 * 这一场该不该挂在公开列表上。
 *
 * 三个条件缺一不可，而且顺序无所谓 —— 它们是「和」的关系：
 *   · 还在进行（结束了的局别人来不了）
 *   · 没被勾成私人局
 *   · 还新鲜（见 STALE_MS）
 */
export function shouldPublish(
  session: Session,
  opts: { lastActivity: number; now: number },
): boolean {
  if (session.status !== 'active') return false
  if (session.private) return false
  return opts.now - opts.lastActivity < STALE_MS
}

/** 把一场球局摊成公开列表上的那一行 */
export function openRow(
  session: Session,
  extra: { hostUid: string; clubCode: string | null; hostName: string | null },
): OpenRow {
  return {
    session_id: session.id,
    host_uid: extra.hostUid,
    club_code: extra.clubCode,
    venue: session.venue,
    /*
     * 州是从球馆那串地址里认出来的（lib/region.ts）。认不出来就是空 ——
     * **不猜**：猜错了把一场局放进隔壁州的列表里，比不放更糟。
     */
    state: stateOf(session.venue),
    date: session.date,
    time: session.time ?? null,
    courts: session.courtCount,
    joined: session.playerIds.length,
    max_players: session.maxPlayers ?? null,
    host_name: extra.hostName,
  }
}

/**
 * 手上这份和云端那份差在哪。
 *
 * 返回「要写哪几行」和「要删哪几行」。
 *
 * 为什么要 diff 而不是每次全量重写：这段代码跟着本机球局的任何一点
 * 变动跑（加一个人、打完一场），而一晚上那是几十次。全量重写等于
 * 几十次写同样的内容 —— 免费版的数据库不该这么用，而且每一次写都是
 * 一次可能失败的网络请求。
 *
 * **只认自己开的局**：别人开的局不归这台手机管，混进来会变成两台
 * 手机互相覆盖对方的行。
 */
export function openDiff(
  want: OpenRow[],
  have: OpenRow[],
): { upsert: OpenRow[]; remove: string[] } {
  const byId = new Map(have.map((r) => [r.session_id, r]))
  const upsert = want.filter((w) => {
    const old = byId.get(w.session_id)
    return !old || !sameRow(old, w)
  })
  const wanted = new Set(want.map((w) => w.session_id))
  const remove = have.filter((h) => !wanted.has(h.session_id)).map((h) => h.session_id)
  return { upsert, remove }
}

/*
 * 两行一不一样。
 *
 * 一栏一栏比，不比 JSON 字符串 —— 云端那行上还有 updated_at 这种
 * 本机没有的东西，比字符串的话永远不相等，diff 就等于没做。
 */
function sameRow(a: OpenRow, b: OpenRow): boolean {
  return (
    a.venue === b.venue &&
    a.state === b.state &&
    a.date === b.date &&
    a.time === b.time &&
    a.courts === b.courts &&
    a.joined === b.joined &&
    a.max_players === b.max_players &&
    a.club_code === b.club_code &&
    a.host_name === b.host_name
  )
}

/**
 * 列表怎么排：先按日期，同一天按时间，没写时间的排在最后。
 *
 * 不按「刚发布的在前」—— 别人翻这张列表是为了找**今晚去哪打**，
 * 不是看谁刚开了局。
 */
export function sortOpen(rows: OpenRow[]): OpenRow[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (!a.time && !b.time) return 0
    /* 没写时间的排在同一天的最后：信息少的往后站 */
    if (!a.time) return 1
    if (!b.time) return -1
    return a.time < b.time ? -1 : 1
  })
}

/** 还差几个人。没设上限就是 null（不显示「还差几个」） */
export function spotsLeftOn(row: OpenRow): number | null {
  if (row.max_players == null) return null
  return Math.max(0, row.max_players - row.joined)
}
