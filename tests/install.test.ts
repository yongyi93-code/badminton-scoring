import { describe, expect, it } from 'vitest'
import { HIDE_DAYS, stillHidden } from '@/lib/install'

/*
 * 「以后再说」以前是永久的。
 *
 * 那是个错，而且是个查了半天才查出来的错：beforeinstallprompt 那里
 * 我们把 Chrome 自己的安装横幅拦掉了，所以划掉一次之后两条路一起断 ——
 * 浏览器不问了，我们的卡也不出现了，只剩「我的」里那个入口。
 *
 * 有人跟我说「以前点进网站都会问要不要安装，现在没有了」。就是这个。
 *
 * 所以这几条钉的是同一件事：**它必须会自己回来。**
 */

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

describe('划掉之后安静多久', () => {
  it('没划过就显示', () => {
    expect(stillHidden(null, NOW)).toBe(false)
  })

  it('刚划掉，安静', () => {
    expect(stillHidden(String(NOW), NOW)).toBe(true)
  })

  it('29 天还安静', () => {
    expect(stillHidden(String(NOW - 29 * DAY), NOW)).toBe(true)
  })

  it(`${HIDE_DAYS} 天之后自己回来`, () => {
    expect(stillHidden(String(NOW - (HIDE_DAYS + 1) * DAY), NOW)).toBe(false)
  })

  /*
   * 老版本存的是个 '1'，没有时间戳 —— 没法知道他是什么时候划的。
   *
   * 当成过期，让卡回到他眼前一次。那批人正是被「永久」坑住的那批：
   * 他们以为自己只是关掉一张卡，实际是把安装这件事整个关掉了。
   */
  it('老版本那个 1 当成过期 —— 被坑住的正是那批人', () => {
    expect(stillHidden('1', NOW)).toBe(false)
  })

  it('存坏了的值也当成过期，不会把卡永久锁死', () => {
    expect(stillHidden('', NOW)).toBe(false)
    expect(stillHidden('什么鬼', NOW)).toBe(false)
    expect(stillHidden('-5', NOW)).toBe(false)
  })

  /* 手机上改过系统时间、或者时区跳了，都会出现「存的时间在未来」 */
  it('时间戳在未来也不会永远锁住', () => {
    expect(stillHidden(String(NOW + 10 * DAY), NOW)).toBe(true)
    expect(stillHidden(String(NOW + 10 * DAY), NOW + 41 * DAY)).toBe(false)
  })
})
