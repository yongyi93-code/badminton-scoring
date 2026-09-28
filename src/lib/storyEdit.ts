/* ------------------------------------------------------------------ *
 * 拍完之后那一步：调个色、写句话
 *
 * 这个文件只管**算数**：滤镜是哪串 CSS、文字该落在哪一个像素上、
 * 字号多大。画布怎么画、界面长什么样都在别处。
 *
 * -------------------------------------------------------------------
 * 位置和字号都存成比例，不存像素
 *
 * 人是在手机屏上那个小预览框里拖的（比如 360×640），可导出来的是
 * 原图（比如 1080×1920）。存像素的话，预览里贴着右下角的那行字，
 * 导出来会飘到正中间 —— 而且换个手机，位置还不一样。
 *
 * 所以拖的时候存的是「横向 73%、纵向 86%」，导出时再乘回去。
 * 字号同理：存的是「字高占画面宽度的 6.5%」。这样预览和成图是
 * 同一套数，**看到什么就是什么**，这也是这个文件唯一真正要测的事。
 * ------------------------------------------------------------------ */

/** 一个滤镜。css 那串同时喂给预览的 style 和画布的 ctx.filter */
export type StoryFilter = {
  id: string
  zh: string
  en: string
  /** 空串 = 原图。CSS filter 语法，canvas 的 ctx.filter 认同一套 */
  css: string
}

/*
 * 八个，不再多。
 *
 * 滤镜这东西给到二十个，人就变成一路划到底再也选不出来 ——
 * 而且后面那些多半是前面的微调。这八个各走一个方向：
 * 亮、旧、冷、暖、黑白、高对比、褪色、球场绿。
 */
export const FILTERS: StoryFilter[] = [
  { id: 'none', zh: '原图', en: 'Original', css: '' },
  { id: 'bright', zh: '明亮', en: 'Bright', css: 'brightness(1.08) saturate(1.18) contrast(1.04)' },
  { id: 'film', zh: '胶片', en: 'Film', css: 'sepia(0.32) contrast(1.12) saturate(0.92) brightness(1.02)' },
  { id: 'cool', zh: '冷调', en: 'Cool', css: 'hue-rotate(-12deg) saturate(1.12) brightness(1.03)' },
  { id: 'warm', zh: '暖阳', en: 'Warm', css: 'sepia(0.2) saturate(1.24) hue-rotate(-8deg) brightness(1.05)' },
  { id: 'mono', zh: '黑白', en: 'Mono', css: 'grayscale(1) contrast(1.12)' },
  { id: 'punch', zh: '浓烈', en: 'Punch', css: 'contrast(1.34) saturate(1.22)' },
  { id: 'faded', zh: '褪色', en: 'Faded', css: 'saturate(0.72) brightness(1.08) contrast(0.92)' },
  /* 这一个是给这个 App 的：把球场那片绿压出来 */
  { id: 'court', zh: '球场', en: 'Court', css: 'saturate(1.3) hue-rotate(10deg) contrast(1.06)' },
]

/** 找不着就当原图 —— 存过的滤镜 id 以后可能被删掉，那时候别整张图不出来 */
export function filterCss(id: string): string {
  return FILTERS.find((f) => f.id === id)?.css ?? ''
}

/** 写在图上的一行字 */
export type TextLayer = {
  text: string
  /** 横向位置，0 到 1（字的中心） */
  x: number
  /** 纵向位置，0 到 1（字的中心） */
  y: number
  /** 字高占画面宽度的比例 —— 见开头那段为什么不存像素 */
  size: number
  color: string
}

/* 白和黑打底，其余是这套配色里认得出的几个。深浅背景都得有得挑 */
export const TEXT_COLORS = [
  '#ffffff',
  '#101010',
  '#ddfb6d',
  '#5fdca6',
  '#6fc0ea',
  '#f4909a',
  '#eab861',
]

/** 三档字号，存的都是「占画面宽度的几成」 */
export const TEXT_SIZES = { sm: 0.045, md: 0.068, lg: 0.1 } as const
export type TextSize = keyof typeof TEXT_SIZES

export const newTextLayer = (text = ''): TextLayer => ({
  text,
  x: 0.5,
  y: 0.78,
  size: TEXT_SIZES.md,
  color: '#ffffff',
})

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * 拖到的那个点 → 存下来的比例。
 *
 * 夹在 0 和 1 之间：手指甩出框外也不该把字扔到画面外面，
 * 那就再也拖不回来了。
 */
export function toFraction(px: number, box: number): number {
  if (box <= 0) return 0.5
  return clamp01(px / box)
}

/**
 * 比例 → 这个尺寸下的实际像素。
 *
 * 预览和导出都走这一个函数，所以两边不可能算出不一样的位置 ——
 * 两处各写一遍才是这种功能最常见的错法。
 */
export function layout(
  layer: TextLayer,
  w: number,
  h: number,
): { x: number; y: number; fontPx: number } {
  return {
    x: clamp01(layer.x) * w,
    y: clamp01(layer.y) * h,
    fontPx: Math.max(1, Math.round(layer.size * w)),
  }
}

/** 这一行字要不要画。空的和只有空格的都不画 */
export const hasText = (layer: TextLayer | null): layer is TextLayer =>
  !!layer && layer.text.trim().length > 0

/**
 * 有没有动过。
 *
 * 一处都没改就别再走一遍画布：重新编码一张 JPEG 只会让照片更糊、
 * 文件更大，而人什么都没要求。
 */
export function edited(filterId: string, layer: TextLayer | null): boolean {
  return filterId !== 'none' || hasText(layer)
}
