import { pickNextMatch, playerLoads, type Pairing } from './rotation'
import { matchWinnerBySets } from './ranking'
import {
  formatOf,
  type Match,
  type MatchType,
  type Player,
  type Session,
  type SessionFormat,
  type TeamSide,
} from '@/types'

/* ================================================================== *
 * 打法模式
 *
 * free     自由模式 —— 用 rotation.ts 的公平配对，边打边排
 * rotation 轮转赛   —— 开局一次生成整份固定赛程，打完为止
 * king     车轮赛   —— 赢的留场，输的排队尾，连胜到上限强制换下
 * ================================================================== */

export const teamSizeOf = (type: MatchType) => (type === 'singles' ? 1 : 2)

/**
 * 由配对生成一条可以写进 store 的比赛。
 * 开局谁先发球现实中是猜边决定的，这里随机一次。
 * courtIndex 为 null 表示还在排队，不占场地。
 */
export function matchInput(
  pairing: Pairing,
  sessionId: string,
  courtIndex: number | null,
  random = Math.random,
): Omit<Match, 'id' | 'seq'> {
  const servingTeam: TeamSide = random() < 0.5 ? 'A' : 'B'
  return {
    sessionId,
    courtIndex,
    type: pairing.type,
    teamA: pairing.teamA,
    teamB: pairing.teamB,
    games: [
      {
        a: 0,
        b: 0,
        points: [],
        serveInit: {
          servingTeam,
          rightA: pairing.teamA[0],
          rightB: pairing.teamB[0],
        },
      },
    ],
    status: courtIndex === null ? 'queued' : 'playing',
    startedAt: courtIndex === null ? undefined : Date.now(),
  }
}

/** 构造喂给配对算法用的临时比赛。只有 teamA / teamB / seq / courtIndex 会被读到 */
function syntheticMatch(pairing: Pairing, seq: number): Match {
  return {
    id: `plan-${seq}`,
    sessionId: 'plan',
    courtIndex: null,
    type: pairing.type,
    teamA: pairing.teamA,
    teamB: pairing.teamB,
    games: [],
    status: 'queued',
    seq,
  }
}

/* ------------------------------------------------------------------ *
 * 轮转赛：生成固定赛程
 * ------------------------------------------------------------------ */

export type ScheduleInput = {
  attending: Player[]
  courtCount: number
  type: MatchType
  /** 目标每人打几场 */
  perPlayer: number
  /** 直接指定要排几场，给「再加几场」用；给了就不按 perPlayer 算 */
  total?: number
  /** 生成几份候选取最优，默认 16。赛程很小，多跑几份几乎不花时间 */
  attempts?: number
  /**
   * 已经打完的比赛。中途有人走/有人来需要重新生成剩余赛程时传进来，
   * 算法会把它当历史，避免重新生成后又撞回同样的搭档。
   */
  history?: Match[]
  /** 每个人的 MMR，用来做两队实力平衡；口径同 pickNextMatch */
  mmrById?: Map<string, number>
  random?: () => number
}

export type ScheduleResult = {
  pairings: Pairing[]
  /** 一轮排几场（= 同时开几片场），界面和测试按这个切分轮次 */
  matchesPerRound: number
  /** 实际每人最少打几场 */
  perPlayerMin: number
  /** 实际每人最多打几场 */
  perPlayerMax: number
  reason?: string
}

/** 一份赛程里出现了多少种不同的搭档组合，越多越好 */
function distinctPartners(pairings: Pairing[]): number {
  const set = new Set<string>()
  for (const p of pairings) {
    for (const team of [p.teamA, p.teamB]) {
      if (team.length > 1) set.add([...team].sort().join('|'))
    }
  }
  return set.size
}

/**
 * 生成整份赛程。
 *
 * 按「轮」推进：同一轮里的人不能重复上场（他们在不同场地同时打），
 * 一轮排满就清空 busy 进入下一轮。这个结构和 tests/rotation.test.ts
 * 里的 simulate() harness 完全同构，那套公平性已经测过 ——
 * pickNextMatch 里「已打场数最少的人必须上场」是硬约束，
 * 所以每人场数天然均等 ±1，不需要额外配平。
 *
 * 单跑一遍贪心的搭档丰富度一般：每轮排完第一场后，剩下的人就被锁死了，
 * 算法没有回旋余地。赛程规模很小（十几场），所以这里直接多跑几份候选，
 * 挑搭档组合最多的那一份 —— 场数均等由硬约束保证，不会因此被牺牲。
 */
export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const { random = Math.random, attempts = 16 } = input

  let best: ScheduleResult | null = null
  for (let i = 0; i < attempts; i++) {
    const candidate = generateOnce({ ...input, random })
    if (!candidate.pairings.length) return candidate // 排不出来，直接把理由带回去
    if (
      !best ||
      candidate.pairings.length > best.pairings.length ||
      (candidate.pairings.length === best.pairings.length &&
        distinctPartners(candidate.pairings) > distinctPartners(best.pairings))
    ) {
      best = candidate
    }
  }
  return best ?? generateOnce({ ...input, random })
}

function generateOnce(input: ScheduleInput): ScheduleResult {
  const {
    attending,
    courtCount,
    type,
    perPlayer,
    history = [],
    mmrById,
    random = Math.random,
  } = input

  const need = teamSizeOf(type) * 2
  const empty: ScheduleResult = {
    pairings: [],
    matchesPerRound: 0,
    perPlayerMin: 0,
    perPlayerMax: 0,
  }

  if (attending.length < need) {
    return {
      ...empty,
      reason: `${type === 'singles' ? '单打' : '双打'}需要至少 ${need} 人`,
    }
  }
  if (perPlayer < 1) return { ...empty, reason: '每人至少要打 1 场' }

  const total =
    input.total !== undefined
      ? Math.max(1, input.total)
      : Math.max(1, Math.round((perPlayer * attending.length) / need))
  // 一轮最多开几片场：受场地数和人数双重限制
  const matchesPerRound = Math.max(
    1,
    Math.min(courtCount, Math.floor(attending.length / need)),
  )

  const timeline: Match[] = [...history].sort((a, b) => a.seq - b.seq)
  let seq = timeline.reduce((max, m) => Math.max(max, m.seq), 0)
  const pairings: Pairing[] = []

  while (pairings.length < total) {
    const busy: string[] = []
    let madeThisRound = 0

    for (let c = 0; c < matchesPerRound && pairings.length < total; c++) {
      const { pairing } = pickNextMatch({
        attending,
        matches: timeline,
        busyIds: busy,
        type,
        mmrById,
        random,
      })
      if (!pairing) break
      seq += 1
      timeline.push(syntheticMatch(pairing, seq))
      pairings.push(pairing)
      busy.push(...pairing.teamA, ...pairing.teamB)
      madeThisRound += 1
    }

    // 一场都排不出来说明卡住了，跳出避免死循环
    if (madeThisRound === 0) break
  }

  const counts = attending.map(
    (p) =>
      pairings.filter(
        (x) => x.teamA.includes(p.id) || x.teamB.includes(p.id),
      ).length,
  )

  return {
    pairings,
    matchesPerRound,
    perPlayerMin: counts.length ? Math.min(...counts) : 0,
    perPlayerMax: counts.length ? Math.max(...counts) : 0,
    reason:
      pairings.length < total
        ? `只排出 ${pairings.length} 场（目标 ${total} 场）`
        : undefined,
  }
}

/* ------------------------------------------------------------------ *
 * 车轮赛
 * ------------------------------------------------------------------ */

/**
 * 排队顺序：最久没上场的排最前。
 * 不需要新存字段 —— 一个人的排队位置就是他最后一场比赛的序号，
 * 从比赛记录直接推出来（没打过的算 0，排最前）。
 */
export function queueOrder(
  attending: Player[],
  matches: Match[],
  opts: { excludeIds?: string[]; busyIds?: string[] } = {},
): string[] {
  const exclude = new Set(opts.excludeIds ?? [])
  const busy = new Set(opts.busyIds ?? [])
  // playerLoads 已经算好了 lastSeq，这里只是换个排序口径
  const loads = playerLoads(attending, matches)
  const lastSeq = new Map(loads.map((l) => [l.playerId, l.lastSeq]))
  const arrival = new Map(attending.map((p, i) => [p.id, i]))

  return attending
    .filter((p) => !exclude.has(p.id) && !busy.has(p.id))
    .sort(
      (a, b) =>
        (lastSeq.get(a.id) ?? 0) - (lastSeq.get(b.id) ?? 0) ||
        (arrival.get(a.id) ?? 0) - (arrival.get(b.id) ?? 0),
    )
    .map((p) => p.id)
}

const sameTeam = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

/**
 * 守场组合当前连胜几场。沿同一片场往回数，换了组合或输了就停。
 */
export function courtWinStreak(
  matches: Match[],
  courtIndex: number,
  winnerIds: string[],
): number {
  const history = matches
    .filter((m) => m.courtIndex === courtIndex && m.status === 'done')
    .sort((a, b) => b.seq - a.seq)

  let streak = 0
  for (const m of history) {
    const side = matchWinnerBySets(m)
    if (!side) break
    const winners = side === 'A' ? m.teamA : m.teamB
    if (!sameTeam(winners, winnerIds)) break
    streak += 1
  }
  return streak
}

export type KingResult = {
  pairing: Pairing | null
  /** 留在场上的人；空数组表示守场者也下场了 */
  stayed: string[]
  /** 守场组合此刻的连胜数 */
  streak: number
  /** 是否因为撞到连胜上限被换下 */
  cappedOut: boolean
  reason?: string
}

/**
 * 某场打完后，同一片场的下一场怎么排。
 *
 * 挑战者按排队顺序直接组队，不走平衡算法 ——
 * 车轮赛的公平性就是队列本身，再用算法配一次会跟队列打架，
 * 而且大家排队时就想知道「我上场是跟谁一队」。
 */
export function kingOfCourtNext(input: {
  attending: Player[]
  /** 本球局所有比赛，含刚打完那场 */
  matches: Match[]
  finished: Match
  /** 连胜上限，0 = 不限 */
  streakCap: number
  excludeIds?: string[]
  /** 其他场地正在打的人 */
  busyIds?: string[]
}): KingResult {
  const { attending, matches, finished, streakCap } = input
  const teamSize = teamSizeOf(finished.type)
  const courtIndex = finished.courtIndex ?? 0

  const side = matchWinnerBySets(finished)
  if (!side) {
    return {
      pairing: null,
      stayed: [],
      streak: 0,
      cappedOut: false,
      reason: '这场没有分出胜负，先把比分记完',
    }
  }

  const winners = side === 'A' ? finished.teamA : finished.teamB
  const streak = courtWinStreak(matches, courtIndex, winners)
  const cappedOut = streakCap > 0 && streak >= streakCap

  // 守场者不进队列；被上限换下时才回到队列
  const busy = [...(input.busyIds ?? [])]
  if (!cappedOut) busy.push(...winners)

  let queue = queueOrder(attending, matches, {
    excludeIds: input.excludeIds,
    busyIds: busy,
  })

  // 守场者和败方刚打完同一场，lastSeq 相同。守场者打得更多，排在败方之后
  if (cappedOut) {
    const w = new Set(winners)
    queue = [...queue.filter((id) => !w.has(id)), ...queue.filter((id) => w.has(id))]
  }

  const needed = cappedOut ? teamSize * 2 : teamSize
  if (queue.length < needed) {
    return {
      pairing: null,
      stayed: cappedOut ? [] : winners,
      streak,
      cappedOut,
      reason: `排队区只有 ${queue.length} 人，还需要 ${needed} 人才能开下一场`,
    }
  }

  if (cappedOut) {
    const picked = queue.slice(0, teamSize * 2)
    return {
      pairing: {
        teamA: picked.slice(0, teamSize),
        teamB: picked.slice(teamSize, teamSize * 2),
        type: finished.type,
      },
      stayed: [],
      streak,
      cappedOut,
    }
  }

  return {
    pairing: {
      teamA: winners,
      teamB: queue.slice(0, teamSize),
      type: finished.type,
    },
    stayed: winners,
    streak,
    cappedOut,
    reason: undefined,
  }
}

/** 界面上要显示「谁在守场、连胜几场」 */
export function courtHolder(
  matches: Match[],
  courtIndex: number,
): { ids: string[]; streak: number } | null {
  const live = matches.find(
    (m) => m.courtIndex === courtIndex && m.status === 'playing',
  )
  if (!live) return null
  for (const team of [live.teamA, live.teamB]) {
    const streak = courtWinStreak(matches, courtIndex, team)
    if (streak > 0) return { ids: team, streak }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 进度与结束条件
 * ------------------------------------------------------------------ */

export type SessionProgress = {
  format: SessionFormat
  played: number
  totalTarget?: number
  elapsedMinutes: number
  durationTarget?: number
  /** 当前打得最少的人打了几场 */
  perPlayerMin: number
  perPlayerTarget?: number
  /** 轮转赛：赛程还剩几场 / 一共几场 */
  scheduleRemaining?: number
  scheduleTotal?: number
  /** 按目前节奏，剩下的时间还够打几场（设了时长且有足够样本时才给） */
  estimatedMatchesLeft?: number
  /** 达到任一上限，或轮转赛赛程打完 */
  shouldWrapUp: boolean
  wrapUpReason?: string
  /** 上限到了但「每人打满 N 场」还没满足 */
  unmetFloor?: string
}

export function sessionProgress(
  session: Session,
  matches: Match[],
  now = Date.now(),
): SessionProgress {
  const format = formatOf(session)
  const end = session.endCondition ?? {}
  const done = matches.filter((m) => m.status === 'done')
  const played = done.length

  const until = session.endedAt ?? now
  const elapsedMinutes = Math.max(
    0,
    Math.floor((until - session.createdAt) / 60000),
  )

  const perPlayerCounts = session.playerIds.map(
    (id) =>
      done.filter((m) => m.teamA.includes(id) || m.teamB.includes(id)).length,
  )
  const perPlayerMin = perPlayerCounts.length ? Math.min(...perPlayerCounts) : 0

  const scheduleTotal = format === 'rotation' ? matches.length : undefined
  const scheduleRemaining =
    format === 'rotation'
      ? matches.filter((m) => m.status !== 'done').length
      : undefined

  // 已打完的场次给出「平均多久一场」，据此估算剩余时间还够打几场。
  // 这是挂钟节奏，已经把多片场并行算进去了。
  let estimatedMatchesLeft: number | undefined
  if (end.durationMinutes && played >= 3) {
    const minutesPerMatch = elapsedMinutes / played
    const left = end.durationMinutes - elapsedMinutes
    if (minutesPerMatch > 0) {
      estimatedMatchesLeft = Math.max(0, Math.floor(left / minutesPerMatch))
    }
  }

  let shouldWrapUp = false
  let wrapUpReason: string | undefined

  if (format === 'rotation' && scheduleRemaining === 0 && matches.length > 0) {
    shouldWrapUp = true
    wrapUpReason = '赛程全部打完了'
  } else if (end.totalMatches && played >= end.totalMatches) {
    shouldWrapUp = true
    wrapUpReason = `已经打满 ${end.totalMatches} 场了`
  } else if (end.durationMinutes && elapsedMinutes >= end.durationMinutes) {
    shouldWrapUp = true
    wrapUpReason = `已经打了 ${elapsedMinutes} 分钟，超过预定的 ${end.durationMinutes} 分钟`
  }

  let unmetFloor: string | undefined
  if (end.perPlayerMatches) {
    const short = perPlayerCounts.filter((c) => c < end.perPlayerMatches!).length
    if (short > 0) {
      unmetFloor = `还有 ${short} 人没打满 ${end.perPlayerMatches} 场`
    }
  }

  return {
    format,
    played,
    totalTarget: end.totalMatches,
    elapsedMinutes,
    durationTarget: end.durationMinutes,
    perPlayerMin,
    perPlayerTarget: end.perPlayerMatches,
    scheduleRemaining,
    scheduleTotal,
    estimatedMatchesLeft,
    shouldWrapUp,
    wrapUpReason,
    unmetFloor,
  }
}
