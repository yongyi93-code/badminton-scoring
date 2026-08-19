import { describe, expect, it } from 'vitest'
import {
  balanceOf,
  buyBlocker,
  earnedPoints,
  earnedPointsByPlayer,
  itemById,
  levelOf,
  newPet,
  outfitValue,
  PET_LEVELS,
  SHOP_ITEMS,
  STARS_PER_TIER,
  starThreshold,
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

  it('一次扫完的批量算法和逐个算的结果一致', () => {
    const ms = [
      match('m1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
      match('m2', ['p1', 'p3'], ['p2', 'p4'], 'B'),
      match('m3', ['p1'], ['p2'], 'A'),
      { ...match('m4', ['p1'], ['p2'], 'A'), status: 'playing' as const },
    ]
    const batch = earnedPointsByPlayer(ms)
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      expect(batch.get(id) ?? 0).toBe(earnedPoints(id, ms))
    }
    // 一场没赢过的人不进这张表，取不到时按 0 处理
    expect(batch.get('p9')).toBeUndefined()
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

describe('段位', () => {
  it('照着给定门槛分段', () => {
    expect(levelOf(1).tier.name).toBe('Herald')
    expect(levelOf(500).tier.name).toBe('Herald')
    expect(levelOf(501).tier.name).toBe('Guardian')
    expect(levelOf(1000).tier.name).toBe('Guardian')
    expect(levelOf(1001).tier.name).toBe('Crusader')
    expect(levelOf(2500).tier.name).toBe('Crusader')
    expect(levelOf(2501).tier.name).toBe('Archon')
    expect(levelOf(3000).tier.name).toBe('Archon')
    expect(levelOf(3001).tier.name).toBe('Legend')
    expect(levelOf(3501).tier.name).toBe('Ancient')
    expect(levelOf(4001).tier.name).toBe('Divine')
    expect(levelOf(4501).tier.name).toBe('Immortal')
  })

  it('八段，段位表按门槛严格递增', () => {
    expect(PET_LEVELS).toHaveLength(8)
    for (let i = 1; i < PET_LEVELS.length; i++) {
      expect(PET_LEVELS[i].min).toBeGreaterThan(PET_LEVELS[i - 1].min)
    }
  })

  it('段位看累计赚到的分，花掉多少都不掉段', () => {
    const broke = pet({ spent: 1000 })
    // 累计赚了 1200 花掉 1000，余额只剩 200，但段位仍按 1200 算
    expect(balanceOf(broke, 1200)).toBe(200)
    expect(levelOf(1200).tier.name).toBe('Crusader')
  })

  it('进度和距离下一段', () => {
    // Guardian 501 → Crusader 1001，跨度 500，正好走一半
    const half = levelOf(751)
    expect(half.tier.name).toBe('Guardian')
    expect(half.next?.name).toBe('Crusader')
    expect(half.toNext).toBe(250)
    expect(half.progress).toBeCloseTo(0.5)
  })

  it('每段 5 颗星，刚进是 1 星，快升段是 5 星', () => {
    expect(levelOf(0).star).toBe(1)
    expect(levelOf(500).star).toBe(5)
    expect(levelOf(501).star).toBe(1) // 升段后星归位
    expect(levelOf(1000).star).toBe(5)
    // Guardian 跨度 500，每 100 分一颗星
    expect(levelOf(501 + 100).star).toBe(2)
    expect(levelOf(501 + 300).star).toBe(4)
  })

  it('星数永远落在 1~5', () => {
    for (let pts = 0; pts <= 4600; pts += 37) {
      const star = levelOf(pts).star
      if (star === null) continue
      expect(star).toBeGreaterThanOrEqual(1)
      expect(star).toBeLessThanOrEqual(STARS_PER_TIER)
    }
  })

  it('最高段不分星，也没有下一段', () => {
    const top = levelOf(99999)
    expect(top.tier.name).toBe('Immortal')
    expect(top.next).toBe(null)
    expect(top.toNext).toBe(0)
    expect(top.progress).toBe(1)
    expect(top.star).toBe(null)
  })

  it('星的门槛能反推回分数', () => {
    // Guardian 第 3 颗星 = 501 + 500*2/5 = 701
    expect(starThreshold(1, 1)).toBe(501)
    expect(starThreshold(1, 3)).toBe(701)
    expect(levelOf(starThreshold(1, 3)).star).toBe(3)
  })

  it('负分当 0 处理', () => {
    expect(levelOf(-50).tier.name).toBe('Herald')
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
