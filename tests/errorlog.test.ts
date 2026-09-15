import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 把云端换成一个假的。
 *
 * 不换的话这个文件会**真的往生产库里发请求**：.env 是提交进仓库的
 * （里面那两个值本来就要编进前端包，是公开的），所以 CI 上
 * supabase 客户端是活的，report() 里那句 insert 会真的出网。
 *
 * 这已经出过事：CI 上这两条连着 await 五次真请求，偶尔超过 5 秒
 * 的超时，于是测试红了、部署被挡下 —— 而代码一个字都没问题。
 * 本机看不出来，因为这台机器屏蔽了 supabase.co，请求秒失败。
 *
 * 限流这件事本来就和云端无关：它要钉的是「同一个错报几次」，
 * 那个判断在发请求之前就做完了。
 */
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ insert: async () => ({ error: null }) }),
  },
}))

import {
  fingerprintOf,
  groupErrors,
  report,
  resetThrottle,
  shouldReport,
  type ErrorRow,
} from '@/lib/errorlog'

/*
 * 这个文件里唯一会真出事的东西是限流。
 *
 * 一个渲染循环里的错误一秒能报几百条，而免费版数据库 500 MB ——
 * 淹掉之后真正的那条也就看不见了。限流在浏览器里很难验
 * （要真的造几百个错），所以在这儿把它钉死。
 *
 * 表上的规则（谁看得到、内容能不能改）在 supabase/015-errors.sql，
 * 那些是在本机跑一个真的 Postgres 打出来的，不在这里。
 */

const row = (patch: Partial<ErrorRow> = {}): ErrorRow => ({
  id: 'e1',
  message: 'Cannot read properties of null',
  stack: 'at paint (DressUp.tsx:81)',
  route: 'avatar',
  app_build: '7f8f434',
  device: 'iOS 17 · Safari · 主屏幕',
  fingerprint: 'aaa',
  status: 'open',
  created_at: '2026-01-02T00:00:00Z',
  ...patch,
})

describe('限流', () => {
  beforeEach(() => resetThrottle())

  it('报过之后，同一个错就不再报了', async () => {
    const fp = fingerprintOf('boom', 'at x (a.ts:1)')
    expect(shouldReport(fp)).toBe(true)
    await report('boom', 'at x (a.ts:1)')
    expect(shouldReport(fp)).toBe(false)
  })

  it('同一句话在不同地方出的错，算两个 bug', () => {
    const a = fingerprintOf('Cannot read properties of null', 'at paint (DressUp.tsx:81)')
    const b = fingerprintOf('Cannot read properties of null', 'at send (Chat.tsx:92)')
    expect(a).not.toBe(b)
  })

  it('同一处的错，行号之后的细节变了还是同一个 bug', () => {
    /*
     * 指纹只取堆栈第一帧。取整个堆栈的话，调用路径一变就成了
     * 新的一条，同一个 bug 会在管理员那一屏刷出好几行。
     */
    const a = fingerprintOf('boom', 'at paint (DressUp.tsx:81)\n at A (x.ts:1)')
    const b = fingerprintOf('boom', 'at paint (DressUp.tsx:81)\n at B (y.ts:9)')
    expect(a).toBe(b)
  })

  it('一次会话最多 5 条，第 6 个新错误也不报', async () => {
    for (let i = 0; i < 5; i++) await report(`boom ${i}`, `at f${i} (a.ts:${i})`)
    expect(shouldReport('brand-new-fingerprint')).toBe(false)
  })

  it('空的报错文本不占额度', async () => {
    await report('')
    await report('   ')
    expect(shouldReport('still-fresh')).toBe(true)
  })

  it('resetThrottle 之后重新开始', async () => {
    for (let i = 0; i < 5; i++) await report(`boom ${i}`, `at f${i} (a.ts:${i})`)
    expect(shouldReport('x')).toBe(false)
    resetThrottle()
    expect(shouldReport('x')).toBe(true)
  })
})

describe('按 bug 归并', () => {
  it('同一个指纹收成一行，数出撞了几次', () => {
    const g = groupErrors([
      row({ id: '1', fingerprint: 'aaa' }),
      row({ id: '2', fingerprint: 'aaa' }),
      row({ id: '3', fingerprint: 'bbb', message: '别的错' }),
    ])
    expect(g).toHaveLength(2)
    expect(g.find((x) => x.fingerprint === 'aaa')!.count).toBe(2)
  })

  it('留的是最近那一次 —— 进来时是时间倒序的', () => {
    const g = groupErrors([
      row({ id: 'new', fingerprint: 'aaa', created_at: '2026-02-02T00:00:00Z' }),
      row({ id: 'old', fingerprint: 'aaa', created_at: '2026-01-01T00:00:00Z' }),
    ])
    expect(g[0].latest.id).toBe('new')
  })

  it('把撞过的机型和版本号都收集起来（不重复）', () => {
    const g = groupErrors([
      row({ fingerprint: 'aaa', device: 'iOS 17 · Safari', app_build: 'v2' }),
      row({ fingerprint: 'aaa', device: 'Android 14 · Chrome', app_build: 'v2' }),
      row({ fingerprint: 'aaa', device: 'iOS 17 · Safari', app_build: 'v1' }),
    ])
    expect(g[0].devices.sort()).toEqual(['Android 14 · Chrome', 'iOS 17 · Safari'])
    expect(g[0].builds.sort()).toEqual(['v1', 'v2'])
  })

  it('组里只要还有一条没看，整组就算没看', () => {
    const g = groupErrors([
      row({ fingerprint: 'aaa', status: 'done' }),
      row({ fingerprint: 'aaa', status: 'open' }),
    ])
    expect(g[0].anyOpen).toBe(true)
  })

  it('没看的排前面，同样状态里撞得多的排前面', () => {
    const g = groupErrors([
      row({ fingerprint: 'done-many', status: 'done' }),
      row({ fingerprint: 'done-many', status: 'done' }),
      row({ fingerprint: 'done-many', status: 'done' }),
      row({ fingerprint: 'open-one', status: 'open' }),
      row({ fingerprint: 'open-two', status: 'open' }),
      row({ fingerprint: 'open-two', status: 'open' }),
    ])
    expect(g.map((x) => x.fingerprint)).toEqual(['open-two', 'open-one', 'done-many'])
  })

  it('一条都没有时不会炸', () => {
    expect(groupErrors([])).toEqual([])
  })
})

describe('不能收的东西', () => {
  /*
   * 这一条钉的是「路由名塞不下一个带令牌的网址」。
   *
   * 重设密码回来时地址栏是 #access_token=...，那是一把能登录的钥匙。
   * 数据库那边 route 限死 60 字，比任何一个真实令牌都短得多 ——
   * 就算哪天有人图省事改成存 location.href，也会被那条约束当场挡下。
   */
  it('数据库把 route 限死在 60 字以内', () => {
    const sql = readFileSync('supabase/015-errors.sql', 'utf8')
    const m = sql.match(/route text check[^)]*char_length\(route\) <= (\d+)/)
    expect(m, '015 里 route 的长度约束不见了').not.toBeNull()
    expect(Number(m![1])).toBeLessThanOrEqual(60)
  })

  it('报错文本和堆栈也都有上限', () => {
    const sql = readFileSync('supabase/015-errors.sql', 'utf8')
    expect(sql).toMatch(/char_length\(message\) between 1 and 500/)
    expect(sql).toMatch(/char_length\(stack\) <= 2000/)
  })
})
