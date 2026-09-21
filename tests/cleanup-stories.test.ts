import { beforeEach, describe, expect, it } from 'vitest'
import { fake } from './edge-fakes/supabase'
import { hush, installDeno, load, type Handler } from './edge-fakes/deno'

/* ------------------------------------------------------------------ *
 * 清过期 Story 那个函数
 *
 * 和 notify-auth 那一组一样，跑的是**真的要部署上去的那份源码**
 * （supabase/functions/cleanup-stories/index.ts），只把 `npm:` 那个
 * 依赖换成假的（见 vite.config.ts 里 test.alias）。
 *
 * -------------------------------------------------------------------
 * 为什么补这一组
 *
 * 线上撞出来的（2026-09-21）：一条 Story 过了 24 小时还在，点开一片黑。
 * 查下来是 028 漏了一句 `grant select on posts to service_role` ——
 * 带 where 的 DELETE 要读那些列，于是每小时都是「照片删掉了、行删不掉」。
 *
 * 权限那一半在 029 里补了。但真正让它躲了一整天没人发现的是**这个
 * 函数自己**：它删了 0 行还是返回 200，排班那边看到的是一串绿色。
 *
 * 所以这一组钉的不是「查询对不对」（那一半在真 Postgres 上撞），
 * 而是**这个函数在出事的时候有没有喊出来**。
 * ------------------------------------------------------------------ */

/*
 * env 留一个引用，因为函数是**每次请求**去读 CLEANUP_SECRET 的 ——
 * 改这个对象就能模拟「忘了配密钥」，不用重新载入模块（载入只有一次）。
 */
const env: Record<string, string> = {
  SUPABASE_URL: 'http://fake',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  CLEANUP_SECRET: 'the-agreed-one',
}
installDeno(env)

const 清理 = () => load('../../supabase/functions/cleanup-stories/index.ts')

const call = (h: Handler, secret?: string) =>
  hush(async () => {
    const headers = new Headers()
    if (secret !== undefined) headers.set('x-cleanup-secret', secret)
    const res = await h(new Request('http://fake/f', { method: 'POST', headers }))
    return { status: res.status, body: await res.json() }
  })

const HOUR = 3600_000
const at = (ms: number) => new Date(Date.now() + ms).toISOString()

beforeEach(() => {
  fake.removed = []
  fake.storageError = null
  fake.undeletable = new Set()
  fake.pushed = []
  fake.db = {
    posts: [
      { id: 's1', author: 'u1', photos: ['u1/a.webp'], expires_at: at(-HOUR) },
      { id: 's2', author: 'u1', photos: [], expires_at: at(-2 * HOUR) },
      /* 还没过期的 Story */
      { id: 's3', author: 'u2', photos: ['u2/c.webp'], expires_at: at(5 * HOUR) },
      /* 普通朋友圈：永久，没有到期时间 */
      { id: 'p1', author: 'u2', photos: ['u2/d.webp'], expires_at: null },
    ],
  }
  /* 视图不会自己跟着表变，得说一声「这一刻它是哪几行」 */
  fake.views = {
    expired_stories: () =>
      (fake.db.posts ?? []).filter(
        (r) => r.expires_at != null && Date.parse(r.expires_at as string) <= Date.now(),
      ),
  }
})

const ids = () => (fake.db.posts ?? []).map((r) => r.id)

describe('谁调得动', () => {
  /* 预检不带密钥 —— 拿它当「密钥不对」挡回去的话，正式请求永远发不出来 */
  it('预检不用带密钥', async () => {
    const res = await hush(async () =>
      (await 清理())(new Request('http://fake/f', { method: 'OPTIONS' })),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('不带密钥调不动', async () => {
    expect((await call(await 清理())).status).toBe(401)
  })

  it('密钥不对调不动', async () => {
    expect((await call(await 清理(), 'a-wrong-guess')).status).toBe(401)
  })

  it('密钥不对的那一次，一行都没动', async () => {
    await call(await 清理(), 'a-wrong-guess')
    expect(ids()).toEqual(['s1', 's2', 's3', 'p1'])
  })

  /*
   * 忘了配 CLEANUP_SECRET 的时候**直接拒**，不是默认放行 ——
   * 放行等于把「删数据」这件事对全网开着。
   */
  it('后台没配密钥的时候，谁都调不动', async () => {
    const had = env.CLEANUP_SECRET
    delete env.CLEANUP_SECRET
    try {
      expect((await call(await 清理(), 'whatever')).status).toBe(503)
      expect(ids()).toEqual(['s1', 's2', 's3', 'p1'])
    } finally {
      env.CLEANUP_SECRET = had
    }
  })
})

describe('清掉哪些、留下哪些', () => {
  it('过期的行删掉了', async () => {
    const { status } = await call(await 清理(), env.CLEANUP_SECRET)
    expect(status).toBe(200)
    expect(ids()).toEqual(['s3', 'p1'])
  })

  /*
   * 这一条是整组里最该有的。
   *
   * 它护的是「**只删刚才读到的那几个 id**」：`.in('id', ids)` 那一句
   * 掉了的话，这个 delete 就没有任何条件 —— 所有人的朋友圈连同照片
   * 一起没了，而它每小时自己跑一次，等有人发现的时候已经没有任何
   * 东西可以恢复。（实测把那一句拿掉，这一组红 4 条。）
   *
   * 「什么算过期」不在这一层，在 028 那个视图里 —— 那一半在真
   * Postgres 上撞。
   */
  it('普通朋友圈一条都不能碰', async () => {
    await call(await 清理(), env.CLEANUP_SECRET)
    expect(ids()).toContain('p1')
    expect(fake.removed).not.toContain('u2/d.webp')
  })

  it('还没过期的 Story 也不碰', async () => {
    await call(await 清理(), env.CLEANUP_SECRET)
    expect(ids()).toContain('s3')
    expect(fake.removed).not.toContain('u2/c.webp')
  })

  it('照片是真从桶里删掉的', async () => {
    await call(await 清理(), env.CLEANUP_SECRET)
    expect(fake.removed).toEqual(['u1/a.webp'])
  })

  it('一条过期的都没有的时候，不去碰桶', async () => {
    fake.db.posts = [{ id: 'p1', author: 'u2', photos: ['u2/d.webp'], expires_at: null }]
    const { status, body } = await call(await 清理(), env.CLEANUP_SECRET)
    expect(status).toBe(200)
    expect((body as { 清了: number }).清了).toBe(0)
    expect(fake.removed).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 出事的时候要喊出来
 *
 * 这一节是 2026-09-21 那次真正的教训。前面那些就算全绿，只要这一节
 * 不成立，同样的事还会再发生一遍 —— 而且照样是一整天没人发现。
 * ------------------------------------------------------------------ */

describe('出事的时候', () => {
  /*
   * 删不动行的时候**不能返回 200**。
   *
   * 线上就是这个形状：权限不够，PostgREST 不报错、只是动了 0 行，
   * 而函数照样回一句 ok。排班列表里全是绿的，实际上每小时都在
   * 原地打转：照片删掉、行删不掉、下一轮再来一遍。
   *
   * 这个函数没有别的出口能让人知道它出事了 —— 只有状态码。
   */
  it('一行都没删掉的时候，不算成功', async () => {
    fake.undeletable.add('posts')
    const { status } = await call(await 清理(), env.CLEANUP_SECRET)
    expect(status).not.toBe(200)
    expect(status).toBe(500)
  })

  it('删不动的时候，那几行还在（没有假装清掉了）', async () => {
    fake.undeletable.add('posts')
    await call(await 清理(), env.CLEANUP_SECRET)
    expect(ids()).toEqual(['s1', 's2', 's3', 'p1'])
  })

  /*
   * 只删掉一部分不算失败。
   *
   * 作者可以在这中间自己把某一条删了 —— 那一行就已经不在了。
   * 把这种也判成失败的话，排班会时不时无缘无故变红，
   * 而真出事的那次就淹在里面了。
   */
  it('只删掉一部分算成功', async () => {
    /* 视图里多一条表里已经没有的（作者刚刚自己删掉了） */
    fake.views.expired_stories = () => [
      ...(fake.db.posts ?? []).filter(
        (r) => r.expires_at != null && Date.parse(r.expires_at as string) <= Date.now(),
      ),
      { id: '刚被作者删掉的', author: 'u1', photos: [] },
    ]
    const { status, body } = await call(await 清理(), env.CLEANUP_SECRET)
    expect(status).toBe(200)
    expect((body as { 清了: number }).清了).toBe(2)
  })

  /*
   * 删文件失败的那一轮**一行都不能删**。
   *
   * 反过来的话，行没了就再也找不到那些文件的路径了 —— 它们会永远
   * 留在桶里，而且没有任何办法知道哪些是孤儿。
   */
  it('照片删不掉的时候，行一条都不动', async () => {
    fake.storageError = '桶那边出事了'
    const { status } = await call(await 清理(), env.CLEANUP_SECRET)
    expect(status).toBe(500)
    expect(ids()).toEqual(['s1', 's2', 's3', 'p1'])
  })
})
