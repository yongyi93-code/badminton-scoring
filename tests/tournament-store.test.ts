import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTournament, entrantMap, needsRedraw, playedCount } from '../src/store/useTournament'
import { champion, type Entrant } from '../src/lib/bracket'

/* ------------------------------------------------------------------ *
 * 比赛这份存档
 *
 * bracket.ts 那一层已经测死了「表怎么排」。这里只管存档自己的事：
 * 建一场、填分、重抽、删掉，以及那条最容易被忘记的 ——
 * **换球群不该把办到一半的比赛冲掉**。
 * ------------------------------------------------------------------ */

const team = (id: string, seed?: number): Entrant => ({
  id,
  names: [`${id}甲`, `${id}乙`],
  ...(seed === undefined ? {} : { seed }),
})

const reset = () => useTournament.setState({ list: [] })
const store = () => useTournament.getState()

beforeEach(() => {
  reset()
  try {
    localStorage.clear()
  } catch {
    // node 环境里可能没有
  }
})

const four = [team('a', 1), team('b', 2), team('c'), team('d')]

const draft = (over: Partial<Parameters<ReturnType<typeof store>['create']>[0]> = {}) => ({
  name: '城中公开赛',
  date: '2026-09-25',
  doubles: true,
  entrants: four,
  mode: 'seeded' as const,
  ...over,
})

describe('建一场比赛', () => {
  it('建完就有一张排好的表', () => {
    const t = store().create(draft())
    expect(t.size).toBe(4)
    /* 4 人表 = 半决赛 2 场 + 决赛 1 场 */
    expect(t.matches).toHaveLength(3)
    expect(store().list).toHaveLength(1)
  })

  it('人数不是 2 的幂，表往上取，多出来的是轮空', () => {
    const t = store().create(draft({ entrants: [team('a', 1), team('b', 2), team('c')] }))
    expect(t.size).toBe(4)
    /* 一号种子那一场是轮空 —— 建完就已经有胜者，不用打 */
    const byes = t.matches.filter((m) => m.round === 0 && m.winner)
    expect(byes).toHaveLength(1)
  })

  it('比赛名字前后的空格会去掉', () => {
    const t = store().create(draft({ name: '  春季赛  ' }))
    expect(t.name).toBe('春季赛')
  })

  it('新的排在最前面 —— 列表是按办的时间倒着看的', () => {
    store().create(draft({ name: '第一场' }))
    store().create(draft({ name: '第二场' }))
    expect(store().list.map((t) => t.name)).toEqual(['第二场', '第一场'])
  })

  it('每一场有自己的 id', () => {
    const a = store().create(draft())
    const b = store().create(draft())
    expect(a.id).not.toBe(b.id)
  })
})

describe('填分', () => {
  it('填完一场，胜者进下一轮', () => {
    const t = store().create(draft())
    const semi = store().list[0].matches.filter((m) => m.round === 0)
    store().score(t.id, 0, 0, 21, 15)

    const after = store().list[0].matches
    const final = after.find((m) => m.round === 1)!
    expect(final.a).toBe(semi[0].a)
  })

  it('改了上游的结果，决赛上站的人跟着换，旧比分作废', () => {
    const t = store().create(draft())
    store().score(t.id, 0, 0, 21, 15)
    store().score(t.id, 0, 1, 21, 10)
    store().score(t.id, 1, 0, 21, 19)
    expect(champion(store().list[0].matches)).toBeTruthy()

    /* 半决赛第一场敲错了，改过来 */
    store().score(t.id, 0, 0, 15, 21)

    const final = store().list[0].matches.find((m) => m.round === 1)!
    /*
     * 决赛换了人，所以那 21:19 不能留着 —— 它是对着另一个人打出来的。
     * 冠军也跟着没了：决赛还没打。
     */
    expect(final.scoreA).toBeUndefined()
    expect(final.winner).toBeUndefined()
    expect(champion(store().list[0].matches)).toBeNull()
  })

  it('只动被点的那一场，别的比赛不受影响', () => {
    const one = store().create(draft({ name: 'A 赛' }))
    store().create(draft({ name: 'B 赛' }))
    store().score(one.id, 0, 0, 21, 15)

    const other = store().list.find((t) => t.name === 'B 赛')!
    expect(other.matches.every((m) => m.scoreA === undefined)).toBe(true)
  })
})

describe('重抽签', () => {
  it('重抽之后整张表是干净的 —— 比分全没了', () => {
    const t = store().create(draft())
    store().score(t.id, 0, 0, 21, 15)
    expect(store().list[0].matches.some((m) => m.scoreA !== undefined)).toBe(true)

    store().redraw(t.id, 'random')
    expect(store().list[0].matches.some((m) => m.scoreA !== undefined)).toBe(false)
    expect(store().list[0].mode).toBe('random')
  })

  it('人还是那些人', () => {
    const t = store().create(draft())
    store().redraw(t.id, 'random')
    expect(store().list[0].entrants.map((e) => e.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('删掉和改名', () => {
  it('删掉的那场不在了，别的还在', () => {
    const a = store().create(draft({ name: 'A' }))
    store().create(draft({ name: 'B' }))
    store().remove(a.id)
    expect(store().list.map((t) => t.name)).toEqual(['B'])
  })

  it('改名只改名字，表不动', () => {
    const t = store().create(draft())
    const before = store().list[0].matches
    store().rename(t.id, '秋季赛')
    expect(store().list[0].name).toBe('秋季赛')
    expect(store().list[0].matches).toEqual(before)
  })
})

describe('换球群', () => {
  it('换一个球群，办到一半的比赛还在', async () => {
    /*
     * 换群 = 把本机那份球局数据整个清掉（useApp.setClubId 里那一段）。
     * 而比赛根本不属于任何球群 —— 来打公开赛的人多半不在你群里。
     */
    const { useApp } = await import('../src/store/useApp')
    const t = store().create(draft())
    store().score(t.id, 0, 0, 21, 15)

    useApp.getState().setClubId('club_另一个群')

    expect(store().list).toHaveLength(1)
    expect(store().list[0].matches.find((m) => m.round === 0 && m.index === 0)?.scoreA).toBe(21)
  })

  it('比赛写在自己那个 localStorage 键下，不占球局那一份', async () => {
    /*
     * 上面那条只证明了**内存里**没被清掉。真正会丢数据的是硬盘那一层：
     * 两份共用一个键的话，后写的一份会整个盖掉前一份 —— 关掉 App
     * 再打开，比赛或者球局其中一份就没了，而这种丢法是当场看不出来的。
     *
     * node 环境里没有 localStorage，所以这里自己造一个，再把两份 store
     * 重新 import 一遍，让 persist 真的写进去。
     */
    const mem = new Map<string, string>()
    const fake = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size
      },
    }
    /* zustand 的 persist 认的是 window.localStorage，不是 globalThis 上那个 */
    vi.stubGlobal('window', { localStorage: fake })
    vi.stubGlobal('localStorage', fake)
    vi.resetModules()

    const { useTournament: fresh } = await import('../src/store/useTournament')
    const { useApp, STORAGE_KEY } = await import('../src/store/useApp')
    fresh.getState().create(draft())
    useApp.getState().setClubId('club_某个群')

    const keys = [...mem.keys()]
    const mine = keys.filter((k) => k !== STORAGE_KEY)
    expect(mine).toHaveLength(1)
    /* 比赛在自己的键里，而那个键不是球局那一份 */
    expect(mem.get(mine[0])).toContain('城中公开赛')
    expect(mem.get(STORAGE_KEY) ?? '').not.toContain('城中公开赛')

    vi.unstubAllGlobals()
    vi.resetModules()
  })
})

describe('entrantMap', () => {
  it('按 id 查得到人 —— 画表时每一格都要查一次', () => {
    const t = store().create(draft())
    const map = entrantMap(t)
    expect(map.get('a')?.names).toEqual(['a甲', 'a乙'])
    expect(map.get('没这个人')).toBeUndefined()
  })
})

describe('回去改名单', () => {
  /*
   * 这一条是用户提的：抽完签就改不了了。可球馆里最常见的三件事
   * 恰恰都发生在抽完之后 —— 名字打错了、有人临时退赛、有人补上。
   *
   * 关键在于**改名字不该动到赛表**：为了一个错别字把打完的比分
   * 全清掉，没人受得了。
   */
  const rename = (t: ReturnType<typeof store>['list'][number], id: string, name: string) =>
    t.entrants.map((e) => (e.id === id ? { ...e, names: [name] } : e))

  it('只改名字：赛表和比分一个都不动', () => {
    const made = store().create(draft())
    store().score(made.id, 0, 0, 21, 15)
    const before = store().list[0]
    const beforeMatches = before.matches

    store().update(made.id, {
      name: before.name,
      date: before.date,
      doubles: before.doubles,
      mode: before.mode,
      entrants: rename(before, 'a', '改过的名字'),
    })

    const after = store().list[0]
    expect(after.matches).toEqual(beforeMatches)
    expect(playedCount(after)).toBe(1)
    /* 新名字是通过 entrants 查出来的，赛表上那一格自然就跟着变了 */
    expect(entrantMap(after).get('a')?.names).toEqual(['改过的名字'])
  })

  it('加一个人：表重排，比分作废', () => {
    const made = store().create(draft())
    store().score(made.id, 0, 0, 21, 15)
    const before = store().list[0]

    store().update(made.id, {
      name: before.name,
      date: before.date,
      doubles: before.doubles,
      mode: before.mode,
      entrants: [...before.entrants, team('e')],
    })

    const after = store().list[0]
    expect(after.entrants).toHaveLength(5)
    expect(after.size).toBe(8)
    expect(playedCount(after)).toBe(0)
  })

  it('删一个人：表重排', () => {
    const made = store().create(draft())
    const before = store().list[0]
    store().update(made.id, {
      name: before.name,
      date: before.date,
      doubles: before.doubles,
      mode: before.mode,
      entrants: before.entrants.filter((e) => e.id !== 'd'),
    })
    const after = store().list[0]
    expect(after.entrants.map((e) => e.id)).not.toContain('d')
    expect(after.size).toBe(4)
  })

  it('比赛名字、日期照样改得动', () => {
    const made = store().create(draft())
    const before = store().list[0]
    store().update(made.id, {
      name: '  改过的比赛名  ',
      date: '2026-12-01',
      doubles: before.doubles,
      mode: before.mode,
      entrants: before.entrants,
    })
    const after = store().list[0]
    expect(after.name).toBe('改过的比赛名')
    expect(after.date).toBe('2026-12-01')
  })

  it('别的比赛不受影响', () => {
    const one = store().create(draft({ name: 'A 赛' }))
    store().create(draft({ name: 'B 赛' }))
    const before = store().list.find((x) => x.id === one.id)!
    store().update(one.id, {
      name: '改了',
      date: before.date,
      doubles: before.doubles,
      mode: before.mode,
      entrants: before.entrants,
    })
    expect(store().list.find((x) => x.name === 'B 赛')).toBeTruthy()
  })
})

describe('要不要重排', () => {
  const es = (spec: [string, number?][]) =>
    spec.map(([id, seed]) => ({ id, names: [id], ...(seed === undefined ? {} : { seed }) }))

  const seeded = { mode: 'seeded' as const }

  it('名字变了不用重排 —— needsRedraw 根本不看名字', () => {
    const before = { ...seeded, entrants: es([['a', 1], ['b', 2]]) }
    const after = {
      ...seeded,
      entrants: [
        { id: 'a', names: ['完全不同的名字'], seed: 1 },
        { id: 'b', names: ['也不一样'], seed: 2 },
      ],
    }
    expect(needsRedraw(before, after)).toBe(false)
  })

  it('名单顺序挪一挪，不算变 —— 抽签结果不受顺序影响', () => {
    const before = { ...seeded, entrants: es([['a', 1], ['b'], ['c']]) }
    const after = { ...seeded, entrants: es([['c'], ['a', 1], ['b']]) }
    expect(needsRedraw(before, after)).toBe(false)
  })

  it('加人要重排', () => {
    expect(
      needsRedraw(
        { ...seeded, entrants: es([['a'], ['b']]) },
        { ...seeded, entrants: es([['a'], ['b'], ['c']]) },
      ),
    ).toBe(true)
  })

  it('换人要重排（人数一样，但不是同一批人）', () => {
    expect(
      needsRedraw(
        { ...seeded, entrants: es([['a'], ['b']]) },
        { ...seeded, entrants: es([['a'], ['c']]) },
      ),
    ).toBe(true)
  })

  it('动了种子号要重排', () => {
    expect(
      needsRedraw(
        { ...seeded, entrants: es([['a', 1], ['b', 2]]) },
        { ...seeded, entrants: es([['a', 2], ['b', 1]]) },
      ),
    ).toBe(true)
  })

  it('换了排签方式要重排', () => {
    const list = es([['a'], ['b']])
    expect(
      needsRedraw({ mode: 'seeded', entrants: list }, { mode: 'random', entrants: list }),
    ).toBe(true)
  })
})
