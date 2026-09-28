import { describe, expect, it } from 'vitest'
import {
  FILTERS,
  TEXT_SIZES,
  clamp01,
  edited,
  filterCss,
  hasText,
  layout,
  newTextLayer,
  toFraction,
} from '@/lib/storyEdit'

/* ------------------------------------------------------------------ *
 * 拍完之后那一步
 *
 * 这一块真正会错的地方只有一个：**预览里看到的和发出去的不一样**。
 * 人在 360 宽的框里把字拖到右下角，导出的是 1080 宽的原图 ——
 * 中间只要有一处按像素算，字就飘走了，而且换台手机飘的还不一样。
 *
 * 所以下面大半在钉同一件事：同一个比例，不管画面多大，落点都对。
 * ------------------------------------------------------------------ */

describe('滤镜', () => {
  it('原图那一档不加任何 CSS', () => {
    expect(filterCss('none')).toBe('')
  })

  it('每个滤镜都有中英文和一串 CSS', () => {
    for (const f of FILTERS) {
      expect(f.zh.length).toBeGreaterThan(0)
      expect(f.en.length).toBeGreaterThan(0)
      if (f.id !== 'none') expect(f.css).toMatch(/\w+\(/)
    }
  })

  it('id 不重复 —— 重了的话选中状态会同时亮两个', () => {
    const ids = FILTERS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('不认识的 id 当原图，不是整张图不出来', () => {
    /* 存过的滤镜以后可能被删掉，那时候老帖子还得画得出来 */
    expect(filterCss('这个滤镜不存在了')).toBe('')
  })
})

describe('位置存成比例', () => {
  it('拖到正中间就是 0.5', () => {
    expect(toFraction(180, 360)).toBe(0.5)
  })

  it('甩出框外也夹回来 —— 不然字就再也拖不回来了', () => {
    expect(toFraction(-50, 360)).toBe(0)
    expect(toFraction(900, 360)).toBe(1)
  })

  it('框宽是 0 时不炸（刚挂上还没量到）', () => {
    expect(toFraction(10, 0)).toBe(0.5)
  })

  it('clamp01 只管夹，中间的原样放过', () => {
    expect(clamp01(0.37)).toBe(0.37)
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
  })
})

describe('预览和成图落在同一处', () => {
  const layer = { ...newTextLayer('好球'), x: 0.73, y: 0.86 }

  it('同一个比例，画面大一倍，位置也大一倍', () => {
    const small = layout(layer, 360, 640)
    const big = layout(layer, 1080, 1920)
    expect(big.x / small.x).toBeCloseTo(3, 6)
    expect(big.y / small.y).toBeCloseTo(3, 6)
  })

  it('字号跟着画面宽度走，跟高度无关', () => {
    /*
     * 跟宽度走而不是高度：横图竖图混着发，按高度算的话
     * 同一个「中号」在横图上会小一大截。
     */
    const a = layout(layer, 1000, 500)
    const b = layout(layer, 1000, 2000)
    expect(a.fontPx).toBe(b.fontPx)
    const wide = layout(layer, 2000, 500)
    expect(wide.fontPx).toBe(a.fontPx * 2)
  })

  it('中号字在 1080 宽的图上是 73 像素左右', () => {
    const l = { ...newTextLayer('x'), size: TEXT_SIZES.md }
    expect(layout(l, 1080, 1920).fontPx).toBe(Math.round(0.068 * 1080))
  })

  it('字号再小也不会算成 0', () => {
    const tiny = { ...newTextLayer('x'), size: 0.0001 }
    expect(layout(tiny, 100, 100).fontPx).toBeGreaterThanOrEqual(1)
  })

  it('存坏了的比例也夹回画面里', () => {
    const off = { ...newTextLayer('x'), x: 4, y: -2 }
    const p = layout(off, 500, 800)
    expect(p.x).toBe(500)
    expect(p.y).toBe(0)
  })
})

describe('要不要画这行字', () => {
  it('空的、只有空格的都不画', () => {
    expect(hasText(null)).toBe(false)
    expect(hasText(newTextLayer(''))).toBe(false)
    expect(hasText(newTextLayer('   '))).toBe(false)
  })

  it('有字就画', () => {
    expect(hasText(newTextLayer('好球'))).toBe(true)
  })
})

describe('有没有动过', () => {
  /*
   * 什么都没改就别再过一遍画布：重新编码只会让照片更糊、文件更大，
   * 而人什么都没要求。
   */
  it('没选滤镜也没写字 = 没动过', () => {
    expect(edited('none', null)).toBe(false)
    expect(edited('none', newTextLayer(''))).toBe(false)
  })

  it('选了滤镜就算动过', () => {
    expect(edited('mono', null)).toBe(true)
  })

  it('写了字就算动过', () => {
    expect(edited('none', newTextLayer('好球'))).toBe(true)
  })
})
