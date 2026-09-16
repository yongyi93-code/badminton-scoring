import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmed } from '@/components/DeleteAccount'

/*
 * 注销账号。
 *
 * 这个文件钉两件事，它们出错的样子完全不同：
 *
 *   1. 那道「打字确认」的门 —— 松了，一次误触就删掉一个账号
 *   2. 失败之后这台手机停在什么状态 —— 停错了，人会看着一个
 *      已经不存在的账号的数据，或者反过来，明明没删成却被登出
 *
 * 真正不可逆的那一步（auth.admin.deleteUser）在 Edge Function 里，
 * 这里测不到。所以更要把「什么时候才走到那一步」钉死。
 */

describe('打字确认那道门', () => {
  it('中英各认一个词', () => {
    expect(confirmed('注销')).toBe(true)
    expect(confirmed('delete')).toBe(true)
  })

  it('大小写和前后空格不计较 —— 手机键盘会自己加空格', () => {
    expect(confirmed('DELETE')).toBe(true)
    expect(confirmed('  Delete ')).toBe(true)
    expect(confirmed(' 注销 ')).toBe(true)
  })

  /*
   * 这一组是这道门的意义所在。松一点就等于没有门 ——
   * 而门后面是一个删了就回不来的账号。
   */
  it('空的、差一点的、别的词，一律不算', () => {
    expect(confirmed('')).toBe(false)
    expect(confirmed('   ')).toBe(false)
    expect(confirmed('注')).toBe(false)
    expect(confirmed('注销账号')).toBe(false)
    expect(confirmed('delet')).toBe(false)
    expect(confirmed('deleted')).toBe(false)
    expect(confirmed('yes')).toBe(false)
    expect(confirmed('确定')).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * 失败之后停在哪
 *
 * 这一组全是围绕同一条规矩：**账号没删掉，就一个字都别动。**
 *
 * 反过来那一半同样要紧：账号删掉了，这台手机就必须擦干净 ——
 * 不擦的话，人对着满屏已经读不回来的数据，而再按一次注销
 * 只会得到「令牌认不出是谁」。
 * ------------------------------------------------------------------ */

const resetAll = vi.fn()
const stopSync = vi.fn()
const signOut = vi.fn(async () => ({ error: null }))
const invoke = vi.fn()
let flushResult: { ok: true } | { ok: false; error: string } = { ok: true }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { signOut: () => signOut() },
  },
  cloudReady: true,
  defaultClubCode: null,
}))

vi.mock('@/lib/sync', () => ({
  flushNow: async () => flushResult,
  stopSync: () => stopSync(),
}))

vi.mock('@/store/useApp', () => ({
  useApp: { getState: () => ({ resetAll }) },
}))

const { deleteMyAccount } = await import('@/lib/account')

beforeEach(() => {
  resetAll.mockClear()
  stopSync.mockClear()
  signOut.mockClear()
  invoke.mockReset()
  flushResult = { ok: true }
})

describe('注销失败的时候', () => {
  it('服务端报错就不擦这台手机 —— 账号还在，数据也该还在', async () => {
    invoke.mockResolvedValue({ error: new Error('boom') })
    const r = await deleteMyAccount({ scrubName: false })
    expect(r).toMatchObject({ ok: false })
    expect(resetAll).not.toHaveBeenCalled()
    expect(stopSync).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })

  /*
   * supabase-js 把非 2xx 包成一句放之四海而皆准的废话
   * （「Edge Function returned a non-2xx status code」）。
   * 真正的原因在响应体里，不挖出来的话这一屏等于什么都没说。
   */
  it('把服务端那句真话挖出来，而不是显示那句没用的包装', async () => {
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: '一把服务端钥匙都没有' }), { status: 500 }),
    })
    invoke.mockResolvedValue({ error: err })
    const r = await deleteMyAccount({ scrubName: false })
    expect(r).toEqual({ ok: false, error: '一把服务端钥匙都没有' })
  })

  it('挖不出来就退回原来那句，不显示 undefined', async () => {
    invoke.mockResolvedValue({ error: new Error('网络断了') })
    expect(await deleteMyAccount({ scrubName: false })).toEqual({
      ok: false,
      error: '网络断了',
    })
  })
})

describe('注销成功的时候', () => {
  it('停同步、擦本机、登出，一个都不少', async () => {
    invoke.mockResolvedValue({ error: null })
    const r = await deleteMyAccount({ scrubName: false })
    expect(r).toEqual({ ok: true })
    expect(stopSync).toHaveBeenCalledOnce()
    expect(resetAll).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('本人选了抹名字，就把这个选择递给服务端', async () => {
    invoke.mockResolvedValue({ error: null })
    await deleteMyAccount({ scrubName: true })
    expect(invoke).toHaveBeenCalledWith('delete-me', { body: { scrubName: true } })
  })

  /*
   * 同步失败**不能**拦住注销。
   *
   * 这一条是故意和 signOut() 不一样的：那边推不上去就中止，因为
   * 退出登录会清本机缓存，没推的东西会丢。这边人是要走的 ——
   * 为一次同步失败把注销挡回去，等于这个按钮时灵时不灵。
   */
  it('走之前那次同步没成功，照样注销', async () => {
    flushResult = { ok: false, error: '离线' }
    invoke.mockResolvedValue({ error: null })
    expect(await deleteMyAccount({ scrubName: false })).toEqual({ ok: true })
    expect(resetAll).toHaveBeenCalledOnce()
  })
})
