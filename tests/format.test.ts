import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  courtHolder,
  courtWinStreak,
  kingOfCourtNext,
  queueOrder,
  sessionProgress,
} from '@/lib/sessionFormat'
import {
  DEFAULT_RULES,
  formatOf,
  type Gender,
  type Level,
  type Match,
  type MatchType,
  type Player,
  type Session,
} from '@/types'

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function makePlayers(
  n: number,
  opts: { levels?: Level[]; genders?: Gender[] } = {},
): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `球员${i + 1}`,
    level: (opts.levels?.[i] ?? 3) as Level,
    gender: (opts.genders?.[i] ?? '-') as Gender,
    archived: false,
    createdAt: i,
  }))
}

let seq = 0
function match(
  teamA: string[],
  teamB: string[],
  score: [number, number],
  over: Partial<Match> = {},
): Match {
  seq += 1
  return {
    id: `m${seq}`,
    sessionId: 's1',
    courtIndex: 0,
    type: teamA.length > 1 ? 'doubles' : 'singles',
    teamA,
    teamB,
    games: [{ a: score[0], b: score[1], points: null, serveInit: null }],
    status: 'done',
    seq,
    endedAt: 1_700_000_000_000 + seq * 1000,
    ...over,
  }
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    date: '2026-08-11',
    venue: '球馆',
    courtCount: 1,
    playerIds: [],
    defaultType: 'doubles',
    rules: DEFAULT_RULES,
    fee: { courtFee: 0, shuttleCount: 0, shuttleUnitPrice: 0, paidPlayerIds: [] },
    status: 'active',
    createdAt: 1_700_000_000_000,
    ...over,
  }
}

const gamesOf = (players: Player[], pairings: { teamA: string[]; teamB: string[] }[]) =>
  players.map(
    (p) =>
      pairings.filter(
        (x) => x.teamA.includes(p.id) || x.teamB.includes(p.id),
      ).length,
  )

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/* ================================================================== */

describe('轮转赛：生成固定赛程', () => {
  it('8 人 2 片场每人 6 场 → 共 12 场，每人正好 6 场', () => {
    const players = makePlayers(8)
    const s = buildSchedule({
      attending: players,
      courtCount: 2,
      type: 'doubles',
      perPlayer: 6,
      random: seeded(1),
    })
    expect(s.pairings).toHaveLength(12)
    expect(gamesOf(players, s.pairings)).toEqual([6, 6, 6, 6, 6, 6, 6, 6])
    expect(s.perPlayerMin).toBe(6)
    expect(s.perPlayerMax).toBe(6)
    expect(s.reason).toBeUndefined()
  })

  it('同一轮里没有人重复上场（他们在不同场地同时打）', () => {
    const players = makePlayers(8)
    const s = buildSchedule({
      attending: players,
      courtCount: 2,
      type: 'doubles',
      perPlayer: 6,
      random: seeded(7),
    })
    for (let i = 0; i < s.pairings.length; i += s.matchesPerRound) {
      const round = s.pairings.slice(i, i + s.matchesPerRound)
      const ids = round.flatMap((p) => [...p.teamA, ...p.teamB])
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('人数不能被 4 整除时场数均等 ±1', () => {
    for (const n of [5, 6, 7, 9, 11, 13]) {
      const players = makePlayers(n)
      const s = buildSchedule({
        attending: players,
        courtCount: 2,
        type: 'doubles',
        perPlayer: 6,
        random: seeded(n * 13),
      })
      expect(s.perPlayerMax - s.perPlayerMin).toBeLessThanOrEqual(1)
      expect(s.perPlayerMin).toBeGreaterThan(0)
    }
  })

  it('刚好 4 人 1 片场也能生成', () => {
    const players = makePlayers(4)
    const s = buildSchedule({
      attending: players,
      courtCount: 1,
      type: 'doubles',
      perPlayer: 6,
      random: seeded(3),
    })
    expect(s.pairings).toHaveLength(6)
    expect(s.matchesPerRound).toBe(1)
    expect(gamesOf(players, s.pairings)).toEqual([6, 6, 6, 6])
  })

  it('场地数超过人数支撑时按人数收敛，不会排出重复上场的一轮', () => {
    const players = makePlayers(5)
    const s = buildSchedule({
      attending: players,
      courtCount: 4,
      type: 'doubles',
      perPlayer: 4,
      random: seeded(5),
    })
    expect(s.matchesPerRound).toBe(1) // 5 人只够开 1 片场
    for (const p of s.pairings) {
      const ids = [...p.teamA, ...p.teamB]
      expect(new Set(ids).size).toBe(4)
    }
  })

  it('8 人每人 6 场：24 个搭档位全部不重复（水平相同时）', () => {
    // 前提是大家水平一样。水平参差时算法会为了两队实力接近
    // 牺牲一点搭档多样性，见下一条测试
    const players = makePlayers(8)
    const s = buildSchedule({
      attending: players,
      courtCount: 2,
      type: 'doubles',
      perPlayer: 6,
      random: seeded(21),
    })
    const partners: string[] = []
    for (const p of s.pairings) {
      partners.push(pairKey(p.teamA[0], p.teamA[1]))
      partners.push(pairKey(p.teamB[0], p.teamB[1]))
    }
    expect(partners).toHaveLength(24)
    expect(new Set(partners).size).toBe(24) // 一次重复都没有
  })

  it('水平参差时优先保证两队实力接近，搭档多样性稍作让步', () => {
    const players = makePlayers(8, { levels: [5, 5, 4, 4, 2, 2, 1, 1] })
    const levelOf = new Map(players.map((p) => [p.id, p.level as number]))
    const s = buildSchedule({
      attending: players,
      courtCount: 2,
      type: 'doubles',
      perPlayer: 6,
      random: seeded(31),
    })

    // 实力平衡是主要目标：两队水平和的平均差距要小
    const sum = (t: string[]) => t.reduce((a, id) => a + levelOf.get(id)!, 0)
    const gaps = s.pairings.map((p) => Math.abs(sum(p.teamA) - sum(p.teamB)))
    expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeLessThan(1.5)

    // 强弱分成两档时，要保证队伍平衡就只能强配弱，
    // 可能的搭档组合本来就只有 4×4 = 16 种 —— 算法把 16 种全用上了，
    // 这已经是这个配置下的上限，不是退化
    const partners = new Set<string>()
    for (const p of s.pairings) {
      partners.add(pairKey(p.teamA[0], p.teamA[1]))
      partners.add(pairKey(p.teamB[0], p.teamB[1]))
    }
    expect(partners.size).toBe(16)

    // 场数均等这条硬约束任何时候都不让步
    expect(s.perPlayerMax - s.perPlayerMin).toBe(0)
  })

  it('6 人只有 15 种搭档组合，能全部用上', () => {
    const players = makePlayers(6)
    const s = buildSchedule({
      attending: players,
      courtCount: 1,
      type: 'doubles',
      perPlayer: 6,
      random: seeded(6),
    })
    const partners = new Set<string>()
    for (const p of s.pairings) {
      partners.add(pairKey(p.teamA[0], p.teamA[1]))
      partners.add(pairKey(p.teamB[0], p.teamB[1]))
    }
    expect(partners.size).toBe(15)
  })

  it('多份候选能稳定拿到最优搭档分布，单份不能', () => {
    const players = makePlayers(8)
    const count = (attempts: number, seed: number) => {
      const s = buildSchedule({
        attending: players,
        courtCount: 2,
        type: 'doubles',
        perPlayer: 6,
        attempts,
        random: seeded(seed),
      })
      const set = new Set<string>()
      for (const p of s.pairings) {
        set.add(pairKey(p.teamA[0], p.teamA[1]))
        set.add(pairKey(p.teamB[0], p.teamB[1]))
      }
      return set.size
    }
    const seeds = [1, 42, 99, 2026, 7777]
    const many = seeds.map((s) => count(16, s))
    const once = seeds.map((s) => count(1, s))

    // 多份候选每次都摸到上限 24
    expect(many).toEqual([24, 24, 24, 24, 24])
    // 单份候选靠运气，至少有一次没摸到
    expect(once.some((n) => n < 24)).toBe(true)
    // 而且任何一个种子下都不会更差
    seeds.forEach((_, i) => expect(many[i]).toBeGreaterThanOrEqual(once[i]))
  })

  it('搭档铺得开：8 人 14 场应覆盖大部分组合', () => {
    const players = makePlayers(8)
    const s = buildSchedule({
      attending: players,
      courtCount: 2,
      type: 'doubles',
      perPlayer: 7,
      random: seeded(11),
    })
    expect(s.pairings).toHaveLength(14)
    const partners = new Set<string>()
    for (const p of s.pairings) {
      partners.add(pairKey(p.teamA[0], p.teamA[1]))
      partners.add(pairKey(p.teamB[0], p.teamB[1]))
    }
    // 8 人共 28 种搭档，14 场提供 28 个搭档位，理想是全覆盖
    expect(partners.size).toBeGreaterThanOrEqual(24)
  })

  it('重新生成剩余赛程时会避开已经打过的搭档', () => {
    const players = makePlayers(8)
    // 已经打完两场，p1+p2 和 p3+p4 刚搭过
    const history = [
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 }),
      match(['p5', 'p6'], ['p7', 'p8'], [21, 15], { seq: 2 }),
    ]
    const s = buildSchedule({
      attending: players,
      courtCount: 2,
      type: 'doubles',
      perPlayer: 4,
      history,
      random: seeded(2),
    })
    const firstRound = s.pairings.slice(0, s.matchesPerRound)
    const keys = firstRound.flatMap((p) => [
      pairKey(p.teamA[0], p.teamA[1]),
      pairKey(p.teamB[0], p.teamB[1]),
    ])
    expect(keys).not.toContain(pairKey('p1', 'p2'))
    expect(keys).not.toContain(pairKey('p3', 'p4'))
  })

  it('单打赛程：每场 2 人', () => {
    const players = makePlayers(6)
    const s = buildSchedule({
      attending: players,
      courtCount: 1,
      type: 'singles',
      perPlayer: 4,
      random: seeded(4),
    })
    expect(s.pairings).toHaveLength(12) // 4 × 6 / 2
    for (const p of s.pairings) {
      expect(p.teamA).toHaveLength(1)
      expect(p.teamB).toHaveLength(1)
    }
  })

  it('人不够时给人话理由而不是空转', () => {
    const s = buildSchedule({
      attending: makePlayers(3),
      courtCount: 1,
      type: 'doubles',
      perPlayer: 6,
    })
    expect(s.pairings).toHaveLength(0)
    expect(s.reason).toContain('至少 4 人')
  })
})

/* ================================================================== */

describe('车轮赛：排队顺序', () => {
  it('没上过场的排最前，刚下场的排最后', () => {
    const players = makePlayers(6)
    const matches = [
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 }),
      match(['p1', 'p2'], ['p5', 'p6'], [21, 15], { seq: 2 }),
    ]
    // p3 p4 最后一场是 seq1，p5 p6 是 seq2，p1 p2 也是 seq2
    expect(queueOrder(players, matches)).toEqual([
      'p3', 'p4', 'p1', 'p2', 'p5', 'p6',
    ])
  })

  it('从没上过场的人一定排在所有打过的人前面', () => {
    const players = makePlayers(5)
    const matches = [match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 })]
    expect(queueOrder(players, matches)[0]).toBe('p5')
  })

  it('休息中和在别的场地打球的人不进队列', () => {
    const players = makePlayers(6)
    const q = queueOrder(players, [], {
      excludeIds: ['p2'],
      busyIds: ['p3', 'p4'],
    })
    expect(q).toEqual(['p1', 'p5', 'p6'])
  })

  it('并列时按出席顺序，结果确定', () => {
    const players = makePlayers(4)
    expect(queueOrder(players, [])).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(queueOrder(players, [])).toEqual(queueOrder(players, []))
  })
})

describe('车轮赛：连胜统计', () => {
  it('连赢三场算 3', () => {
    const ms = [
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 }),
      match(['p1', 'p2'], ['p5', 'p6'], [21, 10], { seq: 2 }),
      match(['p1', 'p2'], ['p3', 'p4'], [21, 18], { seq: 3 }),
    ]
    expect(courtWinStreak(ms, 0, ['p1', 'p2'])).toBe(3)
  })

  it('中间输过就从头算', () => {
    const ms = [
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 }),
      match(['p1', 'p2'], ['p5', 'p6'], [15, 21], { seq: 2 }),
      match(['p5', 'p6'], ['p1', 'p2'], [21, 18], { seq: 3 }),
    ]
    expect(courtWinStreak(ms, 0, ['p1', 'p2'])).toBe(0)
    expect(courtWinStreak(ms, 0, ['p5', 'p6'])).toBe(2)
  })

  it('只数同一片场，别的场地不算', () => {
    const ms = [
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1, courtIndex: 0 }),
      match(['p1', 'p2'], ['p5', 'p6'], [21, 15], { seq: 2, courtIndex: 1 }),
    ]
    expect(courtWinStreak(ms, 0, ['p1', 'p2'])).toBe(1)
  })

  it('看板能读出当前守场者和连胜数', () => {
    const ms = [
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 }),
      match(['p1', 'p2'], ['p5', 'p6'], [0, 0], { seq: 2, status: 'playing' }),
    ]
    expect(courtHolder(ms, 0)).toEqual({ ids: ['p1', 'p2'], streak: 1 })
  })
})

describe('车轮赛：排下一场', () => {
  const players = makePlayers(8)

  it('赢的留场，队头两人组队上来挑战', () => {
    const finished = match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 })
    const out = kingOfCourtNext({
      attending: players,
      matches: [finished],
      finished,
      streakCap: 3,
    })
    expect(out.stayed).toEqual(['p1', 'p2'])
    expect(out.pairing!.teamA).toEqual(['p1', 'p2'])
    // p5~p8 没上过场排最前，取队头两个
    expect(out.pairing!.teamB).toEqual(['p5', 'p6'])
    expect(out.cappedOut).toBe(false)
    expect(out.streak).toBe(1)
  })

  it('输的两人排到队尾', () => {
    const finished = match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 })
    const out = kingOfCourtNext({
      attending: players,
      matches: [finished],
      finished,
      streakCap: 3,
    })
    // 败方 p3 p4 不在下一场里
    const next = [...out.pairing!.teamA, ...out.pairing!.teamB]
    expect(next).not.toContain('p3')
    expect(next).not.toContain('p4')
  })

  it('达到连胜上限时守场者被强制换下，且排在败方之后', () => {
    const ms = [
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 }),
      match(['p1', 'p2'], ['p5', 'p6'], [21, 15], { seq: 2 }),
      match(['p1', 'p2'], ['p7', 'p8'], [21, 15], { seq: 3 }),
    ]
    const out = kingOfCourtNext({
      attending: players,
      matches: ms,
      finished: ms[2],
      streakCap: 3,
    })
    expect(out.cappedOut).toBe(true)
    expect(out.streak).toBe(3)
    expect(out.stayed).toEqual([])
    const next = [...out.pairing!.teamA, ...out.pairing!.teamB]
    expect(next).not.toContain('p1')
    expect(next).not.toContain('p2')
    // 最久没上的 p3 p4（seq1）排在刚下场的 p7 p8（seq3）前面
    expect(out.pairing!.teamA).toEqual(['p3', 'p4'])
  })

  it('连胜上限设 0 表示不限，赢到底', () => {
    const ms = [
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 }),
      match(['p1', 'p2'], ['p5', 'p6'], [21, 15], { seq: 2 }),
      match(['p1', 'p2'], ['p7', 'p8'], [21, 15], { seq: 3 }),
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 4 }),
    ]
    const out = kingOfCourtNext({
      attending: players,
      matches: ms,
      finished: ms[3],
      streakCap: 0,
    })
    expect(out.cappedOut).toBe(false)
    expect(out.stayed).toEqual(['p1', 'p2'])
  })

  it('单打车轮赛：赢的留下，下一个人上', () => {
    const four = makePlayers(4)
    const finished = match(['p1'], ['p2'], [21, 15], { seq: 1 })
    const out = kingOfCourtNext({
      attending: four,
      matches: [finished],
      finished,
      streakCap: 3,
    })
    expect(out.pairing).toEqual({ teamA: ['p1'], teamB: ['p3'], type: 'singles' })
  })

  it('多片场时不会把别的场地正在打的人排进来', () => {
    const finished = match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 })
    const out = kingOfCourtNext({
      attending: players,
      matches: [finished],
      finished,
      streakCap: 3,
      busyIds: ['p5', 'p6'],
    })
    expect(out.pairing!.teamB).toEqual(['p7', 'p8'])
  })

  it('没有别人排队时，败方原地再战一场', () => {
    // 场上刚好 4 个人，队列里只有刚输的两人，只能他们再上
    const four = makePlayers(4)
    const finished = match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 })
    const out = kingOfCourtNext({
      attending: four,
      matches: [finished],
      finished,
      streakCap: 3,
    })
    expect(out.stayed).toEqual(['p1', 'p2'])
    expect(out.pairing!.teamB).toEqual(['p3', 'p4'])
  })

  it('排队人数不够时给人话理由', () => {
    const four = makePlayers(4)
    const finished = match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: 1 })
    const out = kingOfCourtNext({
      attending: four,
      matches: [finished],
      finished,
      streakCap: 3,
      busyIds: ['p4'], // p4 被叫去别的场地，凑不出两个挑战者
    })
    expect(out.pairing).toBe(null)
    expect(out.reason).toContain('还需要')
  })

  it('比分还没分出胜负时不排下一场', () => {
    const finished = match(['p1', 'p2'], ['p3', 'p4'], [0, 0], { seq: 1 })
    const out = kingOfCourtNext({
      attending: players,
      matches: [finished],
      finished,
      streakCap: 3,
    })
    expect(out.pairing).toBe(null)
    expect(out.reason).toContain('没有分出胜负')
  })
})

/* ================================================================== */

describe('进度与结束条件', () => {
  const four = ['p1', 'p2', 'p3', 'p4']
  const played = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: i + 1 }),
    )

  it('总场数到上限就提示结束', () => {
    const s = session({ playerIds: four, endCondition: { totalMatches: 5 } })
    expect(sessionProgress(s, played(4)).shouldWrapUp).toBe(false)
    const p = sessionProgress(s, played(5))
    expect(p.shouldWrapUp).toBe(true)
    expect(p.wrapUpReason).toContain('打满 5 场')
  })

  it('时长到上限就提示结束', () => {
    const s = session({ playerIds: four, endCondition: { durationMinutes: 120 } })
    const now = s.createdAt + 121 * 60000
    const p = sessionProgress(s, played(3), now)
    expect(p.elapsedMinutes).toBe(121)
    expect(p.shouldWrapUp).toBe(true)
    expect(p.wrapUpReason).toContain('120 分钟')
  })

  it('按目前节奏估算剩余时间还够打几场', () => {
    const s = session({ playerIds: four, endCondition: { durationMinutes: 120 } })
    // 60 分钟打了 6 场 → 10 分钟一场，还剩 60 分钟 → 还够 6 场
    const now = s.createdAt + 60 * 60000
    expect(sessionProgress(s, played(6), now).estimatedMatchesLeft).toBe(6)
  })

  it('样本太少时不给估算，避免瞎猜', () => {
    const s = session({ playerIds: four, endCondition: { durationMinutes: 120 } })
    const now = s.createdAt + 10 * 60000
    expect(sessionProgress(s, played(2), now).estimatedMatchesLeft).toBeUndefined()
  })

  it('每人打满 N 场是下限，没满足时给提示', () => {
    const s = session({
      playerIds: [...four, 'p5'],
      endCondition: { totalMatches: 3, perPlayerMatches: 2 },
    })
    const p = sessionProgress(s, played(3))
    expect(p.shouldWrapUp).toBe(true)
    expect(p.perPlayerMin).toBe(0) // p5 一场没打
    expect(p.unmetFloor).toContain('还有 1 人没打满 2 场')
  })

  it('下限满足了就不提示', () => {
    const s = session({ playerIds: four, endCondition: { perPlayerMatches: 2 } })
    expect(sessionProgress(s, played(3)).unmetFloor).toBeUndefined()
  })

  it('轮转赛赛程打完自动提示结束', () => {
    const s = session({ playerIds: four, format: 'rotation' })
    const all = [
      ...played(2),
      match(['p1', 'p3'], ['p2', 'p4'], [0, 0], { seq: 3, status: 'queued' }),
    ]
    expect(sessionProgress(s, all).shouldWrapUp).toBe(false)
    expect(sessionProgress(s, all).scheduleRemaining).toBe(1)

    const done = played(3)
    const p = sessionProgress(s, done)
    expect(p.shouldWrapUp).toBe(true)
    expect(p.wrapUpReason).toContain('赛程全部打完')
    expect(p.scheduleTotal).toBe(3)
  })

  it('球局已结束时按 endedAt 算时长，不会一直涨', () => {
    const s = session({
      playerIds: four,
      status: 'ended',
      endedAt: 1_700_000_000_000 + 90 * 60000,
      createdAt: 1_700_000_000_000,
    })
    const later = 1_700_000_000_000 + 500 * 60000
    expect(sessionProgress(s, played(3), later).elapsedMinutes).toBe(90)
  })
})

describe('向后兼容：v1 存下来的旧球局', () => {
  it('没有 format 字段就当自由模式', () => {
    const old = session({ playerIds: ['p1', 'p2', 'p3', 'p4'] })
    delete (old as Partial<Session>).format
    expect(formatOf(old)).toBe('free')
  })

  it('没有任何结束条件时不会提示结束', () => {
    const old = session({ playerIds: ['p1', 'p2', 'p3', 'p4'] })
    const p = sessionProgress(
      old,
      Array.from({ length: 30 }, (_, i) =>
        match(['p1', 'p2'], ['p3', 'p4'], [21, 15], { seq: i + 1 }),
      ),
    )
    expect(p.shouldWrapUp).toBe(false)
    expect(p.wrapUpReason).toBeUndefined()
    expect(p.unmetFloor).toBeUndefined()
    expect(p.scheduleRemaining).toBeUndefined()
    expect(p.format).toBe('free')
  })

  it('缺 restingIds / endCondition 也不会崩', () => {
    const old = session({ playerIds: ['p1', 'p2'] })
    delete (old as Partial<Session>).restingIds
    delete (old as Partial<Session>).endCondition
    expect(() => sessionProgress(old, [])).not.toThrow()
    expect(sessionProgress(old, []).perPlayerMin).toBe(0)
  })
})

/* 保证 MatchType 联合类型没被改坏 */
const _types: MatchType[] = ['singles', 'doubles', 'mixed']
void _types
