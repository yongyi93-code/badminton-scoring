import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 管理员名单这一层。
 *
 * 表上的规则（谁读得到名单、谁改得动、最后一个 owner 删不掉）在
 * supabase/016-admins.sql —— 那些是在本机跑一个真的 Postgres、
 * 用四个不同身份去撞出来的，不在这个文件里。
 *
 * 这里钉的是**前端最容易写错的那一件**：
 *
 *   被 RLS 挡下来的 delete / update 不报错，只是动了 0 行。
 *
 * 只看 error 是不是 null 的话，一个被策略挡住的操作会在界面上显示
 * 「去掉了」，刷新一下那个人还在。这种界面比报错难查得多 ——
 * 因为它看起来是对的。
 */

const cloud = vi.hoisted(() => ({
  /** 这次写操作「动了几行」。RLS 挡住时是 0 */
  affected: 1,
  /** 想让操作报错时填这个 */
  error: null as { message: string; code?: string } | null,
}))

vi.mock('@/lib/supabase', () => {
  const result = () => ({
    data: cloud.error ? null : Array.from({ length: cloud.affected }, () => ({ uid: 'x' })),
    error: cloud.error,
  })
  /* 链式调用：每一环都返回自己，最后 await 的时候给结果 */
  const chain = () => {
    const self: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'order', 'limit']) self[k] = () => self
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return self
  }
  return {
    supabase: {
      from: () => ({
        select: chain,
        insert: chain,
        update: chain,
        delete: chain,
      }),
      auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    },
  }
})

const { addAdmin, adminLabel, removeAdmin, setOwner } = await import('@/lib/admins')

beforeEach(() => {
  cloud.affected = 1
  cloud.error = null
})

describe('挡下来的写操作不能算成功', () => {
  it('删掉 0 行 = 没删成，不是删成了', async () => {
    cloud.affected = 0
    const r = await removeAdmin('someone')
    expect(r.ok).toBe(false)
  })

  it('改了 0 行 = 没改成', async () => {
    cloud.affected = 0
    const r = await setOwner('someone', true)
    expect(r.ok).toBe(false)
  })

  it('插了 0 行 = 没加成', async () => {
    cloud.affected = 0
    const r = await addAdmin('someone', '阿明')
    expect(r.ok).toBe(false)
  })

  it('真动了一行才算成功', async () => {
    expect((await removeAdmin('x')).ok).toBe(true)
    expect((await setOwner('x', false)).ok).toBe(true)
    expect((await addAdmin('x', '阿明')).ok).toBe(true)
  })

  /*
   * 挡下来的时候那句话要说到点子上。「出错了」对一个 owner 没用 ——
   * 他要知道的是「是我没权限，还是这是最后一个 owner」。
   */
  it('说得出为什么没成', async () => {
    cloud.affected = 0
    const r = await removeAdmin('x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/owner/)
  })
})

describe('报错的情况', () => {
  it('已经在名单上了，说人话，不甩一串 23505', async () => {
    cloud.error = { message: 'duplicate key value violates unique constraint', code: '23505' }
    const r = await addAdmin('x', '阿明')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).not.toMatch(/duplicate|23505/)
      expect(r.error).toMatch(/已经|already/)
    }
  })
})

describe('名单上那个 uid 是谁', () => {
  const row = { uid: 'uid-1', note: '阿明，帮忙管周三', owner: false, created_at: '' }

  it('球群里找得到就用名字', () => {
    expect(adminLabel(row, new Map([['uid-1', '阿明']]))).toBe('阿明')
  })

  it('找不到就用当初写的那句话', () => {
    expect(adminLabel(row, new Map())).toBe('阿明，帮忙管周三')
  })

  it('两样都没有，才退回半截 uid —— 那是兜底，不是给人看的', () => {
    expect(adminLabel({ ...row, note: null }, new Map())).toBe('uid-1')
  })
})
