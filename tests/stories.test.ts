import { describe, expect, it } from 'vitest'
import { addEntry, leftLine, tellers, type Teller } from '@/components/Stories'
import { STORY_MS, type FeedItem } from '@/lib/moments'
import { setLang } from '@/lib/i18n'

/*
 * Story 那一排圈圈里纯逻辑的两块。
 *
 * 真正把门的（过期之后连作者自己都看不到、到期时间被夹在 24 小时以内、
 * 发完改不了到期时间）在 supabase/028-stories.sql 的策略和触发器上，
 * 那些在本机跑真 Postgres 撞过（9 条结构 + 14 条行为），不在这儿。
 *
 * 这个文件钉的是三件在界面上会静悄悄出错的事：
 *   · 一个人发五条排出五个圈 —— 那一排就只剩他一个人了
 *   · 「＋」那一格跑到第六个位置 —— 发 Story 的入口没人找得到
 *   · 「还有几小时」算错，尤其是算成负数
 */

setLang('zh')

const NOW = 1_700_000_000_000

const story = (id: string, author: string, minsAgo: number): FeedItem => ({
  id,
  author,
  body: id,
  photos: [],
  created_at: new Date(NOW - minsAgo * 60_000).toISOString(),
  expires_at: new Date(NOW - minsAgo * 60_000 + STORY_MS).toISOString(),
  urls: [],
  likes: 0,
  liked: false,
})

const who = (uid: string) => ({ name: uid.toUpperCase() })
const ids = (t: Teller) => t.items.map((i) => i.id)

describe('按人分堆', () => {
  it('一个人一个圈，不是一条一个圈', () => {
    const rows = [story('a1', 'u-a', 10), story('a2', 'u-a', 30), story('b1', 'u-b', 20)]
    const out = tellers(rows, null, who, NOW)
    expect(out.length).toBe(2)
    expect(out.map((t) => t.uid).sort()).toEqual(['u-a', 'u-b'])
  })

  /*
   * 自己那一格同时是「发一条」的入口。排到第六个位置上就没人找得到了 ——
   * 而那是这一整块唯一的入口。
   */
  it('自己排最前，哪怕自己那条最旧', () => {
    const rows = [story('b1', 'u-b', 1), story('me1', 'u-me', 600)]
    const out = tellers(rows, 'u-me', who, NOW)
    expect(out[0].uid).toBe('u-me')
  })

  it('其余按最新那条倒着排', () => {
    const rows = [story('a1', 'u-a', 100), story('b1', 'u-b', 5), story('c1', 'u-c', 50)]
    expect(tellers(rows, null, who, NOW).map((t) => t.uid)).toEqual(['u-b', 'u-c', 'u-a'])
  })

  /*
   * 排序看的是**最新**那条，不是第一条或者条数。
   * 看成「谁发得多谁在前」的话，一个话痨会永远占着第一格。
   */
  it('一个人发得多不会因此排前面', () => {
    const rows = [
      story('a1', 'u-a', 300),
      story('a2', 'u-a', 200),
      story('a3', 'u-a', 100),
      story('b1', 'u-b', 5),
    ]
    expect(tellers(rows, null, who, NOW).map((t) => t.uid)).toEqual(['u-b', 'u-a'])
  })

  /* 一个人自己那几条顺着看：先发的先看，和对话一个道理 */
  it('一个人自己那几条从旧到新', () => {
    const rows = [story('新', 'u-a', 10), story('旧', 'u-a', 300), story('中', 'u-a', 100)]
    expect(ids(tellers(rows, null, who, NOW)[0])).toEqual(['旧', '中', '新'])
  })

  it('名字和照片从外面拿', () => {
    const out = tellers(
      [story('a1', 'u-a', 10)],
      null,
      (u) => ({ name: u === 'u-a' ? '阿力' : '?', photo: 'p.webp' }),
      NOW,
    )
    expect(out[0].name).toBe('阿力')
    expect(out[0].photo).toBe('p.webp')
  })

  it('一条都没有的时候是空的，不是抛错', () => {
    expect(tellers([], 'u-me', who, NOW)).toEqual([])
  })

  /* 没登录的时候没有「自己」那一格，但别人的圈照常排 */
  it('没登录也排得出来', () => {
    const out = tellers([story('a1', 'u-a', 10)], null, who, NOW)
    expect(out.map((t) => t.uid)).toEqual(['u-a'])
  })
})

describe('还剩多久', () => {
  const at = (minsLeft: number): FeedItem => ({
    ...story('x', 'u-a', 0),
    expires_at: new Date(NOW + minsLeft * 60_000).toISOString(),
  })

  it('不到一小时按分钟说', () => {
    expect(leftLine(at(20), true, NOW)).toBe('还有 20 分钟')
  })

  it('一小时以上按小时说', () => {
    expect(leftLine(at(60 * 5), true, NOW)).toBe('还有 5 小时')
  })

  /*
   * 这一条是最要紧的：过期了但还没轮到清理的那几分钟里，
   * 作者自己那一格上会写「还有 -3 分钟」—— 看着像 App 坏了。
   */
  it('已经过期的不会说成负数', () => {
    expect(leftLine(at(-30), true, NOW)).toBe('还有 0 分钟')
  })

  it('英文也说得出来', () => {
    expect(leftLine(at(20), false, NOW)).toBe('20 min left')
    expect(leftLine(at(60 * 5), false, NOW)).toBe('5h left')
  })

  /*
   * 没有到期时间的时候按「发出来那一刻 + 24 小时」算。
   *
   * 正常进不到这儿（Story 一定有 expires_at），但 028 跑之前那一列
   * 根本不存在 —— 部署和迁移之间总有一段时间对不上，而那一段里
   * 这里要给一个数，不能是 NaN。
   */
  it('没有到期时间就按发出来那一刻加 24 小时算', () => {
    const noExpiry: FeedItem = { ...story('x', 'u-a', 0), expires_at: null }
    expect(leftLine(noExpiry, true, NOW)).toBe('还有 24 小时')
  })
})

/* ------------------------------------------------------------------ *
 * 过期的不许再露面
 *
 * 线上撞出来的（2026-09-21）：过了 24 小时那条 Story 还挂在圈圈里，
 * 点开一片黑。
 *
 * 原因不在这一层，在我对上一层的误解：028 那条读策略的第一支是
 * `is_admin(auth.uid())`，管理员看得到所有动态，过期的也包括在内。
 * 而客户端当时写着「策略那边已经读不到了，不用再判」。
 *
 * 于是这个 bug **只有管理员自己撞得到** —— 而他恰好是最不会怀疑
 * 「我看到的和别人不一样」的那个人。
 * ------------------------------------------------------------------ */

describe('过期的不进那一排圈圈', () => {
  const expired = (id: string, author: string): FeedItem => ({
    ...story(id, author, 60 * 25),
    /* 25 小时前发的，到期时间在一小时前 */
    expires_at: new Date(NOW - 60 * 60_000).toISOString(),
  })

  it('过期的那条直接不算', () => {
    expect(tellers([expired('x1', 'u-a')], null, who, NOW)).toEqual([])
  })

  it('一个人有过期也有没过期的，只留没过期的', () => {
    const out = tellers([expired('x1', 'u-a'), story('ok', 'u-a', 10)], null, who, NOW)
    expect(out).toHaveLength(1)
    expect(ids(out[0])).toEqual(['ok'])
  })

  /* 整个人只剩过期的，那个圈圈就该整个消失，不是留一个点开没东西的 */
  it('一个人只有过期的，他那个圈整个不出现', () => {
    const out = tellers([expired('x1', 'u-a'), story('ok', 'u-b', 10)], null, who, NOW)
    expect(out.map((t) => t.uid)).toEqual(['u-b'])
  })

  /*
   * 差一秒都算过期。
   *
   * 边界写松的话，「还有 0 分钟」那条会在圈圈里多挂一会儿 ——
   * 而那正是线上看到的样子。
   */
  it('刚好到点就算过期', () => {
    const justNow: FeedItem = { ...story('x', 'u-a', 0), expires_at: new Date(NOW).toISOString() }
    expect(tellers([justNow], null, who, NOW)).toEqual([])
  })

  it('还差一秒到点的还在', () => {
    const almost: FeedItem = {
      ...story('x', 'u-a', 0),
      expires_at: new Date(NOW + 1000).toISOString(),
    }
    expect(tellers([almost], null, who, NOW)).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * 「发一条」那个入口在哪
 *
 * 线上撞出来的（2026-09-21）：**自己发过一条之后，「＋」整个消失，
 * 第二条再也发不出去。**
 *
 * 原来那一句是 `canPost && !mineFirst` —— 自己那个圈排第一，于是
 * 「＋」不渲染。当时那句注释写着「自己那一格同时是发一条的入口」，
 * 而那是**意图**，不是事实：点自己那个圈打开的是全屏播放。
 *
 * 一句描述意图的注释读起来和描述行为的一模一样 —— 它掩护了这个 bug
 * 一整版。所以这件事现在有名字、有返回值，也有这几条。
 * ------------------------------------------------------------------ */

describe('「发一条」的入口', () => {
  const teller = (uid: string): Teller => ({ uid, name: uid, items: [] })

  it('一条都没有的时候，单独占一格', () => {
    expect(addEntry([], 'u-me', true)).toBe('tile')
  })

  it('只有别人发过，自己还是单独占一格', () => {
    expect(addEntry([teller('u-a')], 'u-me', true)).toBe('tile')
  })

  /* 这一条就是那个 bug。以前这里返回的是「没有入口」 */
  it('自己已经发过了，入口挂在自己那个圈上 —— 不是消失', () => {
    expect(addEntry([teller('u-me'), teller('u-a')], 'u-me', true)).toBe('badge')
  })

  /* 自己那个圈不一定排第一（虽然现在排序保证了），入口也不该跟着丢 */
  it('自己那个圈就算没排第一，入口也还在', () => {
    expect(addEntry([teller('u-a'), teller('u-me')], 'u-me', true)).toBe('badge')
  })

  /* 被禁言、没登录：写完一段再被拒，比一开始就没有那个按钮糟 */
  it('发不了的时候没有入口', () => {
    expect(addEntry([], 'u-me', false)).toBe('none')
    expect(addEntry([teller('u-me')], 'u-me', false)).toBe('none')
  })

  it('没登录的时候，别人的圈照常显示，但没有入口', () => {
    expect(addEntry([teller('u-a')], null, false)).toBe('none')
  })
})
