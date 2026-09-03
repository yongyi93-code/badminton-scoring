import { describe, expect, it } from 'vitest'
import { looksLikeAuthCallback } from '@/lib/supabase'

/*
 * 这一组守的是一个已经出过事的 bug。
 *
 * detectSessionInUrl 让 supabase 启动时去 URL 里捡登录令牌。「忘记密码」
 * 的邮件链接需要它 —— 令牌就在地址里。但常开会把「检查更新」加的 ?_v=
 * 当成一次没认出来的登录回调，顺手把存着的会话清掉：表现是点完更新
 * 发现自己被登出了。当时排查了很久。
 *
 * 所以这个判断必须两头都准：邮件回来的一定认出来，自家加的参数一个
 * 都不能误认。
 */
describe('这次打开是不是从登录邮件回来的', () => {
  const APP = 'https://yongyi93-code.github.io/badminton-scoring/'

  describe('必须认出来的（认不出，人就设不了新密码）', () => {
    it('隐式流：hash 里带 access_token', () => {
      expect(
        looksLikeAuthCallback(`${APP}#access_token=abc123&refresh_token=def&type=recovery`),
      ).toBe(true)
    })

    it('只有 type=recovery 也算', () => {
      expect(looksLikeAuthCallback(`${APP}#type=recovery`)).toBe(true)
    })

    it('PKCE 流：query 里带 code', () => {
      expect(looksLikeAuthCallback(`${APP}?code=9f2a-uuid-like`)).toBe(true)
    })

    /* 链接过期也要让 supabase 接住，否则界面什么都不说 */
    it('链接过期的错误回调也算', () => {
      expect(
        looksLikeAuthCallback(`${APP}#error=access_denied&error_code=otp_expired`),
      ).toBe(true)
    })
  })

  describe('绝不能误认的（误认一次就是把人登出）', () => {
    it('「检查更新」加的 ?_v= —— 正是当初出事的那个', () => {
      expect(looksLikeAuthCallback(`${APP}?_v=1764038400000`)).toBe(false)
    })

    it('干干净净的地址', () => {
      expect(looksLikeAuthCallback(APP)).toBe(false)
    })

    it('本地开发地址', () => {
      expect(looksLikeAuthCallback('http://localhost:5173/')).toBe(false)
    })

    /* 名字里碰巧带 code 的参数不算 —— 得是 code 本身 */
    it('叫 courtcode 的参数不算', () => {
      expect(looksLikeAuthCallback(`${APP}?courtcode=3`)).toBe(false)
    })

    it('无意义的 hash 不算', () => {
      expect(looksLikeAuthCallback(`${APP}#top`)).toBe(false)
    })

    it('乱七八糟的字符串不会抛异常', () => {
      expect(looksLikeAuthCallback('这不是个地址')).toBe(false)
    })
  })
})
