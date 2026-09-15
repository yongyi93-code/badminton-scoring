import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  REPORT_REASONS,
  openCount,
  openReportAgainst,
  reasonLabel,
  type Report,
  type ReportReason,
  type ReportStatus,
} from '@/lib/report'

/*
 * 举报这一块真正的规则 —— 谁举报得了谁、谁看得到、证据能不能改 ——
 * 全在数据库的策略里（supabase/012-reports.sql），前端一条都挡不住。
 * 那些规则是在本机跑一个真的 Postgres 打出来的，不在这个文件里。
 *
 * 这里管的是另外两件前端确实该负责的事：
 *   1. 那份理由清单和数据库那条 check 约束必须对得上
 *   2. 界面上「已经举报过了」这类判断不能说反
 */

const REASON_SQL = 'supabase/012-reports.sql'

const report = (patch: Partial<Report> = {}): Report => ({
  id: 'r1',
  reporter: 'me',
  reported: 'them',
  reason: 'harassment',
  note: null,
  evidence: null,
  status: 'open',
  handled_by: null,
  handled_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...patch,
})

describe('理由清单', () => {
  /*
   * 这一条是整个文件里最值钱的。
   *
   * 理由存进数据库时要过一条 check 约束，而那条约束在另一个文件里。
   * 在这边加一个新理由、忘了去那边加，后果是：界面上选得到，
   * 点「确定举报」之后一句 23514 —— 而那个人正在被骚扰。
   *
   * 编译器管不着跨文件的这种事，所以直接把那段 SQL 读出来对。
   */
  it('和数据库那条 check 约束一字不差', () => {
    const sql = readFileSync(REASON_SQL, 'utf8')
    const m = sql.match(/reason in \(([^)]*)\)/)
    expect(m, '012 里那条 reason 的 check 约束不见了').not.toBeNull()
    const inSql = (m![1].match(/'([a-z]+)'/g) ?? []).map((s) => s.replace(/'/g, ''))
    expect([...inSql].sort()).toEqual([...REPORT_REASONS.map((r) => r.value)].sort())
  })

  it('状态那三个也和数据库对得上', () => {
    const sql = readFileSync(REASON_SQL, 'utf8')
    const m = sql.match(/status in \(([^)]*)\)/)
    expect(m).not.toBeNull()
    const inSql = (m![1].match(/'([a-z]+)'/g) ?? []).map((s) => s.replace(/'/g, ''))
    const mine: ReportStatus[] = ['open', 'handled', 'dismissed']
    expect([...inSql].sort()).toEqual([...mine].sort())
  })

  it('没有重复的，每条中英文和说明都齐', () => {
    const values = REPORT_REASONS.map((r) => r.value)
    expect(new Set(values).size).toBe(values.length)
    for (const r of REPORT_REASONS) {
      for (const [k, v] of Object.entries(r)) {
        expect(String(v).length, `${r.value} 的 ${k}`).toBeGreaterThan(0)
      }
    }
  })

  it('「其他」排在最后 —— 它是兜底，不该挡在具体理由前面', () => {
    expect(REPORT_REASONS[REPORT_REASONS.length - 1].value).toBe('other')
  })

  it('认不出来的理由原样吐出来，不会显示成空白', () => {
    // 老数据、或者以后数据库先加了一个前端还不认识的理由
    expect(reasonLabel('nonsense' as ReportReason)).toBe('nonsense')
  })
})

describe('我举报过谁', () => {
  it('找得到对这个人那条还开着的', () => {
    const rows = [report({ id: 'x', reported: 'ben' })]
    expect(openReportAgainst(rows, 'ben')?.id).toBe('x')
  })

  it('处理过的不算 —— 那时候他又能再举报一次了', () => {
    /*
     * 这一条和数据库那个唯一索引是同一件事的两面：索引只拦
     * status = 'open' 的。界面这边要是把处理过的也算成「已举报」，
     * 那个人再次被骚扰时会发现举报按钮点不动，而数据库其实放行。
     */
    const rows = [
      report({ id: 'x', reported: 'ben', status: 'handled' }),
      report({ id: 'y', reported: 'ben', status: 'dismissed' }),
    ]
    expect(openReportAgainst(rows, 'ben')).toBeUndefined()
  })

  it('别人那条不算成我举报了他', () => {
    const rows = [report({ reported: 'cho' })]
    expect(openReportAgainst(rows, 'ben')).toBeUndefined()
  })

  it('一条都没有时不会炸', () => {
    expect(openReportAgainst([], 'ben')).toBeUndefined()
    expect(openCount([])).toBe(0)
  })
})

describe('队列里还剩几条', () => {
  it('只数没处理的', () => {
    const rows = [
      report({ id: '1' }),
      report({ id: '2' }),
      report({ id: '3', status: 'handled' }),
      report({ id: '4', status: 'dismissed' }),
    ]
    expect(openCount(rows)).toBe(2)
  })
})
