import { describe, expect, it } from 'vitest'
import { leftLine, tellers, type Teller } from '@/components/Stories'
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
    const out = tellers(rows, null, who)
    expect(out.length).toBe(2)
    expect(out.map((t) => t.uid).sort()).toEqual(['u-a', 'u-b'])
  })

  /*
   * 自己那一格同时是「发一条」的入口。排到第六个位置上就没人找得到了 ——
   * 而那是这一整块唯一的入口。
   */
  it('自己排最前，哪怕自己那条最旧', () => {
    const rows = [story('b1', 'u-b', 1), story('me1', 'u-me', 600)]
    const out = tellers(rows, 'u-me', who)
    expect(out[0].uid).toBe('u-me')
  })

  it('其余按最新那条倒着排', () => {
    const rows = [story('a1', 'u-a', 100), story('b1', 'u-b', 5), story('c1', 'u-c', 50)]
    expect(tellers(rows, null, who).map((t) => t.uid)).toEqual(['u-b', 'u-c', 'u-a'])
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
    expect(tellers(rows, null, who).map((t) => t.uid)).toEqual(['u-b', 'u-a'])
  })

  /* 一个人自己那几条顺着看：先发的先看，和对话一个道理 */
  it('一个人自己那几条从旧到新', () => {
    const rows = [story('新', 'u-a', 10), story('旧', 'u-a', 300), story('中', 'u-a', 100)]
    expect(ids(tellers(rows, null, who)[0])).toEqual(['旧', '中', '新'])
  })

  it('名字和照片从外面拿', () => {
    const out = tellers([story('a1', 'u-a', 10)], null, (u) => ({
      name: u === 'u-a' ? '阿力' : '?',
      photo: 'p.webp',
    }))
    expect(out[0].name).toBe('阿力')
    expect(out[0].photo).toBe('p.webp')
  })

  it('一条都没有的时候是空的，不是抛错', () => {
    expect(tellers([], 'u-me', who)).toEqual([])
  })

  /* 没登录的时候没有「自己」那一格，但别人的圈照常排 */
  it('没登录也排得出来', () => {
    const out = tellers([story('a1', 'u-a', 10)], null, who)
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
