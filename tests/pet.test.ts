import { describe, expect, it } from 'vitest'
import {
  balanceOf,
  buyBlocker,
  earnedPoints,
  itemById,
  levelOf,
  newPet,
  outfitValue,
  PET_LEVELS,
  SHOP_ITEMS,
  WIN_POINTS,
  winCount,
  type PetProfile,
} from '@/lib/pet'
import type { Match } from '@/types'

/** 造一场打完的比赛，winner 指定哪边赢 */
function match(
  id: string,
  teamA: string[],
  teamB: string[],
  winner: 'A' | 'B',
  endedAt = 0,
): Match {
  const a = winner === 'A' ? 21 : 15
  const b = winner === 'B' ? 21 : 15
  return {
    id,
    sessionId: 's1',
    courtIndex: 0,
    type: teamA.length > 1 ? 'doubles' : 'singles',
    teamA,
    teamB,
    games: [{ a, b, points: null, serveInit: null }],
    status: 'done',
    seq: Number(id.replace(/\D/g, '')) || 1,
    endedAt,
  }
}

const pet = (patch: Partial<PetProfile> = {}): PetProfile => ({
  ...newPet('p1', 'dog'),
  ...patch,
})

describe('积分', () => {
  it('赢一场给固定分，输了不给', () => {
    const ms = [
      match('m1', ['p1'], ['p2'], 'A'),
      match('m2', ['p1'], ['p2'], 'B'),
      match('m3', ['p1'], ['p2'], 'A'),
    ]
    expect(winCount('p1', ms)).toBe(2)
    expect(earnedPoints('p1', ms)).toBe(2 * WIN_POINTS)
    expect(earnedPoints('p2', ms)).toBe(1 * WIN_POINTS)
  })

  it('双打里搭档一起算赢', () => {
    const ms = [match('m1', ['p1', 'p2'], ['p3', 'p4'], 'A')]
    expect(earnedPoints('p1', ms)).toBe(WIN_POINTS)
    expect(earnedPoints('p2', ms)).toBe(WIN_POINTS)
    expect(earnedPoints('p3', ms)).toBe(0)
  })

  it('没打完的比赛不算分', () => {
    const queued: Match = { ...match('m1', ['p1'], ['p2'], 'A'), status: 'playing' }
    expect(earnedPoints('p1', [queued])).toBe(0)
  })

  it('没上过场的人 0 分', () => {
    const ms = [match('m1', ['p1'], ['p2'], 'A')]
    expect(earnedPoints('p9', ms)).toBe(0)
  })

  it('余额 = 赚到的 − 花掉的，不会显示负数', () => {
    expect(balanceOf(pet({ spent: 30 }), 100)).toBe(70)
    expect(balanceOf(pet({ spent: 0 }), 100)).toBe(100)
    expect(balanceOf(undefined, 100)).toBe(100)
    // 真出现花超了（改过数据之类）也夹到 0
    expect(balanceOf(pet({ spent: 500 }), 100)).toBe(0)
  })
})

describe('等级', () => {
  it('按累计积分分档', () => {
    expect(levelOf(0).tier.name).toBe('青铜')
    expect(levelOf(99).tier.name).toBe('青铜')
    expect(levelOf(100).tier.name).toBe('白银')
    expect(levelOf(300).tier.name).toBe('黄金')
    expect(levelOf(9999).tier.name).toBe(PET_LEVELS[PET_LEVELS.length - 1].name)
  })

  it('等级看累计赚到的分，花掉多少都不掉段', () => {
    const rich = pet({ spent: 0 })
    const broke = pet({ spent: 290 })
    // 两人都累计赚了 300，只是一个把钱花光了
    expect(levelOf(300).index).toBe(levelOf(300).index)
    expect(balanceOf(rich, 300)).toBe(300)
    expect(balanceOf(broke, 300)).toBe(10)
    expect(levelOf(300).tier.name).toBe('黄金') // 花光了也还是黄金
  })

  it('进度和距离下一级', () => {
    const half = levelOf(200) // 白银 100 → 黄金 300，正好一半
    expect(half.tier.name).toBe('白银')
    expect(half.next?.name).toBe('黄金')
    expect(half.toNext).toBe(100)
    expect(half.progress).toBeCloseTo(0.5)
  })

  it('满级后没有下一级，进度拉满', () => {
    const top = levelOf(99999)
    expect(top.next).toBe(null)
    expect(top.toNext).toBe(0)
    expect(top.progress).toBe(1)
  })

  it('负分当 0 处理', () => {
    expect(levelOf(-50).tier.name).toBe('青铜')
    expect(levelOf(-50).progress).toBeGreaterThanOrEqual(0)
  })
})

describe('商店', () => {
  it('每件道具的等级门槛都在表里存在', () => {
    for (const item of SHOP_ITEMS) {
      expect(PET_LEVELS[item.minLevel]).toBeDefined()
    }
  })

  it('道具 id 不重复', () => {
    const ids = SHOP_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('钱不够时挡住', () => {
    const cap = itemById('cap')!
    expect(buyBlocker(cap, pet(), 10)).toBe('money')
    expect(buyBlocker(cap, pet(), cap.price)).toBe(null)
  })

  it('等级不够时挡住，哪怕钱够', () => {
    const crown = itemById('crown')!
    expect(crown.minLevel).toBeGreaterThan(0)
    // 给足够多的钱但等级不到：先确认这个分数确实没到门槛
    const justEnoughMoney = crown.price
    expect(levelOf(justEnoughMoney).index).toBeLessThan(crown.minLevel)
    expect(buyBlocker(crown, pet(), justEnoughMoney)).toBe('level')
    // 累计到门槛且余额够就能买
    const enough = PET_LEVELS[crown.minLevel].min
    expect(buyBlocker(crown, pet(), enough)).toBe(null)
  })

  it('已拥有的不再卖', () => {
    const cap = itemById('cap')!
    expect(buyBlocker(cap, pet({ owned: ['cap'] }), 999)).toBe('owned')
  })

  it('花掉的分会让后面买不起', () => {
    const cap = itemById('cap')! // 60
    const racket = itemById('racket')! // 50
    const after = pet({ owned: [cap.id], spent: cap.price })
    // 累计 100，买过 60，剩 40 不够买 50 的球拍
    expect(balanceOf(after, 100)).toBe(40)
    expect(buyBlocker(racket, after, 100)).toBe('money')
  })
})

describe('身上行头估值', () => {
  it('只算戴着的，没戴的不算', () => {
    const p = pet({
      owned: ['cap', 'racket'],
      equipped: { hat: 'cap' },
    })
    expect(outfitValue(p)).toBe(itemById('cap')!.price)
  })

  it('多个槽位相加', () => {
    const p = pet({
      owned: ['cap', 'racket'],
      equipped: { hat: 'cap', item: 'racket' },
    })
    expect(outfitValue(p)).toBe(itemById('cap')!.price + itemById('racket')!.price)
  })

  it('没宠物或没穿戴时是 0', () => {
    expect(outfitValue(undefined)).toBe(0)
    expect(outfitValue(pet())).toBe(0)
  })
})
