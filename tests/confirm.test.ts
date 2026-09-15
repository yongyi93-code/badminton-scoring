import { describe, expect, it } from 'vitest'
import {
  CLEAR_CONFIRMATIONS,
  CONFIRM_WINDOW_MS,
  confirmPending,
  confirmers,
  disputed,
  opponentConfirmed,
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
    const m = match({ scoreOk: ['b1'], disputedBy: ['b2'] })
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
    const m = match({ disputedBy: ['b1'] })
    const patch = withConfirm(m, 'b1')
    expect(patch.scoreOk).toEqual(['b1'])
    expect(patch.disputedBy).toEqual([])
  })

  it('点过没错又改口提异议，确认要撤掉', () => {
    const m = match({ scoreOk: ['b1'] })
    const patch = withDispute(m, 'b1')
    expect(patch.disputedBy).toEqual(['b1'])
    expect(patch.scoreOk).toEqual([])
  })

  it('一个人不会同时出现在两份名单上', () => {
    const m = { ...match(), ...withDispute(match({ scoreOk: ['b1'] }), 'b1') }
    expect(m.scoreOk).not.toContain('b1')
    expect(m.disputedBy).toContain('b1')
  })
})

describe('退回去改比分之后', () => {
  /*
   * 最容易漏的一处：确认是对**那一个**比分说的。
   * 不抹掉的话，「对手确认过」会跟着一个根本没人看过的新比分走。
   */
  it('旧的确认和异议全部作废', () => {
    const m: Match = {
      ...match({ scoreOk: ['b1', 'b2'], disputedBy: ['a2'] }),
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
    const m = match({ disputedBy: ['b1', 'b2'] })
    expect(decidedMatches([m])).toHaveLength(1)
  })

  it('全场都提异议也照算', () => {
    const m = match({ disputedBy: ['a2', 'b1', 'b2'] })
    expect(decidedMatches([m])).toHaveLength(1)
  })

  it('disputed 只是在问「有没有人说不对」', () => {
    expect(disputed(match())).toBe(false)
    expect(disputed(match({ disputedBy: [] }))).toBe(false)
    expect(disputed(match({ disputedBy: ['b1'] }))).toBe(true)
  })
})
