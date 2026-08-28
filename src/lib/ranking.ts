import { RANK_MIN_GAMES, type Match, type PlayerStats, type TeamSide } from '@/types'

/* ------------------------------------------------------------------ *
 * 排名与统计
 *
 * 全部由比赛记录实时推导，不落库，避免排名和实际战绩对不上。
 * 胜负判定不依赖赛制配置：谁赢的局数多就是谁赢，
 * 这样一局定胜负和三局两胜、跨赛制的历史数据都能一起统计。
 * ------------------------------------------------------------------ */

/** 打完且分出胜负的比赛 */
const settled = (m: Match) => m.status === 'done' && matchWinnerBySets(m) !== null

/**
 * 只统计打完的比赛，并且默认把友谊赛排除在外。
 *
 * 过滤放在这一处是有意的：MMR、段位、金币、累计排行榜、最佳搭档、苦主、
 * 连胜……全都从这个函数往下走，挡在这里就不可能漏掉某条统计路径。
 * 友谊赛的客队大多只打这一晚，让他们的战绩去搅动常年累计的榜没有意义。
 *
 * 友谊赛自己那场的结算需要看这些比赛，用 includeFriendly 显式打开。
 */
export const decidedMatches = (
  matches: Match[],
  { includeFriendly = false } = {},
) =>
  matches.filter((m) => settled(m) && (includeFriendly || !m.friendly))

/**
 * 按真实先后顺序排。
 * seq 是「本球局内」的序号，跨球局统计时会重头计数，
 * 所以必须先按时间排，否则连胜会算错。
 */
export const chronological = (matches: Match[]) =>
  [...matches].sort(
    (x, y) =>
      (x.endedAt ?? x.startedAt ?? 0) - (y.endedAt ?? y.startedAt ?? 0) ||
      x.seq - y.seq,
  )

/** 赢的局数多的一方胜；打平或没比分则返回 null */
export function matchWinnerBySets(match: Match): TeamSide | null {
  let a = 0
  let b = 0
  for (const g of match.games) {
    if (g.a > g.b) a++
    else if (g.b > g.a) b++
  }
  if (a === b) return null
  return a > b ? 'A' : 'B'
}

export const sideOf = (match: Match, playerId: string): TeamSide | null => {
  if (match.teamA.includes(playerId)) return 'A'
  if (match.teamB.includes(playerId)) return 'B'
  return null
}

/** 一场比赛两队的总得分（多局相加） */
export function totalPoints(match: Match): { A: number; B: number } {
  return match.games.reduce(
    (acc, g) => ({ A: acc.A + g.a, B: acc.B + g.b }),
    { A: 0, B: 0 },
  )
}

export function computeStats(
  matches: Match[],
  playerIds: string[],
  minGames = RANK_MIN_GAMES,
  /** 友谊赛自己那场的结算要看自己的比赛，其余场合一律不算 */
  { includeFriendly = false } = {},
): PlayerStats[] {
  const played = chronological(decidedMatches(matches, { includeFriendly }))

  return playerIds.map((playerId) => {
    let games = 0
    let wins = 0
    let pointsFor = 0
    let pointsAgainst = 0
    const results: boolean[] = []

    for (const m of played) {
      const side = sideOf(m, playerId)
      if (!side) continue
      const pts = totalPoints(m)
      const won = matchWinnerBySets(m) === side
      games += 1
      if (won) wins += 1
      pointsFor += side === 'A' ? pts.A : pts.B
      pointsAgainst += side === 'A' ? pts.B : pts.A
      results.push(won)
    }

    // 当前连胜（正数）或连败（负数），从最后一场往前数
    let streak = 0
    for (let i = results.length - 1; i >= 0; i--) {
      if (i === results.length - 1) {
        streak = results[i] ? 1 : -1
      } else if (results[i] === results[results.length - 1]) {
        streak += results[i] ? 1 : -1
      } else break
    }

    return {
      playerId,
      games,
      wins,
      losses: games - wins,
      winRate: games ? wins / games : 0,
      pointsFor,
      pointsAgainst,
      diff: pointsFor - pointsAgainst,
      streak,
      qualified: games >= minGames,
    }
  })
}

/**
 * 排名口径：胜率 ↓ → 净分差 ↓ → 场数 ↓。
 * 场次不足的人一律排在合格球员之后，避免打 1 场全胜就霸榜。
 * 完全没上过场的人不进榜。
 */
/* ------------------------------------------------------------------ *
 * 榜的时间范围
 * ------------------------------------------------------------------ */

export type Period = 'all' | 'month' | 'quarter'

export const PERIOD_LABELS: Record<Period, string> = {
  all: '总榜',
  month: '本月',
  quarter: '本季',
}

/**
 * 按球局的日期切出一段时间内的比赛。
 *
 * 以球局的 date 为准，不是比赛的 endedAt —— 跨零点还在打的那几场，
 * 记在开球那天才对得上大家嘴里说的「上周三那场」。
 */
export function matchesInPeriod(
  sessions: { id: string; date: string }[],
  matches: Match[],
  period: Period,
  now = new Date(),
): Match[] {
  if (period === 'all') return matches
  const y = now.getFullYear()
  const m = now.getMonth()
  const from =
    period === 'month'
      ? new Date(y, m, 1)
      : new Date(y, Math.floor(m / 3) * 3, 1)
  const iso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`
  const ids = new Set(sessions.filter((s) => s.date >= iso).map((s) => s.id))
  return matches.filter((x) => ids.has(x.sessionId))
}

export function rankPlayers(stats: PlayerStats[]): PlayerStats[] {
  return [...stats]
    .filter((s) => s.games > 0)
    .sort((x, y) => {
      if (x.qualified !== y.qualified) return x.qualified ? -1 : 1
      return (
        y.winRate - x.winRate ||
        y.diff - x.diff ||
        y.games - x.games ||
        x.playerId.localeCompare(y.playerId)
      )
    })
}

/** 今晚 MVP：达门槛者中排第一的人 */
export function mvpOf(stats: PlayerStats[]): PlayerStats | null {
  const ranked = rankPlayers(stats).filter((s) => s.qualified)
  return ranked[0] ?? null
}

/* ------------------------------------------------------------------ *
 * 趣味统计
 * ------------------------------------------------------------------ */

export type PartnerRecord = {
  partnerId: string
  games: number
  wins: number
  winRate: number
}

/** 最佳搭档：同队 ≥ minGames 场里胜率最高的人 */
export function bestPartner(
  playerId: string,
  matches: Match[],
  minGames = RANK_MIN_GAMES,
): PartnerRecord | null {
  const tally = new Map<string, { games: number; wins: number }>()

  for (const m of decidedMatches(matches)) {
    const side = sideOf(m, playerId)
    if (!side) continue
    const team = side === 'A' ? m.teamA : m.teamB
    if (team.length < 2) continue // 单打没有搭档
    const won = matchWinnerBySets(m) === side
    for (const mate of team) {
      if (mate === playerId) continue
      const cur = tally.get(mate) ?? { games: 0, wins: 0 }
      tally.set(mate, { games: cur.games + 1, wins: cur.wins + (won ? 1 : 0) })
    }
  }

  const records = [...tally.entries()]
    .map(([partnerId, t]) => ({
      partnerId,
      games: t.games,
      wins: t.wins,
      winRate: t.wins / t.games,
    }))
    .filter((r) => r.games >= minGames)
    .sort(
      (x, y) =>
        y.winRate - x.winRate ||
        y.games - x.games ||
        x.partnerId.localeCompare(y.partnerId),
    )

  return records[0] ?? null
}

export type NemesisRecord = {
  opponentId: string
  games: number
  losses: number
}

/** 苦主：交手中输给他最多次的对手 */
export function nemesis(playerId: string, matches: Match[]): NemesisRecord | null {
  const tally = new Map<string, { games: number; losses: number }>()

  for (const m of decidedMatches(matches)) {
    const side = sideOf(m, playerId)
    if (!side) continue
    const foes = side === 'A' ? m.teamB : m.teamA
    const lost = matchWinnerBySets(m) !== side
    for (const foe of foes) {
      const cur = tally.get(foe) ?? { games: 0, losses: 0 }
      tally.set(foe, { games: cur.games + 1, losses: cur.losses + (lost ? 1 : 0) })
    }
  }

  const records = [...tally.entries()]
    .map(([opponentId, t]) => ({ opponentId, ...t }))
    .filter((r) => r.losses > 0)
    .sort(
      (x, y) =>
        y.losses - x.losses ||
        x.games - y.games ||
        x.opponentId.localeCompare(y.opponentId),
    )

  return records[0] ?? null
}

/** 最长连胜（历史最好，不是当前） */
export function longestWinStreak(playerId: string, matches: Match[]): number {
  let best = 0
  let cur = 0
  for (const m of chronological(decidedMatches(matches))) {
    const side = sideOf(m, playerId)
    if (!side) continue
    if (matchWinnerBySets(m) === side) {
      cur += 1
      best = Math.max(best, cur)
    } else {
      cur = 0
    }
  }
  return best
}
