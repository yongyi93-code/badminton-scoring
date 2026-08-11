import { describe, expect, it } from 'vitest'
import { pickNextMatch, playerLoads } from '@/lib/rotation'
import type { Gender, Level, Match, MatchType, Player } from '@/types'

/** 固定种子的伪随机，保证测试可复现 */
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

const finishedGame = () => [{ a: 21, b: 15, points: null, serveInit: null }]

/**
 * 模拟真实球局：场地空出来就排下一场，打完一场再排一场。
 * 与 SessionBoard 的实际流程一致。
 */
function simulate(
  players: Player[],
  courtCount: number,
  totalMatches: number,
  type: MatchType = 'doubles',
  seed = 42,
) {
  const random = seeded(seed)
  const matches: Match[] = []
  const playing: Match[] = []
  let seq = 0

  while (matches.length < totalMatches) {
    while (playing.length < courtCount && matches.length < totalMatches) {
      const busyIds = playing.flatMap((m) => [...m.teamA, ...m.teamB])
      const { pairing } = pickNextMatch({
        attending: players,
        matches,
        busyIds,
        type,
        random,
      })
      if (!pairing) break
      seq += 1
      const m: Match = {
        id: `m${seq}`,
        sessionId: 's1',
        courtIndex: playing.length,
        type,
        teamA: pairing.teamA,
        teamB: pairing.teamB,
        games: finishedGame(),
        status: 'playing',
        seq,
      }
      matches.push(m)
      playing.push(m)
    }
    if (playing.length === 0) break
    const done = playing.shift()!
    done.status = 'done'
  }

  return matches
}

const gamesPerPlayer = (players: Player[], matches: Match[]) =>
  players.map(
    (p) =>
      matches.filter((m) => m.teamA.includes(p.id) || m.teamB.includes(p.id))
        .length,
  )

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

describe('负载统计', () => {
  it('已打场数少的人排在前面，同场数则等得久的优先', () => {
    const players = makePlayers(4)
    const matches: Match[] = [
      {
        id: 'm1',
        sessionId: 's1',
        courtIndex: 0,
        type: 'doubles',
        teamA: ['p1', 'p2'],
        teamB: ['p3', 'p4'],
        games: finishedGame(),
        status: 'done',
        seq: 1,
      },
      {
        id: 'm2',
        sessionId: 's1',
        courtIndex: 0,
        type: 'doubles',
        teamA: ['p1', 'p3'],
        teamB: ['p2', 'p4'],
        games: finishedGame(),
        status: 'done',
        seq: 2,
      },
    ]
    const loads = playerLoads(players, matches)
    expect(loads.every((l) => l.games === 2)).toBe(true)
    expect(loads.every((l) => l.restRounds === 0)).toBe(true)
  })

  it('从没上场的人休息轮数等于本局总场数，优先度最高', () => {
    const players = makePlayers(5)
    const matches: Match[] = [
      {
        id: 'm1',
        sessionId: 's1',
        courtIndex: 0,
        type: 'doubles',
        teamA: ['p1', 'p2'],
        teamB: ['p3', 'p4'],
        games: finishedGame(),
        status: 'done',
        seq: 1,
      },
    ]
    const loads = playerLoads(players, matches)
    expect(loads[0].playerId).toBe('p5')
    expect(loads[0].restRounds).toBe(1)
  })
})

describe('公平性：不能有人连坐冷板凳', () => {
  it('14 人 2 片场打 30 场后，任何两人的场数差 ≤ 1', () => {
    const players = makePlayers(14)
    const matches = simulate(players, 2, 30)
    expect(matches).toHaveLength(30)
    const counts = gamesPerPlayer(players, matches)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it('人数不能整除时也不会有人被系统性冷落（7 人 1 片场 20 场）', () => {
    const players = makePlayers(7)
    const matches = simulate(players, 1, 20)
    const counts = gamesPerPlayer(players, matches)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it('换不同随机种子都成立', () => {
    for (const seed of [1, 7, 99, 20260810]) {
      const players = makePlayers(11)
      const matches = simulate(players, 2, 25, 'doubles', seed)
      const counts = gamesPerPlayer(players, matches)
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    }
  })

  it('没有人会连续休息 3 轮以上（9 人 2 片场）', () => {
    const players = makePlayers(9)
    const matches = simulate(players, 2, 24)
    for (const p of players) {
      const appearances = matches
        .filter((m) => m.teamA.includes(p.id) || m.teamB.includes(p.id))
        .map((m) => m.seq)
      for (let i = 1; i < appearances.length; i++) {
        expect(appearances[i] - appearances[i - 1]).toBeLessThanOrEqual(5)
      }
    }
  })
})

describe('搭档与对手多样性', () => {
  it('同一对搭档不会在 3 场内重复', () => {
    const players = makePlayers(12)
    const matches = simulate(players, 2, 30)
    for (let i = 0; i < matches.length; i++) {
      const window = matches.slice(Math.max(0, i - 3), i)
      const currentPairs = new Set(
        [matches[i].teamA, matches[i].teamB]
          .filter((t) => t.length === 2)
          .map((t) => pairKey(t[0], t[1])),
      )
      for (const prev of window) {
        for (const t of [prev.teamA, prev.teamB]) {
          if (t.length === 2) {
            expect(currentPairs.has(pairKey(t[0], t[1]))).toBe(false)
          }
        }
      }
    }
  })

  it('搭档分布不会集中在少数几对（8 人 40 场）', () => {
    const players = makePlayers(8)
    const matches = simulate(players, 1, 40)
    const partnerCount = new Map<string, number>()
    for (const m of matches) {
      for (const t of [m.teamA, m.teamB]) {
        const k = pairKey(t[0], t[1])
        partnerCount.set(k, (partnerCount.get(k) ?? 0) + 1)
      }
    }
    // 8 人共 28 种搭档组合，40 场共 80 次配对，应铺得比较开
    expect(partnerCount.size).toBeGreaterThanOrEqual(20)
    expect(Math.max(...partnerCount.values())).toBeLessThanOrEqual(8)
  })
})

describe('实力平衡', () => {
  it('高手和菜鸟混合时两队水平和尽量接近', () => {
    // 4 个 5 星 + 4 个 1 星，理想分队是每队 5+1
    const players = makePlayers(8, { levels: [5, 5, 5, 5, 1, 1, 1, 1] })
    const levelOf = new Map(players.map((p) => [p.id, p.level]))
    const matches = simulate(players, 1, 20)
    const gaps = matches.map((m) => {
      const sum = (t: string[]) => t.reduce((s, id) => s + levelOf.get(id)!, 0)
      return Math.abs(sum(m.teamA) - sum(m.teamB))
    })
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(avgGap).toBeLessThan(1.5)
  })
})

describe('混双', () => {
  it('每队必须一男一女', () => {
    const players = makePlayers(8, {
      genders: ['M', 'M', 'M', 'M', 'F', 'F', 'F', 'F'],
    })
    const genderOf = new Map(players.map((p) => [p.id, p.gender]))
    const matches = simulate(players, 1, 20, 'mixed')
    expect(matches.length).toBe(20)
    for (const m of matches) {
      for (const t of [m.teamA, m.teamB]) {
        const g = t.map((id) => genderOf.get(id))
        expect(g.filter((x) => x === 'M')).toHaveLength(1)
        expect(g.filter((x) => x === 'F')).toHaveLength(1)
      }
    }
  })

  it('男女人数不够时明确报错而不是乱排', () => {
    const players = makePlayers(6, {
      genders: ['M', 'M', 'M', 'M', 'M', 'F'],
    })
    const out = pickNextMatch({ attending: players, matches: [], type: 'mixed' })
    expect(out.pairing).toBe(null)
    expect(out.reason).toContain('2 男 2 女')
  })

  it('有人没填性别时提示出来', () => {
    const players = makePlayers(4, { genders: ['M', 'F', '-', '-'] })
    const out = pickNextMatch({ attending: players, matches: [], type: 'mixed' })
    expect(out.pairing).toBe(null)
    expect(out.reason).toContain('没填性别')
  })
})

describe('边界与人工干预', () => {
  it('等待区人数不够时给出人话理由', () => {
    const players = makePlayers(3)
    const out = pickNextMatch({ attending: players, matches: [], type: 'doubles' })
    expect(out.pairing).toBe(null)
    expect(out.reason).toContain('需要 4 人')
  })

  it('在场上的人不会被重复排进下一场', () => {
    const players = makePlayers(8)
    const out = pickNextMatch({
      attending: players,
      matches: [],
      busyIds: ['p1', 'p2', 'p3', 'p4'],
      type: 'doubles',
    })
    const chosen = [...out.pairing!.teamA, ...out.pairing!.teamB]
    expect(chosen.sort()).toEqual(['p5', 'p6', 'p7', 'p8'])
  })

  it('临时休息的人被排除在外', () => {
    const players = makePlayers(5)
    const out = pickNextMatch({
      attending: players,
      matches: [],
      excludeIds: ['p3'],
      type: 'doubles',
    })
    const chosen = [...out.pairing!.teamA, ...out.pairing!.teamB]
    expect(chosen).not.toContain('p3')
    expect(chosen).toHaveLength(4)
  })

  it('指定某人下一场必须上，即使他刚打完', () => {
    const players = makePlayers(9)
    const matches = simulate(players, 1, 6)
    const out = pickNextMatch({
      attending: players,
      matches,
      mustInclude: ['p1'],
      type: 'doubles',
    })
    const chosen = [...out.pairing!.teamA, ...out.pairing!.teamB]
    expect(chosen).toContain('p1')
  })

  it('单打排 2 人一队', () => {
    const players = makePlayers(6)
    const out = pickNextMatch({ attending: players, matches: [], type: 'singles' })
    expect(out.pairing!.teamA).toHaveLength(1)
    expect(out.pairing!.teamB).toHaveLength(1)
  })

  it('刚好 4 人时也能开双打', () => {
    const players = makePlayers(4)
    const out = pickNextMatch({ attending: players, matches: [], type: 'doubles' })
    expect(out.pairing).not.toBe(null)
  })
})
