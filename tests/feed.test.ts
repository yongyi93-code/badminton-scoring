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

/*
 * 夹具的时间戳要贴着「现在」。
 *
 * 首页公告只播最近三天的事（见 FRESH_MS），而这些用例原来用的是
 * at = 1、2 这种小数字 —— 那是 1970 年，加了时限之后一条都播不出来。
 * 用 NOW + at：相对先后不变，同时全都算新鲜。
 */
const NOW = Date.now()

const session = (id: string, venue: string, ended: boolean, at = 1): Session => ({
  id, date: '2026-08-27', venue, courtCount: 1,
  playerIds: ['p1', 'p2', 'p3', 'p4'], defaultType: 'doubles',
  rules: { pointsToWin: 21, winBy2: true, cap: 30, bestOf: 1 },
  fee: { courtFee: 0, shuttleCount: 0, shuttleUnitPrice: 0, paidPlayerIds: [] },
  status: ended ? 'ended' : 'active', createdAt: NOW + at,
  endedAt: ended ? NOW + at : undefined,
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
    expect(king!.link).toEqual({ kind: 'leaderboard', venue: '城中羽球馆' })
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
    /*
      取 [0]，不是整个数组。原来这里写的是 toContain(PET_LEVELS[1].label)，
      而那会把二元组拼成「卫士,Guardian」去比对 —— 真实文案里当时正好
      也是这么拼的，于是这条断言不但没抓到那个 bug，还把它钉住了。
    */
    expect(up?.text).toContain(PET_LEVELS[1].label[0])
    // 逗号是二元组被 JS 拼过的记号，正常文案里不该出现
    expect(up?.text).not.toContain(',')
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
    /*
     * 每场换一个对手。这一条测的是快讯的排序，要的只是「p1 在 s2 里升了段」，
     * 而连赢同一个人九场会触发「重复打要打折」那条规矩，攒不到升段的分 ——
     * 那是另一条规矩的事，不该在这里搅进来。
     */
    const first = Array.from({ length: 9 }, (_, i) =>
      match(i + 1, 's1', ['p1'], [`o${i}`], 'A'),
    )
    const second = Array.from({ length: 2 }, (_, i) =>
      match(i + 10, 's2', ['p1'], [`o${9 + i}`], 'A'),
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

  /*
   * 公告是新闻，不是档案。没有这一道闸的话，「阿明 5 连胜」
   * 「城中现在是老陈的天下」会一直挂在首页第一屏 —— 三个月没打球也挂着。
   */
  describe('过期就不播了', () => {
    const DAY = 24 * 60 * 60 * 1000
    const busy = Array.from({ length: 8 }, (_, i) =>
      match(i + 1, 's1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
    )
    const one = [session('s1', '城中羽球馆', true)]

    it('最近一局是今天的：照播', () => {
      expect(buildFeed(PLAYERS, one, busy, NOW + 1).length).toBeGreaterThan(0)
    })

    it('最近一局是三天前的：还在窗口里，照播', () => {
      // NOW + 1 是那一局结束的时刻，所以「三天后」是它 + 3 天
      expect(buildFeed(PLAYERS, one, busy, NOW + 1 + 3 * DAY).length).toBeGreaterThan(0)
    })

    it('最近一局是四天前的：一条都不播', () => {
      expect(buildFeed(PLAYERS, one, busy, NOW + 1 + 4 * DAY)).toEqual([])
    })

    it('连胜和馆主也跟着一起收 —— 它们是状态不是事件', () => {
      /*
       * 这两类不依赖「最近一局」，只要数据在就永远成立。
       * 不跟着一起关的话，首页永远清不空 —— 而这正是加这道闸要解决的事。
       */
      const stale = buildFeed(PLAYERS, one, busy, NOW + 1 + 10 * DAY)
      expect(stale.some((f) => f.id.startsWith('streak-'))).toBe(false)
      expect(stale.some((f) => f.id.startsWith('king-'))).toBe(false)
    })

    it('球局还没结束的时候本来就没有「最近一局」，也不播', () => {
      expect(buildFeed(PLAYERS, [session('s1', '城中', false)], busy, NOW)).toEqual([])
    })
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
