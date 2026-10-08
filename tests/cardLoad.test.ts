import { describe, expect, it } from 'vitest'
import { shouldLoadCards } from '@/lib/cardLoad'

/* ------------------------------------------------------------------ *
 * 名片表什么时候该重新拉
 *
 * 这一块错了**不会报错**，表现是「头像不见了」：所有人的照片悄悄
 * 退回卡通角色，和「大家都没设过照片」长得一模一样。没有红框、
 * 没有日志，人只会觉得这个 App 时好时坏。
 *
 * 所以下面钉的是真实踩过的场景，不是一个布尔的真值表。
 *
 * -------------------------------------------------------------------
 * 「什么时候问」不在这里
 *
 * 挂载、换账号、球员表变了、从后台切回前台 —— 那四个时机在
 * store/useCards 里。这个函数只回答「问到我头上时该不该拉」，
 * 而它对四个时机一视同仁：这正是重试能成立的原因 ——
 * 拉失败不记账，于是回前台那一问自然就是重试。
 * ------------------------------------------------------------------ */

const 我 = 'uid-me'
const 别人 = 'uid-other'

describe('没拉成功过就一直该拉', () => {
  /*
   * 「失败不记账」是这一版的根。
   *
   * 地铁里开的 App：第一次拉失败了。没有这一条，这一整次使用里
   * 头像就都是卡通的，直到他彻底关掉重开。
   */
  it('登录着没成功过', () => {
    expect(shouldLoadCards({ loadedFor: undefined, uid: 我 })).toBe(true)
  })

  it('没登录也没成功过', () => {
    expect(shouldLoadCards({ loadedFor: undefined, uid: null })).toBe(true)
  })
})

describe('换人就要重拉', () => {
  /*
   * 这张表是按「谁在看」过滤的（自己 / 好友 / 同群）。
   * 换了人，同一张表里的内容就不对了。
   */
  it('登录之后要重拉 —— 登录前拉到的基本是空的', () => {
    /*
     * 今天踩得最狠的就是这一条：注册登录来回试了几趟，每退出再进来
     * 一次，头像就没了一次。登录前数据库看到的是个陌生人，
     * 回来的是空表；不跟着重拉，他登录之后头像还是卡通。
     */
    expect(shouldLoadCards({ loadedFor: null, uid: 我 })).toBe(true)
  })

  it('登出之后也要重拉 —— 不然下一个人看到的是上一个人的头像', () => {
    expect(shouldLoadCards({ loadedFor: 我, uid: null })).toBe(true)
  })

  it('换成另一个账号要重拉', () => {
    expect(shouldLoadCards({ loadedFor: 我, uid: 别人 })).toBe(true)
  })
})

describe('已经是这个人的表了就别再花请求', () => {
  it('同一个人，不重拉', () => {
    /*
     * 这一条是在挡「每次切回 App 都拉一次」：一天几十次，
     * 而这张表一小时也变不了一次。
     */
    expect(shouldLoadCards({ loadedFor: 我, uid: 我 })).toBe(false)
  })

  it('一直没登录、也拉成功过，同样不重拉', () => {
    expect(shouldLoadCards({ loadedFor: null, uid: null })).toBe(false)
  })
})

describe('null 和 undefined 不是一回事', () => {
  /*
   * 这两个长得像，混起来正好把「从来没成功过」和「登出状态下成功了」
   * 搅在一起 —— 而前者必须重试，后者不必。
   *
   * 这一条是这个文件里最该留着的：真要有人把 !== 写成 !=，
   * undefined != null 是 false，于是「从来没拉成功过」会被当成
   * 「登出时拉成功过」，重试那条路当场断掉，而别的测试一条都不红。
   */
  it('没成功过（undefined）要拉；登出时成功过（null）不用', () => {
    expect(shouldLoadCards({ loadedFor: undefined, uid: null })).toBe(true)
    expect(shouldLoadCards({ loadedFor: null, uid: null })).toBe(false)
  })
})
