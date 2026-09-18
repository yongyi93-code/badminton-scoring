import { describe, expect, it } from 'vitest'
import { NAME_MAX, checkName, nameOf, tidyName } from '@/lib/profile'
import { setLang } from '@/lib/i18n'

/*
 * 名片里纯逻辑的那几块。
 *
 * 真正把门的（谁看得到谁的名字和照片）在 supabase/022 的策略上 ——
 * 那些在本机跑真 Postgres 撞过，不在这儿。
 *
 * 这个文件钉的是三件会静悄悄出错的事：
 *   · 名字的三个来源排错顺序（球群里那个必须排最前）
 *   · 空白当成了名字（列表上是一行空白，看着像坏了）
 *   · 截断切在一个 emoji 中间（服务端收到半个字符）
 */

setLang('zh')

describe('显示哪个名字', () => {
  /*
   * 这一条是整个文件里最要紧的。
   *
   * 同一个球群里，记分的人管他叫什么就是什么 —— 那个名字和比赛记录
   * 对得上。他自己填的那个排后面，不然一个人在设置里改个名，
   * 全群的比赛记录就对不上人了。
   */
  it('球群里那个名字排最前', () => {
    expect(nameOf({ club: '阿伟', card: 'Ah Wei', hint: '榜上那个' })).toBe('阿伟')
  })

  it('不同群的人，用他自己填的', () => {
    expect(nameOf({ club: null, card: 'Ah Wei', hint: '榜上那个' })).toBe('Ah Wei')
  })

  /* 全国榜上那一行的名字。陌生人的名片读不到，只剩这个 */
  it('名片也读不到时，用调用方带过来的', () => {
    expect(nameOf({ hint: '榜上那个' })).toBe('榜上那个')
  })

  it('三个都没有就是 null —— 由界面决定说什么', () => {
    expect(nameOf({})).toBeNull()
    expect(nameOf({ club: null, card: null, hint: null })).toBeNull()
  })

  /*
   * 空字符串和一串空格都不算「有名字」。
   *
   * 不这么判的话，一个 display_name 是 '' 的人会挡住后面两个来源，
   * 结果列表上是一行空白 —— 比写「不认识的人」还糟，因为看着像坏了。
   */
  it('空白不算有名字，接着往下找', () => {
    expect(nameOf({ club: '', card: 'Ah Wei' })).toBe('Ah Wei')
    expect(nameOf({ club: '   ', card: '', hint: '榜上那个' })).toBe('榜上那个')
  })
})

describe('把名字收拾干净', () => {
  it('两头的空白去掉', () => {
    expect(tidyName('  阿伟  ')).toBe('阿伟')
  })

  /* 好友那一行靠 truncate 截断，前面几个空格会把名字推出可视区 */
  it('中间连着的空白并成一个', () => {
    expect(tidyName('Ah    Wei')).toBe('Ah Wei')
    expect(tidyName('Ah\t\nWei')).toBe('Ah Wei')
  })

  it('超长的截到上限', () => {
    expect(tidyName('あ'.repeat(40))).toHaveLength(NAME_MAX)
  })

  /*
   * 一个 emoji 在 JS 里占两格。用 slice 截断正好切在中间的话，
   * 留下半个字符 —— 传到服务端变成一个「�」。
   */
  it('截断不会把一个 emoji 劈成两半', () => {
    const out = tidyName('🏸'.repeat(40))
    expect([...out]).toHaveLength(NAME_MAX)
    /*
     * 找的是**落单**的代理项，不是所有代理项 —— 一个完整的 emoji
     * 本来就是一对代理项组成的。落单才说明切在了中间。
     */
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    expect(lone.test(out)).toBe(false)
    /* 每一个都还是完整的羽毛球 */
    expect(out).toBe('🏸'.repeat(NAME_MAX))
  })

  it('本来就短的原样留着', () => {
    expect(tidyName('阿伟')).toBe('阿伟')
  })
})

describe('能不能存', () => {
  it('正常名字放行', () => {
    expect(checkName('阿伟')).toBeNull()
    expect(checkName('Ah Wei')).toBeNull()
  })

  /* 判的是收拾之后的：一串空格收拾完是空的，那不是名字 */
  it('空的和全是空格的拦住', () => {
    expect(checkName('')).not.toBeNull()
    expect(checkName('   ')).not.toBeNull()
    expect(checkName('\t\n')).not.toBeNull()
  })

  /*
   * 太长的**不拦**，截短了存 —— 拦住的话，一个从别处粘了一长串进来的人
   * 只会看到「不行」，而他并不知道该删到多短。
   */
  it('太长的不算错，截短了存', () => {
    expect(checkName('あ'.repeat(40))).toBeNull()
  })
})

describe('上限要和数据库那条 check 对得上', () => {
  /*
   * 023-display-name.sql 里写死的是 24。这边比它松的话，写下去会被
   * 服务端拒掉，而那个错发生在按下保存之后 —— 比在这儿截住难看。
   */
  it('上限是 24', () => {
    expect(NAME_MAX).toBe(24)
  })
})
