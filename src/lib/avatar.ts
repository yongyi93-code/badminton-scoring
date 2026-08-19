import { decidedMatches, matchWinnerBySets, sideOf } from './ranking'
import type { Match } from '@/types'

/* ------------------------------------------------------------------ *
 * 角色养成
 *
 * 目的很单纯：让人多一个想赢的理由。赢球拿金币，金币换装备把自己打扮帅。
 *
 * 设计上最要紧的一条：金币和 MMR「赚了多少」不落库，
 * 永远从比赛记录实时算出来 —— 和排行榜同一个口径，
 * 删掉一场比赛立刻跟着变，不会出现「战绩改了但积分没改」这种对不上的账。
 * 落库的只有「花掉了多少」和「买了什么」，这两个没法从比赛推导。
 * ------------------------------------------------------------------ */

/** 赢一场加多少 MMR（同时也是拿到多少金币） */
export const WIN_POINTS = 10

/** 输一场扣多少 MMR（正数，算的时候是减掉）。金币不受影响 */
export const LOSS_POINTS = 10

/** 角色性别，只此两种 */
export type AvatarSex = 'm' | 'f'

export const AVATAR_SEXES: { sex: AvatarSex; label: string }[] = [
  { sex: 'm', label: '男' },
  { sex: 'f', label: '女' },
]

/** 肤色档位，免费换，不进商店 */
export const SKIN_TONES = ['#f6dcc0', '#e8bb96', '#c68a63', '#8d5a3b'] as const

/** 装备槽位，一个槽位同时只能穿一件 */
export type AvatarSlot = 'hair' | 'outfit' | 'weapon' | 'background'

export const SLOT_LABELS: Record<AvatarSlot, string> = {
  hair: '发型',
  outfit: '战服',
  weapon: '武器',
  background: '背景',
}

/** 槽位展示顺序 */
export const SLOT_ORDER: AvatarSlot[] = ['hair', 'outfit', 'weapon', 'background']

export type ShopItem = {
  id: string
  name: string
  slot: AvatarSlot
  price: number
  /** 需要达到的段位下标，0 = 无门槛 */
  minLevel: number
  /** 只有某个性别能用；不填就是两边通用 */
  sex?: AvatarSex
}

/**
 * 商店目录。
 * 价格按「赢几场能买到」来定：赢一场 10 金币，所以 50 金币 = 赢 5 场。
 *
 * 段位门槛摊开到八段，每升一段都至少解锁一件新东西 ——
 * 升段本身要有看得见的奖励，不然中间几段爬起来没盼头。
 * 越靠后的段位配越贵的货，价格和段位一起卡，不会攒够钱就一步到位。
 *
 * 发型分男女：同一个名字在男女身上是两种画法，所以标了 sex；
 * 战服和武器男女通用，省一半工作量也省一半商店条目。
 */
export const SHOP_ITEMS: ShopItem[] = [
  // 发型 —— 男
  { id: 'm-short', name: '利落短发', slot: 'hair', price: 0, minLevel: 0, sex: 'm' },
  { id: 'm-spiky', name: '刺猬头', slot: 'hair', price: 80, minLevel: 0, sex: 'm' },
  { id: 'm-wolf', name: '狼尾', slot: 'hair', price: 200, minLevel: 2, sex: 'm' },
  { id: 'm-silver', name: '银发', slot: 'hair', price: 700, minLevel: 6, sex: 'm' },
  // 发型 —— 女
  { id: 'f-bob', name: '齐耳短发', slot: 'hair', price: 0, minLevel: 0, sex: 'f' },
  { id: 'f-twin', name: '双马尾', slot: 'hair', price: 80, minLevel: 0, sex: 'f' },
  { id: 'f-long', name: '黑长直', slot: 'hair', price: 200, minLevel: 2, sex: 'f' },
  { id: 'f-wavy', name: '金色大波浪', slot: 'hair', price: 700, minLevel: 6, sex: 'f' },
  // 战服
  { id: 'tee', name: '训练服', slot: 'outfit', price: 0, minLevel: 0 },
  { id: 'jersey', name: '球队队服', slot: 'outfit', price: 60, minLevel: 0 },
  { id: 'leather', name: '轻甲', slot: 'outfit', price: 150, minLevel: 1 },
  { id: 'knight', name: '骑士铠', slot: 'outfit', price: 400, minLevel: 4 },
  { id: 'shadow', name: '暗影战衣', slot: 'outfit', price: 900, minLevel: 7 },
  // 武器
  { id: 'racket', name: '羽毛球拍', slot: 'weapon', price: 0, minLevel: 0 },
  { id: 'dagger', name: '短刃', slot: 'weapon', price: 70, minLevel: 0 },
  { id: 'sword', name: '长剑', slot: 'weapon', price: 250, minLevel: 3 },
  { id: 'staff', name: '法杖', slot: 'weapon', price: 500, minLevel: 5 },
  { id: 'greatsword', name: '巨剑', slot: 'weapon', price: 1200, minLevel: 7 },
  // 背景
  { id: 'court', name: '球场', slot: 'background', price: 150, minLevel: 1 },
  { id: 'podium', name: '领奖台', slot: 'background', price: 500, minLevel: 5 },
  { id: 'galaxy', name: '星空', slot: 'background', price: 1200, minLevel: 7 },
]

/** 某个性别能买到的东西：通用的 + 专属的 */
export const shopFor = (sex: AvatarSex): ShopItem[] =>
  SHOP_ITEMS.filter((i) => !i.sex || i.sex === sex)

/** 开局白送的那几件，价格为 0 —— 新号一进来就有得穿，不至于光着 */
export const STARTER_IDS = SHOP_ITEMS.filter((i) => i.price === 0).map((i) => i.id)

export const itemById = (id: string): ShopItem | undefined =>
  SHOP_ITEMS.find((i) => i.id === id)

/* ------------------------------------------------------------------ *
 * 等级
 * ------------------------------------------------------------------ */

export type LevelTier = {
  /** 英文段位名，和 Dota 一致 */
  name: string
  /** 中文叫法，界面上跟在英文后面 */
  label: string
  /** 达到这个段位所需的累计积分 */
  min: number
  color: string
}

/** 每个段位内部分几颗星 */
export const STARS_PER_TIER = 5

/** 冠绝之上每多少分升一级（冠绝 1、冠绝 2……） */
export const IMMORTAL_STEP = 100

/**
 * 段位照搬 Dota 那一套八段，一段不少。
 *
 * 门槛看 MMR = 赢的场数 × 10 − 输的场数 × 10，赢加输减、可以为负。
 * 换算成净胜场：卫士 +10、中军 +20、统帅 +30、传奇 +50、
 * 万古 +70、超凡 +85、冠绝 +100。
 *
 * 到了冠绝还能继续往上，每 100 分（净胜 10 场）加一级，显示成「Immortal 1」。
 */
export const PET_LEVELS: LevelTier[] = [
  { name: 'Herald', label: '先锋', min: 0, color: '#8fa07d' },
  { name: 'Guardian', label: '卫士', min: 100, color: '#9fb0bf' },
  { name: 'Crusader', label: '中军', min: 200, color: '#5fb8a8' },
  { name: 'Archon', label: '统帅', min: 300, color: '#7fc47f' },
  { name: 'Legend', label: '传奇', min: 500, color: '#e3b344' },
  { name: 'Ancient', label: '万古', min: 700, color: '#b98cd8' },
  { name: 'Divine', label: '超凡', min: 850, color: '#7fb3ff' },
  { name: 'Immortal', label: '冠绝', min: 1000, color: '#ff8a3d' },
]

export type LevelInfo = {
  /** 段位下标，和 ShopItem.minLevel 对应 */
  index: number
  tier: LevelTier
  /** 显示用的完整名字，例如 'Archon' 或 'Immortal 3' */
  display: string
  /**
   * 冠绝之上的编号：0 = 冠绝本身，1 = 冠绝 1，以此类推。
   * 没到冠绝为 null。
   */
  immortalRank: number | null
  /** 下一段，已进冠绝为 null（冠绝之上按编号无限涨） */
  next: LevelTier | null
  /** 距离下一段（或下一个冠绝编号）还差多少分 */
  toNext: number
  /** 当前段位内的进度 0~1 */
  progress: number
  /**
   * 段位内的第几颗星（1~5）。
   * 冠绝不分星，改用编号，返回 null。
   */
  star: number | null
}

/**
 * 由 MMR 算出段位。
 *
 * MMR 可以是负的（输多过赢），负分一律按 0 处理落在最低段 ——
 * 打得再差也就是先锋，不设「负段位」，不然新手会被劝退。
 */
export function levelOf(mmr: number): LevelInfo {
  const pts = Math.max(0, mmr)
  let index = 0
  for (let i = 0; i < PET_LEVELS.length; i++) {
    if (pts >= PET_LEVELS[i].min) index = i
  }
  const tier = PET_LEVELS[index]
  const next = PET_LEVELS[index + 1] ?? null

  // 冠绝：不再有下一段，改成每 IMMORTAL_STEP 分一个编号，可以一直往上
  if (!next) {
    const over = pts - tier.min
    const immortalRank = Math.floor(over / IMMORTAL_STEP)
    const intoStep = over - immortalRank * IMMORTAL_STEP
    return {
      index,
      tier,
      display: immortalRank > 0 ? `${tier.name} ${immortalRank}` : tier.name,
      immortalRank,
      next: null,
      toNext: IMMORTAL_STEP - intoStep,
      progress: intoStep / IMMORTAL_STEP,
      star: null,
    }
  }

  const span = next.min - tier.min
  const progress = span > 0 ? (pts - tier.min) / span : 1
  return {
    index,
    tier,
    display: tier.name,
    immortalRank: null,
    next,
    toNext: next.min - pts,
    progress,
    // 刚进这一段就是 1 星，差一分升段还是 5 星
    star: Math.min(STARS_PER_TIER, Math.floor(progress * STARS_PER_TIER) + 1),
  }
}

/** 某段位第 n 颗星对应多少 MMR，用来告诉人「再赢几场亮下一颗星」 */
export function starThreshold(tierIndex: number, star: number): number {
  const tier = PET_LEVELS[tierIndex]
  const next = PET_LEVELS[tierIndex + 1]
  if (!tier || !next) return tier?.min ?? 0
  const span = next.min - tier.min
  return tier.min + Math.ceil((span * (star - 1)) / STARS_PER_TIER)
}

/* ------------------------------------------------------------------ *
 * 积分
 * ------------------------------------------------------------------ */

export type PlayerRecord = { wins: number; losses: number }

/** 某人的胜负场次 —— 口径和排行榜完全一致 */
export function recordOf(playerId: string, matches: Match[]): PlayerRecord {
  let wins = 0
  let losses = 0
  for (const m of decidedMatches(matches)) {
    const side = sideOf(m, playerId)
    if (!side) continue
    if (matchWinnerBySets(m) === side) wins += 1
    else losses += 1
  }
  return { wins, losses }
}

/** 兼容旧叫法：只关心赢了几场的地方还在用 */
export const winCount = (playerId: string, matches: Match[]): number =>
  recordOf(playerId, matches).wins

/**
 * MMR：赢一场加，输一场减，可以为负。
 * 这是「现在什么水平」，打得差会掉下来，段位就是按它划的。
 */
export const mmrFrom = (r: PlayerRecord): number =>
  r.wins * WIN_POINTS - r.losses * LOSS_POINTS

/**
 * 金币：只按赢的场次算，输球不扣。
 *
 * 特意和 MMR 分开。要是买装备的钱也跟着输球缩水，
 * 会出现「昨天买得起、今天输两场就买不起」，甚至已经攒着准备买的钱凭空蒸发 ——
 * 那样大家会不敢打，正好和这套东西的目的相反。
 * 段位掉可以，攒下的家当不能被没收。
 */
export const coinsFrom = (r: PlayerRecord): number => r.wins * WIN_POINTS

export type Progress = {
  wins: number
  losses: number
  /** MMR，可为负 */
  mmr: number
  /** 累计赚到的金币（还没扣花掉的） */
  coins: number
  level: LevelInfo
}

const progressFrom = (r: PlayerRecord): Progress => {
  const mmr = mmrFrom(r)
  return {
    ...r,
    mmr,
    coins: coinsFrom(r),
    level: levelOf(mmr),
  }
}

export const progressOf = (playerId: string, matches: Match[]): Progress =>
  progressFrom(recordOf(playerId, matches))

/**
 * 一次扫完算出所有人的战绩、MMR 与段位。
 * 排行榜每一行都要，逐个调 progressOf 会把比赛表扫 N 遍。
 */
export function progressByPlayer(matches: Match[]): Map<string, Progress> {
  const records = new Map<string, PlayerRecord>()
  const bump = (id: string, won: boolean) => {
    const cur = records.get(id) ?? { wins: 0, losses: 0 }
    if (won) cur.wins += 1
    else cur.losses += 1
    records.set(id, cur)
  }

  for (const m of decidedMatches(matches)) {
    const winner = matchWinnerBySets(m)
    if (!winner) continue
    for (const id of m.teamA) bump(id, winner === 'A')
    for (const id of m.teamB) bump(id, winner === 'B')
  }

  return new Map([...records].map(([id, r]) => [id, progressFrom(r)]))
}

/* ------------------------------------------------------------------ *
 * 角色档案
 * ------------------------------------------------------------------ */

export type AvatarProfile = {
  playerId: string
  sex: AvatarSex
  /** 肤色档位下标，免费换 */
  skin: number
  /** 已买下的装备 id */
  owned: string[]
  /** 当前每个槽位穿着什么 */
  equipped: Partial<Record<AvatarSlot, string>>
  /** 累计花掉的金币。只有这个和 owned 需要落库 */
  spent: number
  createdAt: number
}

/** 换性别时把发型换成对应性别的免费款，否则会顶着异性发型 */
export const defaultHair = (sex: AvatarSex): string =>
  sex === 'm' ? 'm-short' : 'f-bob'

export const newAvatar = (playerId: string, sex: AvatarSex): AvatarProfile => ({
  playerId,
  sex,
  skin: 0,
  // 免费那几件直接送，新号一进来就穿戴整齐
  owned: [...STARTER_IDS],
  equipped: { hair: defaultHair(sex), outfit: 'tee', weapon: 'racket' },
  spent: 0,
  createdAt: Date.now(),
})

/** 还剩多少金币能花。金币只增不减，所以正常不会为负，夹一下防御 */
export const balanceOf = (
  avatar: AvatarProfile | undefined,
  coins: number,
): number => Math.max(0, coins - (avatar?.spent ?? 0))

export type BuyBlock = 'owned' | 'level' | 'money' | null

/**
 * 能不能买。返回挡住的原因，界面直接拿来显示，
 * 免得每处自己拼「段位不够」还是「金币不够」。
 *
 * 两道关分别看两个数：段位门槛看 MMR（会掉），价格看金币（不会掉）。
 * 所以输球可能让你暂时买不了某件高段位的货，但不会没收已经买下的东西。
 */
export function buyBlocker(
  item: ShopItem,
  avatar: AvatarProfile | undefined,
  progress: Progress,
): BuyBlock {
  if (avatar?.owned.includes(item.id)) return 'owned'
  if (progress.level.index < item.minLevel) return 'level'
  if (balanceOf(avatar, progress.coins) < item.price) return 'money'
  return null
}

/** 身上装备的总价值，用来显示「这身行头值多少」 */
export function outfitValue(avatar: AvatarProfile | undefined): number {
  if (!avatar) return 0
  return SLOT_ORDER.reduce((sum, slot) => {
    const id = avatar.equipped[slot]
    return sum + (id ? (itemById(id)?.price ?? 0) : 0)
  }, 0)
}
