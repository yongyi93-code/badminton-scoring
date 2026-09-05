import { pick } from './i18n'
import { decidedMatches } from './ranking'
import type { Match, Session, Venue } from '@/types'

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
export const UNNAMED_VENUE = () => pick('未填球馆', 'No venue')

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
  normalizeVenue(raw) || UNNAMED_VENUE()

/**
 * 从一段文本里认出经纬度。认不出返回 null。
 *
 * 认三种写法，都是人真的会粘进来的：
 *   3.1234, 101.5678                     地图 App 里长按「复制坐标」
 *   .../maps/@3.1234,101.5678,17z/...    Google Maps 网址栏
 *   ...!3d3.1234!4d101.5678              分享出来的那种长链接
 *
 * 反过来写（经度在前）不用额外判断就会被挡掉：纬度的绝对值不可能
 * 超过 90，而马来西亚的经度是 100 出头。这一条是白捡的正确性检查。
 *
 * 短链（maps.app.goo.gl）认不出来 —— 坐标不在链接里，要跟着跳转才拿得到，
 * 而那要发一个跨域请求。与其做一半，不如明说「先在地图里打开它」。
 */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const s = (text ?? '').trim()
  if (!s) return null

  const pair =
    // Google Maps 长链接里的那一对
    s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ??
    // 网址栏里的 @纬度,经度
    s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ??
    // 光是两个数字
    s.match(/(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/)
  if (!pair) return null

  const lat = Number(pair[1])
  const lng = Number(pair[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  // 正好 0,0 在几内亚湾里，那是「解析出错」而不是有人在那儿打球
  if (lat === 0 && lng === 0) return null

  // 六位小数约等于 0.1 米，再多是噪音
  return { lat: round6(lat), lng: round6(lng) }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** 这个馆有没有填过位置 —— 地址或坐标，有一样就算 */
export const hasLocation = (venue: Venue | undefined) =>
  Boolean(venue && (normalizeVenue(venue.address) || (venue.lat != null && venue.lng != null)))

/** 这个馆有没有人填过地址；没填过就是 undefined */
export const venueByKey = (venues: Venue[], key: string) =>
  venues.find((v) => v.key === venueKey(key))

/**
 * 「带我去」那个链接。没有地址也没有坐标就返回 null —— 那时候不该有按钮。
 *
 * 为什么不拿球馆名字去搜：名字是群里自己叫的（「老地方」「城中」），
 * 拿去搜地图会把人导到一个看着像模像样、其实完全不相干的地方。
 * 宁可没有按钮，也不要一个会把人带错地方的按钮。
 *
 * 有坐标就用坐标（以后地图那一版会填），否则用「馆名 + 地址」——
 * 带上馆名是因为地址常常打得不全，馆名能帮地图消歧。
 *
 * 用 Google Maps 的通用搜索链接：手机上装了 App 会直接跳进 App，
 * 没装就开网页。iOS 上也一样 —— 不用为两个系统各写一套。
 */
export function mapsUrl(label: string, venue: Venue | undefined): string | null {
  if (!venue) return null

  if (venue.lat != null && venue.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${venue.lat},${venue.lng}`,
    )}`
  }

  /*
   * 地址是硬条件，不是「有就加上」。
   *
   * 差一点就写成了「馆名 + 地址，两个都可选」—— 那样地址空着时会拿
   * 光秃秃一个馆名去搜，正是上面说的那种「把人导错地方」。
   */
  const address = normalizeVenue(venue.address)
  if (!address) return null

  const query = [normalizeVenue(label), address].filter(Boolean).join(' ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

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

/* ------------------------------------------------------------------ *
 * 主场：一个人最常打的球馆
 * ------------------------------------------------------------------ */

export type HomeVenue = {
  key: string
  label: string
  /** 在这个馆打完的场数 */
  matches: number
}

/**
 * 每个人打得最多的那个球馆。
 *
 * 全体排行榜上要显示「这个人是哪个馆的」—— 而 MMR 是跨馆累计的，
 * 光看名次不知道他平时在哪儿打。并列时取场数多的；再并列取名字排前的
 * 那个 key，纯粹为了结果稳定 —— 不定死的话同一份数据每次渲染都可能
 * 换一个馆，看起来像数据在乱跳。
 *
 * 口径和别处一致：只算打完的（decidedMatches），没打完的不算「在那儿打过」。
 */
export function homeVenues(
  sessions: Session[],
  matches: Match[],
): Map<string, HomeVenue> {
  const venueOf = new Map<string, { key: string; label: string }>()
  for (const s of sessions) {
    venueOf.set(s.id, { key: venueKey(s.venue), label: venueLabel(s.venue) })
  }

  /** playerId -> venueKey -> 场数 */
  const tally = new Map<string, Map<string, number>>()
  for (const m of decidedMatches(matches)) {
    const v = venueOf.get(m.sessionId)
    if (!v) continue
    for (const id of [...m.teamA, ...m.teamB]) {
      const byVenue = tally.get(id) ?? new Map<string, number>()
      byVenue.set(v.key, (byVenue.get(v.key) ?? 0) + 1)
      tally.set(id, byVenue)
    }
  }

  const labelOf = new Map<string, string>()
  for (const v of venueOf.values()) labelOf.set(v.key, v.label)

  const out = new Map<string, HomeVenue>()
  for (const [playerId, byVenue] of tally) {
    let best: HomeVenue | null = null
    for (const [key, count] of [...byVenue].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!best || count > best.matches) {
        best = { key, label: labelOf.get(key) ?? venueLabel(key), matches: count }
      }
    }
    if (best) out.set(playerId, best)
  }
  return out
}
