import { describe, expect, it } from 'vitest'
import { QR_BORDER, qrMatrix, qrPath } from '@/lib/qr'
import { QR_FIXTURES } from './fixtures/qr'

/* ------------------------------------------------------------------ *
 * 二维码
 *
 * 这一组和仓库里别的测试不一样：它钉的不是「界面上显不显示」，
 * 而是**一串格子算得对不对**，而那件事肉眼完全验不了 ——
 * Reed-Solomon 错一位，画出来还是一张横平竖直、有三个角、看着
 * 毫无破绽的二维码，只是全世界的扫码器都读不出来。
 *
 * 所以这里的「标准答案」是 tests/fixtures/qr.ts：那四张是这份代码
 * 自己画的，然后拿**两个互相独立的解码器**（zxing-cpp、OpenCV）
 * 各自读回来验过。
 *
 * -------------------------------------------------------------------
 * 写这一份的时候真撞到的三个 bug，都长这个样子
 *
 *   1. 三个「回」字外面那一圈分隔白边被画黑了 —— 结构错，还看得出来
 *   2. 格式信息位序反了（我按记忆写成低位在前）—— 完全看不出来
 *   3. 生成多项式的系数顺序反了 —— 数据、掩码、格式全对，只有纠错
 *      那一段是另一串数。**完全看不出来**，而且自洽
 *
 * 第 3 个是靠逐个码字和 segno 比对才揪出来的。这一组存在的意义就是
 * 别让第 4 个溜过去。
 * ------------------------------------------------------------------ */

describe('对着已知正确的答案', () => {
  for (const f of QR_FIXTURES) {
    const version = (f.rows.length - 17) / 4
    it(`v${version}：${f.text.slice(0, 38)}${f.text.length > 38 ? '…' : ''}`, () => {
      const got = qrMatrix(f.text).map((r) => r.map((c) => (c ? '1' : '0')).join(''))
      expect(got).toEqual(f.rows)
    })
  }
})

describe('结构上必须成立的几件事', () => {
  const m = qrMatrix('https://rallybadminton.com/?c=7E8ADB')
  const n = m.length

  it('边长是 4×版本+17', () => {
    expect((n - 17) % 4).toBe(0)
    expect(n).toBe(29) // 这条是 v3
  })

  /*
   * 三个角上那个「回」字是扫码器**第一眼找的东西**。
   * 它们不对，后面什么都无从谈起 —— 连试都不会试。
   */
  it('三个角上都有「回」字', () => {
    for (const [top, left] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const edge = y === 0 || y === 6 || x === 0 || x === 6
          const core = y >= 2 && y <= 4 && x >= 2 && x <= 4
          expect(m[top + y][left + x]).toBe(edge || core)
        }
      }
    }
  })

  /*
   * 「回」字外面那一圈必须是空的。
   *
   * 这一条是真撞过的：少了它，定位符和数据连成一片，扫码器认不出
   * 那三个角 —— 而画出来的图看着只是「黑了一点」。
   */
  it('「回」字外面那一圈是空的', () => {
    for (let i = 0; i < 8; i++) {
      expect(m[7][i]).toBe(false) // 左上，下边那条
      expect(m[i][7]).toBe(false) // 左上，右边那条
      expect(m[7][n - 1 - i]).toBe(false) // 右上
      expect(m[n - 8][i]).toBe(false) // 左下
    }
  })

  it('第 6 行和第 6 列是黑白相间的定位图案', () => {
    for (let i = 8; i < n - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0)
      expect(m[i][6]).toBe(i % 2 === 0)
    }
  })

  /* 规范钉死的那一格：左下角上方永远是黑的 */
  it('那个永远是黑的格子在', () => {
    expect(m[n - 8][8]).toBe(true)
  })

  /*
   * 黑白比例不能太偏。
   *
   * 这一条盯的其实是**掩码到底有没有起作用**：不上掩码的话，
   * 一条网址里那么多重复的字符会画出成片的白（或黑），
   * 而成片的同色正是扫码器最容易读错的地方。
   */
  it('黑格子不到一边倒', () => {
    const dark = m.flat().filter(Boolean).length
    const ratio = dark / (n * n)
    expect(ratio).toBeGreaterThan(0.35)
    expect(ratio).toBeLessThan(0.65)
  })
})

describe('画成 SVG 那一步', () => {
  it('一行里连着的黑格并成一个矩形', () => {
    /* 三个黑格连着 → 一条 h3，不是三条 h1 */
    const path = qrPath([[true, true, true]], 0)
    expect(path).toBe('M0 0h3v1h-3z')
  })

  it('断开的分成两条', () => {
    expect(qrPath([[true, false, true]], 0)).toBe('M0 0h1v1h-1zM2 0h1v1h-1z')
  })

  it('一个黑格都没有就是空的', () => {
    expect(qrPath([[false, false]], 0)).toBe('')
  })

  /*
   * 白边是规范要求的四格，不是留白好看 —— 没有它，扫码器分不清
   * 二维码从哪里开始，很多手机直接扫不出来。
   */
  it('往里挪了四格，给白边留出位置', () => {
    expect(QR_BORDER).toBe(4)
    expect(qrPath([[true]])).toBe('M4 4h1v1h-1z')
  })
})

describe('画不出来的时候宁可抛错', () => {
  /*
   * 悄悄降级是这里最糟的选择：画出一张扫不出来的二维码，
   * 比不画更糟 —— 没人会去验证它，而发现的时候是「那个码没用」，
   * 已经隔了很久。
   */
  it('非 ASCII 直接拒', () => {
    expect(() => qrMatrix('球局')).toThrow(/ASCII/)
  })

  it('太长了直接拒', () => {
    expect(() => qrMatrix('x'.repeat(300))).toThrow(/放不下/)
  })

  it('到版本 10 的容量为止都画得出来', () => {
    expect(() => qrMatrix('x'.repeat(213))).not.toThrow()
  })

  it('空字符串也画得出来（不该崩）', () => {
    expect(qrMatrix('').length).toBe(21)
  })
})
