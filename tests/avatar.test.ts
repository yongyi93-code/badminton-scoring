import { describe, expect, it } from 'vitest'
import {
  balanceOf,
  buyBlocker,
  IMMORTAL_STEP,
  itemById,
  LOSS_POINTS,
  progressByPlayer,
  progressOf,
  type Progress,
  levelOf,
  newAvatar,
  shopFor,
  STARTER_IDS,
  outfitValue,
  PET_LEVELS,
  SHOP_ITEMS,
  STARS_PER_TIER,
  starThreshold,
  WIN_POINTS,
  winCount,
  type AvatarProfile,
} from '@/lib/avatar'
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

const pet = (patch: Partial<AvatarProfile> = {}): AvatarProfile => ({
  ...newAvatar('p1', 'm'),
  // 新号自带免费装备，测购买逻辑时先清空，否则「已拥有」会挡在前面
  owned: [],
  equipped: {},
  ...patch,
})

describe('MMR 与金币', () => {
  it('MMR 赢加输减，金币只加不减', () => {
    const ms = [
      match('m1', ['p1'], ['p2'], 'A'),
      match('m2', ['p1'], ['p2'], 'B'),
      match('m3', ['p1'], ['p2'], 'A'),
    ]
    const a = progressOf('p1', ms) // 2 胜 1 负
    expect(a.wins).toBe(2)
    expect(a.losses).toBe(1)
    expect(a.mmr).toBe(2 * WIN_POINTS - 1 * LOSS_POINTS)
    expect(a.coins).toBe(2 * WIN_POINTS)

    const b = progressOf('p2', ms) // 1 胜 2 负
    expect(b.mmr).toBe(1 * WIN_POINTS - 2 * LOSS_POINTS)
    expect(b.coins).toBe(1 * WIN_POINTS)
  })

  it('输多过赢时 MMR 为负，金币仍然是正的', () => {
    const ms = [
      match('m1', ['p1'], ['p2'], 'B'),
      match('m2', ['p1'], ['p2'], 'B'),
      match('m3', ['p1'], ['p2'], 'A'),
    ]
    const p = progressOf('p1', ms) // 1 胜 2 负
    expect(p.mmr).toBe(-10)
    expect(p.coins).toBe(10)
    // 负分不会把段位压到最低段以下
    expect(p.level.tier.name).toBe('Herald')
  })

  it('双打里搭档一起算胜负', () => {
    const ms = [match('m1', ['p1', 'p2'], ['p3', 'p4'], 'A')]
    expect(progressOf('p1', ms).mmr).toBe(WIN_POINTS)
    expect(progressOf('p2', ms).mmr).toBe(WIN_POINTS)
    expect(progressOf('p3', ms).mmr).toBe(-LOSS_POINTS)
    expect(progressOf('p4', ms).coins).toBe(0)
  })

  it('没打完的比赛不算分', () => {
    const queued: Match = { ...match('m1', ['p1'], ['p2'], 'A'), status: 'playing' }
    expect(progressOf('p1', [queued]).mmr).toBe(0)
    expect(progressOf('p1', [queued]).coins).toBe(0)
  })

  it('没上过场的人 0 分', () => {
    const ms = [match('m1', ['p1'], ['p2'], 'A')]
    const p = progressOf('p9', ms)
    expect(p.mmr).toBe(0)
    expect(p.coins).toBe(0)
    expect(winCount('p9', ms)).toBe(0)
  })

  it('一次扫完的批量算法和逐个算的结果一致', () => {
    const ms = [
      match('m1', ['p1', 'p2'], ['p3', 'p4'], 'A'),
      match('m2', ['p1', 'p3'], ['p2', 'p4'], 'B'),
      match('m3', ['p1'], ['p2'], 'A'),
      { ...match('m4', ['p1'], ['p2'], 'A'), status: 'playing' as const },
    ]
    const batch = progressByPlayer(ms)
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const one = progressOf(id, ms)
      expect(batch.get(id)?.mmr).toBe(one.mmr)
      expect(batch.get(id)?.coins).toBe(one.coins)
      expect(batch.get(id)?.level.display).toBe(one.level.display)
    }
    // 一场都没上过的人不进这张表
    expect(batch.get('p9')).toBeUndefined()
  })

  it('输球不会让已经买得起的东西变买不起', () => {
    const wins = Array.from({ length: 10 }, (_, i) =>
      match(`w${i + 1}`, ['p1'], ['p2'], 'A'),
    )
    const before = progressOf('p1', wins)
    expect(before.coins).toBe(100)

    // 再输 8 场：MMR 掉到 20，金币还是 100
    const after = progressOf('p1', [
      ...wins,
      ...Array.from({ length: 8 }, (_, i) => match(`l${i + 1}`, ['p1'], ['p2'], 'B')),
    ])
    expect(after.mmr).toBe(20)
    expect(after.coins).toBe(100)
    expect(balanceOf(pet(), after.coins)).toBe(100)
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
    expect(levelOf(0).tier.name).toBe('Herald')
    expect(levelOf(99).tier.name).toBe('Herald')
    expect(levelOf(100).tier.name).toBe('Guardian')
    expect(levelOf(199).tier.name).toBe('Guardian')
    expect(levelOf(200).tier.name).toBe('Crusader')
    expect(levelOf(299).tier.name).toBe('Crusader')
    expect(levelOf(300).tier.name).toBe('Archon')
    expect(levelOf(499).tier.name).toBe('Archon')
    expect(levelOf(500).tier.name).toBe('Legend')
    expect(levelOf(699).tier.name).toBe('Legend')
    expect(levelOf(700).tier.name).toBe('Ancient')
    expect(levelOf(849).tier.name).toBe('Ancient')
    expect(levelOf(850).tier.name).toBe('Divine')
    expect(levelOf(999).tier.name).toBe('Divine')
    expect(levelOf(1000).tier.name).toBe('Immortal')
  })

  it('八段，段位表按门槛严格递增', () => {
    expect(PET_LEVELS).toHaveLength(8)
    for (let i = 1; i < PET_LEVELS.length; i++) {
      expect(PET_LEVELS[i].min).toBeGreaterThan(PET_LEVELS[i - 1].min)
    }
  })

  it('段位只看 MMR，跟金币花掉多少无关', () => {
    const broke = pet({ spent: 250 })
    // 金币赚了 300 花掉 250 只剩 50，MMR 300 照样是 Archon
    expect(balanceOf(broke, 300)).toBe(50)
    expect(levelOf(300).tier.name).toBe('Archon')
  })

  it('进度和距离下一段', () => {
    // Guardian 100 → Crusader 200，跨度 100，正好走一半
    const half = levelOf(150)
    expect(half.tier.name).toBe('Guardian')
    expect(half.next?.name).toBe('Crusader')
    expect(half.toNext).toBe(50)
    expect(half.progress).toBeCloseTo(0.5)
  })

  it('每段 5 颗星，刚进是 1 星，快升段是 5 星', () => {
    expect(levelOf(0).star).toBe(1)
    expect(levelOf(99).star).toBe(5)
    expect(levelOf(100).star).toBe(1) // 升段后星归位
    expect(levelOf(199).star).toBe(5)
    // Guardian 跨度 100，每 20 分一颗星
    expect(levelOf(120).star).toBe(2)
    expect(levelOf(180).star).toBe(5)
  })

  it('星数永远落在 1~5', () => {
    for (let pts = 0; pts < 1000; pts += 7) {
      const star = levelOf(pts).star
      expect(star).not.toBe(null)
      expect(star!).toBeGreaterThanOrEqual(1)
      expect(star!).toBeLessThanOrEqual(STARS_PER_TIER)
    }
  })

  it('冠绝之上按编号继续往上，不封顶', () => {
    const base = levelOf(1000)
    expect(base.tier.name).toBe('Immortal')
    expect(base.display).toBe('Immortal') // 刚进冠绝不带编号
    expect(base.immortalRank).toBe(0)
    expect(base.star).toBe(null)
    expect(base.next).toBe(null)
    expect(base.toNext).toBe(IMMORTAL_STEP)

    expect(levelOf(1000 + IMMORTAL_STEP).display).toBe('Immortal 1')
    expect(levelOf(1000 + IMMORTAL_STEP * 2).display).toBe('Immortal 2')
    expect(levelOf(1000 + IMMORTAL_STEP * 2 - 1).display).toBe('Immortal 1')
    // 分再高也有下一级，永远不会「到顶」
    expect(levelOf(99999).immortalRank).toBeGreaterThan(0)
    expect(levelOf(99999).toNext).toBeGreaterThan(0)
  })

  it('没到冠绝时 display 就是段位名，immortalRank 为空', () => {
    const a = levelOf(300)
    expect(a.display).toBe('Archon')
    expect(a.immortalRank).toBe(null)
  })

  it('星的门槛能反推回分数', () => {
    // Guardian 第 3 颗星 = 100 + 100*2/5 = 140
    expect(starThreshold(1, 1)).toBe(100)
    expect(starThreshold(1, 3)).toBe(140)
    expect(levelOf(starThreshold(1, 3)).star).toBe(3)
  })

  it('MMR 为负时按 0 处理，落在最低段', () => {
    expect(levelOf(-50).tier.name).toBe('Herald')
    expect(levelOf(-50).star).toBe(1)
    expect(levelOf(-500).progress).toBeGreaterThanOrEqual(0)
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

  /** 直接捏一个进度，不用真去造比赛 */
  const prog = (mmr: number, coins: number): Progress => ({
    wins: 0,
    losses: 0,
    mmr,
    coins,
    level: levelOf(mmr),
  })

  it('金币不够时挡住', () => {
    const jersey = itemById('jersey')!
    expect(buyBlocker(jersey, pet(), prog(0, 10))).toBe('money')
    expect(buyBlocker(jersey, pet(), prog(0, jersey.price))).toBe(null)
  })

  it('段位不够时挡住，哪怕金币够', () => {
    const great = itemById('greatsword')!
    expect(great.minLevel).toBeGreaterThan(0)
    const gate = PET_LEVELS[great.minLevel].min
    // 金币多得是，但 MMR 差得远
    expect(buyBlocker(great, pet(), prog(0, 99999))).toBe('level')
    // 段位到了、金币也够才放行
    expect(buyBlocker(great, pet(), prog(gate, great.price))).toBe(null)
  })

  it('段位掉下去会重新锁住高段位的货，但不没收已买的', () => {
    const great = itemById('greatsword')!
    const gate = PET_LEVELS[great.minLevel].min
    // 买的时候段位够
    expect(buyBlocker(great, pet(), prog(gate, 99999))).toBe(null)
    // 输球掉段之后再看：没买的被锁住
    expect(buyBlocker(great, pet(), prog(0, 99999))).toBe('level')
    // 已经买下的还是自己的，不会变回可买/被没收
    expect(buyBlocker(great, pet({ owned: [great.id] }), prog(0, 0))).toBe('owned')
  })

  it('已拥有的不再卖', () => {
    const jersey = itemById('jersey')!
    expect(buyBlocker(jersey, pet({ owned: ['jersey'] }), prog(99999, 99999))).toBe(
      'owned',
    )
  })

  it('花掉的金币会让后面买不起', () => {
    const jersey = itemById('jersey')! // 60
    const dagger = itemById('dagger')! // 70
    const after = pet({ owned: [jersey.id], spent: jersey.price })
    // 赚了 100，买过 60，剩 40 不够买 70 的短刃
    expect(balanceOf(after, 100)).toBe(40)
    expect(buyBlocker(dagger, after, prog(100, 100))).toBe('money')
  })

  it('发型分男女，商店只给看自己性别那份', () => {
    const male = shopFor('m').map((i) => i.id)
    const female = shopFor('f').map((i) => i.id)
    expect(male).toContain('m-short')
    expect(male).not.toContain('f-bob')
    expect(female).toContain('f-bob')
    expect(female).not.toContain('m-short')
    // 战服和武器男女通用，两边都要有
    expect(male).toContain('jersey')
    expect(female).toContain('jersey')
    expect(male).toContain('sword')
    expect(female).toContain('sword')
  })

  it('新建角色白送免费那几件，而且身上就穿着', () => {
    const fresh = newAvatar('p1', 'f')
    for (const id of STARTER_IDS) {
      const item = itemById(id)!
      expect(item.price).toBe(0)
      expect(fresh.owned).toContain(id)
    }
    // 免费款里属于异性的那件虽然拥有，但穿的是自己这边的
    expect(fresh.equipped.hair).toBe('f-bob')
    expect(fresh.equipped.outfit).toBe('tee')
    expect(fresh.equipped.weapon).toBe('racket')
  })
})

describe('身上行头估值', () => {
  it('只算穿着的，没穿的不算', () => {
    const p = pet({
      owned: ['jersey', 'dagger'],
      equipped: { outfit: 'jersey' },
    })
    expect(outfitValue(p)).toBe(itemById('jersey')!.price)
  })

  it('多个槽位相加', () => {
    const p = pet({
      owned: ['jersey', 'dagger'],
      equipped: { outfit: 'jersey', weapon: 'dagger' },
    })
    expect(outfitValue(p)).toBe(
      itemById('jersey')!.price + itemById('dagger')!.price,
    )
  })

  it('没角色或什么都没穿时是 0', () => {
    expect(outfitValue(undefined)).toBe(0)
    expect(outfitValue(pet())).toBe(0)
  })
})
