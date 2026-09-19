import { beforeEach, describe, expect, it } from 'vitest'
import { fake } from './edge-fakes/supabase'

/* ------------------------------------------------------------------ *
 * 那两个推送函数：谁调得动它们
 *
 * 这一组和仓库里别的测试不一样 —— 它跑的是**真的要部署上去的那份
 * 源码**（supabase/functions/**），只是把 `npm:` 那两个依赖换成了假的
 * （见 vite.config.ts 里 test.alias）。
 *
 * 为什么非要这么绕：这两个函数是整个项目里唯一一处**没法在本机跑真
 * Postgres 撞出来**的权限 —— 它长在 Deno 那一侧，不在数据库策略里。
 * 而它们在这之前一条测试都没有。
 *
 * -------------------------------------------------------------------
 * 钉住的是三层，不是一层
 *
 *   1. 没登录调不动（以前挡在前面的只有网关那个开关，而它认的是
 *      「有没有项目的钥匙」，anon key 打包在前端里谁都看得到）
 *   2. 登录了也只能替自己办事 —— 消息得是你发的、申请得是你提的
 *   3. 被拒的那一次**一条推送都没发出去**（只看状态码不够：
 *      先推了再返回 403 是完全可能写出来的）
 * ------------------------------------------------------------------ */

type Handler = (req: Request) => Promise<Response>

/*
 * Deno 的壳。必须在第一次 import 那两个函数**之前**就摆好 ——
 * 它们在模块顶层就调 Deno.env.get 和 Deno.serve。
 */
let caught: Handler | null = null
;(globalThis as { Deno?: unknown }).Deno = {
  env: {
    get: (k: string) =>
      ({
        SUPABASE_URL: 'http://fake',
        SUPABASE_SERVICE_ROLE_KEY: 'svc',
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
      })[k],
  },
  serve: (h: Handler) => {
    caught = h
  },
}

/*
 * 接住 Deno.serve 交上来的那个 handler，接一次记住。
 *
 * 记住这件事不是省事：ESM 的模块只会执行一次，第二次 import 拿到的是
 * 缓存 —— Deno.serve 不会再被调一遍。不记的话除了第一条用例全会
 * 报「那个函数没有调 Deno.serve」，而那个错看着完全像函数写坏了。
 */
const handlers = new Map<string, Handler>()
async function load(path: string): Promise<Handler> {
  const had = handlers.get(path)
  if (had) return had
  caught = null
  await import(path)
  if (!caught) throw new Error('那个函数没有调 Deno.serve')
  handlers.set(path, caught)
  return caught
}

/* 这两个函数里的 console.log 是给线上排错用的，测试里全部吞掉 */
const hush = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { log, error } = console
  console.log = () => {}
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.log = log
    console.error = error
  }
}

const post = (h: Handler, body: unknown, token?: string) =>
  hush(async () => {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const res = await h(new Request('http://fake/f', { method: 'POST', headers, body: JSON.stringify(body) }))
    return res.status
  })

const options = (h: Handler) =>
  hush(async () => h(new Request('http://fake/f', { method: 'OPTIONS' })))

beforeEach(() => {
  fake.pushed = []
  fake.tokens = { 'tok-alice': 'uid-alice', 'tok-bob': 'uid-bob' }
  fake.db = {
    messages: [{ id: 'm1', sender: 'uid-alice', recipient: 'uid-bob' }],
    friendships: [
      { id: 'f1', requester: 'uid-alice', addressee: 'uid-bob', status: 'pending' },
      { id: 'f2', requester: 'uid-alice', addressee: 'uid-bob', status: 'accepted' },
    ],
    reports: [{ id: 'r1', reporter: 'uid-alice', reported: 'uid-bob', status: 'open', evidence: [{}] }],
    feedback: [{ id: 'fb1', kind: 'bug', body: '结束球局点不动', author: 'uid-alice' }],
    app_admins: [{ uid: 'uid-bob' }],
    push_subscribers: [
      { endpoint: 'ep-bob', p256dh: 'x', auth: 'y', user_id: 'uid-bob', player_id: 'p-bob', lang: 'zh' },
      { endpoint: 'ep-alice', p256dh: 'x', auth: 'y', user_id: 'uid-alice', player_id: 'p-alice', lang: 'zh' },
    ],
    records: [
      { kind: 'player', id: 'p-alice', deleted: false, data: { name: '阿丽', ownerId: 'uid-alice' } },
      { kind: 'player', id: 'p-bob', deleted: false, data: { name: '阿博', ownerId: 'uid-bob' } },
      { kind: 'player', id: 'p-ghost', deleted: false, data: { name: '没主的', ownerId: null } },
    ],
  }
})

describe('notify-social：谁调得动', () => {
  const load社 = () => load('../supabase/functions/notify-social/index.ts')

  /*
   * 预检必须在验身份之前回。
   *
   * 预检请求本来就不带 Authorization —— 拿它当「没带令牌」挡回去的话，
   * 正式请求永远发不出来，而界面上只会显示一句「Failed to send a
   * request」，函数一次都没被调到。delete-me 那次就栽在这儿。
   */
  it('预检不用带令牌，而且带着 CORS 头', async () => {
    const res = await options(await load社())
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('不带令牌调不动', async () => {
    expect(await post(await load社(), { kind: 'message', id: 'm1' })).toBe(401)
  })

  /* anon key 是打包进前端的，谁都看得到 —— 它不能算「你是谁」 */
  it('拿一把认不出人的钥匙也调不动', async () => {
    expect(await post(await load社(), { kind: 'message', id: 'm1' }, 'anon-key')).toBe(401)
  })

  it('发件人推自己发的消息，推得动', async () => {
    expect(await post(await load社(), { kind: 'message', id: 'm1' }, 'tok-alice')).toBe(200)
  })

  /*
   * 这一条是整组里最要紧的。
   *
   * 不挡的话，任何人拿着一条消息的 id 就能半夜连发一百次 —— 内容是
   * 真的（这个函数不信请求体），但「响一百次」本身就是骚扰，
   * 而被骚扰的人只能把推送整个关掉。
   */
  it('别人拿这条消息的 id 推不动', async () => {
    expect(await post(await load社(), { kind: 'message', id: 'm1' }, 'tok-bob')).toBe(403)
  })

  /* 只看状态码不够：先推了再返回 403 是完全写得出来的 */
  it('被拒的那一次一条推送都没发出去', async () => {
    await post(await load社(), { kind: 'message', id: 'm1' }, 'tok-bob')
    expect(fake.pushed).toEqual([])
  })

  it('正常那一次推给了收件人，而且不带私信内容', async () => {
    await post(await load社(), { kind: 'message', id: 'm1' }, 'tok-alice')
    expect(fake.pushed.map((p) => p.endpoint)).toEqual(['ep-bob'])
    expect(JSON.stringify(fake.pushed[0].payload)).not.toContain('结束球局')
  })

  /*
   * 申请和同意是两个方向：申请是申请人按的，同意是同意的人按的。
   * 认错方向不只是权限问题 —— 那意味着通知发给了刚刚自己按按钮的人。
   */
  it('好友申请只有申请人推得动', async () => {
    const h = await load社()
    expect(await post(h, { kind: 'friend', id: 'f1' }, 'tok-alice')).toBe(200)
    expect(await post(h, { kind: 'friend', id: 'f1' }, 'tok-bob')).toBe(403)
  })

  it('同意好友只有同意的那个人推得动', async () => {
    const h = await load社()
    expect(await post(h, { kind: 'friend', id: 'f2' }, 'tok-bob')).toBe(200)
    expect(await post(h, { kind: 'friend', id: 'f2' }, 'tok-alice')).toBe(403)
  })

  /* 举报那一支还会拍一份聊天快照，不验的话能被人反复触发 */
  it('举报只有举报人推得动', async () => {
    const h = await load社()
    expect(await post(h, { kind: 'report', id: 'r1' }, 'tok-alice')).toBe(200)
    expect(await post(h, { kind: 'report', id: 'r1' }, 'tok-bob')).toBe(403)
  })

  it('反馈只有写的那个人推得动', async () => {
    const h = await load社()
    expect(await post(h, { kind: 'feedback', id: 'fb1' }, 'tok-alice')).toBe(200)
    expect(await post(h, { kind: 'feedback', id: 'fb1' }, 'tok-bob')).toBe(403)
  })

  /*
   * 这个函数还认数据库 Webhook 那种形状（{ table, record }）。
   * 换个形状不能换掉身份这道门 —— 否则上面那些全白写了。
   */
  it('换成数据库 Webhook 那种形状，一样要验身份', async () => {
    expect(await post(await load社(), { table: 'messages', record: { id: 'm1' } })).toBe(401)
  })
})

describe('notify-session：谁调得动', () => {
  const load局 = () => load('../supabase/functions/notify-session/index.ts')
  const ask = (createdBy: string | undefined, venue = '城中') => ({
    kind: 'session',
    id: 's1',
    data: { createdBy, venue, status: 'active', maxPlayers: 8 },
  })

  it('预检不用带令牌', async () => {
    expect((await options(await load局())).status).toBe(200)
  })

  it('不带令牌调不动', async () => {
    expect(await post(await load局(), ask('p-alice'))).toBe(401)
  })

  it('本人开的局推得动', async () => {
    expect(await post(await load局(), ask('p-alice'), 'tok-alice')).toBe(200)
  })

  /*
   * 这一条是这两个函数里最该挡的一处。
   *
   * 这条通知的**每一个字**都来自请求体（球馆名、上限人数、开局的人），
   * 而它推给订阅表里的每一个人 —— 不验的话，那是一个对全网开着的
   * 广播口，谁都能让所有装了这个 App 的手机弹出任意一句话。
   */
  it('拿别人的球员 id 广播不动', async () => {
    expect(await post(await load局(), ask('p-alice'), 'tok-bob')).toBe(403)
  })

  it('被拒的那一次一条都没广播出去', async () => {
    await post(await load局(), ask('p-alice', '任意文字'), 'tok-bob')
    expect(fake.pushed).toEqual([])
  })

  /* 球员身份还没认领（ownerId 空着）的人推不动。代价写在函数注释里 */
  it('没主的球员 id 推不动', async () => {
    expect(await post(await load局(), ask('p-ghost'), 'tok-alice')).toBe(403)
  })

  it('不说是谁开的局，直接拒', async () => {
    expect(await post(await load局(), ask(undefined))).toBe(401)
  })

  it('正常那一次推给了除自己以外的人', async () => {
    await post(await load局(), ask('p-alice'), 'tok-alice')
    expect(fake.pushed.map((p) => p.endpoint)).toEqual(['ep-bob'])
  })
})
