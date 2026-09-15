import { describe, expect, it } from 'vitest'
import { routeForHash } from '@/lib/openFromPush'

/*
 * 这一份钉的是「什么地址该跳、什么地址绝对不能跳」。
 *
 * 后一半才是重点：地址栏那截 hash 不是我们独占的 —— 重设密码的
 * 邮件链接回来时带的就是一串 #access_token=…&type=recovery，
 * 而那一刻页面上正要弹「设一个新密码」。跳走的话那个一次性会话
 * 就废了，人这次关掉 App 就再也进不来。
 */

describe('点通知之后落在哪一屏', () => {
  it('带着 #friends 就去好友页', () => {
    expect(routeForHash('#friends')).toBe('friends')
    expect(routeForHash('./#friends')).toBe('friends')
  })

  it('带着 #reports 就去举报队列', () => {
    expect(routeForHash('#reports')).toBe('reports')
    expect(routeForHash('./#reports')).toBe('reports')
  })

  it('带着 #feedback 就去反馈那一屏', () => {
    expect(routeForHash('#feedback')).toBe('feedback')
    expect(routeForHash('./#feedback')).toBe('feedback')
  })

  it('什么都没有就不动', () => {
    expect(routeForHash('')).toBeNull()
    expect(routeForHash('#')).toBeNull()
  })

  it('重设密码那串令牌绝对不能被当成「去好友页」', () => {
    expect(
      routeForHash('#access_token=abc123&refresh_token=def&type=recovery'),
    ).toBeNull()
    expect(routeForHash('#error_code=otp_expired')).toBeNull()
  })

  it('不认识的去处一律不动 —— 不猜，也不退回首页', () => {
    expect(routeForHash('#settings')).toBeNull()
    expect(routeForHash('#board/abc')).toBeNull()
  })
})
