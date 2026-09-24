import { describe, expect, it } from 'vitest'
import { readableError, signUpOutcome } from '@/lib/authText'

/* ------------------------------------------------------------------ *
 * 注册登录这一屏上说的话
 *
 * 这一块不是逻辑复杂，是**说错话的代价大**：它是陌生人见到这个 App
 * 的第一屏，说错一句人就走了，而且不会告诉你为什么。
 *
 * 两件事钉在这儿：
 *   一、界面上不许出现只有开发者才懂的东西
 *   二、「去邮箱点一下链接」不是失败
 * ------------------------------------------------------------------ */

describe('不许把开发者的话说给用户听', () => {
  /*
   * 原来有两处写着「去 Supabase 后台把 Confirm email 关掉」。
   * 那是写给我自己的备忘 —— 而它出现在一个刚装上 App 的人眼前：
   * 他既进不去那个后台，也不该知道这个 App 是拿什么搭的。
   *
   * 这一条查的是**所有**出口，不是那两处 —— 以后再加一句也跑不掉。
   */
  const 忌讳 = ['supabase', 'confirm email', 'rls', 'policy', 'auth.uid', 'postgres', 'jwt']

  const 全部出口 = [
    'Invalid login credentials',
    'User already registered',
    'Password should be at least 6 characters',
    'Unable to validate email address',
    'Email not confirmed',
    'Rate limit exceeded',
    'Failed to fetch',
    /* 认不出来的原样返回，那一条没法管，但至少这几条常见的要管住 */
  ]

  for (const raw of 全部出口) {
    it(`「${raw}」翻出来不带黑话`, () => {
      const out = readableError(raw).toLowerCase()
      for (const 词 of 忌讳) expect(out).not.toContain(词)
    })
  }

  it('每一条都真的翻译过了，不是原样吐回去', () => {
    for (const raw of 全部出口) {
      expect(readableError(raw)).not.toBe(raw)
    }
  })

  /* 没验证邮箱那句要告诉人**他能做的事**，而不是这个系统的内部状态 */
  it('没验证邮箱那句要提到收件箱和垃圾邮件', () => {
    const zh = readableError('Email not confirmed')
    expect(zh).toContain('收件箱')
    expect(zh).toContain('垃圾')
  })
})

describe('注册之后该往哪走', () => {
  it('拿到 session 就是进去了', () => {
    expect(signUpOutcome(true, 'a@b.com')).toEqual({ ok: true })
  })

  /*
   * 这一条是整块的重点。
   *
   * 后台开着邮箱验证时，注册**成功了**但不给 session。原来这里返回
   * 的是失败，界面弹一个红框说「注册成功了，但…」—— 人看到红色就
   * 以为没注册上，会再注册一遍，然后撞上「这个邮箱已经注册过了」，
   * 彻底卡在门口。
   */
  it('没拿到 session 不是失败 —— 是「去点一下链接」', () => {
    const r = signUpOutcome(false, 'a@b.com')
    expect(r.ok).toBe(true)
    expect(r).toHaveProperty('confirm', 'a@b.com')
  })

  /* 邮箱要带出来：界面得把它显示给人看（常打错），也要拿它去重发 */
  it('把邮箱带出来', () => {
    const r = signUpOutcome(false, '  Yy@Example.com ')
    expect(r.ok && r.confirm).toBe('  Yy@Example.com ')
  })
})
