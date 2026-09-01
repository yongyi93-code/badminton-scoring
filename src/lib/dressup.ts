import type { AvatarSex, ShopItem } from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * 分层换装（paper doll）
 *
 * 买了衣服就穿上、买了鞋就换鞋 —— 靠一套「同一个人、同一个姿势」的
 * 分层素材实现：一张底图，加上每件装备各一张图层。
 *
 * 素材是这么来的：先定一张底图，每件装备都用局部重绘在这张底图上只改
 * 那一处，得到一张完整人像；再拿变体和底图逐像素比对，差异区域就是
 * 那件装备，抠出来当图层。所以每一层天生就和底图严丝合缝。
 * 整条流水线在 design/extract-dressup.py。
 *
 * 每件装备存两个文件：
 *   xxx.webp       图层本身（带透明）
 *   xxx.mask.webp  区域掩膜（区域放在 alpha 通道里）
 *
 * 为什么要掩膜：合成不是简单叠加，而是「先按掩膜擦掉那块，再画上新的」。
 * 少了这一步，短袖换成无袖时底图的旧袖子会从新衣服边上露出来 ——
 * 图层的 alpha 分不出「区域内但透明（该擦）」和「区域外（该留）」。
 *
 * 男女各一套，两套素材的文件名是一样的（都是 top-01.webp），
 * 靠文件夹分开。所以商店 id 要带上性别前缀，见 dressId。
 * ------------------------------------------------------------------ */

/** 分层换装的四个槽位，和画在人身上的顺序一致（先画的在下面） */
export const DRESS_SLOTS = ['bottom', 'top', 'shoes', 'racket'] as const
export type DressSlot = (typeof DRESS_SLOTS)[number]

/** 每个槽位有几件 */
export const TIERS_PER_SLOT = 11

/**
 * 价格与段位门槛，从低到高。男女共用一份 ——
 * 同一档位两边一样贵，谁也不吃亏。
 * 第一件白送（新号一进来就有得穿），之后越来越贵；
 * 段位门槛摊到八段上，每升一段都能解锁点新东西。
 */
const PRICE = [0, 40, 90, 160, 260, 400, 570, 780, 1030, 1330, 1700]
const MIN_TIER = [0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 7]

/** 每件的名字，下标即等级（0 起）。顺序就是素材文件的编号顺序。 */
/*
 * 每件的名字，下标即等级（0 起）。顺序就是素材文件的编号顺序。
 *
 * 存成 [中文, English] 两元组 —— 少一个 TypeScript 当场报元组长度不对，
 * 不会等到英文界面上冒出一串中文才发现。
 */
const NAMES: Record<AvatarSex, Record<DressSlot, [string, string][]>> = {
  f: {
    top: [
      ['白紫背心', 'White & Violet Vest'],
      ['粉白训练衫', 'Pink Training Top'],
      ['浅粉运动T', 'Soft Pink Tee'],
      ['速干透气衣', 'Quick-Dry Tee'],
      ['白紫轻量背心', 'Violet Light Vest'],
      ['樱花暗纹袍', 'Sakura Weave Top'],
      ['冰蓝运动衫', 'Ice Blue Jersey'],
      ['紫晶护肩衣', 'Amethyst Shoulder Top'],
      ['紫月能量外套', 'Violet Moon Jacket'],
      ['金白冠军战衣', 'Gold & White Champion Top'],
      ['粉蓝传奇战衣', 'Legendary Rose Top'],
    ],
    bottom: [
      ['灰白运动裙', 'Grey Sports Skirt'],
      ['黑运动短裙', 'Black Sports Skirt'],
      ['粉白运动裙', 'Pink Sports Skirt'],
      ['速干五分裤', 'Quick-Dry Shorts'],
      ['白紫训练裤', 'Violet Training Pants'],
      ['樱花纹战裙', 'Sakura Weave Skirt'],
      ['电光粉紧身裤', 'Neon Pink Tights'],
      ['冰晶护膝裙', 'Ice Crystal Skirt'],
      ['紫月能量裤', 'Violet Moon Pants'],
      ['金白冠军裙', 'Gold & White Champion Skirt'],
      ['粉蓝传奇战裙', 'Legendary Rose Skirt'],
    ],
    shoes: [
      ['入门球鞋', 'Starter Shoes'],
      ['白粉训练鞋', 'Pink Training Shoes'],
      ['粉白练习鞋', 'Soft Pink Trainers'],
      ['轻量速跑鞋', 'Lightweight Runners'],
      ['紫白稳定鞋', 'Violet Stability Shoes'],
      ['樱花纹战靴', 'Sakura Weave Boots'],
      ['电光粉弹跳鞋', 'Neon Pink Bounce'],
      ['冰晶护踝鞋', 'Ice Crystal Highs'],
      ['紫晶护踝鞋', 'Amethyst Highs'],
      ['金白冠军鞋', 'Gold & White Champion Shoes'],
      ['粉蓝传奇战靴', 'Legendary Rose Boots'],
    ],
    racket: [
      ['入门球拍', 'Starter Racket'],
      ['基础训练拍', 'Basic Training Racket'],
      ['粉白练习拍', 'Pink Practice Racket'],
      ['轻量速拍', 'Lightweight Speed Racket'],
      ['紫白进攻拍', 'Violet Attack Racket'],
      ['樱花纹球拍', 'Sakura Weave Racket'],
      ['电光粉球拍', 'Neon Pink Racket'],
      ['冰晶球拍', 'Ice Crystal Racket'],
      ['紫月能量拍', 'Violet Moon Racket'],
      ['金白冠军拍', 'Gold & White Champion Racket'],
      ['粉蓝传奇拍', 'Legendary Rose Racket'],
    ],
  },
  m: {
    top: [
      ['白蓝背心', 'White & Blue Vest'],
      ['黑白训练衫', 'Black Training Top'],
      ['浅灰运动T', 'Light Grey Tee'],
      ['速干透气衣', 'Quick-Dry Tee'],
      ['藏青轻量背心', 'Navy Light Vest'],
      ['云纹暗纹衫', 'Cloud Weave Top'],
      ['电光蓝运动衫', 'Electric Blue Jersey'],
      ['冰晶护肩衣', 'Ice Crystal Shoulder Top'],
      ['暗夜能量外套', 'Midnight Jacket'],
      ['金黑冠军战衣', 'Gold & Black Champion Top'],
      ['蓝金传奇战衣', 'Legendary Blue Top'],
    ],
    bottom: [
      ['灰白运动短裤', 'Grey Sports Shorts'],
      ['黑运动短裤', 'Black Sports Shorts'],
      ['白蓝运动短裤', 'White & Blue Shorts'],
      ['速干五分裤', 'Quick-Dry Shorts'],
      ['藏青训练裤', 'Navy Training Pants'],
      ['云纹战裤', 'Cloud Weave Shorts'],
      ['电光蓝紧身裤', 'Electric Blue Tights'],
      ['冰晶护膝裤', 'Ice Crystal Pants'],
      ['暗夜能量裤', 'Midnight Pants'],
      ['金黑冠军裤', 'Gold & Black Champion Shorts'],
      ['蓝金传奇战裤', 'Legendary Blue Shorts'],
    ],
    shoes: [
      ['入门球鞋', 'Starter Shoes'],
      ['黑白训练鞋', 'Black Training Shoes'],
      ['灰白练习鞋', 'Grey Trainers'],
      ['轻量速跑鞋', 'Lightweight Runners'],
      ['藏青稳定鞋', 'Navy Stability Shoes'],
      ['云纹战靴', 'Cloud Weave Boots'],
      ['电光蓝弹跳鞋', 'Electric Blue Bounce'],
      ['冰晶护踝鞋', 'Ice Crystal Highs'],
      ['暗夜护踝鞋', 'Midnight Highs'],
      ['金黑冠军鞋', 'Gold & Black Champion Shoes'],
      ['蓝金传奇战靴', 'Legendary Blue Boots'],
    ],
    racket: [
      ['入门球拍', 'Starter Racket'],
      ['基础训练拍', 'Basic Training Racket'],
      ['灰白练习拍', 'Grey Practice Racket'],
      ['轻量速拍', 'Lightweight Speed Racket'],
      ['藏青进攻拍', 'Navy Attack Racket'],
      ['云纹球拍', 'Cloud Weave Racket'],
      ['电光蓝球拍', 'Electric Blue Racket'],
      ['冰晶球拍', 'Ice Crystal Racket'],
      ['暗夜能量拍', 'Midnight Racket'],
      ['金黑冠军拍', 'Gold & Black Champion Racket'],
      ['蓝金传奇拍', 'Legendary Blue Racket'],
    ],
  },
}

/**
 * 商店 id，例如 f/top-03。
 *
 * 必须带性别前缀：两套素材的文件名是一样的，光看 top-03 分不出是哪一套。
 * 不带前缀的话，换个性别身上那件会指向另一套里同名的另一件衣服。
 * 编号从 01 起，和文件名一一对应。
 */
export const dressId = (sex: AvatarSex, slot: DressSlot, tier: number) =>
  `${sex}/${slot}-${String(tier + 1).padStart(2, '0')}`

/** 把 f/top-03 拆回「哪一套」和「文件叫什么」 */
function parseId(id: string): { sex: AvatarSex; key: string } | null {
  const [sex, key] = id.split('/')
  if ((sex !== 'f' && sex !== 'm') || !key) return null
  return { sex, key }
}

/* ------------------------------------------------------------------ *
 * 素材
 * ------------------------------------------------------------------ */

type Box = { x: number; y: number; w: number; h: number }
type Meta = {
  size: [number, number]
  items: Record<string, Box>
  /** 全身取景框，脚本按素材实测算出来的 */
  body: Box
  /** 头肩取景框 */
  head: Box
}

/**
 * eager 是有意的：一共两百来个小文件，构建时就解析成带 hash 的 URL，
 * 换装时不用等动态 import，点一下立刻就换过去。
 *
 * 路径必须写成字面量，glob 不接受变量，所以两套只能各写一遍。
 */
const FILES: Record<AvatarSex, Record<string, string>> = {
  f: import.meta.glob('../assets/dressup/*.webp', {
    eager: true, import: 'default', query: '?url',
  }) as Record<string, string>,
  m: import.meta.glob('../assets/dressup-m/*.webp', {
    eager: true, import: 'default', query: '?url',
  }) as Record<string, string>,
}

/**
 * meta 也用 glob 取：某一套整个删掉时 glob 返回空对象，
 * 而静态 import 会直接让构建失败。哪一套能被删干净是有意保留的退路 ——
 * 删掉之后那个性别自动退回按段位换整套立绘的老路。
 */
const METAS: Record<AvatarSex, Meta | null> = {
  f: Object.values(
    import.meta.glob('../assets/dressup/meta.json', {
      eager: true, import: 'default',
    }) as Record<string, Meta>,
  )[0] ?? null,
  m: Object.values(
    import.meta.glob('../assets/dressup-m/meta.json', {
      eager: true, import: 'default',
    }) as Record<string, Meta>,
  )[0] ?? null,
}

const urlOf = (sex: AvatarSex, key: string) =>
  Object.entries(FILES[sex]).find(([p]) => p.endsWith(`/${key}.webp`))?.[1]

/** 这个性别有没有分层素材。没有就退回按段位换整套立绘的老路。 */
export const dressUpFor = (sex: AvatarSex) =>
  METAS[sex] !== null && !!urlOf(sex, 'base')

/** 有没有任何一套 —— 界面上决定要不要提「买了就穿上」这回事 */
export const hasDressUp = dressUpFor('f') || dressUpFor('m')

const FALLBACK_CANVAS: [number, number] = [864, 1152]

/** 一套素材的全部信息，渲染那边要的都在这 */
export type DressSet = {
  canvas: [number, number]
  base: string
  body: Box
  head: Box
}

export function dressSet(sex: AvatarSex): DressSet | null {
  const meta = METAS[sex]
  const base = urlOf(sex, 'base')
  if (!meta || !base) return null
  const [w, h] = meta.size ?? FALLBACK_CANVAS
  return {
    canvas: [w, h],
    base,
    body: meta.body ?? { x: 0, y: 0, w, h },
    head: meta.head ?? { x: 0, y: 0, w, h },
  }
}

/** 某件装备的图层、掩膜和它在画布上的位置；素材缺失返回 null */
export function dressLayer(id: string) {
  const parsed = parseId(id)
  if (!parsed) return null
  const { sex, key } = parsed
  const box = METAS[sex]?.items[key]
  const art = urlOf(sex, key)
  const mask = urlOf(sex, `${key}.mask`)
  if (!box || !art || !mask) return null
  return { box, art, mask }
}

/**
 * 商店和衣柜小图的取景框：框住这一件，四周留一点余量。
 *
 * 裁成正方形是有意的 —— 一条长裙的原始区域又窄又高，
 * 按原比例塞进方格里只剩一条细线。宁可多带一点身体当参照，
 * 也比看不出买的是什么强。
 */
export function dressCrop(id: string) {
  const parsed = parseId(id)
  if (!parsed) return null
  const meta = METAS[parsed.sex]
  const box = meta?.items[parsed.key]
  if (!meta || !box) return null
  const [W, H] = meta.size ?? FALLBACK_CANVAS
  const side = Math.min(Math.max(box.w, box.h) * 1.2, W, H)
  const fit = (center: number, limit: number) =>
    Math.max(0, Math.min(center - side / 2, limit - side))
  return {
    x: fit(box.x + box.w / 2, W),
    y: fit(box.y + box.h / 2, H),
    w: side,
    h: side,
  }
}

/* ------------------------------------------------------------------ *
 * 商店条目
 * ------------------------------------------------------------------ */

const buildItems = (sex: AvatarSex): ShopItem[] =>
  DRESS_SLOTS.flatMap((slot) =>
    Array.from({ length: TIERS_PER_SLOT }, (_, i) => ({
      id: dressId(sex, slot, i),
      name: NAMES[sex][slot][i],
      slot,
      price: PRICE[i],
      minLevel: MIN_TIER[i],
      sex,
    })),
  )

/** 四个槽位 × 11 件 × 男女两套 */
export const DRESS_ITEMS: ShopItem[] = [...buildItems('f'), ...buildItems('m')]

/** 某个性别卖的那 44 件。没素材就一件都不卖 */
export const dressItemsFor = (sex: AvatarSex): ShopItem[] =>
  dressUpFor(sex) ? DRESS_ITEMS.filter((i) => i.sex === sex) : []

/** 开局白送的那几件（价格为 0），按性别 */
export const dressStartersFor = (sex: AvatarSex): string[] =>
  dressItemsFor(sex).filter((i) => i.price === 0).map((i) => i.id)

/** 开局默认穿戴：每个槽位第一件。新号和「选个角色」的预览用的是同一份 */
export const dressDefaultsFor = (sex: AvatarSex): Partial<Record<DressSlot, string>> =>
  dressUpFor(sex)
    ? Object.fromEntries(DRESS_SLOTS.map((s) => [s, dressId(sex, s, 0)]))
    : {}
