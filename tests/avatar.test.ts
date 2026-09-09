import { describe, expect, it } from 'vitest'
import {
  balanceOf,
  buyBlocker,
  IMMORTAL_STEP,
  itemById,
  BLOWOUT_MULTIPLIER,
  isBlowout,
  LOSS_POINTS,
  replayMatches,
  UPSET_MULTIPLIER,
  progressByPlayer,
  progressOf,
  type Progress,
  levelOf,
  newAvatar,
  STARTER_IDS,
  outfitValue,
  outcomeOf,
  mmrTimeline,
  retireOldGear,
  SLOT_LABELS,
  PET_LEVELS,
  SHOP_ITEMS,
  STARS_PER_TIER,
  STAKE_MULTIPLIER,
  starThreshold,
  WIN_POINTS,
  winCount,
  type AvatarProfile,
} from '@/lib/avatar'
import { DRAWN_IDS } from '@/components/Avatar'
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
  /** 按给定顺序造一串打完的比赛，endedAt 递增，保证重放顺序确定 */
  const series = (
    rounds: { a: string[]; b: string[]; winner: 'A' | 'B' }[],
  ): Match[] => rounds.map((r, i) => match(`m${i + 1}`, r.a, r.b, r.winner, i + 1))

  const solo = (winners: ('A' | 'B')[]) =>
    series(winners.map((w) => ({ a: ['p1'], b: ['p2'], winner: w })))

  it('势均力敌时赢加输减，金币只加不减', () => {
    // 两人同时起步、交替输赢，双方 MMR 始终不会出现「低打高」，所以不触发爆冷
    const ms = solo(['A', 'B'])
    const a = progressOf('p1', ms)
    expect(a.wins).toBe(1)
    expect(a.losses).toBe(1)
    // 第一场平手起步赢 +10，第二场输掉扣回 0
    expect(a.mmr).toBe(0)
    expect(a.coins).toBe(WIN_POINTS)
  })

  it('输一场正好扣 LOSS_POINTS，扣到 0 为止', () => {
    // 先赢 3 场攒到 30（第一场平手 +10，后两场高打低各 +10），再输 1 场
    const p = progressOf('p1', solo(['A', 'A', 'A', 'B']))
    expect(p.mmr).toBe(3 * WIN_POINTS - LOSS_POINTS)
  })

  it('MMR 扣到 0 就打住，不会变成负数', () => {
    // 连输 5 场，MMR 只会停在 0
    const ms = solo(['B', 'B', 'B', 'B', 'B'])
    const p = progressOf('p1', ms)
    expect(p.losses).toBe(5)
    expect(p.mmr).toBe(0)
    // 金币一分没赚，但也没被扣成负的
    expect(p.coins).toBe(0)
    expect(p.level.tier.name).toBe('Herald')
  })

  it('先输光再赢，赢的分从 0 起算，不用先还债', () => {
    // 这正是「扣到 0 就打住」和「胜场×10 − 负场×10」的区别：
    // 公式算是 2×10 − 3×10 = −10，逐场推是 0→0→0→ 赢两场
    const ms = solo(['B', 'B', 'B', 'A', 'A'])
    const p = progressOf('p1', ms)
    expect(p.mmr).toBeGreaterThan(0)
    expect(p.wins).toBe(2)
    expect(p.losses).toBe(3)
  })

  it('低分赢高分，MMR 翻倍', () => {
    // p1 先赢两场把分拉到 20，p2 还是 0；接着 p2 爆冷赢一场
    const ms = solo(['A', 'A', 'B'])
    const winner = progressOf('p2', ms)
    // 那一场是低打高，拿双倍
    expect(winner.mmr).toBe(WIN_POINTS * UPSET_MULTIPLIER)
    // 但金币不翻倍，还是按「赢了一场」算
    expect(winner.coins).toBe(WIN_POINTS)
  })

  it('高分赢低分只拿基础分，不翻倍', () => {
    // p1 赢到 20 分后再赢一场：这次是高打低
    const ms = solo(['A', 'A', 'A'])
    const p = progressOf('p1', ms)
    // 第一场平手 +10，之后两场都是高打低，各 +10
    expect(p.mmr).toBe(3 * WIN_POINTS)
  })

  it('双打里搭档一起算胜负', () => {
    const ms = series([{ a: ['p1', 'p2'], b: ['p3', 'p4'], winner: 'A' }])
    expect(progressOf('p1', ms).mmr).toBe(WIN_POINTS)
    expect(progressOf('p2', ms).mmr).toBe(WIN_POINTS)
    // 输的一方从 0 扣不下去，还是 0
    expect(progressOf('p3', ms).mmr).toBe(0)
    expect(progressOf('p3', ms).losses).toBe(1)
    expect(progressOf('p4', ms).coins).toBe(0)
  })

  it('没打完的比赛不算分', () => {
    const queued: Match = { ...match('m1', ['p1'], ['p2'], 'A'), status: 'playing' }
    expect(progressOf('p1', [queued]).mmr).toBe(0)
    expect(progressOf('p1', [queued]).coins).toBe(0)
  })

  it('没上过场的人 0 分', () => {
    const ms = solo(['A'])
    const p = progressOf('p9', ms)
    expect(p.mmr).toBe(0)
    expect(p.coins).toBe(0)
    expect(winCount('p9', ms)).toBe(0)
  })

  it('一次扫完的批量算法和逐个算的结果一致', () => {
    const ms = series([
      { a: ['p1', 'p2'], b: ['p3', 'p4'], winner: 'A' },
      { a: ['p1', 'p3'], b: ['p2', 'p4'], winner: 'B' },
      { a: ['p1'], b: ['p2'], winner: 'A' },
    ])
    const batch = progressByPlayer(ms)
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const one = progressOf(id, ms)
      expect(batch.get(id)?.mmr).toBe(one.mmr)
      expect(batch.get(id)?.coins).toBe(one.coins)
      expect(batch.get(id)?.level.display).toBe(one.level.display)
    }
    expect(batch.get('p9')).toBeUndefined()
  })

  it('输球不会让已经买得起的东西变买不起', () => {
    /*
     * 每场换一个对手：这一条测的是「输球扣不扣金币」，
     * 不该被「同一组人重复打要打折」那条规矩搅进来。
     * 十场全打同一个人的话，后五场只给半额，测出来的就不是这件事了。
     */
    const wins = Array.from({ length: 10 }, (_, i) => ({
      a: ['p1'], b: [`o${i}`], winner: 'A' as const,
    }))
    const losses = Array.from({ length: 20 }, (_, i) => ({
      a: ['p1'], b: [`o${i}`], winner: 'B' as const,
    }))
    const after = progressOf('p1', series([...wins, ...losses]))
    // 输到 MMR 归零
    expect(after.mmr).toBe(0)
    // 金币一分没少，赢过的 10 场都还算数
    expect(after.coins).toBe(10 * WIN_POINTS)
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
  /*
   * 门槛这张表是会改的（升太慢就往下调），所以下面大部分用例都从
   * PET_LEVELS 现推，不写死数字 —— 它们测的是分段逻辑，不是某一版的数值。
   * 数值本身只在「当前这一版的门槛」那一条里钉死，改门槛时只该动那一条。
   */
  const GUARDIAN = 1 // 第二段，用来验跨度、星、进度这些和具体数值无关的行为

  it('当前这一版的门槛', () => {
    expect(PET_LEVELS.map((t) => [t.name, t.min])).toEqual([
      ['Herald', 0],
      ['Guardian', 50],
      ['Crusader', 100],
      ['Archon', 150],
      ['Legend', 300],
      ['Ancient', 400],
      ['Divine', 500],
      ['Immortal', 700],
    ])
  })

  it('每一段的门槛分刚好进这一段，差一分还留在上一段', () => {
    PET_LEVELS.forEach((tier, i) => {
      expect(levelOf(tier.min).tier.name).toBe(tier.name)
      if (i > 0) {
        expect(levelOf(tier.min - 1).tier.name).toBe(PET_LEVELS[i - 1].name)
      }
    })
  })

  it('八段，段位表按门槛严格递增', () => {
    expect(PET_LEVELS).toHaveLength(8)
    for (let i = 1; i < PET_LEVELS.length; i++) {
      expect(PET_LEVELS[i].min).toBeGreaterThan(PET_LEVELS[i - 1].min)
    }
  })

  it('段位只看 MMR，跟金币花掉多少无关', () => {
    const broke = pet({ spent: 250 })
    // 金币赚了 300 花掉 250 只剩 50，MMR 照样按原样分段
    expect(balanceOf(broke, 300)).toBe(50)
    expect(levelOf(300).tier.name).toBe(PET_LEVELS[4].name)
  })

  it('进度和距离下一段', () => {
    const tier = PET_LEVELS[GUARDIAN]
    const next = PET_LEVELS[GUARDIAN + 1]
    const span = next.min - tier.min
    const half = levelOf(tier.min + span / 2)
    expect(half.tier.name).toBe(tier.name)
    expect(half.next?.name).toBe(next.name)
    expect(half.toNext).toBe(span / 2)
    expect(half.progress).toBeCloseTo(0.5)
  })

  it('每段 5 颗星，刚进是 1 星，快升段是 5 星', () => {
    const tier = PET_LEVELS[GUARDIAN]
    const next = PET_LEVELS[GUARDIAN + 1]
    expect(levelOf(0).star).toBe(1)
    expect(levelOf(tier.min - 1).star).toBe(5)
    expect(levelOf(tier.min).star).toBe(1) // 升段后星归位
    expect(levelOf(next.min - 1).star).toBe(5)
  })

  it('星数永远落在 1~5', () => {
    const top = PET_LEVELS[PET_LEVELS.length - 1].min
    for (let pts = 0; pts < top; pts += 7) {
      const star = levelOf(pts).star
      expect(star).not.toBe(null)
      expect(star!).toBeGreaterThanOrEqual(1)
      expect(star!).toBeLessThanOrEqual(STARS_PER_TIER)
    }
  })

  it('冠绝之上按编号继续往上，不封顶', () => {
    const top = PET_LEVELS[PET_LEVELS.length - 1].min
    const base = levelOf(top)
    expect(base.tier.name).toBe('Immortal')
    expect(base.display).toBe('Immortal') // 刚进冠绝不带编号
    expect(base.immortalRank).toBe(0)
    expect(base.star).toBe(null)
    expect(base.next).toBe(null)
    expect(base.toNext).toBe(IMMORTAL_STEP)

    expect(levelOf(top + IMMORTAL_STEP).display).toBe('Immortal 1')
    expect(levelOf(top + IMMORTAL_STEP * 2).display).toBe('Immortal 2')
    expect(levelOf(top + IMMORTAL_STEP * 2 - 1).display).toBe('Immortal 1')
    // 分再高也有下一级，永远不会「到顶」
    expect(levelOf(99999).immortalRank).toBeGreaterThan(0)
    expect(levelOf(99999).toNext).toBeGreaterThan(0)
  })

  it('没到冠绝时 display 就是段位名，immortalRank 为空', () => {
    const a = levelOf(PET_LEVELS[GUARDIAN].min)
    expect(a.display).toBe(PET_LEVELS[GUARDIAN].name)
    expect(a.immortalRank).toBe(null)
  })

  it('星的门槛能反推回分数', () => {
    const tier = PET_LEVELS[GUARDIAN]
    const span = PET_LEVELS[GUARDIAN + 1].min - tier.min
    expect(starThreshold(GUARDIAN, 1)).toBe(tier.min)
    expect(starThreshold(GUARDIAN, 3)).toBe(tier.min + Math.ceil((span * 2) / 5))
    expect(levelOf(starThreshold(GUARDIAN, 3)).star).toBe(3)
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
    const top = itemById('racket-legend')!
    expect(top.minLevel).toBeGreaterThan(0)
    const gate = PET_LEVELS[top.minLevel].min
    // 金币多得是，但 MMR 差得远
    expect(buyBlocker(top, pet(), prog(0, 99999))).toBe('level')
    // 段位到了、金币也够才放行
    expect(buyBlocker(top, pet(), prog(gate, top.price))).toBe(null)
  })

  it('段位掉下去会重新锁住高段位的货，但不没收已买的', () => {
    const top = itemById('racket-legend')!
    const gate = PET_LEVELS[top.minLevel].min
    // 买的时候段位够
    expect(buyBlocker(top, pet(), prog(gate, 99999))).toBe(null)
    // 输球掉段之后再看：没买的被锁住
    expect(buyBlocker(top, pet(), prog(0, 99999))).toBe('level')
    // 已经买下的还是自己的，不会变回可买/被没收
    expect(buyBlocker(top, pet({ owned: [top.id] }), prog(0, 0))).toBe('owned')
  })

  it('已拥有的不再卖', () => {
    const jersey = itemById('jersey')!
    expect(buyBlocker(jersey, pet({ owned: ['jersey'] }), prog(99999, 99999))).toBe(
      'owned',
    )
  })

  it('花掉的金币会让后面买不起', () => {
    const jersey = itemById('jersey')! // 60
    const carbon = itemById('racket-blue')! // 70
    const after = pet({ owned: [jersey.id], spent: jersey.price })
    // 赚了 100，买过 60，剩 40 不够买 70 的短刃
    expect(balanceOf(after, 100)).toBe(40)
    expect(buyBlocker(carbon, after, prog(100, 100))).toBe('money')
  })

  it('发型分男女，一款只归一边', () => {
    /*
     * 男女都走分层换装之后，发型／战服／武器整条线在商店里已经下架了
     * （见 lib/dressup.ts）—— shopFor 的输出取决于素材在不在，
     * 拿它来验「按性别过滤」就成了在验素材。所以直接验目录本身：
     * 每款发型都标了性别，而且男女两边不重叠。
     * 谁卖什么由 tests/dressup.test.ts 管。
     */
    const hair = SHOP_ITEMS.filter((i) => i.slot === 'hair')
    expect(hair.length).toBeGreaterThan(0)
    expect(hair.every((i) => !!i.sex)).toBe(true)
    const male = hair.filter((i) => i.sex === 'm').map((i) => i.id)
    const female = hair.filter((i) => i.sex === 'f').map((i) => i.id)
    expect(male).toContain('m-short')
    expect(female).toContain('f-bob')
    expect(male.filter((id) => female.includes(id))).toEqual([])

    // 战服和武器男女通用，所以不标性别
    for (const slot of ['outfit', 'weapon'] as const) {
      const line = SHOP_ITEMS.filter((i) => i.slot === slot)
      expect(line.length, slot).toBeGreaterThan(0)
      expect(line.every((i) => !i.sex), slot).toBe(true)
    }
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
      owned: ['jersey', 'racket-blue'],
      equipped: { outfit: 'jersey' },
    })
    expect(outfitValue(p)).toBe(itemById('jersey')!.price)
  })

  it('多个槽位相加', () => {
    const p = pet({
      owned: ['jersey', 'racket-blue'],
      equipped: { outfit: 'jersey', weapon: 'racket-blue' },
    })
    expect(outfitValue(p)).toBe(
      itemById('jersey')!.price + itemById('racket-blue')!.price,
    )
  })

  it('没角色或什么都没穿时是 0', () => {
    expect(outfitValue(undefined)).toBe(0)
    expect(outfitValue(pet())).toBe(0)
  })
})

describe('旧装备换成羽球装备', () => {
  it('身上和衣柜里的旧 id 都换成同一档的新 id', () => {
    const p = retireOldGear(
      pet({
        owned: ['knight', 'greatsword', 'm-wolf'],
        equipped: { outfit: 'knight', weapon: 'greatsword', hair: 'm-wolf' },
      }),
    )
    expect(p.equipped.outfit).toBe('pro')
    expect(p.equipped.weapon).toBe('racket-legend')
    // 没换掉的东西要原样留着
    expect(p.equipped.hair).toBe('m-wolf')
    expect(p.owned).toEqual(['pro', 'racket-legend', 'm-wolf'])
  })

  it('换过之后每一件都还在商店里 —— 找不到就会退回新手队服', () => {
    const p = retireOldGear(
      pet({
        owned: ['leather', 'shadow', 'dagger', 'sword', 'staff'],
        equipped: { outfit: 'shadow', weapon: 'staff' },
      }),
    )
    for (const id of p.owned) expect(itemById(id), id).toBeDefined()
    expect(itemById(p.equipped.outfit!)).toBeDefined()
    expect(itemById(p.equipped.weapon!)).toBeDefined()
  })

  it('换出来的新装备和旧的同价同门槛，不用补差价也不掉级', () => {
    const same = (oldId: string) => {
      const now = itemById(retireOldGear(pet({ owned: [oldId] })).owned[0])!
      return [now.price, now.minLevel]
    }
    // 旧价：轻甲 150/1、骑士铠 400/4、暗影战衣 900/7
    expect(same('leather')).toEqual([150, 1])
    expect(same('knight')).toEqual([400, 4])
    expect(same('shadow')).toEqual([900, 7])
    // 旧价：短刃 70/0、长剑 250/3、法杖 500/5、巨剑 1200/7
    expect(same('dagger')).toEqual([70, 0])
    expect(same('sword')).toEqual([250, 3])
    expect(same('staff')).toEqual([500, 5])
    expect(same('greatsword')).toEqual([1200, 7])
  })

  it('本来就是新装备的角色一点都不动', () => {
    const before = pet({ owned: ['pro', 'racket-gold'], equipped: { outfit: 'pro' } })
    expect(retireOldGear(before)).toEqual(before)
  })
})

describe('商店卖的每一件都画得出来', () => {
  /*
   * 商店卖 id、画图按 id 查表，两边对不上就是花了金币却什么都没变 ——
   * 界面上不会报错，只会悄悄退回默认款。今天已经栽过一次（旧装备改名没迁移），
   * 所以这里把三类查表的装备全对一遍。
   */
  const slots = ['frame', 'background', 'weapon'] as const
  for (const slot of slots) {
    it(`${SLOT_LABELS[slot]}：每个商品都有对应的画法`, () => {
      const selling = SHOP_ITEMS.filter((i) => i.slot === slot).map((i) => i.id)
      expect(selling.length).toBeGreaterThan(0)
      for (const id of selling) expect(DRAWN_IDS[slot], id).toContain(id)
    })
  }

  it('发型和战服按性别都画得出来（画不出来会退回默认款）', () => {
    // 这两类不查表，是 switch/if 一路匹配下来的，所以只能反过来验：
    // 商店里的 id 必须是画法里认得的那几个，清单写死在这里当契约
    const hair = ['m-short', 'm-spiky', 'm-wolf', 'm-silver', 'f-bob', 'f-twin', 'f-long', 'f-wavy']
    const outfit = ['tee', 'jersey', 'elite', 'pro', 'legend']
    expect(SHOP_ITEMS.filter((i) => i.slot === 'hair').map((i) => i.id).sort())
      .toEqual(hair.sort())
    expect(SHOP_ITEMS.filter((i) => i.slot === 'outfit').map((i) => i.id).sort())
      .toEqual(outfit.sort())
  })

  it('称号只是一行字，有名字就够', () => {
    for (const i of SHOP_ITEMS.filter((i) => i.slot === 'title')) {
      expect(i.name.length).toBeGreaterThan(0)
    }
  })
})

describe('单场的账（赛后结算页用的）', () => {
  it('赢的 +10 输的 −10，两边的前后分都对得上', () => {
    const ms = [match('m1', ['p1'], ['p2'], 'A', 1), match('m2', ['p1'], ['p2'], 'A', 2)]
    const o = outcomeOf(ms, 'm2')!
    expect(o.winner).toBe('A')
    expect(o.upset).toBe(false)

    const win = o.impacts.find((i) => i.playerId === 'p1')!
    expect(win.won).toBe(true)
    expect(win.mmrBefore).toBe(WIN_POINTS) // 第一场赢来的
    expect(win.delta).toBe(WIN_POINTS)
    expect(win.mmrAfter).toBe(2 * WIN_POINTS)
    expect(win.coins).toBe(WIN_POINTS)

    const lose = o.impacts.find((i) => i.playerId === 'p2')!
    expect(lose.won).toBe(false)
    expect(lose.coins).toBe(0)
  })

  /*
   * 这条是这一屏存在的理由之一：MMR 扣到 0 就封底，
   * 所以已经是 0 分的人再输一场，实际变化是 0，不是 −10。
   * 结算页显示名义值的话，写着 −10 但分没少，对不上账。
   */
  it('已经是 0 分的人再输，delta 是 0 而不是 −10', () => {
    const ms = [match('m1', ['p1'], ['p2'], 'B', 1), match('m2', ['p1'], ['p2'], 'B', 2)]
    const first = outcomeOf(ms, 'm1')!.impacts.find((i) => i.playerId === 'p1')!
    const second = outcomeOf(ms, 'm2')!.impacts.find((i) => i.playerId === 'p1')!
    expect(first.delta).toBe(0) // 一开始就是 0，第一场输完还是 0
    expect(second.delta).toBe(0)
    expect(second.mmrBefore).toBe(0)
    expect(second.mmrAfter).toBe(0)
  })

  it('爆冷那一场标出来，赢家 delta 是双倍', () => {
    const ms = [
      match('m1', ['p1'], ['p3'], 'A', 1), // p1 先赢一场垫高
      match('m2', ['p2'], ['p1'], 'A', 2), // p2（0 分）赢 p1（10 分）＝ 爆冷
    ]
    const o = outcomeOf(ms, 'm2')!
    expect(o.upset).toBe(true)
    const win = o.impacts.find((i) => i.playerId === 'p2')!
    expect(win.delta).toBe(WIN_POINTS * UPSET_MULTIPLIER)
    // 金币不跟着翻倍
    expect(win.coins).toBe(WIN_POINTS)
  })

  it('每场的增减加起来，正好是总的 MMR —— 两个口径不许对不上', () => {
    const ms = [
      match('m1', ['p1', 'p2'], ['p3', 'p4'], 'A', 1),
      match('m2', ['p1', 'p3'], ['p2', 'p4'], 'B', 2),
      match('m3', ['p1', 'p4'], ['p2', 'p3'], 'A', 3),
      match('m4', ['p2', 'p3'], ['p1', 'p4'], 'A', 4),
    ]
    const total = progressByPlayer(ms)
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const summed = ms
        .map((m) => outcomeOf(ms, m.id))
        .reduce(
          (n, o) => n + (o?.impacts.find((i) => i.playerId === id)?.delta ?? 0),
          0,
        )
      expect(summed, `${id} 逐场累加和总分对不上`).toBe(total.get(id)!.mmr)
    }
  })

  it('还没打完的、没分出胜负的、友谊赛，都没有账', () => {
    const queued: Match = { ...match('m1', ['p1'], ['p2'], 'A'), status: 'queued' }
    expect(outcomeOf([queued], 'm1')).toBeNull()

    const drawn: Match = {
      ...match('m2', ['p1'], ['p2'], 'A'),
      games: [{ a: 21, b: 21, points: null, serveInit: null }],
    }
    expect(outcomeOf([drawn], 'm2')).toBeNull()

    const friendly: Match = { ...match('m3', ['p1'], ['p2'], 'A'), friendly: true }
    expect(outcomeOf([friendly], 'm3')).toBeNull()
  })
})

describe('MMR 走势', () => {
  it('第一项是起点，之后每场一个点', () => {
    const ms = [
      match('m1', ['p1'], ['p2'], 'A', 1),
      match('m2', ['p1'], ['p2'], 'B', 2),
      match('m3', ['p1'], ['p2'], 'A', 3),
    ]
    const line = mmrTimeline(ms, 'p1')
    // 3 场 + 1 个起点
    expect(line).toHaveLength(4)
    expect(line[0]).toMatchObject({ mmr: 0, delta: 0, matchId: '' })
    // 第三场 p1(0 分) 赢 p2(10 分) 是爆冷，所以是 +20 不是 +10
    expect(line.map((p) => p.mmr)).toEqual([0, 10, 0, 20])
    expect(line.map((p) => p.delta)).toEqual([0, 10, -10, 20])
  })

  it('只算自己打过的场，别人的场不进这条线', () => {
    const ms = [
      match('m1', ['p1'], ['p2'], 'A', 1),
      match('m2', ['p3'], ['p4'], 'A', 2), // 与 p1 无关
      match('m3', ['p1'], ['p2'], 'A', 3),
    ]
    const line = mmrTimeline(ms, 'p1')
    expect(line.map((p) => p.matchId)).toEqual(['', 'm1', 'm3'])
  })

  it('走势最后一格必然等于总 MMR', () => {
    const ms = [
      match('m1', ['p1', 'p2'], ['p3', 'p4'], 'A', 1),
      match('m2', ['p1', 'p3'], ['p2', 'p4'], 'B', 2),
      match('m3', ['p1', 'p4'], ['p2', 'p3'], 'A', 3),
    ]
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const line = mmrTimeline(ms, id)
      expect(line[line.length - 1].mmr, `${id} 走势末端和总分对不上`).toBe(
        progressOf(id, ms).mmr,
      )
    }
  })

  it('没打过球的人拿到空数组，画不出线也不会炸', () => {
    expect(mmrTimeline([], 'p1')).toEqual([])
    expect(mmrTimeline([match('m1', ['p2'], ['p3'], 'A', 1)], 'p1')).toEqual([])
  })

  it('时间顺序按打完的时刻，不按数组顺序', () => {
    const ms = [
      match('m2', ['p1'], ['p2'], 'B', 20),
      match('m1', ['p1'], ['p2'], 'A', 10),
    ]
    expect(mmrTimeline(ms, 'p1').map((p) => p.matchId)).toEqual(['', 'm1', 'm2'])
  })
})

/* ------------------------------------------------------------------ *
 * 碾压双倍
 *
 * 规则：每一局对手的分都不到一半。21 分制就是对手不超过 10 分。
 * MMR 和金币都翻倍 —— 和爆冷不一样，爆冷只翻 MMR。
 * ------------------------------------------------------------------ */

/** 造一场比分随便写的比赛 */
const scored = (id: string, games: [number, number][], seq = 1): Match => ({
  id,
  sessionId: 's1',
  courtIndex: 0,
  type: 'doubles',
  teamA: ['a1', 'a2'],
  teamB: ['b1', 'b2'],
  games: games.map(([a, b]) => ({ a, b, points: null, serveInit: null })),
  status: 'done',
  seq,
  endedAt: seq,
})

describe('碾压', () => {
  it('21 分制：对手 10 分算，11 分不算', () => {
    // 10.5 是一半，所以 10 进、11 不进 —— 这正是「少于总分 50%」
    expect(isBlowout(scored('m1', [[21, 10]]), 'A')).toBe(true)
    expect(isBlowout(scored('m1', [[21, 11]]), 'A')).toBe(false)
  })

  it('一条规则套所有分制，不用去查这场定的是几分', () => {
    // 15 分制：一半是 7.5
    expect(isBlowout(scored('m', [[15, 7]]), 'A')).toBe(true)
    expect(isBlowout(scored('m', [[15, 8]]), 'A')).toBe(false)
    // 11 分制：一半是 5.5
    expect(isBlowout(scored('m', [[11, 5]]), 'A')).toBe(true)
    expect(isBlowout(scored('m', [[11, 6]]), 'A')).toBe(false)
  })

  it('正好一半不算 —— 要「少于」一半', () => {
    /*
     * 这一条是红测时发现漏了的：前面几条用的都是 21、15、11 这种
     * 单数总分，一半永远带零点五，怎么写都碰不到边界。
     * 打到平分加赛才会出现双数总分（16:8、30:15），那时候
     * 「不到一半」和「不超过一半」才分得出来。按你说的「少于 50%」，
     * 正好一半不算。
     */
    expect(isBlowout(scored('m', [[16, 8]]), 'A')).toBe(false)
    expect(isBlowout(scored('m', [[30, 15]]), 'A')).toBe(false)
    expect(isBlowout(scored('m', [[16, 7]]), 'A')).toBe(true)
  })

  it('打到平分加赛的，无论如何不算碾压', () => {
    expect(isBlowout(scored('m', [[30, 28]]), 'A')).toBe(false)
    expect(isBlowout(scored('m', [[23, 21]]), 'A')).toBe(false)
  })

  it('三局两胜：每一局都要碾压才算', () => {
    expect(isBlowout(scored('m', [[21, 8], [21, 9]]), 'A')).toBe(true)
    // 中间输过一局 —— 那一局「对手的分」比自己高，自然不成立
    expect(isBlowout(scored('m', [[21, 5], [18, 21], [21, 3]]), 'A')).toBe(false)
  })

  it('2:0 结束时那个没打的空局不算数', () => {
    /*
     * 三局两胜打 2:0 就结束了，第三局可能是个 0:0 的空壳。
     * 不排掉的话「0 不小于 0 的一半」会把每一场碾压都判成不是。
     */
    expect(isBlowout(scored('m', [[21, 6], [21, 4], [0, 0]]), 'A')).toBe(true)
  })

  it('B 队碾压也认得出来', () => {
    expect(isBlowout(scored('m', [[7, 21]]), 'B')).toBe(true)
    expect(isBlowout(scored('m', [[7, 21]]), 'A')).toBe(false)
  })

  it('碾压时 MMR 和金币都双倍', () => {
    const { progress } = replayMatches([scored('m1', [[21, 6]])])
    const w = progress.get('a1')!
    expect(w.mmr).toBe(WIN_POINTS * BLOWOUT_MULTIPLIER)
    expect(w.coins).toBe(WIN_POINTS * BLOWOUT_MULTIPLIER)
  })

  it('普通赢球还是原来那样，一分不多', () => {
    const { progress } = replayMatches([scored('m1', [[21, 15]])])
    const w = progress.get('a1')!
    expect(w.mmr).toBe(WIN_POINTS)
    expect(w.coins).toBe(WIN_POINTS)
  })

  it('碾压和爆冷不叠加 —— 最多双倍，不是四倍', () => {
    /*
     * 叠起来一场顶四场：分数忽上忽下失去意义，而且正好给刷分的人
     * 指了条路 —— 找个分低的队友赢一场 21:5。
     *
     * 造一个两者同时成立的局面：先让 B 队赢一场把分拉上去，
     * 再让 A 队碾压他们（这时 A 的平均 MMR 更低，算爆冷）。
     */
    const first = scored('m1', [[15, 21]], 1)   // B 赢，B 队 MMR 上去
    const second = scored('m2', [[21, 4]], 2)   // A 碾压 B，且 A 分更低 = 爆冷
    const { progress, outcomes } = replayMatches([first, second])
    const o = outcomes.get('m2')!
    expect(o.upset).toBe(true)
    expect(o.blowout).toBe(true)
    // a1 第一场输（MMR 扣到 0），第二场只该拿双倍，不是四倍
    expect(progress.get('a1')!.mmr).toBe(WIN_POINTS * UPSET_MULTIPLIER)
  })
})

/* ------------------------------------------------------------------ *
 * 防刷分
 * ------------------------------------------------------------------ */

const MIN = 3 * 60_000

/** 一场有时间的球。t 里的时刻都是毫秒，不写就是没记（老数据） */
const timed = (
  id: string,
  t: {
    startedAt?: number
    firstPointAt?: number
    lastPointAt?: number
    endedAt?: number
  },
  o: { seq?: number; sessionId?: string; teams?: [string[], string[]]; winner?: 'A' | 'B' } = {},
): Match => {
  const [teamA, teamB] = o.teams ?? [['a1', 'a2'], ['b1', 'b2']]
  const win = o.winner ?? 'A'
  return {
    id,
    sessionId: o.sessionId ?? 's1',
    courtIndex: 0,
    type: 'doubles',
    teamA,
    teamB,
    games: [
      {
        a: win === 'A' ? 21 : 15,
        b: win === 'B' ? 21 : 15,
        points: null,
        serveInit: null,
      },
    ],
    status: 'done',
    seq: o.seq ?? 1,
    ...t,
  }
}

describe('打得太快不算分', () => {
  it('不到 3 分钟：MMR 和金币都不动', () => {
    const { progress, outcomes } = replayMatches([
      timed('m1', { firstPointAt: 0, lastPointAt: MIN - 1 }),
    ])
    expect(outcomes.get('m1')!.tooQuick).toBe(true)
    expect(progress.get('a1')!.mmr).toBe(0)
    expect(progress.get('a1')!.coins).toBe(0)
  })

  it('输的那一边也不扣 —— 这一场对谁都不作数', () => {
    const ms = [
      // 先正常赢一场把 b1 的分垫起来
      timed('m1', { firstPointAt: 0, lastPointAt: MIN }, { seq: 1, winner: 'B' }),
      // 再来一场十秒的，b 队输
      timed('m2', { firstPointAt: 0, lastPointAt: 10_000 }, { seq: 2, winner: 'A' }),
    ]
    const { progress } = replayMatches(ms)
    expect(progress.get('b1')!.mmr).toBe(WIN_POINTS)
  })

  it('正好 3 分钟算数 —— 卡在门槛上的放行', () => {
    const { outcomes } = replayMatches([
      timed('m1', { firstPointAt: 0, lastPointAt: MIN }),
    ])
    expect(outcomes.get('m1')!.tooQuick).toBe(false)
  })

  it('战绩照记 —— 不算分不等于这场没打过', () => {
    const { progress } = replayMatches([
      timed('m1', { firstPointAt: 0, lastPointAt: 1000 }),
    ])
    expect(progress.get('a1')!.wins).toBe(1)
    expect(progress.get('b1')!.losses).toBe(1)
  })

  it('起点是第一分，不是摆上场 —— 热身那十分钟不算打球', () => {
    /*
     * 摆上场之后热身、等对手，过了十分钟才开打，一分钟打完。
     * 从摆上场算是 11 分钟（放行），从第一分算是 1 分钟（该拦）。
     */
    const { outcomes } = replayMatches([
      timed('m1', {
        startedAt: 0,
        firstPointAt: 10 * 60_000,
        lastPointAt: 11 * 60_000,
      }),
    ])
    expect(outcomes.get('m1')!.tooQuick).toBe(true)
  })

  it('终点是最后一分，不是点打完 —— 点完分把手机丢那儿等三分钟没用', () => {
    /*
     * 这正是要挡的那一类：十秒点完 21 分，然后等三分钟再点「打完」。
     * 用 endedAt 当终点的话，这一场会被判成 3 分钟，正好放过去。
     */
    const { outcomes } = replayMatches([
      timed('m1', {
        firstPointAt: 0,
        lastPointAt: 10_000,
        endedAt: 10 * 60_000,
      }),
    ])
    expect(outcomes.get('m1')!.tooQuick).toBe(true)
  })

  it('直接输入比分的场次一样要满 3 分钟，没有豁免', () => {
    // 这种录法没有第一分，起点退回摆上场
    const quick = replayMatches([
      timed('m1', { startedAt: 0, lastPointAt: 15_000 }),
    ])
    expect(quick.outcomes.get('m1')!.tooQuick).toBe(true)

    const ok = replayMatches([
      timed('m1', { startedAt: 0, lastPointAt: 8 * 60_000 }),
    ])
    expect(ok.outcomes.get('m1')!.tooQuick).toBe(false)
  })

  it('老数据不翻旧账 —— 没有 lastPointAt 的一律放行', () => {
    /*
     * lastPointAt 是这次改动才开始写的，两种录法都会写。
     * 所以「没有」就等于「这条是老版本记的」，那些场次不该被追着扣分。
     */
    const { progress, outcomes } = replayMatches([
      timed('m1', { startedAt: 0, endedAt: 5_000 }),
    ])
    expect(outcomes.get('m1')!.tooQuick).toBe(false)
    expect(progress.get('a1')!.mmr).toBe(WIN_POINTS)
  })
})

describe('同一组人重复打要打折', () => {
  /** 同一组人在同一个球局里连赢 n 场，每场都够 3 分钟 */
  const streak = (n: number, sessionId = 's1') =>
    Array.from({ length: n }, (_, i) =>
      timed(
        `${sessionId}-m${i + 1}`,
        { firstPointAt: i * 10 * 60_000, lastPointAt: i * 10 * 60_000 + MIN },
        { seq: i + 1, sessionId },
      ),
    )

  it('前 5 场全额', () => {
    const { progress } = replayMatches(streak(5))
    expect(progress.get('a1')!.mmr).toBe(5 * WIN_POINTS)
    expect(progress.get('a1')!.coins).toBe(5 * WIN_POINTS)
  })

  it('第 6 到第 10 场半额', () => {
    const { progress } = replayMatches(streak(10))
    // 5 场全额 + 5 场半额
    expect(progress.get('a1')!.mmr).toBe(5 * WIN_POINTS + 5 * (WIN_POINTS / 2))
    expect(progress.get('a1')!.coins).toBe(5 * WIN_POINTS + 5 * (WIN_POINTS / 2))
  })

  it('第 11 场起一分不给', () => {
    const ten = replayMatches(streak(10)).progress.get('a1')!
    const twenty = replayMatches(streak(20)).progress.get('a1')!
    expect(twenty.mmr).toBe(ten.mmr)
    expect(twenty.coins).toBe(ten.coins)
    // 但战绩还是记满 20 场
    expect(twenty.wins).toBe(20)
  })

  it('输的那一边同样打折 —— 不然反复对打会变成净扣分', () => {
    /*
     * 全场只有四个人打一晚上，在羽球里太常见了。
     * 只打赢家的折，到后面就成了「赢的不加、输的照扣」。
     *
     * 先让 b 队打赢一串不同的对手把分垫起来 —— 不然他们一直是 0 分，
     * 扣多扣少都是「扣到 0 为止」，这一条就测不出任何东西了。
     * （第一版就是这么写的，红测时它不会变红，才发现在测空气。）
     */
    const bank = Array.from({ length: 6 }, (_, i) =>
      timed(
        `bank${i}`,
        { firstPointAt: i * 10 * 60_000, lastPointAt: i * 10 * 60_000 + MIN },
        { seq: i + 1, teams: [['b1', 'b2'], [`x${i}`, `y${i}`]] },
      ),
    )
    const beat = Array.from({ length: 6 }, (_, i) =>
      timed(
        `beat${i}`,
        { firstPointAt: (10 + i) * 10 * 60_000, lastPointAt: (10 + i) * 10 * 60_000 + MIN },
        { seq: 10 + i },
      ),
    )
    const { outcomes } = replayMatches([...bank, ...beat])
    const sixth = outcomes.get('beat5')!
    expect(sixth.repeats).toBe(5) // 第 6 次输给同一组人 —— 半额
    const loser = sixth.impacts.find((i) => !i.won)!
    expect(loser.mmrBefore - loser.mmrAfter).toBe(LOSS_POINTS / 2)
  })

  it('换了搭档就是另一组，不打折', () => {
    const ms = [
      ...streak(5),
      // 第 6 场 a1 换了个搭档 —— 另一组人，重新从全额开始
      timed(
        'm6',
        { firstPointAt: 60 * 60_000, lastPointAt: 60 * 60_000 + MIN },
        { seq: 6, teams: [['a1', 'a3'], ['b1', 'b2']] },
      ),
    ]
    const { outcomes } = replayMatches(ms)
    expect(outcomes.get('m6')!.repeats).toBe(0)
    expect(outcomes.get('m6')!.impacts.find((i) => i.won)!.coins).toBe(WIN_POINTS)
  })

  it('反过来赢是另一组 —— 互有胜负的一晚上不会被打折', () => {
    const ms = Array.from({ length: 10 }, (_, i) =>
      timed(
        `m${i + 1}`,
        { firstPointAt: i * 10 * 60_000, lastPointAt: i * 10 * 60_000 + MIN },
        { seq: i + 1, winner: i % 2 === 0 ? 'A' : 'B' },
      ),
    )
    const { outcomes } = replayMatches(ms)
    // 各赢 5 场，两个方向各自数到 4，都还在全额里
    expect(outcomes.get('m9')!.repeats).toBe(4)
    expect(outcomes.get('m10')!.repeats).toBe(4)
    const { progress } = replayMatches(ms)
    expect(progress.get('a1')!.coins).toBe(5 * WIN_POINTS)
  })

  it('换个球局重新数 —— 不然每周固定对手的两个人会永远不涨分', () => {
    /*
     * 这一条是写测试时才想清楚的：计数要是不带球局，数的就是「这辈子」。
     * 每周跟同一个人打单打的两个人，打满十场之后就再也拿不到分了。
     */
    // 分成两个球局，各 5 场：两边各自从头数，10 场全是全额
    const across = replayMatches([...streak(5, 's1'), ...streak(5, 's2')])
    expect(across.progress.get('a1')!.coins).toBe(10 * WIN_POINTS)
    expect(across.outcomes.get('s2-m5')!.repeats).toBe(4)

    // 同样 10 场挤在一个球局里，后 5 场就是半额。
    // 两边一对比才说明计数真的按球局分开了 —— 只测其中一边是测不出来的。
    const within = replayMatches(streak(10, 's1'))
    expect(within.progress.get('a1')!.coins).toBe(5 * WIN_POINTS + 5 * (WIN_POINTS / 2))
    expect(within.outcomes.get('s1-m10')!.repeats).toBe(9)
  })

  it('打折和双倍是乘起来的，不是各算各的', () => {
    // 前 5 场普通赢，第 6 场碾压：双倍 20，再打半折 = 10
    const ms = [
      ...streak(5),
      {
        ...timed(
          'm6',
          { firstPointAt: 60 * 60_000, lastPointAt: 60 * 60_000 + MIN },
          { seq: 6 },
        ),
        games: [{ a: 21, b: 3, points: null, serveInit: null }],
      } as Match,
    ]
    const { outcomes } = replayMatches(ms)
    const o = outcomes.get('m6')!
    expect(o.blowout).toBe(true)
    expect(o.repeats).toBe(5)
    expect(o.impacts.find((i) => i.won)!.coins).toBe(
      (WIN_POINTS * BLOWOUT_MULTIPLIER) / 2,
    )
  })

  it('太快的场次直接归零，不管重复了几次', () => {
    const { outcomes } = replayMatches([
      timed('m1', { firstPointAt: 0, lastPointAt: 1000 }),
    ])
    const o = outcomes.get('m1')!
    expect(o.repeats).toBe(0)
    expect(o.impacts.find((i) => i.won)!.coins).toBe(0)
  })
})

describe('加注', () => {
  /** 一场逐分记下来、时长够的球 */
  const live = (id: string, o: Partial<Match> = {}, seq = 1): Match => ({
    ...timed(`${id}`, { firstPointAt: seq * 6e5, lastPointAt: seq * 6e5 + MIN }, { seq }),
    id,
    ...o,
  })

  it('加注赢了，MMR 和金币都双倍', () => {
    const { progress, outcomes } = replayMatches([live('m1', { staked: true })])
    expect(outcomes.get('m1')!.staked).toBe(true)
    expect(progress.get('a1')!.mmr).toBe(WIN_POINTS * STAKE_MULTIPLIER)
    expect(progress.get('a1')!.coins).toBe(WIN_POINTS * STAKE_MULTIPLIER)
  })

  it('加注输了，MMR 扣双倍', () => {
    /*
     * 输的一方先赢一串别的对手把分垫起来，不然一直贴着 0，
     * 扣双倍和扣单倍看起来一模一样。
     */
    const bank = Array.from({ length: 4 }, (_, i) =>
      timed(`bank${i}`, { firstPointAt: i * 6e5, lastPointAt: i * 6e5 + MIN },
        { seq: i + 1, teams: [['b1', 'b2'], [`x${i}`, `y${i}`]] }),
    )
    const { outcomes } = replayMatches([...bank, live('m1', { staked: true }, 9)])
    const loser = outcomes.get('m1')!.impacts.find((i) => !i.won)!
    expect(loser.mmrBefore - loser.mmrAfter).toBe(LOSS_POINTS * STAKE_MULTIPLIER)
  })

  it('没加注的场次，输赢都还是老样子', () => {
    const { progress, outcomes } = replayMatches([live('m1')])
    expect(outcomes.get('m1')!.staked).toBe(false)
    expect(progress.get('a1')!.mmr).toBe(WIN_POINTS)
  })

  it('金币还是只涨不跌 —— 加注输了也不扣钱', () => {
    const bank = Array.from({ length: 4 }, (_, i) =>
      timed(`bank${i}`, { firstPointAt: i * 6e5, lastPointAt: i * 6e5 + MIN },
        { seq: i + 1, teams: [['b1', 'b2'], [`x${i}`, `y${i}`]] }),
    )
    const before = replayMatches(bank).progress.get('b1')!.coins
    const after = replayMatches([...bank, live('m1', { staked: true }, 9)])
      .progress.get('b1')!.coins
    expect(after).toBe(before)
  })

  it('补录的场次加注不算数 —— 那时候谁赢已经知道了', () => {
    /*
     * 「直接输入最终比分」没有 firstPointAt。这是加注最明显的一个绕法：
     * 打完看到自己赢了，再回去按加注。
     */
    const direct = timed('m1', { startedAt: 0, lastPointAt: 8 * 60_000 })
    const { progress, outcomes } = replayMatches([{ ...direct, staked: true }])
    expect(outcomes.get('m1')!.staked).toBe(false)
    expect(progress.get('a1')!.mmr).toBe(WIN_POINTS)
  })

  it('加注和碾压不叠加 —— 任何加成最多双倍', () => {
    /*
     * 这一条是这个功能能不能上的关键：刷分的人打 21:0 本来就拿双倍，
     * 加注给不了他更多。也就是说加注一点没抬高刷分的天花板。
     */
    const both = { ...live('m1', { staked: true }), games: [{ a: 21, b: 3, points: null, serveInit: null }] } as Match
    const { progress, outcomes } = replayMatches([both])
    const o = outcomes.get('m1')!
    expect(o.staked).toBe(true)
    expect(o.blowout).toBe(true)
    expect(progress.get('a1')!.mmr).toBe(WIN_POINTS * STAKE_MULTIPLIER)
    expect(progress.get('a1')!.coins).toBe(WIN_POINTS * STAKE_MULTIPLIER)
  })

  it('加注和爆冷也不叠加', () => {
    const first = timed('m1', { firstPointAt: 0, lastPointAt: MIN }, { seq: 1, winner: 'B' })
    const second = { ...live('m2', { staked: true }, 2) } as Match
    const { progress, outcomes } = replayMatches([first, second])
    const o = outcomes.get('m2')!
    expect(o.upset).toBe(true)
    expect(o.staked).toBe(true)
    // a1 第一场输到 0，第二场只该拿双倍
    expect(progress.get('a1')!.mmr).toBe(WIN_POINTS * UPSET_MULTIPLIER)
  })

  it('打得太快的话，加注也救不回来', () => {
    const quick = timed('m1', { firstPointAt: 0, lastPointAt: 5000 })
    const { progress, outcomes } = replayMatches([{ ...quick, staked: true }])
    expect(outcomes.get('m1')!.tooQuick).toBe(true)
    expect(progress.get('a1')!.mmr).toBe(0)
    expect(progress.get('a1')!.coins).toBe(0)
  })

  it('重复打的折扣照打在加注上 —— 加注抬不高刷分的上限', () => {
    // 同一组人第 6 场：加注双倍 20，再打半折 = 10
    const ms = [
      ...Array.from({ length: 5 }, (_, i) =>
        timed(`m${i + 1}`, { firstPointAt: i * 6e5, lastPointAt: i * 6e5 + MIN }, { seq: i + 1 })),
      live('m6', { staked: true }, 6),
    ]
    const { outcomes } = replayMatches(ms)
    const o = outcomes.get('m6')!
    expect(o.repeats).toBe(5)
    expect(o.impacts.find((i) => i.won)!.coins).toBe(
      (WIN_POINTS * STAKE_MULTIPLIER) / 2,
    )
  })
})
