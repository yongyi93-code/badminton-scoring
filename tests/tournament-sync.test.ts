import { beforeEach, describe, expect, it, vi } from 'vitest'

/* ------------------------------------------------------------------ *
 * 淘汰赛表上云：两台手机同时填分，谁都不能把对方那一笔盖掉
 *
 * 云端换成一张内存里的表，规矩和 supabase/032 一样：
 * 每写一次 version +1；update 带着 version 条件，对不上就一行都不改。
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown> & { id: string; version: number }
const db = new Map<string, Row>()
/** 在某一次 update 真正落库之前插一脚（模拟另一台手机抢先写了） */
let beforeUpdate: (() => void) | null = null

function builder(table: string) {
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Record<string, unknown> = {}
  const filters: [string, unknown][] = []
  const run = () => {
    if (table !== 'tournaments') return { data: null, error: null }
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v)
    if (op === 'insert') {
      const row = { ...payload, version: 0, updated_at: 'now' } as unknown as Row
      db.set(row.id, row)
      return { data: [structuredClone(row)], error: null }
    }
    if (op === 'update') {
      if (beforeUpdate) {
        const f = beforeUpdate
        beforeUpdate = null
        f()
      }
      const hit = [...db.values()].filter(match)
      for (const r of hit) {
        const next = { ...r, ...structuredClone(payload), version: r.version + 1 }
        db.set(r.id, next)
      }
      return { data: hit.map((r) => structuredClone(db.get(r.id)!)), error: null }
    }
    if (op === 'delete') {
      for (const r of [...db.values()].filter(match)) db.delete(r.id)
      return { data: null, error: null }
    }
    return { data: [...db.values()].filter(match).map((r) => structuredClone(r)), error: null }
  }
  const b = {
    select: () => b,
    insert: (p: Record<string, unknown>) => ((op = 'insert'), (payload = p), b),
    update: (p: Record<string, unknown>) => ((op = 'update'), (payload = p), b),
    delete: () => ((op = 'delete'), b),
    eq: (k: string, v: unknown) => (filters.push([k, v]), b),
    order: () => b,
    limit: () => b,
    single: async () => {
      const r = run()
      return { data: (r.data as Row[])?.[0] ?? null, error: r.error }
    },
    maybeSingle: async () => {
      const r = run()
      return { data: (r.data as Row[])?.[0] ?? null, error: r.error }
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
  }
  return b
}

vi.mock('@/lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel }
  return {
    supabase: {
      from: (t: string) => builder(t),
      channel: () => channel,
      removeChannel: async () => {},
    },
  }
})
vi.mock('@/lib/profile', () => ({ myCard: async () => ({ name: '阿明' }) }))

/* node 环境里没有 document */
;(globalThis as { document?: unknown }).document ??= {
  addEventListener: () => {},
  removeEventListener: () => {},
  visibilityState: 'visible',
}

const { useTournament, opScore } = await import('../src/store/useTournament')
const { startTournamentSync, stopTournamentSync, fromRow } =
  await import('../src/lib/tournamentSync')

const HOST = 'uid-host'
const four = ['a', 'b', 'c', 'd'].map((id) => ({ id, names: [id] }))
const store = () => useTournament.getState()
const settle = () => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  stopTournamentSync()
  db.clear()
  useTournament.setState({ list: [] })
})

async function hostCreates() {
  startTournamentSync(HOST)
  await settle()
  const t = store().create({
    name: '城中公开赛',
    date: '2026-11-07',
    doubles: false,
    entrants: four,
    mode: 'manual',
    slots: four,
  })
  await settle()
  return t
}

describe('上云', () => {
  it('建一场比赛，云端就有一行，开比赛的人是自己', async () => {
    const t = await hostCreates()
    expect(db.get(t.id)?.host_uid).toBe(HOST)
    expect(store().list[0].hostUid).toBe(HOST)
  })

  it('没登录时建的比赛，登录后自动推上去', async () => {
    const t = store().create({
      name: '离线建的',
      date: '2026-11-07',
      doubles: false,
      entrants: four,
      mode: 'seeded',
    })
    expect(db.has(t.id)).toBe(false)
    startTournamentSync(HOST)
    await settle()
    expect(db.get(t.id)?.host_uid).toBe(HOST)
  })

  it('填分会写上云端', async () => {
    const t = await hostCreates()
    store().score(t.id, 0, 0, 21, 15)
    await settle()
    const cloud = fromRow(db.get(t.id) as never)
    expect(cloud.matches.find((m) => m.round === 0 && m.index === 0)?.winner).toBe('a')
  })
})

describe('两台手机同时填分', () => {
  it('别人抢先写了另一场，我这一笔重算后写上去，两场都在', async () => {
    const t = await hostCreates()
    /* 记分员那台手机抢在我前面填了第二场 */
    beforeUpdate = () => {
      const row = db.get(t.id)!
      const theirs = opScore(0, 1, 21, 19)(fromRow(row as never))
      db.set(t.id, { ...row, matches: theirs.matches, version: row.version + 1 })
    }
    store().score(t.id, 0, 0, 21, 10)
    await settle()
    const cloud = fromRow(db.get(t.id) as never)
    const first = cloud.matches.filter((m) => m.round === 0)
    expect(first[0].winner).toBe('a')
    expect(first[1].winner).toBe('c')
    /* 决赛两边都上来了 —— 两笔都算进去了 */
    const final = cloud.matches.find((m) => m.round === 1)!
    expect([final.a, final.b]).toEqual(['a', 'c'])
    /* 本机和云端一致 */
    expect(store().list[0].matches).toEqual(cloud.matches)
  })

  it('连着填好几场，一笔都不丢', async () => {
    const t = await hostCreates()
    store().score(t.id, 0, 0, 21, 10)
    store().score(t.id, 0, 1, 21, 12)
    store().score(t.id, 1, 0, 21, 18)
    await settle()
    const cloud = fromRow(db.get(t.id) as never)
    expect(cloud.matches.find((m) => m.round === 1)?.winner).toBe('a')
    expect(cloud.version).toBe(3)
  })
})

describe('退出登录', () => {
  it('云端来的比赛从这台手机上清掉，没上云的留着', async () => {
    await hostCreates()
    stopTournamentSync()
    useTournament.setState((s) => ({
      list: [...s.list, { ...s.list[0], id: 'local-only', hostUid: undefined }],
    }))
    store().dropAllRemote()
    expect(store().list.map((x) => x.id)).toEqual(['local-only'])
  })
})
