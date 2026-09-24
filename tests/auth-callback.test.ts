import { describe, expect, it } from 'vitest'
import { looksLikeAuthCallback, looksLikeRecovery } from '@/lib/supabase'

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

/* ------------------------------------------------------------------ *
 * 是「重设密码」那一种，还是「验证邮箱」那一种
 *
 * 这一组守的是 2026-09-24 线上撞的那个：接了真的发信服务、开了邮箱
 * 验证之后，**新用户点完验证链接跳回来，看到的是「设一个新密码」**。
 * 他刚注册完，根本没有旧密码可重设。
 *
 * 原因是那一句认的是 looksLikeAuthCallback —— 「任何从邮件回来的
 * 链接」。以前只有忘记密码一种，两者恰好等价，所以一直没露馅。
 *
 * 两头都要准：
 *   认宽了  新用户被拦在一个他答不上来的问题前面（就是那个 bug）
 *   认窄了  真忘了密码的人跳回来却没得设，而他手上没有可用的密码
 * ------------------------------------------------------------------ */
describe('这次回调是不是重设密码', () => {
  const APP = 'https://rallybadminton.com/'

  describe('是的（认不出来，忘了密码的人就设不了新的）', () => {
    it('隐式流：hash 里 type=recovery', () => {
      expect(
        looksLikeRecovery(`${APP}#access_token=abc&refresh_token=def&type=recovery`),
      ).toBe(true)
    })

    it('type=recovery 在最前面也算', () => {
      expect(looksLikeRecovery(`${APP}#type=recovery&access_token=abc`)).toBe(true)
    })

    it('只有 type=recovery 也算', () => {
      expect(looksLikeRecovery(`${APP}#type=recovery`)).toBe(true)
    })

    /* 有的版本放在 query 里，不在 hash 里 */
    it('query 里 type=recovery 也算', () => {
      expect(looksLikeRecovery(`${APP}?type=recovery`)).toBe(true)
    })
  })

  describe('不是（认成是的话，新用户会被问一个他答不上来的问题）', () => {
    /* 这一条就是那个 bug 本身 */
    it('注册验证：type=signup', () => {
      expect(
        looksLikeRecovery(`${APP}#access_token=abc&refresh_token=def&type=signup`),
      ).toBe(false)
    })

    it('换邮箱：type=email_change', () => {
      expect(looksLikeRecovery(`${APP}#type=email_change`)).toBe(false)
    })

    it('魔法链接：type=magiclink', () => {
      expect(looksLikeRecovery(`${APP}#type=magiclink`)).toBe(false)
    })

    /*
     * PKCE 那条路两种长得一模一样，从 URL 上分辨不了。
     * 所以这里返回假 —— 由 PASSWORD_RECOVERY 事件兜底，
     * 代价是重设密码那一屏晚几十毫秒出现。
     */
    it('PKCE 的 ?code= 分辨不了，当成不是', () => {
      expect(looksLikeRecovery(`${APP}?code=9f2a-uuid-like`)).toBe(false)
    })

    it('平时打开', () => {
      expect(looksLikeRecovery(APP)).toBe(false)
      expect(looksLikeRecovery(`${APP}?_v=abc123`)).toBe(false)
    })

    /*
     * 别被「像」的东西骗了：这两个都不是 type 这个参数本身。
     * 认宽了的代价是新用户撞上那个 bug。
     */
    it('别的参数里带着 recovery 字样不算', () => {
      expect(looksLikeRecovery(`${APP}#error_description=type=recovery`)).toBe(false)
      expect(looksLikeRecovery(`${APP}#type=recovery_x`)).toBe(false)
    })

    it('乱七八糟的地址不炸', () => {
      expect(looksLikeRecovery('不是网址')).toBe(false)
    })
  })
})
