import { describe, expect, it } from 'vitest'
import {
  BAN_SPANS,
  type Ban,
  activeBan,
  banLine,
  blockedThings,
  isActive,
  silencedFrom,
  untilFrom,
  untilLine,
} from '@/lib/ban'
import { setLang } from '@/lib/i18n'

/*
 * 封号里纯逻辑的那几块。
 *
 * 真正把门的（谁封得了人、被封的人发不发得出话、申诉不受封号影响）
 * 在 supabase/025-bans.sql 的策略和触发器上，那些在本机跑真 Postgres
 * 撞过（24 条），不在这儿。
 *
 * 这个文件钉的是四件会静悄悄出错的事：
 *   · 过期的封号还压着人（或者反过来，永久的被当成过期）
 *   · 同时有禁言和封号时说成了轻的那条（人会以为自己还加得了好友）
 *   · 数据库抛回来的暗号没被翻成人话（用户看到 RALLY_SILENCED:ban:）
 *   · 「永久」被算成了一个很远的日期
 */

setLang('zh')

const ban = (o: Partial<Ban>): Ban => ({
  id: 'b1',
  uid: 'u1',
  kind: 'mute',
  reason: 'harassment',
  note: null,
  until: null,
  created_by: 'admin',
  created_at: '2026-09-01T00:00:00Z',
  lifted_at: null,
  lifted_by: null,
  ...o,
})

const NOW = Date.parse('2026-09-18T12:00:00Z')

describe('还生效着吗', () => {
  it('没到期的还压着', () => {
    expect(isActive(ban({ until: '2026-09-20T00:00:00Z' }), NOW)).toBe(true)
  })

  /* 这一条不对的话，人被永久禁言之后过一天自己就好了 */
  it('没写到期时间的是永久', () => {
    expect(isActive(ban({ until: null }), NOW)).toBe(true)
  })

  it('过期了就自动失效，不用谁去点一下', () => {
    expect(isActive(ban({ until: '2026-09-17T00:00:00Z' }), NOW)).toBe(false)
  })

  /* 解封不是删行，是盖一个章 —— 盖过章的哪怕没到期也不算数 */
  it('解封过的不算，哪怕还没到期', () => {
    expect(
      isActive(ban({ until: '2026-09-30T00:00:00Z', lifted_at: '2026-09-18T01:00:00Z' }), NOW),
    ).toBe(false)
  })
})

describe('挑出压着我的那一条', () => {
  it('一条都没有就是 null', () => {
    expect(activeBan([], NOW)).toBeNull()
    expect(activeBan([ban({ until: '2026-01-01T00:00:00Z' })], NOW)).toBeNull()
  })

  /*
   * 这一条最要紧。同时有一条禁言和一条封号的时候，说成禁言的话，
   * 人会以为自己还加得了好友 —— 然后一次次去试，一次次失败。
   */
  it('禁言和封号同时在，说的是封号那条', () => {
    const got = activeBan(
      [
        ban({ id: 'mute', kind: 'mute', until: '2026-12-01T00:00:00Z' }),
        ban({ id: 'ban', kind: 'ban', until: '2026-09-20T00:00:00Z' }),
      ],
      NOW,
    )
    expect(got?.id).toBe('ban')
  })

  it('两条同样重的，说的是管得久的那条', () => {
    const got = activeBan(
      [
        ban({ id: 'short', until: '2026-09-19T00:00:00Z' }),
        ban({ id: 'long', until: '2026-10-19T00:00:00Z' }),
      ],
      NOW,
    )
    expect(got?.id).toBe('long')
  })

  it('永久的比任何有期限的都久', () => {
    const got = activeBan(
      [
        ban({ id: 'long', until: '2099-01-01T00:00:00Z' }),
        ban({ id: 'forever', until: null }),
      ],
      NOW,
    )
    expect(got?.id).toBe('forever')
  })
})

describe('数据库抛回来的暗号', () => {
  /*
   * 触发器抛的是 RALLY_SILENCED:mute:2026-...，翻不出来的话
   * 用户看到的就是这一串。
   */
  it('认得出禁言和封号', () => {
    expect(silencedFrom('RALLY_SILENCED:mute:2026-09-25 12:00:00+00')).toEqual({
      kind: 'mute',
      until: '2026-09-25 12:00:00+00',
    })
    expect(silencedFrom('RALLY_SILENCED:ban:')?.kind).toBe('ban')
  })

  it('永久那种的 until 是 null，不是空字符串', () => {
    expect(silencedFrom('RALLY_SILENCED:ban:')?.until).toBeNull()
  })

  /* Postgres 的报错前面常带一段前缀，不能要求整句从头匹配 */
  it('前面带别的字也认得出来', () => {
    const real = 'new row violates ... RALLY_SILENCED:mute:2026-09-25 12:00:00+00'
    expect(silencedFrom(real)?.kind).toBe('mute')
  })

  it('别的错不认，返回 null（宁可显示原文也别猜）', () => {
    expect(silencedFrom('duplicate key value')).toBeNull()
    expect(silencedFrom('')).toBeNull()
  })
})

describe('说给人听的那句话', () => {
  it('永久的不编一个日期出来', () => {
    expect(untilLine(null, true)).toBe('不会自动解除')
    expect(banLine({ kind: 'ban', until: null }, true)).toContain('不会自动解除')
  })

  /* 一个坏掉的日期不该渲染成 Invalid Date */
  it('日期读不懂时退回「不会自动解除」，不显示 Invalid Date', () => {
    expect(untilLine('这不是日期', true)).toBe('不会自动解除')
    expect(untilLine('这不是日期', false)).not.toContain('Invalid')
  })

  it('禁言和封号说的不是同一件事', () => {
    expect(banLine({ kind: 'mute', until: null }, true)).not.toBe(
      banLine({ kind: 'ban', until: null }, true),
    )
  })
})

describe('被封之后做不了什么', () => {
  /* 照着说，别让人自己一件件去试 */
  it('禁言只挡说话那三件', () => {
    expect(blockedThings('mute', true)).toHaveLength(3)
  })

  it('封号挡的更多，而且包含禁言那三件', () => {
    const mute = blockedThings('mute', true)
    const banned = blockedThings('ban', true)
    expect(banned.length).toBeGreaterThan(mute.length)
    for (const x of mute) expect(banned).toContain(x)
  })

  /* 「记分、打球」不在挡住的名单里 —— 封号是社交上的处理 */
  it('没有一条是关于打球的', () => {
    for (const x of blockedThings('ban', true)) {
      expect(x).not.toContain('记分')
      expect(x).not.toContain('球局')
    }
  })
})

describe('封多久', () => {
  it('永久算出来的是 null，不是一个很远的日期', () => {
    expect(untilFrom(null, NOW)).toBeNull()
  })

  it('7 天就是 7 天之后', () => {
    const got = untilFrom(24 * 7, NOW)
    expect(Date.parse(got!) - NOW).toBe(7 * 24 * 3600 * 1000)
  })

  it('那几个选项里有且只有一个是永久', () => {
    expect(BAN_SPANS.filter((s) => s.hours === null)).toHaveLength(1)
  })
})
