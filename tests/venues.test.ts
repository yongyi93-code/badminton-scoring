import { describe, expect, it } from 'vitest'
import {
  UNNAMED_VENUE,
  matchesAtVenue,
  normalizeVenue,
  playerIdsAtVenue,
  recentVenues,
  sessionsAtVenue,
  venueKey,
  venueLabel,
  venueSummaries,
} from '@/lib/venues'
import { computeStats, rankPlayers } from '@/lib/ranking'
import { DEFAULT_RULES, type Match, type Session } from '@/types'

let seq = 0
function session(over: Partial<Session> = {}): Session {
  seq += 1
  return {
    id: `s${seq}`,
    date: '2026-08-11',
    venue: '',
    courtCount: 1,
    playerIds: [],
    defaultType: 'doubles',
    rules: DEFAULT_RULES,
    fee: { courtFee: 0, shuttleCount: 0, shuttleUnitPrice: 0, paidPlayerIds: [] },
    status: 'ended',
    createdAt: 1_700_000_000_000 + seq * 100_000,
    ...over,
  }
}

let mseq = 0
function match(
  sessionId: string,
  teamA: string[],
  teamB: string[],
  score: [number, number] = [21, 15],
  over: Partial<Match> = {},
): Match {
  mseq += 1
  return {
    id: `m${mseq}`,
    sessionId,
    courtIndex: 0,
    type: 'doubles',
    teamA,
    teamB,
    games: [{ a: score[0], b: score[1], points: null, serveInit: null }],
    status: 'done',
    seq: mseq,
    endedAt: 1_700_000_000_000 + mseq * 1000,
    ...over,
  }
}

describe('场馆名归一化', () => {
  it('显示名去掉首尾空格、压缩中间空白', () => {
    expect(normalizeVenue('  城中羽球馆 ')).toBe('城中羽球馆')
    expect(normalizeVenue('城中  羽球馆')).toBe('城中 羽球馆')
  })

  it('归组时空格完全不算数 —— 这是排行榜不被拆散的关键', () => {
    const same = ['城中羽球馆', '城中 羽球馆', '城中  羽球馆', '  城中羽球馆  ']
    const keys = new Set(same.map(venueKey))
    expect(keys.size).toBe(1)
  })

  it('英文名大小写不算数', () => {
    expect(venueKey('City Badminton')).toBe(venueKey('citybadminton'))
    expect(venueKey('CITY BADMINTON')).toBe(venueKey('City Badminton'))
  })

  it('没填时显示为未填球馆', () => {
    expect(venueLabel('')).toBe(UNNAMED_VENUE())
    expect(venueLabel('   ')).toBe(UNNAMED_VENUE())
    expect(venueLabel(undefined)).toBe(UNNAMED_VENUE())
    expect(venueLabel('城中羽球馆')).toBe('城中羽球馆')
  })

  it('写法不同的球局会归到同一个场馆', () => {
    const a = session({ venue: '城中羽球馆' })
    const b = session({ venue: '  城中羽球馆  ' })
    const c = session({ venue: '城中  羽球馆' })
    expect(sessionsAtVenue([a, b, c], '城中羽球馆')).toHaveLength(3)
  })
})

describe('场馆显示名', () => {
  it('取最近一次用过的写法', () => {
    const older = session({ venue: '城中  羽球馆', createdAt: 1000, endedAt: 1000 })
    const newer = session({ venue: '城中羽球馆', createdAt: 9000, endedAt: 9000 })
    const ms = [
      match(older.id, ['a', 'b'], ['c', 'd']),
      match(newer.id, ['a', 'b'], ['c', 'd']),
    ]
    const out = venueSummaries([older, newer], ms)
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('城中羽球馆')
    expect(out[0].sessionCount).toBe(2)
    expect(out[0].matchCount).toBe(2)
  })
})

describe('按场馆取比赛与球员', () => {
  const s1 = session({ venue: '城中羽球馆' })
  const s2 = session({ venue: '城中羽球馆' })
  const s3 = session({ venue: '北区体育馆' })
  const ms = [
    match(s1.id, ['a', 'b'], ['c', 'd']),
    match(s2.id, ['a', 'c'], ['b', 'd']),
    match(s3.id, ['e', 'f'], ['g', 'h']),
  ]

  it('只拿这个场馆的比赛', () => {
    expect(matchesAtVenue([s1, s2, s3], ms, '城中羽球馆')).toHaveLength(2)
    expect(matchesAtVenue([s1, s2, s3], ms, '北区体育馆')).toHaveLength(1)
  })

  it('球员按场馆分开，不会串场', () => {
    expect(playerIdsAtVenue([s1, s2, s3], ms, '城中羽球馆').sort()).toEqual([
      'a', 'b', 'c', 'd',
    ])
    expect(playerIdsAtVenue([s1, s2, s3], ms, '北区体育馆').sort()).toEqual([
      'e', 'f', 'g', 'h',
    ])
  })

  it('查一个不存在的场馆返回空', () => {
    expect(matchesAtVenue([s1], ms, '不存在的馆')).toHaveLength(0)
  })
})

describe('场馆概览', () => {
  it('统计球局数、场数、人数，按最近打过排前面', () => {
    const older = session({ venue: '北区体育馆' })
    const newer = session({ venue: '城中羽球馆' })
    const ms = [
      match(older.id, ['e', 'f'], ['g', 'h']),
      match(newer.id, ['a', 'b'], ['c', 'd']),
      match(newer.id, ['a', 'c'], ['b', 'd']),
    ]
    const out = venueSummaries([older, newer], ms)
    expect(out.map((v) => v.key)).toEqual(['城中羽球馆', '北区体育馆'])
    expect(out[0]).toMatchObject({ sessionCount: 1, matchCount: 2, playerCount: 4 })
    expect(out[1]).toMatchObject({ sessionCount: 1, matchCount: 1, playerCount: 4 })
  })

  it('一场都没打完的球局不会冒出一个场馆', () => {
    const empty = session({ venue: '刚建的空球局' })
    const real = session({ venue: '城中羽球馆' })
    const ms = [match(real.id, ['a', 'b'], ['c', 'd'])]
    expect(venueSummaries([empty, real], ms).map((v) => v.key)).toEqual([
      '城中羽球馆',
    ])
  })

  it('还在打的比赛不算进场数', () => {
    const s = session({ venue: '城中羽球馆' })
    const ms = [
      match(s.id, ['a', 'b'], ['c', 'd']),
      match(s.id, ['a', 'c'], ['b', 'd'], [5, 3], { status: 'playing' }),
    ]
    expect(venueSummaries([s], ms)[0].matchCount).toBe(1)
  })

  it('没填球馆的球局单独成一档', () => {
    const s = session({ venue: '' })
    const ms = [match(s.id, ['a', 'b'], ['c', 'd'])]
    const out = venueSummaries([s], ms)
    expect(out[0].key).toBe('')
    expect(out[0].label).toBe(UNNAMED_VENUE())
  })
})

describe('各场馆的排名是独立的', () => {
  it('同一个人在两个场馆可以是完全不同的名次', () => {
    const home = session({ venue: '主场' })
    const away = session({ venue: '客场' })
    // 阿明在主场全胜、在客场全败
    const ms = [
      match(home.id, ['ming', 'x'], ['y', 'z'], [21, 10]),
      match(home.id, ['ming', 'y'], ['x', 'z'], [21, 10]),
      match(home.id, ['ming', 'z'], ['x', 'y'], [21, 10]),
      match(away.id, ['ming', 'x'], ['y', 'z'], [10, 21]),
      match(away.id, ['ming', 'y'], ['x', 'z'], [10, 21]),
      match(away.id, ['ming', 'z'], ['x', 'y'], [10, 21]),
    ]
    const sessions = [home, away]

    const rankAt = (venue: string) =>
      rankPlayers(
        computeStats(
          matchesAtVenue(sessions, ms, venue),
          playerIdsAtVenue(sessions, ms, venue),
        ),
      )

    expect(rankAt('主场')[0].playerId).toBe('ming')
    expect(rankAt('主场')[0].winRate).toBe(1)

    const awayRank = rankAt('客场')
    expect(awayRank[awayRank.length - 1].playerId).toBe('ming')
    expect(awayRank.find((r) => r.playerId === 'ming')!.winRate).toBe(0)
  })

  it('场馆冠军就是该场馆排第一且达门槛的人', () => {
    const s = session({ venue: '主场' })
    const ms = [
      match(s.id, ['king', 'a'], ['b', 'c'], [21, 10]),
      match(s.id, ['king', 'b'], ['a', 'c'], [21, 10]),
      match(s.id, ['king', 'c'], ['a', 'b'], [21, 10]),
    ]
    const ranked = rankPlayers(
      computeStats(matchesAtVenue([s], ms, '主场'), playerIdsAtVenue([s], ms, '主场')),
    )
    const champion = ranked.filter((r) => r.qualified)[0]
    expect(champion.playerId).toBe('king')
    expect(champion.games).toBe(3)
  })
})

describe('写法不同不影响排名统计', () => {
  it('同一个场馆的两种写法，战绩合并计算', () => {
    const a = session({ venue: '城中羽球馆' })
    const b = session({ venue: '城中  羽球馆' })
    const ms = [
      match(a.id, ['ming', 'x'], ['y', 'z'], [21, 10]),
      match(a.id, ['ming', 'y'], ['x', 'z'], [21, 10]),
      match(b.id, ['ming', 'z'], ['x', 'y'], [21, 10]),
    ]
    const sessions = [a, b]
    // 三场全在同一个场馆，阿明应该是 3 场全胜而不是被拆成 2 场 + 1 场
    const stats = computeStats(
      matchesAtVenue(sessions, ms, '城中羽球馆'),
      playerIdsAtVenue(sessions, ms, '城中羽球馆'),
    )
    const ming = stats.find((s) => s.playerId === 'ming')!
    expect(ming.games).toBe(3)
    expect(ming.qualified).toBe(true)
    expect(rankPlayers(stats)[0].playerId).toBe('ming')
  })
})

describe('历史球馆快选', () => {
  it('按最近用过排序，去重，跳过没填的', () => {
    const a = session({ venue: '城中羽球馆', createdAt: 1000 })
    const b = session({ venue: '北区体育馆', createdAt: 2000 })
    const c = session({ venue: '城中  羽球馆', createdAt: 3000 })
    const d = session({ venue: '', createdAt: 4000 })
    const out = recentVenues([a, b, c, d])
    // 城中羽球馆的两种写法只出现一次，显示名取最近一次用的写法
    expect(out).toHaveLength(2)
    expect(out).toEqual(['城中 羽球馆', '北区体育馆'])
    expect(out.map(venueKey)).toEqual([venueKey('城中羽球馆'), venueKey('北区体育馆')])
  })
})
