import { pick } from './i18n'
import type { AvatarSex, LevelInfo } from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * 角色立绘
 *
 * 角色形象有两套画法，同一个人身上只会用其中一套：
 *
 * 1. 立绘图片（这个文件）—— 放进 src/assets/avatars/ 就自动生效，
 *    按段位换形象，5 个成长阶段，男女各一套。
 * 2. SVG 手绘（components/Avatar.tsx）—— 图片没放的时候顶上，
 *    App 一件图片资源都没有也能跑，离线可用是底线。
 *
 * 所以这里查不到图不算错误，是设计好的退路。
 * ------------------------------------------------------------------ */

export type Stage = {
  id: string
  /** 中文阶段名 */
  label: string
  /** 英文阶段名，中文界面里跟在中文后面显示 */
  en: string
  /** 设计稿上的等级数字，只是个说法，实际按段位算 */
  lv: number
  /**
   * 进入这个阶段所需的最低段位下标（对应 PET_LEVELS）。
   * 8 个段位摊到 5 个阶段：先锋 / 卫士·中军 / 统帅·传奇 / 万古·超凡 / 冠绝。
   */
  minTier: number
  /** 这一阶段的光晕颜色，衬在立绘后面 */
  glow: string
}

export const STAGES: Stage[] = [
  { id: 'rookie', label: '新手', en: 'Rookie', lv: 1, minTier: 0, glow: '#5b7fa8' },
  { id: 'player', label: '进阶', en: 'Player', lv: 10, minTier: 1, glow: '#2f6feb' },
  { id: 'elite', label: '精英', en: 'Elite', lv: 30, minTier: 3, glow: '#6f5bd8' },
  { id: 'pro', label: '高手', en: 'Pro', lv: 50, minTier: 5, glow: '#a855f7' },
  { id: 'legend', label: '传奇', en: 'Legend', lv: 100, minTier: 7, glow: '#f2c14e' },
]

/**
 * 阶段名。中文界面写「进阶 Player」，英文界面只写 Player。
 *
 * 不在 STAGES 表里就 pick() 定死 —— 那张表是模块级常量，
 * 求值早于 initLang()，当场挑会把语言冻在默认值上。
 */
export const stageName = (stage: Stage) =>
  pick(`${stage.label} ${stage.en}`, stage.en)

/** 段位 → 成长阶段。取最后一个够得着的。 */
export function stageOf(level: LevelInfo): Stage {
  let out = STAGES[0]
  for (const s of STAGES) if (level.index >= s.minTier) out = s
  return out
}

/** 下一个阶段，已经是传奇则为 null —— 用来在角色页写「还差多少升下一形象」 */
export function nextStage(level: LevelInfo): Stage | null {
  const i = STAGES.indexOf(stageOf(level))
  return STAGES[i + 1] ?? null
}

/**
 * 立绘文件表。
 *
 * 文件名必须是 `<性别>-<阶段 id>.<后缀>`，例如 m-rookie.png、f-legend.webp。
 * 只放了几张也没关系 —— 查不到的那几个阶段自动退回 SVG 手绘。
 *
 * eager 是有意的：一共十张图，构建时就解析成带 hash 的 URL，
 * 运行时不用再等一次动态 import，切换形象不会闪一下。
 */
const FILES = import.meta.glob('../assets/avatars/*.{png,webp,jpg,jpeg}', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const BY_KEY = new Map(
  Object.entries(FILES).map(([path, url]) => [
    path.replace(/^.*\/([^/]+)\.[^.]+$/, '$1'),
    url,
  ]),
)

/** 这一格有没有立绘图片；没有就返回 undefined，交给 SVG */
export const artUrl = (sex: AvatarSex, stage: Stage): string | undefined =>
  BY_KEY.get(`${sex}-${stage.id}`)

/** 有没有放过任何一张立绘 —— 界面上决定要不要提这回事 */
export const hasArt = BY_KEY.size > 0

/**
 * 头像圆圈里的裁切：立绘是全身的，直接缩到小圆圈里人只有几像素高。
 * 放大 scale 倍、把 origin 挪到头的位置，圆圈里就只剩头和肩膀。
 * 这两个数是按「人物站在画面正中、头顶留一点空」估的，
 * 换了构图不对的话调这里一处就够。
 */
export const HEAD_CROP = { scale: 3.1, originY: 12 }

/**
 * 立绘图片管着的槽位。
 *
 * 图片是一整张画好的人，没法把发型或战服单独换掉 —— 这几个槽位在
 * 有立绘的时候不能再摆出来让人买，不然就是卖了东西却看不到变化。
 * 背景不在里面：那是衬在人后面另画的一层，跟立绘不冲突。
 */
export const ART_OWNED_SLOTS = ['hair', 'outfit', 'weapon'] as const

/** 这个槽位现在还能不能自己搭配 */
export const slotIsDressable = (slot: string) =>
  !hasArt || !(ART_OWNED_SLOTS as readonly string[]).includes(slot)
