import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/* ------------------------------------------------------------------ *
 * 别在 input 上改宽度
 *
 * inputClass 里已经带了 w-full。再往同一个 input 上加一条 w-16，
 * 就是两条同权重的 width 规则打架 —— 谁赢由样式表里的先后决定，
 * 不是由 class 属性里的先后决定，而 w-full 排在后面。
 *
 * 这条规矩是踩出来的：报名那一屏的种子框这么写，结果它撑成整行
 * 350px 盖在名字框上，名字框被挤成 30px。人点下去其实点中的是种子框，
 * 敲进去的字被「只留数字」那个过滤全吃掉 —— 屏幕上就是
 * 「名字填下去没显示」，而代码看起来完全合理。
 *
 * 更麻烦的是它**测不出来**：Playwright 的 fill() 直接写 DOM，不做
 * 命中判定，所以自动跑一遍全是绿的，只有真拿手点才会发现。
 *
 * 所以在源码这一层拦：要改宽度，把宽度写在外面包一层 div 上。
 * ------------------------------------------------------------------ */

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : []
  })

describe('inputClass 不该被加宽度', () => {
  it('没有哪个 input 在 inputClass 之外又写了 w-*', () => {
    const offenders: string[] = []
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        if (!line.includes('inputClass')) continue
        /* w-full 本身没问题（就是它自己）；别的 w-… 才是打架 */
        const width = line.match(/\bw-(?!full\b)[\w[\]./-]+/)
        if (width) offenders.push(`${file}:${i + 1} ${width[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
