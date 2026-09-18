import { describe, expect, it } from 'vitest'
import { COMMENT_MAX, type Comment, checkComment, groupByPost } from '@/lib/comments'
import { setLang } from '@/lib/i18n'

/*
 * 评论里纯逻辑的那两块。
 *
 * 真正把门的（谁看得到、谁删得掉、被禁言的人评不了）在
 * supabase/027-comments.sql 的策略和触发器上，那些在本机跑真 Postgres
 * 撞过（16 条），不在这儿。
 *
 * 这个文件钉的是两件会静悄悄出错的事：
 *   · 一串空格被当成一条评论（界面上是一条空白，看着像坏了）
 *   · 评论**倒着**排（对话倒着读就不是对话了）
 */

setLang('zh')

const c = (id: string, post: string, at: string): Comment => ({
  id,
  post_id: post,
  author: 'u',
  body: id,
  created_at: at,
  hidden_at: null,
})

describe('这条能不能发', () => {
  it('正常的放行', () => {
    expect(checkComment('几点？')).toBeNull()
  })

  it('空的和全是空格的拦住', () => {
    expect(checkComment('')).not.toBeNull()
    expect(checkComment('   ')).not.toBeNull()
    expect(checkComment('\n\t ')).not.toBeNull()
  })

  it('正好到上限可以，超一个字不行', () => {
    expect(checkComment('あ'.repeat(COMMENT_MAX))).toBeNull()
    expect(checkComment('あ'.repeat(COMMENT_MAX + 1))).not.toBeNull()
  })

  /* 数的是 trim 之后的，和数据库那条 check（btrim）同一个口径 */
  it('字数按 trim 之后算', () => {
    expect(checkComment('  ' + 'あ'.repeat(COMMENT_MAX) + '  ')).toBeNull()
  })
})

describe('按动态分堆', () => {
  it('各归各的动态', () => {
    const m = groupByPost([
      c('a', 'p1', '2026-09-18T10:00:00Z'),
      c('b', 'p2', '2026-09-18T10:01:00Z'),
      c('c', 'p1', '2026-09-18T10:02:00Z'),
    ])
    expect(m.get('p1')?.map((x) => x.id)).toEqual(['a', 'c'])
    expect(m.get('p2')?.map((x) => x.id)).toEqual(['b'])
  })

  /*
   * 顺着排，不是倒着。
   *
   * 动态列表是倒着的（最新的在最上面），评论不是 —— 一段对话倒着读
   * 就不是对话了：先看到回答，再看到问题。
   */
  it('顺着时间排，先说的在上面', () => {
    const m = groupByPost([
      c('晚', 'p1', '2026-09-18T12:00:00Z'),
      c('早', 'p1', '2026-09-18T09:00:00Z'),
    ])
    expect(m.get('p1')?.map((x) => x.id)).toEqual(['早', '晚'])
  })

  it('一条都没有的时候是空表，不是抛错', () => {
    expect(groupByPost([]).size).toBe(0)
  })
})

describe('上限要和数据库对得上', () => {
  /*
   * 027 里写死的是 500。这边比它松的话，发下去会被服务端拒掉，
   * 而人已经把那句话打完了。
   */
  it('上限是 500', () => {
    expect(COMMENT_MAX).toBe(500)
  })
})
