import { describe, expect, it } from 'vitest'
import {
  bestPartner,
  computeStats,
  decidedMatches,
  longestWinStreak,
  matchWinnerBySets,
  mvpOf,
  nemesis,
  rankPlayers,
  totalPoints,
} from '@/lib/ranking'
import { money, roundUpToHalf, splitFee } from '@/lib/fee'
import { progressOf } from '@/lib/avatar'
import { DEFAULT_RULES, type Match, type Session } from '@/types'

let seq = 0
function match(
  teamA: string[],
  teamB: string[],
  games: [number, number][],
  status: Match['status'] = 'done',
): Match {
  seq += 1
  return {
    id: `m${seq}`,
    sessionId: 's1',
    courtIndex: 0,
    type: teamA.length > 1 ? 'doubles' : 'singles',
    teamA,
    teamB,
    games: games.map(([a, b]) => ({ a, b, points: null, serveInit: null })),
    status,
    seq,
    endedAt: 1_700_000_000_000 + seq * 1000,
  }
}

describe('胜负与得分', () => {
  it('赢的局数多的一方胜', () => {
    expect(matchWinnerBySets(match(['a'], ['b'], [[21, 15]]))).toBe('A')
    expect(
      matchWinnerBySets(match(['a'], ['b'], [[21, 15], [18, 21], [19, 21]])),
    ).toBe('B')
  })

  it('没打出胜负的比赛不算进统计', () => {
    const m = match(['a'], ['b'], [[0, 0]])
    expect(matchWinnerBySets(m)).toBe(null)
    expect(computeStats([m], ['a'])[0].games).toBe(0)
  })

  it('还在打的比赛不算进统计', () => {
    const m = match(['a'], ['b'], [[15, 10]], 'playing')
    expect(computeStats([m], ['a'])[0].games).toBe(0)
  })

  it('多局的总得分相加', () => {
    expect(totalPoints(match(['a'], ['b'], [[21, 15], [18, 21]]))).toEqual({
      A: 39,
      B: 36,
    })
  })
})

describe('球员统计', () => {
  const matches = [
    match(['a', 'b'], ['c', 'd'], [[21, 15]]), // a,b 胜
    match(['a', 'c'], ['b', 'd'], [[21, 19]]), // a,c 胜
    match(['a', 'd'], ['b', 'c'], [[18, 21]]), // b,c 胜
  ]

  it('胜率、净分差、连胜都算对', () => {
    const [a] = computeStats(matches, ['a'])
    expect(a).toMatchObject({
      games: 3,
      wins: 2,
      losses: 1,
      pointsFor: 21 + 21 + 18,
      pointsAgainst: 15 + 19 + 21,
      qualified: true,
    })
    expect(a.winRate).toBeCloseTo(2 / 3)
    expect(a.diff).toBe(5)
    expect(a.streak).toBe(-1) // 最后一场输了
  })

  it('连胜是从最后一场往前数的', () => {
    const [b] = computeStats(matches, ['b'])
    expect(b.streak).toBe(1) // 最后一场赢
    expect(longestWinStreak('b', matches)).toBe(1)
  })

  it('跨球局按时间排序，连胜不会被 seq 重置搞乱', () => {
    // 第二个球局的 seq 从 1 重新开始，但时间在后面
    const s1 = { ...match(['a'], ['x'], [[21, 10]]), sessionId: 's1', seq: 5, endedAt: 1000 }
    const s2 = { ...match(['a'], ['y'], [[10, 21]]), sessionId: 's2', seq: 1, endedAt: 2000 }
    const [a] = computeStats([s1, s2], ['a'])
    expect(a.streak).toBe(-1) // 最后（时间上）是输
    expect(longestWinStreak('a', [s1, s2])).toBe(1)
  })
})

describe('排行榜口径', () => {
  it('胜率优先，同胜率看净分差', () => {
    const matches = [
      match(['a'], ['z'], [[21, 5]]),
      match(['a'], ['z'], [[21, 5]]),
      match(['a'], ['z'], [[21, 5]]),
      match(['b'], ['z'], [[21, 19]]),
      match(['b'], ['z'], [[21, 19]]),
      match(['b'], ['z'], [[21, 19]]),
    ]
    const ranked = rankPlayers(computeStats(matches, ['a', 'b', 'z']))
    expect(ranked.map((r) => r.playerId)).toEqual(['a', 'b', 'z'])
  })

  it('场次不足的人排在合格球员之后，哪怕全胜', () => {
    const matches = [
      match(['rookie'], ['z'], [[21, 0]]), // 1 场全胜
      match(['vet'], ['z'], [[21, 19]]),
      match(['vet'], ['z'], [[21, 19]]),
      match(['vet'], ['z'], [[19, 21]]),
    ]
    const ranked = rankPlayers(computeStats(matches, ['rookie', 'vet', 'z']))
    expect(ranked[0].playerId).toBe('vet')
    expect(ranked.find((r) => r.playerId === 'rookie')!.qualified).toBe(false)
  })

  it('没上过场的人不进榜', () => {
    const matches = [match(['a'], ['b'], [[21, 10]])]
    const ranked = rankPlayers(computeStats(matches, ['a', 'b', 'ghost']))
    expect(ranked.map((r) => r.playerId)).not.toContain('ghost')
  })

  it('MVP 必须达门槛', () => {
    const oneGame = [match(['a'], ['b'], [[21, 0]])]
    expect(mvpOf(computeStats(oneGame, ['a', 'b']))).toBe(null)

    const enough = [
      match(['a'], ['b'], [[21, 0]]),
      match(['a'], ['b'], [[21, 0]]),
      match(['a'], ['b'], [[21, 0]]),
    ]
    expect(mvpOf(computeStats(enough, ['a', 'b']))!.playerId).toBe('a')
  })
})

describe('趣味统计', () => {
  it('最佳搭档取同队 ≥3 场里胜率最高的', () => {
    const matches = [
      match(['a', 'good'], ['x', 'y'], [[21, 10]]),
      match(['a', 'good'], ['x', 'y'], [[21, 10]]),
      match(['a', 'good'], ['x', 'y'], [[21, 10]]),
      match(['a', 'bad'], ['x', 'y'], [[10, 21]]),
      match(['a', 'bad'], ['x', 'y'], [[10, 21]]),
      match(['a', 'bad'], ['x', 'y'], [[10, 21]]),
    ]
    expect(bestPartner('a', matches)).toMatchObject({
      partnerId: 'good',
      games: 3,
      wins: 3,
    })
  })

  it('同队场次不够时不给最佳搭档', () => {
    const matches = [match(['a', 'b'], ['x', 'y'], [[21, 10]])]
    expect(bestPartner('a', matches)).toBe(null)
  })

  it('单打不产生搭档', () => {
    const matches = [
      match(['a'], ['b'], [[21, 10]]),
      match(['a'], ['b'], [[21, 10]]),
      match(['a'], ['b'], [[21, 10]]),
    ]
    expect(bestPartner('a', matches)).toBe(null)
  })

  it('苦主是输给最多次的对手', () => {
    const matches = [
      match(['a'], ['boss'], [[10, 21]]),
      match(['a'], ['boss'], [[10, 21]]),
      match(['a'], ['easy'], [[21, 10]]),
    ]
    expect(nemesis('a', matches)).toMatchObject({ opponentId: 'boss', losses: 2 })
  })

  it('没输过就没有苦主', () => {
    const matches = [match(['a'], ['b'], [[21, 10]])]
    expect(nemesis('a', matches)).toBe(null)
  })

  it('最长连胜取历史最好，不是当前', () => {
    const matches = [
      match(['a'], ['z'], [[21, 10]]),
      match(['a'], ['z'], [[21, 10]]),
      match(['a'], ['z'], [[21, 10]]),
      match(['a'], ['z'], [[10, 21]]),
    ]
    expect(longestWinStreak('a', matches)).toBe(3)
    expect(computeStats(matches, ['a'])[0].streak).toBe(-1)
  })
})

describe('费用 AA', () => {
  const session = (over: Partial<Session['fee']>, playerIds: string[]): Session => ({
    id: 's1',
    date: '2026-08-10',
    venue: '球馆',
    courtCount: 2,
    playerIds,
    defaultType: 'doubles',
    rules: DEFAULT_RULES,
    fee: {
      courtFee: 0,
      shuttleCount: 0,
      shuttleUnitPrice: 0,
      paidPlayerIds: [],
      ...over,
    },
    status: 'ended',
    createdAt: 0,
  })

  it('场地费加球钱除以人数，向上取整到 0.5', () => {
    // 60 + 3*8 = 84，7 人 → 12
    const f = splitFee(session({ courtFee: 60, shuttleCount: 3, shuttleUnitPrice: 8 }, [
      'a', 'b', 'c', 'd', 'e', 'f', 'g',
    ]))
    expect(f.total).toBe(84)
    expect(f.shuttleTotal).toBe(24)
    expect(f.perPerson).toBe(12)
  })

  it('除不尽时往上凑到 0.5', () => {
    // 100 / 7 = 14.28... → 14.5
    const f = splitFee(session({ courtFee: 100 }, ['a', 'b', 'c', 'd', 'e', 'f', 'g']))
    expect(f.perPerson).toBe(14.5)
  })

  it('统计谁还没付', () => {
    const f = splitFee(
      session({ courtFee: 40, paidPlayerIds: ['a', 'b'] }, ['a', 'b', 'c', 'd']),
    )
    expect(f.perPerson).toBe(10)
    expect(f.unpaidIds).toEqual(['c', 'd'])
    expect(f.collected).toBe(20)
    expect(f.outstanding).toBe(20)
  })

  it('已付名单里的幽灵球员不算钱', () => {
    const f = splitFee(session({ courtFee: 40, paidPlayerIds: ['ghost'] }, ['a', 'b']))
    expect(f.collected).toBe(0)
    expect(f.unpaidIds).toEqual(['a', 'b'])
  })

  it('没人出席时不会除以 0', () => {
    const f = splitFee(session({ courtFee: 40 }, []))
    expect(f.perPerson).toBe(0)
    expect(f.outstanding).toBe(0)
  })

  it('负数输入当 0 处理', () => {
    const f = splitFee(session({ courtFee: -50, shuttleCount: -2 }, ['a', 'b']))
    expect(f.total).toBe(0)
  })

  it('金额显示', () => {
    expect(roundUpToHalf(14.01)).toBe(14.5)
    expect(money(12)).toBe('12')
    expect(money(14.5)).toBe('14.5')
  })
})

describe('友谊赛不进累计统计', () => {
  const friendlyMatch = (id: string, a: string[], b: string[], seq: number): Match => ({
    id,
    sessionId: 'f1',
    courtIndex: 0,
    type: 'doubles',
    teamA: a,
    teamB: b,
    games: [{ a: 21, b: 10, points: null, serveInit: null }],
    status: 'done',
    seq,
    endedAt: seq * 1000,
    friendly: true,
  })

  const normal = (id: string, a: string[], b: string[], seq: number): Match => ({
    ...friendlyMatch(id, a, b, seq),
    sessionId: 's1',
    friendly: undefined,
  })

  it('decidedMatches 默认把友谊赛挡掉', () => {
    const ms = [normal('n1', ['p1'], ['p2'], 1), friendlyMatch('f1', ['p1'], ['g1'], 2)]
    expect(decidedMatches(ms).map((m) => m.id)).toEqual(['n1'])
    expect(decidedMatches(ms, { includeFriendly: true }).map((m) => m.id)).toEqual([
      'n1',
      'f1',
    ])
  })

  it('友谊赛赢再多也不涨 MMR、不进段位', () => {
    const only = [
      friendlyMatch('f1', ['p1'], ['g1'], 1),
      friendlyMatch('f2', ['p1'], ['g2'], 2),
      friendlyMatch('f3', ['p1'], ['g3'], 3),
    ]
    const prog = progressOf('p1', only)
    expect(prog.mmr).toBe(0)
    expect(prog.wins).toBe(0)
    expect(prog.coins).toBe(0)
  })

  it('友谊赛不进胜率统计，正常球局照算', () => {
    const ms = [
      normal('n1', ['p1'], ['p2'], 1),
      friendlyMatch('f1', ['p1'], ['g1'], 2),
      friendlyMatch('f2', ['p1'], ['g2'], 3),
    ]
    const [stats] = computeStats(ms, ['p1'], 1)
    expect(stats.games).toBe(1)
    expect(stats.wins).toBe(1)

    // 本场结算显式打开时，三场都算
    const [inSession] = computeStats(ms, ['p1'], 1, { includeFriendly: true })
    expect(inSession.games).toBe(3)
  })
})
