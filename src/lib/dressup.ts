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
 *
 * 每件装备存两个文件：
 *   xxx.webp       图层本身（带透明）
 *   xxx.mask.webp  区域掩膜
 *
 * 为什么要掩膜：合成不是简单叠加，而是「先按掩膜擦掉那块，再画上新的」。
 * 少了这一步，短袖换成无袖时底图的旧袖子会从新衣服边上露出来 ——
 * 图层的 alpha 分不出「区域内但透明（该擦）」和「区域外（该留）」。
 * ------------------------------------------------------------------ */

/** 分层换装的四个槽位，和画在人身上的顺序一致（先画的在下面） */
export const DRESS_SLOTS = ['bottom', 'top', 'shoes', 'racket'] as const
export type DressSlot = (typeof DRESS_SLOTS)[number]

export const DRESS_SLOT_LABELS: Record<DressSlot, string> = {
  bottom: '下装',
  top: '上衣',
  shoes: '球鞋',
  racket: '球拍',
}

/** 每个槽位有几件 */
export const TIERS_PER_SLOT = 11

/**
 * 价格与段位门槛，从低到高。
 * 第一件白送（新号一进来就有得穿），之后越来越贵；
 * 段位门槛摊到八段上，每升一段都能解锁点新东西。
 */
const PRICE = [0, 40, 90, 160, 260, 400, 570, 780, 1030, 1330, 1700]
const MIN_TIER = [0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 7]

/** 每件的名字，下标即等级（0 起）。顺序就是素材文件的编号顺序。 */
const NAMES: Record<DressSlot, string[]> = {
  top: [
    '白紫背心', '粉白训练衫', '浅粉运动T', '速干透气衣', '白紫轻量背心',
    '樱花暗纹袍', '冰蓝运动衫', '紫晶护肩衣', '紫月能量外套',
    '金白冠军战衣', '粉蓝传奇战衣',
  ],
  bottom: [
    '灰白运动裙', '黑运动短裙', '粉白运动裙', '速干五分裤', '白紫训练裤',
    '樱花纹战裙', '电光粉紧身裤', '冰晶护膝裙', '紫月能量裤',
    '金白冠军裙', '粉蓝传奇战裙',
  ],
  shoes: [
    '入门球鞋', '白粉训练鞋', '粉白练习鞋', '轻量速跑鞋', '紫白稳定鞋',
    '樱花纹战靴', '电光粉弹跳鞋', '冰晶护踝鞋', '紫晶护踝鞋',
    '金白冠军鞋', '粉蓝传奇战靴',
  ],
  racket: [
    '入门球拍', '基础训练拍', '粉白练习拍', '轻量速拍', '紫白进攻拍',
    '樱花纹球拍', '电光粉球拍', '冰晶球拍', '紫月能量拍',
    '金白冠军拍', '粉蓝传奇拍',
  ],
}

/** 素材 id，例如 top-03。编号从 01 起，和文件名一一对应。 */
export const dressId = (slot: DressSlot, tier: number) =>
  `${slot}-${String(tier + 1).padStart(2, '0')}`

/** 商店条目：四个槽位 × 11 件 */
export const DRESS_ITEMS: ShopItem[] = DRESS_SLOTS.flatMap((slot) =>
  Array.from({ length: TIERS_PER_SLOT }, (_, i) => ({
    id: dressId(slot, i),
    name: NAMES[slot][i],
    slot,
    price: PRICE[i],
    minLevel: MIN_TIER[i],
  })),
)

/* ------------------------------------------------------------------ *
 * 素材
 * ------------------------------------------------------------------ */

type Box = { x: number; y: number; w: number; h: number }
type Meta = { size: [number, number]; items: Record<string, Box> }

/**
 * eager 是有意的：一共九十来个小文件，构建时就解析成带 hash 的 URL，
 * 换装时不用等动态 import，点一下立刻就换过去。
 */
const FILES = import.meta.glob('../assets/dressup/*.webp', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const urlOf = (key: string) =>
  Object.entries(FILES).find(([p]) => p.endsWith(`/${key}.webp`))?.[1]

/**
 * meta 也用 glob 取：素材整个删掉时 glob 返回空对象，
 * 而静态 import 会直接让构建失败。整套换装能被删干净是有意保留的退路。
 */
const META_FILES = import.meta.glob('../assets/dressup/meta.json', {
  eager: true,
  import: 'default',
}) as Record<string, Meta>

const meta: Meta | null = Object.values(META_FILES)[0] ?? null

/** 有没有这套分层素材。没有就退回按段位换整套立绘的老路。 */
export const hasDressUp = meta !== null && !!urlOf('base')

/** 画布尺寸，所有图层都按这个坐标系定位 */
export const DRESS_CANVAS: [number, number] = meta?.size ?? [864, 1152]

export const baseUrl = () => urlOf('base')

/** 某件装备的图层、掩膜和它在画布上的位置；素材缺失返回 null */
export function dressLayer(id: string) {
  const box = meta?.items[id]
  const art = urlOf(id)
  const mask = urlOf(`${id}.mask`)
  if (!box || !art || !mask) return null
  return { box, art, mask }
}

/** 开局白送的那几件（价格为 0） */
export const DRESS_STARTERS = DRESS_ITEMS.filter((i) => i.price === 0).map((i) => i.id)

/** 开局默认穿戴：每个槽位第一件。新号和「选个角色」的预览用的是同一份 */
export const DRESS_DEFAULTS = Object.fromEntries(
  DRESS_SLOTS.map((s) => [s, dressId(s, 0)]),
) as Record<DressSlot, string>

/**
 * 商店和衣柜小图的取景框：框住这一件，四周留一点余量。
 *
 * 裁成正方形是有意的 —— 一条长裙的原始区域又窄又高，
 * 按原比例塞进方格里只剩一条细线。宁可多带一点身体当参照，
 * 也比看不出买的是什么强。
 */
export function dressCrop(id: string) {
  const box = meta?.items[id]
  if (!box) return null
  const [W, H] = DRESS_CANVAS
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

/**
 * 这套素材目前只有女生版。
 * 男号继续走按段位换整套立绘的老路 —— 与其给男生套一身女装，
 * 不如等他那套素材出来再开。
 */
export const dressUpFor = (sex: AvatarSex) => hasDressUp && sex === 'f'
