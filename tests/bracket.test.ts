import { describe, expect, it } from 'vitest'
import {
  buildBracket,
  champion,
  drawSize,
  firstRound,
  isDead,
  placeRanked,
  rankEntrants,
  roundCount,
  roundName,
  seedOrder,
  setScore,
  slotLabel,
  type Entrant,
} from '@/lib/bracket'

/* ------------------------------------------------------------------ *
 * 单淘汰赛表
 *
 * 这一块出错的样子很特别：**画出来还是一张漂亮的表**，横平竖直，
 * 每一格都有人 —— 只是排错了。而办比赛的人一眼就看得出来
 * （「凭什么一号种子第一轮就碰三号」），当场丢脸。
 *
 * 所以这里钉的不是「有没有报错」，是那几条办赛的人真正会检查的规矩。
 * ------------------------------------------------------------------ */

const p = (id: string, seed?: number): Entrant => ({ id, names: [id], seed })
const many = (n: number) => Array.from({ length: n }, (_, i) => p(`p${i + 1}`))

describe('要多大的表', () => {
  it('正好是 2 的幂就用它', () => {
    expect(drawSize(2)).toBe(2)
    expect(drawSize(16)).toBe(16)
    expect(drawSize(64)).toBe(64)
  })

  /* 23 个人用 32 人表，剩下 9 格轮空 —— 这是最常见的真实情形 */
  it('不是 2 的幂就往上取', () => {
    expect(drawSize(23)).toBe(32)
    expect(drawSize(17)).toBe(32)
    expect(drawSize(33)).toBe(64)
  })

  it('人很少也画得出来', () => {
    expect(drawSize(0)).toBe(2)
    expect(drawSize(1)).toBe(2)
    expect(drawSize(3)).toBe(4)
  })

  it('几轮', () => {
    expect(roundCount(2)).toBe(1)
    expect(roundCount(32)).toBe(5)
    expect(roundCount(64)).toBe(6)
  })
})

describe('种子位', () => {
  it('两人表', () => {
    expect(seedOrder(2)).toEqual([1, 2])
  })

  it('四人表：1 碰 4、2 碰 3', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
  })

  it('八人表', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })

  it('长度对得上，而且每个名次只出现一次', () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const o = seedOrder(size)
      expect(o).toHaveLength(size)
      expect(new Set(o).size).toBe(size)
      expect(Math.min(...o)).toBe(1)
      expect(Math.max(...o)).toBe(size)
    }
  })

  /* ---------------------------------------------------------------- *
   * 下面三条是这一整块的**验收标准**。
   *
   * 用户原话：「有一些是第一种子，他们必须安排打到半决赛」。
   * 那件事不是单独写一条规则实现的，是种子位这个构造的数学后果 ——
   * 所以要直接对着后果断言，而不是对着实现。
   * ---------------------------------------------------------------- */
  const halfOf = (size: number, seed: number) => {
    const pos = seedOrder(size).indexOf(seed)
    return pos < size / 2 ? 'top' : 'bottom'
  }
  const quarterOf = (size: number, seed: number) =>
    Math.floor(seedOrder(size).indexOf(seed) / (size / 4))

  it('1 号和 2 号永远在不同的半区 —— 只可能决赛碰面', () => {
    for (const size of [4, 8, 16, 32, 64]) {
      expect(halfOf(size, 1)).not.toBe(halfOf(size, 2))
    }
  })

  it('1、2、3、4 号各占一个 1/4 区 —— 最早半决赛碰面', () => {
    for (const size of [8, 16, 32, 64]) {
      const qs = [1, 2, 3, 4].map((s) => quarterOf(size, s))
      expect(new Set(qs).size).toBe(4)
    }
  })

  it('3 号在 1 号的对面半区，4 号在 2 号的对面半区', () => {
    for (const size of [8, 16, 32, 64]) {
      /* 标准排法：1 和 4 同半区、2 和 3 同半区，所以半决赛是 1-4、2-3 */
      expect(halfOf(size, 4)).toBe(halfOf(size, 1))
      expect(halfOf(size, 3)).toBe(halfOf(size, 2))
    }
  })

  it('前八个种子各占一个 1/8 区', () => {
    const size = 32
    const eighth = (s: number) => Math.floor(seedOrder(size).indexOf(s) / (size / 8))
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(eighth)).size).toBe(8)
  })
})

describe('排签', () => {
  /* 定死的假随机：洗牌也就变成确定的，测得住 */
  const fixedRng = () => 0.5

  it('按种子排：种子按号在前，其余接在后面', () => {
    const list = [p('c'), p('a', 2), p('d'), p('b', 1)]
    const out = rankEntrants(list, 'seeded', fixedRng)
    expect(out.slice(0, 2).map((e) => e.id)).toEqual(['b', 'a'])
    expect(out).toHaveLength(4)
  })

  /* 全随机那一档要把种子那一列当不存在，不然「随机」是假的 */
  it('全随机不认种子', () => {
    const list = [p('a', 1), p('b'), p('c'), p('d')]
    const out = rankEntrants(list, 'random', () => 0)
    expect(out).toHaveLength(4)
    expect(new Set(out.map((e) => e.id)).size).toBe(4)
  })

  it('洗牌不动原来那个数组', () => {
    const list = [p('a'), p('b'), p('c')]
    const before = list.map((e) => e.id)
    rankEntrants(list, 'random', fixedRng)
    expect(list.map((e) => e.id)).toEqual(before)
  })

  it('一个人都不少', () => {
    const list = many(23)
    for (const mode of ['random', 'seeded'] as const) {
      const out = rankEntrants(list, mode, fixedRng)
      expect(new Set(out.map((e) => e.id)).size).toBe(23)
    }
  })
})

describe('轮空给谁', () => {
  /*
   * 这一条是办比赛的人第二眼会看的：轮空必须给高种子。
   * 给错了等于把一号种子和一个新手的位置对调，而那在赛表上是丑闻。
   */
  it('人不够的时候，空格落在高种子对面', () => {
    /* 5 个人摆 8 人表：名次 6、7、8 要不到人 */
    const ranked = many(5)
    const slots = placeRanked(ranked, 8)
    expect(slots.map((s) => s?.id ?? null)).toEqual([
      'p1', null, 'p4', 'p5', 'p2', null, 'p3', null,
    ])
  })

  it('一号种子第一场就轮空', () => {
    const r1 = firstRound(placeRanked(many(5), 8))
    expect(r1[0]).toMatchObject({ a: 'p1', b: null, winner: 'p1' })
  })

  it('人正好够就一个轮空都没有', () => {
    const slots = placeRanked(many(8), 8)
    expect(slots.every((s) => s !== null)).toBe(true)
    expect(firstRound(slots).every((m) => m.winner === undefined)).toBe(true)
  })

  /* 两边都空的那一场：winner 是 null，不是某个人 */
  it('两边都空的那一场没有胜者', () => {
    const r1 = firstRound(placeRanked(many(3), 8))
    const empty = r1.filter((m) => m.a === null && m.b === null)
    expect(empty.length).toBeGreaterThan(0)
    for (const m of empty) expect(m.winner).toBeNull()
  })

  it('轮空的人数正好是差的那几格', () => {
    for (const n of [3, 5, 9, 17, 23, 31]) {
      const size = drawSize(n)
      const slots = placeRanked(many(n), size)
      expect(slots.filter((s) => s === null)).toHaveLength(size - n)
      expect(slots.filter((s) => s !== null)).toHaveLength(n)
    }
  })
})

describe('整张表', () => {
  it('场次总数 = 表大小 - 1', () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      expect(buildBracket(placeRanked(many(size), size))).toHaveLength(size - 1)
    }
  })

  it('每一轮的场次是上一轮的一半', () => {
    const all = buildBracket(placeRanked(many(16), 16))
    const per = [0, 1, 2, 3].map((r) => all.filter((m) => m.round === r).length)
    expect(per).toEqual([8, 4, 2, 1])
  })

  /* 一开始就要有决赛那一格 —— 表要贴出来，后生成的话画不出全貌 */
  it('还没开打就有决赛那一格', () => {
    const all = buildBracket(placeRanked(many(16), 16))
    const final = all.filter((m) => m.round === 3)
    expect(final).toHaveLength(1)
    expect(final[0]).toMatchObject({ a: null, b: null })
  })

  it('轮空的人一开始就站在第二轮了', () => {
    const all = buildBracket(placeRanked(many(5), 8))
    /* p1 第一场轮空，所以第二轮第 0 场上应该已经有他 */
    expect(all.find((m) => m.round === 1 && m.index === 0)?.a).toBe('p1')
  })
})

describe('填分之后往上走', () => {
  const start = () => buildBracket(placeRanked(many(4), 4))

  it('赢的人进下一轮', () => {
    /* 4 人表：seedOrder=[1,4,2,3] → 第一场 p1 vs p4 */
    let all = start()
    expect(all[0]).toMatchObject({ a: 'p1', b: 'p4' })
    all = setScore(all, 0, 0, 21, 15)
    expect(all.find((m) => m.round === 0 && m.index === 0)?.winner).toBe('p1')
    expect(all.find((m) => m.round === 1 && m.index === 0)?.a).toBe('p1')
  })

  it('两场都打完，决赛两边都有人', () => {
    let all = start()
    all = setScore(all, 0, 0, 21, 15)
    all = setScore(all, 0, 1, 12, 21)
    const final = all.find((m) => m.round === 1)!
    expect(final.a).toBe('p1')
    expect(final.b).toBe('p3')
    expect(champion(all)).toBeNull()
  })

  it('决赛打完才有冠军', () => {
    let all = start()
    all = setScore(all, 0, 0, 21, 15)
    all = setScore(all, 0, 1, 12, 21)
    all = setScore(all, 1, 0, 21, 19)
    expect(champion(all)).toBe('p1')
  })

  /*
   * 改一场已经打完的比赛，后面几轮要跟着重算。
   *
   * 这是唯一一个「填错了改回来」的路径，而现场一定会用到
   * （比分敲错一位是常事）。不重算的话，改完之后决赛上站着的还是
   * 原来那个人 —— 而表上看不出哪里不对。
   */
  it('改了结果，后面几轮跟着变', () => {
    let all = start()
    all = setScore(all, 0, 0, 21, 15)
    all = setScore(all, 0, 1, 12, 21)
    all = setScore(all, 1, 0, 21, 19)
    expect(champion(all)).toBe('p1')

    /* 把第一场改成 p4 赢 */
    all = setScore(all, 0, 0, 15, 21)
    expect(all.find((m) => m.round === 1)?.a).toBe('p4')
    /* 决赛那一场的人换了，原来那个冠军不能还挂着 */
    expect(champion(all)).not.toBe('p1')
  })

  /* 羽毛球不会平。出现平分一定是填错了，这一层不替人猜 */
  it('平分不给赢家', () => {
    const all = setScore(start(), 0, 0, 21, 21)
    expect(all.find((m) => m.round === 0 && m.index === 0)?.winner).toBeUndefined()
  })
})

describe('那几个词', () => {
  it('按办赛的人写的叫', () => {
    expect(roundName(4, 5, true)).toBe('决赛')
    expect(roundName(3, 5, true)).toBe('半决赛')
    expect(roundName(2, 5, true)).toBe('八强')
    expect(roundName(1, 5, true)).toBe('16 强')
    expect(roundName(0, 5, true)).toBe('32 强')
  })

  it('英文那一套', () => {
    expect(roundName(4, 5, false)).toBe('Final')
    expect(roundName(3, 5, false)).toBe('Semi-final')
    expect(roundName(2, 5, false)).toBe('Quarter-final')
    expect(roundName(1, 5, false)).toBe('Round of 16')
  })
})

describe('一格上写什么', () => {
  it('单打一个名字', () => {
    expect(slotLabel({ id: 'x', names: ['阿伟'] }, true)).toBe('阿伟')
  })

  /* 双打两个名字用斜杠隔开，和赛场上贴的表一样 */
  it('双打两个名字', () => {
    expect(slotLabel({ id: 'x', names: ['阿伟', '小明'] }, true)).toBe('阿伟 / 小明')
  })

  it('空格写「轮空」', () => {
    expect(slotLabel(null, true)).toBe('轮空')
    expect(slotLabel(undefined, false)).toBe('Bye')
  })
})

describe('空枝和「还没打到」是两件事', () => {
  /*
   * 11 个人摆 16 人表：半决赛那两格现在也是空的，但人会来。
   * 5 个人摆 8 人表：半决赛有一格是**永远不会有人**的。
   *
   * 画表时这两种都是「a 和 b 都还是 null」，长得一模一样 ——
   * 分不清就会在决赛那一格上写「空」。
   */
  const make = (n: number, size: number) => {
    const people: Entrant[] = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      names: [`p${i}`],
      seed: i + 1,
    }))
    return buildBracket(placeRanked(rankEntrants(people, 'seeded'), size))
  }

  it('人满的表，一格都不是空枝', () => {
    const m = make(8, 8)
    expect(m.filter((x) => isDead(m, x.round, x.index))).toHaveLength(0)
  })

  it('5 个人摆 8 人表：一场空枝都没有 —— 轮空是散开的', () => {
    /*
     * 这一条是我先写错、被测试纠正过来的：本来以为「人不满就会有空枝」。
     * 不会。seedOrder 把第 r 名和第 (size+1-r) 名配在一起，5 个人的时候
     * 空出来的是第 6、7、8 名，它们配的是第 3、2、1 名 —— 全是轮空，
     * 没有哪一场是两边都没人。
     *
     * 人数超过表的一半，就一个空枝都不会有。
     */
    const m = make(5, 8)
    expect(m.filter((x) => isDead(m, x.round, x.index))).toHaveLength(0)
  })

  it('3 个人硬摆 8 人表：真的有空枝了', () => {
    /* 人数不到表的一半，才会出现「两边都没人」的那种场次 */
    const m = make(3, 8)
    const dead = m.filter((x) => x.round === 0 && isDead(m, x.round, x.index))
    expect(dead).toHaveLength(1)
    expect(dead[0].a).toBeNull()
    expect(dead[0].b).toBeNull()
  })

  it('半决赛那一格，上游全空才算空枝', () => {
    const m = make(3, 8)
    const semis = m.filter((x) => x.round === 1)
    /* 两场半决赛，一场上游有人（不算空枝），另一场上游一半是空枝但另一半有人 */
    expect(semis.every((x) => !isDead(m, x.round, x.index))).toBe(true)
  })

  it('决赛永远不是空枝 —— 只要场上有人', () => {
    for (const [n, size] of [[2, 2], [3, 4], [5, 8], [11, 16], [23, 32]] as const) {
      const m = make(n, size)
      const last = Math.max(...m.map((x) => x.round))
      expect(isDead(m, last, 0)).toBe(false)
    }
  })

  it('一个人都没有的表，整张都是空枝', () => {
    const m = buildBracket([null, null, null, null])
    expect(m.every((x) => isDead(m, x.round, x.index))).toBe(true)
  })
})
