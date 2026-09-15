import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_KINDS,
  kindLabel,
  openFeedbackCount,
  type Feedback,
  type FeedbackKind,
} from '@/lib/feedback'

/*
 * 反馈的规则（谁看得到、内容能不能改）在 supabase/014-feedback.sql，
 * 那些是在本机跑一个真的 Postgres 打出来的，不在这个文件里。
 *
 * 这里只钉两件前端该负责的：分类和数据库那条 check 对得上，
 * 以及「还剩几条没看」不会数错。
 */

const SQL = 'supabase/014-feedback.sql'

const row = (patch: Partial<Feedback> = {}): Feedback => ({
  id: 'f1',
  author: 'someone',
  kind: 'bug',
  body: '点不动',
  app_build: 'abc1234',
  device: 'iOS 17 · Safari · 主屏幕',
  status: 'open',
  handled_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...patch,
})

describe('分类', () => {
  /*
   * 和举报那边同一条理由，也同样值钱：在这边加一类、忘了去 SQL 那边
   * 加，后果是界面上选得到，点「发出去」之后一句 23514 ——
   * 而那个人正想告诉你哪里坏了。
   */
  it('和数据库那条 check 约束一字不差', () => {
    const sql = readFileSync(SQL, 'utf8')
    const m = sql.match(/kind in \(([^)]*)\)/)
    expect(m, '014 里那条 kind 的 check 约束不见了').not.toBeNull()
    const inSql = (m![1].match(/'([a-z]+)'/g) ?? []).map((s) => s.replace(/'/g, ''))
    expect([...inSql].sort()).toEqual([...FEEDBACK_KINDS.map((k) => k.value)].sort())
  })

  it('状态那两个也对得上', () => {
    const sql = readFileSync(SQL, 'utf8')
    const m = sql.match(/status in \(([^)]*)\)/)
    expect(m).not.toBeNull()
    const inSql = (m![1].match(/'([a-z]+)'/g) ?? []).map((s) => s.replace(/'/g, ''))
    expect([...inSql].sort()).toEqual(['done', 'open'])
  })

  it('没有重复的，每条中英文和说明都齐', () => {
    const values = FEEDBACK_KINDS.map((k) => k.value)
    expect(new Set(values).size).toBe(values.length)
    for (const k of FEEDBACK_KINDS) {
      for (const [field, v] of Object.entries(k)) {
        expect(String(v).length, `${k.value} 的 ${field}`).toBeGreaterThan(0)
      }
    }
  })

  it('认不出来的分类原样吐出来，不会显示成空白', () => {
    expect(kindLabel('nonsense' as FeedbackKind)).toBe('nonsense')
  })
})

describe('还剩几条没看', () => {
  it('只数没看的', () => {
    expect(
      openFeedbackCount([
        row({ id: '1' }),
        row({ id: '2' }),
        row({ id: '3', status: 'done' }),
      ]),
    ).toBe(2)
  })

  it('一条都没有时是 0，不会炸', () => {
    expect(openFeedbackCount([])).toBe(0)
  })
})
