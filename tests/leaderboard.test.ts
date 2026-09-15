import { describe, expect, it } from 'vitest'
import { myTally } from '@/lib/leaderboard'
import type { Match } from '@/types'

/*
 * 全国榜上那三个数是自己报的，所以理论上都能造假 ——
 * 除了 confirmed：它要求对面的人在自己手机上点过头。
 *
 * 所以这个文件钉的主要是 confirmed 数得对不对。数错了的话，
 * 榜上那个「唯一信得过的数」就也不信得过了。
 *
 * 表上的规则（谁能写自己那一行）在 supabase/017-leaderboard.sql，
 * 那些是在本机跑一个真的 Postgres、用四种身份撞出来的，不在这儿。
 */

const m = (patch: Partial<Match> = {}): Match => ({
  id: 'm1',
  sessionId: 's1',
  courtIndex: 0,
  type: 'doubles',
  teamA: ['me', 'a2'],
  teamB: ['b1', 'b2'],
  games: [{ a: 21, b: 18, points: null, serveInit: null }],
  status: 'done',
  seq: 1,
  endedAt: 1000,
  recordedBy: 'me',
  ...patch,
})

describe('数自己的胜负', () => {
  it('赢的算赢，输的算输', () => {
    const t = myTally(
      [
        m({ id: '1', games: [{ a: 21, b: 18, points: null, serveInit: null }] }),
        m({ id: '2', seq: 2, games: [{ a: 18, b: 21, points: null, serveInit: null }] }),
      ],
      'me',
    )
    expect(t).toMatchObject({ wins: 1, losses: 1 })
  })

  it('在 B 队的时候也数得对 —— 不是永远看 A 队', () => {
    const t = myTally(
      [m({ teamA: ['x', 'y'], teamB: ['me', 'b2'], games: [{ a: 18, b: 21, points: null, serveInit: null }] })],
      'me',
    )
    expect(t).toMatchObject({ wins: 1, losses: 0 })
  })

  it('没上场的比赛不算', () => {
    expect(myTally([m({ teamA: ['x', 'y'], teamB: ['z', 'w'] })], 'me')).toMatchObject({
      wins: 0,
      losses: 0,
    })
  })

  it('没打完的不算', () => {
    expect(myTally([m({ status: 'playing' })], 'me')).toMatchObject({ wins: 0, losses: 0 })
  })

  /* 友谊赛不进累计榜 —— 和 decidedMatches 那边一个口径 */
  it('友谊赛不算', () => {
    expect(myTally([m({ friendly: true })], 'me')).toMatchObject({ wins: 0, losses: 0 })
  })

  it('三局两胜按赢的局数多的那边算', () => {
    const t = myTally(
      [
        m({
          games: [
            { a: 21, b: 18, points: null, serveInit: null },
            { a: 15, b: 21, points: null, serveInit: null },
            { a: 21, b: 19, points: null, serveInit: null },
          ],
        }),
      ],
      'me',
    )
    expect(t).toMatchObject({ wins: 1, losses: 0 })
  })

  it('打平的不算胜也不算负', () => {
    const t = myTally(
      [
        m({
          games: [
            { a: 21, b: 18, points: null, serveInit: null },
            { a: 18, b: 21, points: null, serveInit: null },
          ],
        }),
      ],
      'me',
    )
    expect(t).toMatchObject({ wins: 0, losses: 0 })
  })
})

describe('「其中几场对手确认过」', () => {
  /*
   * 这个数是榜上唯一不容易伪造的东西 —— 它要求对面的人
   * 在自己手机上点过头。所以它必须和 confirm.ts 那边一个口径：
   * 队友的确认不算数。
   */
  it('对手点过头的才算', () => {
    expect(myTally([m({ recordedBy: 'me', scoreOk: ['b1'] })], 'me').confirmed).toBe(1)
  })

  it('队友点的不算 —— 和 confirm.ts 一个口径', () => {
    expect(myTally([m({ recordedBy: 'me', scoreOk: ['a2'] })], 'me').confirmed).toBe(0)
  })

  it('没人点的不算', () => {
    expect(myTally([m()], 'me').confirmed).toBe(0)
  })

  it('确认过的场次照样算进胜负里 —— 是加一个数，不是换一套账', () => {
    const t = myTally([m({ scoreOk: ['b1'] })], 'me')
    expect(t).toEqual({ wins: 1, losses: 1 - 1, confirmed: 1 })
  })

  it('输掉的场次被确认了也算一场确认 —— 数的是可信度，不是战绩', () => {
    const t = myTally(
      [m({ games: [{ a: 18, b: 21, points: null, serveInit: null }], scoreOk: ['b1'] })],
      'me',
    )
    expect(t).toMatchObject({ losses: 1, confirmed: 1 })
  })
})

describe('一场都没打', () => {
  it('三个数都是 0，不会炸', () => {
    expect(myTally([], 'me')).toEqual({ wins: 0, losses: 0, confirmed: 0 })
  })
})
