import { decidedMatches, matchWinnerBySets, sideOf } from './ranking'
import type { Match } from '@/types'

/* ------------------------------------------------------------------ *
 * 宠物养成
 *
 * 目的很单纯：让人多一个想赢的理由。赢球拿积分，积分换装备打扮宠物。
 *
 * 设计上最要紧的一条：积分「赚了多少」不落库，永远从比赛记录实时算出来。
 * 和排行榜同一个口径，删掉一场比赛积分立刻跟着变，不会出现
 * 「战绩改了但积分没改」这种对不上的账。
 * 落库的只有「花掉了多少」和「买了什么」—— 这两个没法从比赛推导。
 * ------------------------------------------------------------------ */

/** 赢一场给多少分。输了不给，这是选好胜心最强的那档规则 */
export const WIN_POINTS = 10

export type PetKind = 'dog' | 'cat' | 'fish'

export const PET_KINDS: { kind: PetKind; label: string }[] = [
  { kind: 'dog', label: '狗' },
  { kind: 'cat', label: '猫' },
  { kind: 'fish', label: '鱼' },
]

/** 装备槽位，一个槽位同时只能戴一件 */
export type PetSlot = 'hat' | 'face' | 'neck' | 'item' | 'background'

export const SLOT_LABELS: Record<PetSlot, string> = {
  hat: '头顶',
  face: '眼部',
  neck: '脖子',
  item: '手持',
  background: '背景',
}

/** 槽位展示顺序 */
export const SLOT_ORDER: PetSlot[] = ['hat', 'face', 'neck', 'item', 'background']

export type ShopItem = {
  id: string
  name: string
  slot: PetSlot
  price: number
  /** 需要达到的等级下标，0 = 无门槛 */
  minLevel: number
}

/**
 * 商店目录。
 * 价格按「赢几场能买到」来定：赢一场 10 分，所以 50 分 = 赢 5 场。
 * 高级货挂等级门槛，避免攒够钱就能一步到位，留点长期目标。
 */
export const SHOP_ITEMS: ShopItem[] = [
  // 头顶
  { id: 'headband', name: '运动头带', slot: 'hat', price: 30, minLevel: 0 },
  { id: 'cap', name: '鸭舌帽', slot: 'hat', price: 60, minLevel: 0 },
  { id: 'laurel', name: '桂冠', slot: 'hat', price: 180, minLevel: 2 },
  { id: 'crown', name: '王冠', slot: 'hat', price: 260, minLevel: 3 },
  // 眼部
  { id: 'goggles', name: '护目镜', slot: 'face', price: 50, minLevel: 0 },
  { id: 'shades', name: '墨镜', slot: 'face', price: 80, minLevel: 1 },
  // 脖子
  { id: 'bowtie', name: '领结', slot: 'neck', price: 40, minLevel: 0 },
  { id: 'scarf', name: '围巾', slot: 'neck', price: 70, minLevel: 1 },
  { id: 'medal', name: '金牌', slot: 'neck', price: 150, minLevel: 2 },
  // 手持
  { id: 'shuttle', name: '羽毛球', slot: 'item', price: 25, minLevel: 0 },
  { id: 'racket', name: '球拍', slot: 'item', price: 50, minLevel: 0 },
  { id: 'trophy', name: '奖杯', slot: 'item', price: 220, minLevel: 3 },
  // 背景
  { id: 'court', name: '球场', slot: 'background', price: 90, minLevel: 1 },
  { id: 'podium', name: '领奖台', slot: 'background', price: 200, minLevel: 2 },
  { id: 'galaxy', name: '星空', slot: 'background', price: 320, minLevel: 4 },
]

export const itemById = (id: string): ShopItem | undefined =>
  SHOP_ITEMS.find((i) => i.id === id)

/* ------------------------------------------------------------------ *
 * 等级
 * ------------------------------------------------------------------ */

export type LevelTier = {
  name: string
  /** 达到这个等级所需的累计积分 */
  min: number
  color: string
}

/**
 * 等级看「累计赚到的分」，不看余额 —— 买东西花钱不该掉段。
 * 门槛换算成场数：白银 10 胜、黄金 30 胜、铂金 60 胜、大师 100 胜、传奇 180 胜。
 */
export const PET_LEVELS: LevelTier[] = [
  { name: '青铜', min: 0, color: '#b08d57' },
  { name: '白银', min: 100, color: '#c9d1d9' },
  { name: '黄金', min: 300, color: '#f2c14e' },
  { name: '铂金', min: 600, color: '#7fd4c1' },
  { name: '大师', min: 1000, color: '#a78bfa' },
  { name: '传奇', min: 1800, color: '#fb7185' },
]

export type LevelInfo = {
  /** 等级下标，和 ShopItem.minLevel 对应 */
  index: number
  tier: LevelTier
  /** 下一级，已满级为 null */
  next: LevelTier | null
  /** 距离下一级还差多少分，已满级为 0 */
  toNext: number
  /** 当前等级内的进度 0~1，已满级为 1 */
  progress: number
}

export function levelOf(earned: number): LevelInfo {
  const pts = Math.max(0, earned)
  let index = 0
  for (let i = 0; i < PET_LEVELS.length; i++) {
    if (pts >= PET_LEVELS[i].min) index = i
  }
  const tier = PET_LEVELS[index]
  const next = PET_LEVELS[index + 1] ?? null
  if (!next) return { index, tier, next: null, toNext: 0, progress: 1 }

  const span = next.min - tier.min
  return {
    index,
    tier,
    next,
    toNext: next.min - pts,
    progress: span > 0 ? (pts - tier.min) / span : 1,
  }
}

/* ------------------------------------------------------------------ *
 * 积分
 * ------------------------------------------------------------------ */

/** 某人赢了多少场 —— 口径和排行榜完全一致 */
export function winCount(playerId: string, matches: Match[]): number {
  let wins = 0
  for (const m of decidedMatches(matches)) {
    const side = sideOf(m, playerId)
    if (side && matchWinnerBySets(m) === side) wins += 1
  }
  return wins
}

/** 累计赚到的分（实时推导，不落库） */
export const earnedPoints = (playerId: string, matches: Match[]): number =>
  winCount(playerId, matches) * WIN_POINTS

/* ------------------------------------------------------------------ *
 * 宠物档案
 * ------------------------------------------------------------------ */

export type PetProfile = {
  playerId: string
  kind: PetKind
  /** 宠物名字，空着就用默认叫法 */
  name: string
  /** 已买下的道具 id */
  owned: string[]
  /** 当前每个槽位戴着什么 */
  equipped: Partial<Record<PetSlot, string>>
  /** 累计花掉的积分。只有这个和 owned 需要落库 */
  spent: number
  createdAt: number
}

export const defaultPetName = (kind: PetKind): string =>
  ({ dog: '旺仔', cat: '喵喵', fish: '泡泡' })[kind]

export const newPet = (playerId: string, kind: PetKind): PetProfile => ({
  playerId,
  kind,
  name: defaultPetName(kind),
  owned: [],
  equipped: {},
  spent: 0,
  createdAt: Date.now(),
})

/** 还能花多少。理论上不会为负，真出现了也夹到 0，界面不至于显示负数 */
export const balanceOf = (pet: PetProfile | undefined, earned: number): number =>
  Math.max(0, earned - (pet?.spent ?? 0))

export type BuyBlock = 'owned' | 'level' | 'money' | null

/**
 * 能不能买。返回挡住的原因，界面直接拿来显示，
 * 免得每处自己拼「等级不够」还是「钱不够」。
 */
export function buyBlocker(
  item: ShopItem,
  pet: PetProfile | undefined,
  earned: number,
): BuyBlock {
  if (pet?.owned.includes(item.id)) return 'owned'
  if (levelOf(earned).index < item.minLevel) return 'level'
  if (balanceOf(pet, earned) < item.price) return 'money'
  return null
}

/** 已装备道具的总价值，用来显示「这身行头值多少」 */
export function outfitValue(pet: PetProfile | undefined): number {
  if (!pet) return 0
  return SLOT_ORDER.reduce((sum, slot) => {
    const id = pet.equipped[slot]
    return sum + (id ? (itemById(id)?.price ?? 0) : 0)
  }, 0)
}
