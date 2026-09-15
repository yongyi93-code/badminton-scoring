import type { Match, Player } from '@/types'
import { sideOf } from './ranking'

/* ------------------------------------------------------------------ *
 * 对手确认记分（异议制）
 *
 * 现在的比分是谁拿着手机谁说了算。十几个人靠脸熟撑得住；
 * 开放给陌生人之后，MMR 和排名就没什么可信度了。
 *
 * -------------------------------------------------------------------
 * 三条规矩，每一条都是为了躲开一个具体的坑
 *
 * 1. **不卡着等人点。** 比分记下来立刻算数，MMR、金币、排行榜照走。
 *    要每一场都等对手确认才算数的话，球场上没人受得了 ——
 *    而一个「打完了但还不算数」的比分，比没有确认更难解释。
 *
 * 2. **异议不是否决权。** 提异议不会把这一场从 MMR 里拿掉。
 *    拿掉的话，每一个输的人都会提异议 —— 那比假比分还糟，
 *    因为它给了输的人一个稳赚的按钮。异议只是「这个数不对，去改」。
 *
 * 3. **确认是加分项，不是及格线。** 「对手确认过」是一个正面标记。
 *    没人确认的场次不会被惩罚（对手可能压根没装 App），
 *    但确认过的场次值得被看见 —— 陌生人之间的可信度是这么攒起来的。
 *
 * -------------------------------------------------------------------
 * 谁来确认
 *
 * 只问装了 App 的人（Player.ownerId 有值）。代建的球友、临时来的客人
 * 没有手机上的入口，把他们算进「还差谁」只会让那一行永远消不掉。
 *
 * 记分的那个人不问 —— 他刚按完，再让他确认一遍自己记的分毫无意义。
 *
 * -------------------------------------------------------------------
 * 已知的一处不完美：两个人同时点
 *
 * 同步是「整场比赛一个对象推上去，后到的那份覆盖前一份」（见 lib/sync.ts）。
 * 所以两个人在同一个防抖窗口里各点一次确认，可能只留下一个。
 *
 * 没去修，理由是代价和收益不成比例：「对手确认过」只需要对面有一个人
 * 点过，丢掉第二个不改变任何结论；而要修就得给这两个数组单独做一套
 * 按元素合并的同步，那是整个同步引擎里目前唯一需要合并的东西。
 * 加注那个 stakeOk 一直也是这样的，没出过事。
 * ------------------------------------------------------------------ */

/**
 * 还能表态多久。
 *
 * 24 小时之后那个问句自己消失：隔了一天再问「昨晚第三场 21:18 对吗」，
 * 没人答得上来，而一个答不上来的问句只会一直挂在那儿。
 *
 * 过期不等于确认过 —— 见 opponentConfirmed，那个标记只认真点过的人。
 */
export const CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000

/** 这一场里装了 App 的人（能在自己手机上表态的） */
const claimed = (match: Match, players: Player[]): string[] => {
  const app = new Set(players.filter((p) => p.ownerId).map((p) => p.id))
  return [...match.teamA, ...match.teamB].filter((id) => app.has(id))
}

/**
 * 该问谁「这个比分对吗」。
 *
 * 场上装了 App 的人，减去记分的那一个。
 */
export const confirmers = (match: Match, players: Player[]): string[] =>
  claimed(match, players).filter((id) => id !== match.recordedBy)

/** 还没表过态的那些人（既没点确认，也没提异议） */
export function confirmPending(match: Match, players: Player[]): string[] {
  const said = new Set([...(match.scoreOk ?? []), ...(match.disputedBy ?? [])])
  return confirmers(match, players).filter((id) => !said.has(id))
}

/** 有人说这个比分不对 */
export const disputed = (match: Match): boolean => (match.disputedBy?.length ?? 0) > 0

/**
 * 「对手确认过」—— 这一场的比分有对面的人点过头。
 *
 * 只认**记分人那一队之外**的确认。队友点头证明不了比分：
 * 他和记分的人是同一边，赢输一起走，正是没有动机去挑错的那个人。
 *
 * 记分的人不在场上时（别人在场边帮着记），两队谁点都算数 ——
 * 那种情形下双方都是「对面」。
 */
export function opponentConfirmed(match: Match): boolean {
  const ok = match.scoreOk ?? []
  if (ok.length === 0) return false
  const mine = match.recordedBy ? sideOf(match, match.recordedBy) : null
  if (mine === null) return true
  return ok.some((id) => sideOf(match, id) !== null && sideOf(match, id) !== mine)
}

/** 还在能表态的窗口里 */
export const withinWindow = (match: Match, now: number): boolean =>
  match.endedAt != null && now - match.endedAt < CONFIRM_WINDOW_MS

/**
 * 现在该不该拿这一场去问这个人。
 *
 * 五个条件都满足才问：打完了、在窗口里、他在场上、不是他记的分、
 * 他还没表过态。少一条都会变成「问了也没用」的那种打扰。
 */
export function shouldAsk(
  match: Match,
  playerId: string | null | undefined,
  players: Player[],
  now: number,
): boolean {
  if (!playerId) return false
  if (match.status !== 'done') return false
  if (!withinWindow(match, now)) return false
  return confirmPending(match, players).includes(playerId)
}

/**
 * 改过比分之后要抹掉的东西。
 *
 * 退回去改一次，之前的确认和异议全部作废 —— 它们是对**那个**比分说的。
 * 不抹的话，一个「对手确认过」的标记会跟着改完的新比分走，
 * 而那个新比分根本没人看过。这是这一整套里最容易漏、也最伤的一处。
 */
export const CLEAR_CONFIRMATIONS = {
  recordedBy: undefined,
  scoreOk: undefined,
  disputedBy: undefined,
} as const

/** 点一次「没错」。重复点不会重复记 */
export const withConfirm = (match: Match, playerId: string): Partial<Match> => ({
  scoreOk: [...new Set([...(match.scoreOk ?? []), playerId])],
  /* 改主意了：把他之前的异议撤掉，不然一个人同时在两份名单上 */
  disputedBy: (match.disputedBy ?? []).filter((id) => id !== playerId),
})

/** 提一次异议。同样可以改主意 */
export const withDispute = (match: Match, playerId: string): Partial<Match> => ({
  disputedBy: [...new Set([...(match.disputedBy ?? []), playerId])],
  scoreOk: (match.scoreOk ?? []).filter((id) => id !== playerId),
})
