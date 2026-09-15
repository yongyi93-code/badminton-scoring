import { describe, expect, it } from 'vitest'
import {
  applyDispute,
  CLEAR_CONFIRMATIONS,
  CONFIRM_WINDOW_MS,
  confirmPending,
  confirmers,
  disputed,
  disputers,
  opponentConfirmed,
  sameScore,
  scoreText,
  shouldAsk,
  withConfirm,
  withDispute,
  withinWindow,
} from '@/lib/confirm'
import { decidedMatches } from '@/lib/ranking'
import type { Match, Player } from '@/types'

/*
 * 这一套里真正会出事的是两件：
 *
 *   1. 「对手确认过」这个标记会不会被队友点出来 —— 会的话它什么都不证明
 *   2. 改了比分之后，旧的确认会不会跟着新比分走 —— 会的话它是个谎
 *
 * 剩下的是「异议不能是否决权」：提异议不该把这一场从 MMR 里拿掉，
 * 否则每个输的人都会点它。那一条在最后一组里钉着。
 */

const NOW = 1_700_000_000_000

const player = (id: string, hasApp = true): Player => ({
  id,
  name: id,
  level: 3,
  gender: 'M',
  archived: false,
  createdAt: 0,
  ownerId: hasApp ? `uid-${id}` : null,
})

/** 双打：A 队 a1 a2，B 队 b1 b2，四个人都装了 App */
const PLAYERS = [player('a1'), player('a2'), player('b1'), player('b2')]

const match = (patch: Partial<Match> = {}): Match => ({
  id: 'm1',
  sessionId: 's1',
  courtIndex: 0,
  type: 'doubles',
  teamA: ['a1', 'a2'],
  teamB: ['b1', 'b2'],
  games: [{ a: 21, b: 18, points: null, serveInit: null }],
  status: 'done',
  seq: 1,
  endedAt: NOW - 1000,
  recordedBy: 'a1',
  ...patch,
})

describe('该问谁', () => {
  it('记分的人自己不用确认', () => {
    expect(confirmers(match(), PLAYERS)).toEqual(['a2', 'b1', 'b2'])
  })

  it('没装 App 的人不算 —— 他手机上没有那个按钮', () => {
    const players = [player('a1'), player('a2'), player('b1'), player('b2', false)]
    expect(confirmers(match(), players)).toEqual(['a2', 'b1'])
  })

  it('表过态的人从「还差谁」里消失', () => {
    const m = match({ scoreOk: ['b1'], disputes: [{ by: 'b2', games: [{ a: 21, b: 19 }] }] })
    expect(confirmPending(m, PLAYERS)).toEqual(['a2'])
  })

  it('不知道谁记的分（老数据）时，场上每个人都问', () => {
    const m = match({ recordedBy: undefined })
    expect(confirmers(m, PLAYERS)).toEqual(['a1', 'a2', 'b1', 'b2'])
  })
})

describe('「对手确认过」这个标记', () => {
  it('对面的人点了才算', () => {
    expect(opponentConfirmed(match({ scoreOk: ['b1'] }))).toBe(true)
  })

  /*
   * 这一条是这个文件存在的主要理由。
   *
   * 队友和记分的人赢输一起走 —— 他正是最没有动机去挑错的那个人。
   * 让队友的点头也算数，这个标记就只表示「有两个人都想赢」。
   */
  it('队友点的不算 —— 他和记分的人是同一边', () => {
    expect(opponentConfirmed(match({ scoreOk: ['a2'] }))).toBe(false)
  })

  it('队友点了、对手也点了，算', () => {
    expect(opponentConfirmed(match({ scoreOk: ['a2', 'b2'] }))).toBe(true)
  })

  it('没人点，不算', () => {
    expect(opponentConfirmed(match())).toBe(false)
  })

  it('记分的人不在场上（场边帮记的），谁点都算', () => {
    const m = match({ recordedBy: 'coach' })
    expect(opponentConfirmed(m)).toBe(false)
    expect(opponentConfirmed({ ...m, scoreOk: ['a2'] })).toBe(true)
  })

  it('单打也一样：输的那个点了才算', () => {
    const m = match({ type: 'singles', teamA: ['a1'], teamB: ['b1'], recordedBy: 'a1' })
    expect(opponentConfirmed({ ...m, scoreOk: ['b1'] })).toBe(true)
  })
})

describe('窗口', () => {
  it('24 小时之内问得着', () => {
    expect(withinWindow(match({ endedAt: NOW - CONFIRM_WINDOW_MS + 1000 }), NOW)).toBe(true)
  })

  it('过了就不问了 —— 隔天没人记得昨晚第三场是 21:18 还是 21:19', () => {
    expect(withinWindow(match({ endedAt: NOW - CONFIRM_WINDOW_MS - 1 }), NOW)).toBe(false)
  })

  /*
   * 过期 ≠ 确认过。窗口关掉只是不再打扰人，
   * 把它当成默认确认的话，那个标记就成了「时间到了就发」。
   */
  it('过期不会变成「对手确认过」', () => {
    expect(opponentConfirmed(match({ endedAt: NOW - CONFIRM_WINDOW_MS - 1 }))).toBe(false)
  })

  it('没打完的不问', () => {
    expect(shouldAsk(match({ status: 'playing' }), 'b1', PLAYERS, NOW)).toBe(false)
  })

  it('打完了、在窗口里、还没表态的人，问', () => {
    expect(shouldAsk(match(), 'b1', PLAYERS, NOW)).toBe(true)
  })

  it('记分的人自己不问', () => {
    expect(shouldAsk(match(), 'a1', PLAYERS, NOW)).toBe(false)
  })

  it('不在场上的人不问', () => {
    expect(shouldAsk(match(), 'c9', PLAYERS, NOW)).toBe(false)
  })

  it('没登录（meId 是空的）不问', () => {
    expect(shouldAsk(match(), null, PLAYERS, NOW)).toBe(false)
  })
})

describe('表态', () => {
  it('重复点不会记两遍', () => {
    const m = match({ scoreOk: ['b1'] })
    expect(withConfirm(m, 'b1').scoreOk).toEqual(['b1'])
  })

  it('提过异议又改口说没错，异议要撤掉', () => {
    const m = match({ disputes: [{ by: 'b1', games: [{ a: 21, b: 19 }] }] })
    const patch = withConfirm(m, 'b1')
    expect(patch.scoreOk).toEqual(['b1'])
    expect(patch.disputes).toEqual([])
  })

  it('点过没错又改口提异议，确认要撤掉', () => {
    const m = match({ scoreOk: ['b1'] })
    const patch = withDispute(m, 'b1', [{ a: 21, b: 19 }])
    expect(patch.disputes).toEqual([{ by: 'b1', games: [{ a: 21, b: 19 }] }])
    expect(patch.scoreOk).toEqual([])
  })

  it('一个人不会同时出现在两份名单上', () => {
    const m = { ...match(), ...withDispute(match({ scoreOk: ['b1'] }), 'b1', [{ a: 21, b: 19 }]) }
    expect(m.scoreOk).not.toContain('b1')
    expect(disputers(m)).toContain('b1')
  })

  /*
   * 改主意再报一个数，要盖掉上一个。
   * 留着两份的话，拿手机的人面前会摆着两个「改成这个」，不知道点哪个。
   */
  it('同一个人再报一次，盖掉上一次，不是堆两条', () => {
    const m = match({ disputes: [{ by: 'b1', games: [{ a: 21, b: 19 }] }] })
    const patch = withDispute(m, 'b1', [{ a: 21, b: 20 }])
    expect(patch.disputes).toEqual([{ by: 'b1', games: [{ a: 21, b: 20 }] }])
  })

  it('两个人各报各的，两条都留着', () => {
    const m = match({ disputes: [{ by: 'b1', games: [{ a: 21, b: 19 }] }] })
    const patch = withDispute(m, 'b2', [{ a: 21, b: 20 }])
    expect(patch.disputes).toHaveLength(2)
  })
})

describe('退回去改比分之后', () => {
  /*
   * 最容易漏的一处：确认是对**那一个**比分说的。
   * 不抹掉的话，「对手确认过」会跟着一个根本没人看过的新比分走。
   */
  it('旧的确认和异议全部作废', () => {
    const m: Match = {
      ...match({ scoreOk: ['b1', 'b2'], disputes: [{ by: 'a2', games: [{ a: 1, b: 2 }] }] }),
      ...CLEAR_CONFIRMATIONS,
    }
    expect(opponentConfirmed(m)).toBe(false)
    expect(disputed(m)).toBe(false)
    expect(m.recordedBy).toBeUndefined()
  })

  it('抹完之后场上每个人都要重新表态', () => {
    const m: Match = { ...match({ scoreOk: ['b1'] }), ...CLEAR_CONFIRMATIONS }
    expect(confirmPending(m, PLAYERS)).toEqual(['a1', 'a2', 'b1', 'b2'])
  })
})

describe('异议不是否决权', () => {
  /*
   * 这一条是整个设计的地基。
   *
   * 提异议要是能把一场比赛从 MMR 里拿掉，那它就是一个「输了可以不算」
   * 的按钮，每个输的人都会点 —— 比谁记谁算还糟，因为那至少还要脸熟撑着。
   *
   * 所以：异议只是个标记，催人去退回改。分照算。
   */
  it('提了异议的比赛照样进 MMR 和排行榜', () => {
    const m = match({
      disputes: [
        { by: 'b1', games: [{ a: 21, b: 19 }] },
        { by: 'b2', games: [{ a: 21, b: 19 }] },
      ],
    })
    expect(decidedMatches([m])).toHaveLength(1)
  })

  it('disputed 只是在问「有没有人说不对」', () => {
    expect(disputed(match())).toBe(false)
    expect(disputed(match({ disputes: [] }))).toBe(false)
    expect(disputed(match({ disputes: [{ by: 'b1', games: [{ a: 21, b: 19 }] }] }))).toBe(true)
  })

  it('老版本那种只有名字的异议还认得出来', () => {
    expect(disputed(match({ disputedBy: ['b1'] }))).toBe(true)
    expect(disputers(match({ disputedBy: ['b1'] }))).toEqual(['b1'])
    expect(confirmPending(match({ disputedBy: ['b1'] }), PLAYERS)).toEqual(['a2', 'b2'])
  })
})

describe('采纳对方报的比分', () => {
  const claimed = (games: { a: number; b: number }[], by = 'b1') =>
    match({ disputes: [{ by, games }] })

  it('比分换成他报的那个', () => {
    const m = claimed([{ a: 21, b: 19 }])
    const patch = applyDispute(m, 'b1')!
    expect(scoreText(patch.games!)).toBe('21-19')
  })

  /*
   * 这一条是这一版里最容易漏的。
   *
   * Game.points 是记分的人一分一分点出来的那份流水账。总分一改，
   * 那份账就和结果对不上了 —— 留着的话，撤销和发球方推导会照着
   * 一份已经作废的账走。置空的意思是「这一局没有逐分记录」，
   * 和「直接输入最终比分」录进来的那种一样。
   */
  it('改过的那一局，逐分记录要清掉', () => {
    const m = match({
      games: [{ a: 21, b: 18, points: ['A', 'B'], serveInit: null }],
      disputes: [{ by: 'b1', games: [{ a: 21, b: 19 }] }],
    })
    expect(applyDispute(m, 'b1')!.games![0].points).toBeNull()
  })

  it('没改的那一局不连坐 —— 逐分记录留着', () => {
    const m = match({
      games: [
        { a: 21, b: 18, points: ['A'], serveInit: null },
        { a: 15, b: 21, points: ['B'], serveInit: null },
      ],
      disputes: [{ by: 'b1', games: [{ a: 21, b: 18 }, { a: 16, b: 21 }] }],
    })
    const games = applyDispute(m, 'b1')!.games!
    expect(games[0].points).toEqual(['A'])
    expect(games[1].points).toBeNull()
  })

  it('改完之后所有确认和异议作废，大家重新认一次', () => {
    const m = match({ scoreOk: ['a2'], disputes: [{ by: 'b1', games: [{ a: 21, b: 19 }] }] })
    const after = { ...m, ...applyDispute(m, 'b1')! }
    expect(disputed(after)).toBe(false)
    expect(after.scoreOk).toBeUndefined()
  })

  /*
   * 报数的人成了新的记分人。不是记账，是决定接下来该问谁 ——
   * 这个数现在是他说的，那就该由他那一队之外的人来认。
   * 漏了这一句的话 recordedBy 是空的，而空的意思是「谁点都算」，
   * 于是他队友点一下就能给这一场盖上「对手确认过」。
   */
  it('报数的人成了新的记分人 —— 他队友的确认因此不算数', () => {
    const m = match({ disputes: [{ by: 'b1', games: [{ a: 21, b: 19 }] }] })
    const after = { ...m, ...applyDispute(m, 'b1')! }
    expect(after.recordedBy).toBe('b1')
    expect(opponentConfirmed({ ...after, scoreOk: ['b2'] })).toBe(false)
    expect(opponentConfirmed({ ...after, scoreOk: ['a1'] })).toBe(true)
  })

  it('这一场还是「打完了」，不会被退回场上', () => {
    const m = claimed([{ a: 21, b: 19 }])
    expect(applyDispute(m, 'b1')!.status).toBeUndefined()
    expect({ ...m, ...applyDispute(m, 'b1')! }.status).toBe('done')
  })

  it('采纳一个没提过异议的人，什么都不做', () => {
    expect(applyDispute(claimed([{ a: 21, b: 19 }]), 'b2')).toBeNull()
  })

  /*
   * 局数对不上就不敢动。
   *
   * 会发生：他在手机上报数的时候这一场是一局，与此同时另一台手机
   * 把它退回去打了第二局。按局号往上套的话，会把第二局的分写成
   * 一个没人报过的数，或者干脆把它丢掉。
   */
  it('局数对不上就不动 —— 中间有人加了一局', () => {
    const m = match({
      games: [
        { a: 21, b: 18, points: null, serveInit: null },
        { a: 5, b: 3, points: null, serveInit: null },
      ],
      disputes: [{ by: 'b1', games: [{ a: 21, b: 19 }] }],
    })
    expect(applyDispute(m, 'b1')).toBeNull()
  })
})

describe('两个比分是不是同一个', () => {
  it('一样就是一样', () => {
    expect(sameScore([{ a: 21, b: 18 }], [{ a: 21, b: 18 }])).toBe(true)
  })
  it('差一分就不是', () => {
    expect(sameScore([{ a: 21, b: 18 }], [{ a: 21, b: 19 }])).toBe(false)
  })
  it('局数不同就不是', () => {
    expect(sameScore([{ a: 21, b: 18 }], [{ a: 21, b: 18 }, { a: 1, b: 2 }])).toBe(false)
  })
  it('比分写成给人看的样子', () => {
    expect(scoreText([{ a: 21, b: 18 }, { a: 15, b: 21 }])).toBe('21-18 15-21')
  })
})
