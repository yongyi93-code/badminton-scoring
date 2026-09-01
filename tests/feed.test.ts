import { describe, expect, it } from 'vitest'
import { buildFeed } from '@/lib/feed'
import type { Match, Player, Session } from '@/types'
import { PET_LEVELS, WIN_POINTS } from '@/lib/avatar'

/*
 * 快讯全部从比赛记录现算。最要紧的两条性质：
 *   1. 没有数据时不要硬挤消息出来（宁可不显示，也不显示假的）
 *   2. 删掉比赛之后消息跟着消失，不会留下对不上的旧账
 */

const player = (id: string, name: string): Player => ({
  id, name, level: 3, gender: 'M', archived: false, createdAt: 0,
})

const session = (id: string, venue: string, ended: boolean, at = 1): Session => ({
  id, date: '2026-08-27', venue, courtCount: 1,
  playerIds: ['p1', 'p2', 'p3', 'p4'], defaultType: 'doubles',
  rules: { pointsToWin: 21, winBy2: true, cap: 30, bestOf: 1 },
  fee: { courtFee: 0, shuttleCount: 0, shuttleUnitPrice: 0, paidPlayerIds: [] },
  status: ended ? 'ended' : 'active', createdAt: at,
  endedAt: ended ? at : undefined,
  format: 'free',
})

const match = (
  seq: number,
  sessionId: string,
  teamA: string[],
  teamB: string[],
  winner: 'A' | 'B',
): Match => ({
  id: `m${sessionId}-${seq}`, sessionId, courtIndex: 0, type: 'doubles',
  teamA, teamB,
  games: [{ a: winner === 'A' ? 21 : 15, b: winner === 'B' ? 21 : 15, points: null, serveInit: null }],
  status: 'done', seq, endedAt: seq,
})

const PLAYERS = ['p1', 'p2', 'p3', 'p4'].map((id, i) => player(id, `球员${i + 1}`))

describe('首页快讯', () => {
  it('一场都没打完时什么都不播报', () => {
    expect(buildFeed(PLAYERS, [session('s1', '城中', false)], [])).toEqual([])
  })

  it('球员库是空的也不炸', () => {
    const ms = [match(1, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A')]
    expect(() => buildFeed([], [session('s1', '城中', true)], ms)).not.toThrow()
  })

  it('打够场次之后播报这个馆谁是第一', () => {
    // p1 全胜，理应是本馆第一
    const ms = Array.from({ length: 8 }, (_, i) =>
      match(i + 1, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
    )
    const feed = buildFeed(PLAYERS, [session('s1', '城中羽球馆', true)], ms)
    const king = feed.find((f) => f.id.startsWith('king-'))
    expect(king).toBeDefined()
    expect(king!.text).toContain('城中羽球馆')
    expect(king!.text).toContain('球员1')
    expect(king!.link).toEqual({ kind: 'leaderboard' })
  })

  it('场次不够就不说谁是第一 —— 打两场就称王没有说服力', () => {
    const ms = [
      match(1, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
      match(2, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
    ]
    const feed = buildFeed(PLAYERS, [session('s1', '城中', true)], ms)
    expect(feed.some((f) => f.id.startsWith('king-'))).toBe(false)
  })

  it('连胜到 3 场才播报，2 场不播', () => {
    const two = [
      match(1, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
      match(2, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
    ]
    expect(
      buildFeed(PLAYERS, [session('s1', '城中', true)], two)
        .some((f) => f.id.startsWith('streak-')),
    ).toBe(false)

    const three = [...two, match(3, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A')]
    const hit = buildFeed(PLAYERS, [session('s1', '城中', true)], three)
      .find((f) => f.id.startsWith('streak-p1'))
    expect(hit?.text).toContain('3 连胜')
  })

  it('连胜断了就不再播报', () => {
    const ms = [
      match(1, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
      match(2, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
      match(3, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
      // 第 4 场输了，连胜清零
      match(4, 's1', ['p1', 'p2'], ['p3', 'p4'], 'B'),
    ]
    const feed = buildFeed(PLAYERS, [session('s1', '城中', true)], ms)
    expect(feed.some((f) => f.id.startsWith('streak-p1'))).toBe(false)
    // 对面那两个反而连胜 1 场，也不到门槛
    expect(feed.some((f) => f.id.startsWith('streak-'))).toBe(false)
  })

  it('升段只认「最近这一局打完升的」', () => {
    /*
     * 门槛会改，所以从段位表现推：第二段要多少分、赢一场几分。
     * 前一局赢到差一场就升段，最近这一局再赢两场跨过去 ——
     * 升段消息应该出现，而且指向那个人。
     */
    const need = Math.ceil(PET_LEVELS[1].min / WIN_POINTS)
    const first = Array.from({ length: need - 1 }, (_, i) =>
      match(i + 1, 's1', ['p1'], ['p9'], 'A'),
    )
    const second = Array.from({ length: 2 }, (_, i) =>
      match(i + need, 's2', ['p1'], ['p9'], 'A'),
    )
    const feed = buildFeed(
      PLAYERS,
      [session('s2', '城中', true, 2), session('s1', '城中', true, 1)],
      [...first, ...second],
    )
    const up = feed.find((f) => f.id.startsWith('rankup-p1'))
    expect(up?.text).toContain('球员1')
    expect(up?.text).toContain(PET_LEVELS[1].label)
    expect(up?.link).toEqual({ kind: 'player', playerId: 'p1' })
  })

  it('没升段就不播升段', () => {
    const ms = Array.from({ length: 3 }, (_, i) =>
      match(i + 1, 's1', ['p1'], ['p9'], 'A'),
    )
    const feed = buildFeed(PLAYERS, [session('s1', '城中', true)], ms)
    expect(feed.some((f) => f.id.startsWith('rankup-'))).toBe(false)
  })

  it('第一次在某个馆打球时播报新球馆，之后不再播', () => {
    const ms = Array.from({ length: 6 }, (_, i) =>
      match(i + 1, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
    )
    const one = buildFeed(PLAYERS, [session('s1', '新馆', true, 1)], ms)
    expect(one.some((f) => f.id.startsWith('newvenue-'))).toBe(true)

    // 同一个馆打了第二局，就不是新馆了
    const more = [...ms, ...Array.from({ length: 3 }, (_, i) =>
      match(i + 7, 's2', ['p1', 'p2'], ['p3', 'p4'], 'A'))]
    const two = buildFeed(
      PLAYERS,
      [session('s2', '新馆', true, 2), session('s1', '新馆', true, 1)],
      more,
    )
    expect(two.some((f) => f.id.startsWith('newvenue-'))).toBe(false)
  })

  it('按权重排序，升段排在最前面', () => {
    const first = Array.from({ length: 9 }, (_, i) =>
      match(i + 1, 's1', ['p1'], ['p9'], 'A'),
    )
    const second = Array.from({ length: 2 }, (_, i) =>
      match(i + 10, 's2', ['p1'], ['p9'], 'A'),
    )
    const feed = buildFeed(
      PLAYERS,
      [session('s2', '城中', true, 2), session('s1', '城中', true, 1)],
      [...first, ...second],
    )
    expect(feed[0].id).toMatch(/^rankup-/)
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i - 1].weight).toBeGreaterThanOrEqual(feed[i].weight)
    }
  })

  it('每条消息的 id 唯一 —— 轮播用它当 key', () => {
    const ms = Array.from({ length: 8 }, (_, i) =>
      match(i + 1, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
    )
    const feed = buildFeed(PLAYERS, [session('s1', '城中', true)], ms)
    const ids = feed.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
