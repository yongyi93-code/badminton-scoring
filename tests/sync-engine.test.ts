import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '@/store/useApp'

/*
 * 同步引擎的接线部分：登录那一刻先拉后推、之后本机一改就推。
 *
 * 这一段过去一行都没跑过 —— 沙箱连不上 Supabase，手机上又只能靠
 * 「去后台看看表里有没有东西」这种办法验证，一轮要好几分钟。
 * 结果就是第一版上线后云端那张表一直是空的，而代码看着完全合理。
 *
 * 所以把 supabase 客户端换成一个假的：它不联网，只把「谁调了 upsert、
 * 推了哪几行」记下来。真正要钉死的本来也不是网络，而是
 * 「什么时候该推、什么时候不许推」这个判断。
 */

const cloud = vi.hoisted(() => ({
  /** 云端现有的行。测之前摆好 */
  rows: [] as { kind: string; id: string; data: unknown }[],
  /** 每次 upsert 推了哪些行，按顺序记下来 */
  upserts: [] as { kind: string; id: string; deleted: boolean }[][],
  /** 想让读取失败时填这个 */
  selectError: null as { message: string } | null,
  /** 有没有登录。RLS 只认登录的人，没登录时一个请求都不该发出去 */
  session: {} as object | null,
}))

vi.mock('@/lib/supabase', () => {
  const table = {
    select: () => ({
      eq: () =>
        Promise.resolve(
          cloud.selectError
            ? { data: null, error: cloud.selectError }
            : { data: cloud.rows, error: null },
        ),
    }),
    upsert: (rows: { kind: string; id: string; deleted: boolean }[]) => {
      cloud.upserts.push(rows)
      return Promise.resolve({ error: null })
    },
  }
  const channel = { on: () => channel, subscribe: () => channel }
  return {
    supabase: {
      from: () => table,
      channel: () => channel,
      removeChannel: () => Promise.resolve('ok'),
      auth: {
        getSession: () => Promise.resolve({ data: { session: cloud.session } }),
      },
    },
    cloudReady: true,
  }
})

const { startSync, stopSync } = await import('@/lib/sync')

/** 推上去的所有行，按 `kind id` 摊平，方便断言 */
const pushedKeys = () =>
  cloud.upserts.flat().map((r) => `${r.kind} ${r.id}`)

beforeEach(() => {
  // sync.ts 会挂 online 事件，node 环境里没有 window
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
  vi.useFakeTimers()
  cloud.rows = []
  cloud.upserts = []
  cloud.selectError = null
  cloud.session = {}
  useApp.getState().resetAll()
})

afterEach(() => {
  stopSync()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('登录那一刻', () => {
  /*
   * 最自然的使用顺序恰恰是「先建好人、后登录」—— 没人会先想到
   * 去登录再开始用。第一版漏了这一步：登录后基线设成空，然后就等
   * 本机再有改动才推，而本机不会再改了，数据永远卡在这台手机上。
   */
  it('云端是空的、本机有东西：把本机整份推上去', async () => {
    const p = useApp.getState().addPlayer('阿伟', 'M')
    useApp.getState().setAvatarSex(p.id, 'm')

    await startSync()

    expect(pushedKeys()).toContain(`player ${p.id}`)
    // 挑过角色的，那份换装也得跟着上去
    expect(pushedKeys()).toContain(`avatar ${p.id}`)
  })

  it('云端和本机都是空的：一条都不推，不留空转的痕迹', async () => {
    await startSync()
    expect(cloud.upserts).toEqual([])
  })

  /*
   * 云端为准：云端有历史的时候，这台手机上那份是缓存，
   * 应该被盖掉，而不是反过来推上去把别人的覆盖了。
   */
  it('云端有东西：本机被盖掉，而且什么都不推', async () => {
    cloud.rows = [
      { kind: 'player', id: 'cloud-1', data: { id: 'cloud-1', name: '云上的人', gender: 'F' } },
    ]
    useApp.getState().addPlayer('本机的人', 'M')

    await startSync()

    expect(useApp.getState().players.map((p) => p.name)).toEqual(['云上的人'])
    expect(cloud.upserts).toEqual([])
  })

  /*
   * 读不到云端时绝对不能推：读失败和「云端是空的」在客户端看来
   * 长得一样，把本机那份推上去等于拿一台手机的缓存去盖全队的历史。
   */
  it('拉取失败：什么都不推', async () => {
    cloud.selectError = { message: 'network error' }
    useApp.getState().addPlayer('阿伟', 'M')

    await startSync()

    expect(cloud.upserts).toEqual([])
  })
})

describe('登录之后本机再改', () => {
  it('新建的球员会自己推上去', async () => {
    await startSync()
    cloud.upserts = []

    const p = useApp.getState().addPlayer('小林', 'F')
    await vi.advanceTimersByTimeAsync(700)

    expect(pushedKeys()).toContain(`player ${p.id}`)
  })

  it('连着改好几次只推一轮 —— 记分一场会触发十几次 store 变化', async () => {
    await startSync()
    cloud.upserts = []

    const p = useApp.getState().addPlayer('小林', 'F')
    useApp.getState().updatePlayer(p.id, { name: '小林改了名' })
    useApp.getState().updatePlayer(p.id, { name: '小林又改了' })
    await vi.advanceTimersByTimeAsync(700)

    expect(cloud.upserts).toHaveLength(1)
    const row = cloud.upserts[0].find((r) => r.id === p.id) as
      | { data: { name: string } }
      | undefined
    expect(row?.data.name).toBe('小林又改了')
  })

  it('删掉的推成 deleted，而不是从推送里消失', async () => {
    await startSync()
    const s = useApp.getState().createSession({
      date: '2026-09-01',
      venue: '中央球馆',
      courtCount: 2,
      playerIds: [],
      defaultType: 'doubles',
    })
    await vi.advanceTimersByTimeAsync(700)
    cloud.upserts = []

    useApp.getState().deleteSession(s.id)
    await vi.advanceTimersByTimeAsync(700)

    const row = cloud.upserts.flat().find((r) => r.kind === 'session' && r.id === s.id)
    expect(row?.deleted).toBe(true)
  })

  /*
   * 从云端拉下来的改动会让 store 变，但那不是「本机的改动」。
   * 不挡住的话两台手机会把对方的更新当成自己的新改动，来回推个没完。
   */
  it('从云端拉下来的东西不会又被推回去', async () => {
    await startSync()
    cloud.upserts = []

    const { pullAll } = await import('@/lib/sync')
    cloud.rows = [
      { kind: 'player', id: 'cloud-1', data: { id: 'cloud-1', name: '云上的人', gender: 'F' } },
    ]
    await pullAll()
    await vi.advanceTimersByTimeAsync(700)

    expect(cloud.upserts).toEqual([])
  })
})

/*
 * 没登录时数据库回的是「new row violates row-level security policy」，
 * 和「策略压根没建好」返回的是同一句话（都是 42501）—— 手机上看到那句话
 * 根本分不出该去登录还是该去后台跑 SQL。实际上就在这上面卡过一次。
 * 所以没登录必须在发请求之前就拦住，让剩下那条错误只剩一种解释。
 */
describe('没登录的时候', () => {
  it('手动推送不发请求，直接说去登录', async () => {
    const { pushAll } = await import('@/lib/sync')
    useApp.getState().addPlayer('阿伟', 'M')
    cloud.session = null

    const res = await pushAll()

    expect(cloud.upserts).toEqual([])
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toContain('登录')
  })

  it('手动刷新也一样', async () => {
    const { pullAll } = await import('@/lib/sync')
    cloud.session = null

    const res = await pullAll()

    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toContain('登录')
  })

  /*
   * 登录着用着用着会话过期，是最容易被当成「同步坏了」的情况。
   * 这时候基线不能动 —— 重新登录之后这一批还得推上去。
   */
  it('会话中途过期：这一批留着，重新登录后照样推得上去', async () => {
    await startSync()
    cloud.upserts = []

    cloud.session = null
    const p = useApp.getState().addPlayer('小林', 'F')
    await vi.advanceTimersByTimeAsync(700)
    expect(cloud.upserts).toEqual([])

    cloud.session = {}
    useApp.getState().updatePlayer(p.id, { name: '小林改了名' })
    await vi.advanceTimersByTimeAsync(700)
    expect(pushedKeys()).toContain(`player ${p.id}`)
  })
})

describe('退出登录', () => {
  it('收摊之后本机再改也不推了', async () => {
    await startSync()
    stopSync()
    cloud.upserts = []

    useApp.getState().addPlayer('阿伟', 'M')
    await vi.advanceTimersByTimeAsync(700)

    expect(cloud.upserts).toEqual([])
  })
})
