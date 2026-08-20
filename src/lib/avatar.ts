import { chronological, decidedMatches, matchWinnerBySets } from './ranking'
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

/**
 * 输一场扣多少 MMR（正数，算的时候是减掉）。
 * 扣到 0 就打住，不做负分 —— 打得再差也是从 0 重新爬，不至于挖个坑劝退新人。
 * 金币不受影响。
 */
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
 * 门槛看 MMR：赢一场 +10（爆冷 +20），输一场 −10 但扣到 0 就打住。
 * 顺风局大致换算成净胜场：卫士 +10、中军 +20、统帅 +30、传奇 +50、
 * 万古 +70、超凡 +85、冠绝 +100；爆冷赢得多的话会快不少。
 *
 * 到了冠绝还能继续往上，每 100 分加一级，显示成「Immortal 1」。
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
 * MMR 本身已经夹在 0 以上，这里再夹一次纯粹是防御。
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

/** 爆冷（赢了平均 MMR 比自己高的一方）时，赢的分翻几倍 */
export const UPSET_MULTIPLIER = 2

export type Progress = {
  wins: number
  losses: number
  /** MMR，最低 0，不会变成负数 */
  mmr: number
  /** 累计赚到的金币（还没扣花掉的） */
  coins: number
  level: LevelInfo
}

const emptyProgress = (): Progress => ({
  wins: 0,
  losses: 0,
  mmr: 0,
  coins: 0,
  level: levelOf(0),
})

/**
 * 按时间顺序重放所有比赛，算出每个人的 MMR、金币和战绩。
 *
 * 为什么必须一场一场推，不能用「胜场×10 − 负场×10」这个公式：
 *
 * 1. MMR 到 0 就不再往下扣。先输 3 场再赢 2 场，逐场算是 0→0→0→10→20，
 *    公式算是 2×10 − 3×10 = −10。两个结果不一样，逐场推的才是我们要的。
 * 2. 爆冷加倍要看「打这场的当下双方 MMR 谁高」，那是个随时间变的量，
 *    只有重放才知道。
 *
 * 代价是 O(比赛数 × 每场人数)，几千场也就几万次运算，无所谓。
 */
export function progressByPlayer(matches: Match[]): Map<string, Progress> {
  const out = new Map<string, Progress>()
  const get = (id: string) => {
    let p = out.get(id)
    if (!p) {
      p = emptyProgress()
      out.set(id, p)
    }
    return p
  }
  const avgMmr = (team: string[]) =>
    team.length ? team.reduce((s, id) => s + get(id).mmr, 0) / team.length : 0

  for (const m of chronological(decidedMatches(matches))) {
    const winnerSide = matchWinnerBySets(m)
    if (!winnerSide) continue
    const winners = winnerSide === 'A' ? m.teamA : m.teamB
    const losers = winnerSide === 'A' ? m.teamB : m.teamA

    // 爆冷：赢的这队打这场之前平均 MMR 更低
    const upset = avgMmr(winners) < avgMmr(losers)
    const gain = upset ? WIN_POINTS * UPSET_MULTIPLIER : WIN_POINTS

    for (const id of winners) {
      const p = get(id)
      p.wins += 1
      p.mmr += gain
      // 金币不跟着爆冷翻倍：那是买装备的钱，只按「赢了几场」算，规则越简单越好
      p.coins += WIN_POINTS
    }
    for (const id of losers) {
      const p = get(id)
      p.losses += 1
      // 输球扣分，但扣到 0 就打住，不做负分
      p.mmr = Math.max(0, p.mmr - LOSS_POINTS)
    }
  }

  for (const p of out.values()) p.level = levelOf(p.mmr)
  return out
}

export const progressOf = (playerId: string, matches: Match[]): Progress =>
  progressByPlayer(matches).get(playerId) ?? emptyProgress()

/** 只关心赢了几场的地方用这个 */
export const winCount = (playerId: string, matches: Match[]): number =>
  progressOf(playerId, matches).wins

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
