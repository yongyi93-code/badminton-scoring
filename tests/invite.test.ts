import { describe, expect, it } from 'vitest'
import { inviteUrl, readInvite, shareText, stripInvite } from '@/lib/invite'

/* ------------------------------------------------------------------ *
 * 分享链接
 *
 * 这一组盯的是「链接进得来、参数读得对」。真正会出错的地方是
 * 拼和读不对称 —— 拼的时候写 j，读的时候找 s，那种错在本机测不出来，
 * 要等有人在群里发了链接、球友点进来落到首页才发现。
 * ------------------------------------------------------------------ */

const BASE = 'https://rallybadminton.com/'

describe('分享链接', () => {
  it('拼出来的能原样读回去', () => {
    const url = inviteUrl({ sessionId: 's-123', clubCode: '7E8ADB' }, BASE)
    expect(readInvite(url)).toEqual({ sessionId: 's-123', clubCode: '7E8ADB' })
  })

  it('邀请码一律转大写 —— 手打进来的大小写不该算两个码', () => {
    const url = inviteUrl({ sessionId: 's-1', clubCode: '7e8adb' }, BASE)
    expect(url).toContain('7E8ADB')
    expect(readInvite('https://x.test/?j=s-1&c=7e8adb')?.clubCode).toBe('7E8ADB')
  })

  it('没有邀请码也拼得出来（只是进不了别人的群）', () => {
    const url = inviteUrl({ sessionId: 's-1' }, BASE)
    expect(readInvite(url)).toEqual({ sessionId: 's-1' })
  })

  it('不是邀请链接就说不是，别瞎猜', () => {
    expect(readInvite('https://rallybadminton.com/')).toBeNull()
    expect(readInvite('https://rallybadminton.com/?c=7E8ADB')).toBeNull() // 只有群码不算球局邀请
    expect(readInvite('这不是网址')).toBeNull()
    expect(readInvite('https://x.test/?j=%20%20')).toBeNull() // 空白的球局 id
  })

  it('原来网址上的其他参数不能被弄丢', () => {
    /*
     * 抹掉邀请参数是为了刷新时不再触发一次。但地址栏上可能还有别的
     * 东西 —— 比如「检查更新」留下的 ?_v=，抹掉它会让那次更新检测失效。
     */
    const cleaned = stripInvite('https://x.test/?_v=123&j=s-1&c=ABC')
    expect(cleaned).toContain('_v=123')
    expect(cleaned).not.toContain('j=')
    expect(cleaned).not.toContain('c=')
  })

  it('分享的那段话里，链接自己占一行', () => {
    /*
     * WhatsApp 只把链接那一段变成可点的。夹在句子中间的话，
     * 后面的标点很容易被算进链接里，点开就是 404。
     */
    const msg = shareText(
      { venue: 'Twin Ark', when: '今晚 8 点', host: '阿伟', url: 'https://x.test/?j=1' },
      true,
    )
    const lines = msg.split('\n')
    expect(lines[lines.length - 1]).toBe('https://x.test/?j=1')
    expect(msg).toContain('阿伟')
    expect(msg).toContain('Twin Ark')
  })
})
