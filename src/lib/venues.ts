import { decidedMatches } from './ranking'
import type { Match, Session } from '@/types'

/* ------------------------------------------------------------------ *
 * 按场馆分组
 *
 * 场馆名是手打的自由文本，最大的坑是同一个场馆被打成好几个写法，
 * 排行榜就会被拆散 —— 而「这个场的第一是谁」正是这个功能的全部意义。
 *
 * 所以分成两个概念：
 *   venueKey   归组用。把空白全删掉再转小写，
 *              「城中羽球馆」「城中 羽球馆」「 城中羽球馆 」算同一个场馆
 *   venueLabel 显示用。保留最近一次的写法，不会显示成挤在一起的怪名字
 *
 * 另外开局时提供历史场馆快选，从源头减少手打。
 * ------------------------------------------------------------------ */

/** 没填球馆的球局归到这一档 */
export const UNNAMED_VENUE = '未填球馆'

/** 显示用：去首尾空格，中间连续空白压成一个 */
export const normalizeVenue = (raw: string | undefined) =>
  (raw ?? '').trim().replace(/\s+/g, ' ')

/**
 * 归组用的 key。空白全删、转小写。
 * 中文名里的空格没有意义，英文名大小写差异也不该拆成两个场馆。
 */
export const venueKey = (raw: string | undefined) =>
  (raw ?? '').replace(/\s+/g, '').toLowerCase()

/** 显示用名字，空的显示成「未填球馆」 */
export const venueLabel = (raw: string | undefined) =>
  normalizeVenue(raw) || UNNAMED_VENUE

export type VenueSummary = {
  /** 归组 key；'' 表示没填球馆 */
  key: string
  /** 显示名，取最近一次用过的写法 */
  label: string
  sessionCount: number
  /** 打完的场数 */
  matchCount: number
  /** 在这个场馆打过球的人数 */
  playerCount: number
  /** 最近一次在这里打球的时间，用于排序 */
  lastPlayedAt: number
}

/** 某个场馆下的所有球局 */
export const sessionsAtVenue = (sessions: Session[], key: string) =>
  sessions.filter((s) => venueKey(s.venue) === venueKey(key))

/** 某个场馆下的比赛 */
export function matchesAtVenue(
  sessions: Session[],
  matches: Match[],
  key: string,
): Match[] {
  const ids = new Set(sessionsAtVenue(sessions, key).map((s) => s.id))
  return matches.filter((m) => ids.has(m.sessionId))
}

/** 在某个场馆出现过的所有球员 id（含已移出球员库的人） */
export function playerIdsAtVenue(
  sessions: Session[],
  matches: Match[],
  key: string,
): string[] {
  const ms = matchesAtVenue(sessions, matches, key)
  return Array.from(new Set(ms.flatMap((m) => [...m.teamA, ...m.teamB])))
}

/**
 * 所有场馆的概览，按「最近打过」排前面。
 * 只统计打完的比赛，避免刚建的空球局也冒出一个场馆。
 */
export function venueSummaries(
  sessions: Session[],
  matches: Match[],
): VenueSummary[] {
  const done = decidedMatches(matches)
  const bySession = new Map<string, Match[]>()
  for (const m of done) {
    const list = bySession.get(m.sessionId)
    if (list) list.push(m)
    else bySession.set(m.sessionId, [m])
  }

  type Acc = VenueSummary & { players: Set<string>; labelAt: number }
  const map = new Map<string, Acc>()

  for (const s of sessions) {
    const key = venueKey(s.venue)
    const ms = bySession.get(s.id) ?? []
    if (ms.length === 0) continue // 一场都没打完的球局不产生场馆

    const stamp = s.endedAt ?? s.createdAt
    const cur: Acc = map.get(key) ?? {
      key,
      label: venueLabel(s.venue),
      labelAt: -1,
      sessionCount: 0,
      matchCount: 0,
      playerCount: 0,
      lastPlayedAt: 0,
      players: new Set<string>(),
    }

    // 显示名取最近一次用过的写法
    if (stamp > cur.labelAt) {
      cur.label = venueLabel(s.venue)
      cur.labelAt = stamp
    }

    cur.sessionCount += 1
    cur.matchCount += ms.length
    for (const m of ms) {
      for (const id of [...m.teamA, ...m.teamB]) cur.players.add(id)
    }
    cur.lastPlayedAt = Math.max(
      cur.lastPlayedAt,
      stamp,
      ...ms.map((m) => m.endedAt ?? 0),
    )
    map.set(key, cur)
  }

  return [...map.values()]
    .map(({ players, labelAt: _labelAt, ...rest }) => ({
      ...rest,
      playerCount: players.size,
    }))
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
}

/** 开局时给的历史球馆快选，按最近用过排序，同一个场馆只出现一次 */
export function recentVenues(sessions: Session[]): string[] {
  const seen = new Map<string, { label: string; at: number }>()
  for (const s of sessions) {
    const key = venueKey(s.venue)
    if (!key) continue
    const cur = seen.get(key)
    if (!cur || s.createdAt > cur.at) {
      seen.set(key, { label: venueLabel(s.venue), at: s.createdAt })
    }
  }
  return [...seen.values()].sort((a, b) => b.at - a.at).map((v) => v.label)
}
