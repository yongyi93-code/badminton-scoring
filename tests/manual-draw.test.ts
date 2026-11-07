import { describe, expect, it } from 'vitest'
import {
  buildBracket,
  defaultSlots,
  placeInSlot,
  reconcileSlots,
  slotsOf,
} from '../src/lib/bracket'
import { needsRedraw, useTournament } from '../src/store/useTournament'

/* ------------------------------------------------------------------ *
 * 手动排：不管怎么点，每个人在表上恰好一格
 * ------------------------------------------------------------------ */

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)
const valid = (slots: (string | null)[], people: string[]) => {
  const placed = slots.filter((x): x is string => x !== null)
  expect(placed.sort()).toEqual([...people].sort())
}

describe('起手式', () => {
  it('按名单顺序摆进标准位置，轮空分散开、各自对着一个人', () => {
    const s = defaultSlots(ids(5), 8)
    expect(s).toHaveLength(8)
    valid(s, ids(5))
    for (let i = 0; i < 8; i += 2) expect(s[i] !== null || s[i + 1] !== null).toBe(true)
  })
})

describe('换人 = 对调', () => {
  it('把已经摆了的人放进另一格，两格互换', () => {
    const s = ['p1', 'p2', 'p3', 'p4']
    expect(placeInSlot(s, 0, 'p3')).toEqual(['p3', 'p2', 'p1', 'p4'])
  })

  it('设成轮空就和一个空格对调；没有空格时不动', () => {
    expect(placeInSlot(['p1', null, 'p2', 'p3'], 2, null)).toEqual(['p1', 'p2', null, 'p3'])
    expect(placeInSlot(['p1', 'p2', 'p3', 'p4'], 0, null)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('随便点多少下，人数不多不少', () => {
    const people = ids(6)
    let s = defaultSlots(people, 8)
    for (let k = 0; k < 200; k++) {
      const i = (k * 7) % 8
      const pick = k % 5 === 0 ? null : people[(k * 3) % 6]
      s = placeInSlot(s, i, pick)
      valid(s, people)
    }
  })
})

describe('名单变了，格子跟上', () => {
  it('删人：那一格变空，其余原地不动', () => {
    const s = reconcileSlots(['p1', 'p2', 'p3', 'p4'], ['p1', 'p2', 'p4'], 4)
    expect(s).toEqual(['p1', 'p2', null, 'p4'])
  })

  it('加人：优先填进对面有人的空格', () => {
    const s = reconcileSlots(
      ['p1', null, null, null, 'p2', 'p3', null, 'p4'],
      ['p1', 'p2', 'p3', 'p4', 'p5'],
      8,
    )
    expect(s[1]).toBe('p5')
  })

  it('表大小变了就重新起手，人一个不少', () => {
    const s = reconcileSlots(['p1', 'p2', 'p3', 'p4'], ids(5), 8)
    expect(s).toHaveLength(8)
    valid(s, ids(5))
  })

  it('名单没变时原样返回', () => {
    const s = ['p3', 'p1', null, 'p2']
    expect(reconcileSlots(s, ['p1', 'p2', 'p3'], 4)).toEqual(s)
  })
})

describe('建表与回去改', () => {
  const team = (id: string) => ({ id, names: [`${id}甲`, `${id}乙`] })
  const people = ['a', 'b', 'c', 'd'].map(team)
  const byId = new Map(people.map((e) => [e.id, e]))
  const slots = ['a', 'c', 'b', 'd'].map((id) => byId.get(id)!)

  it('第一轮就是摆的那样', () => {
    useTournament.setState({ list: [] })
    const t = useTournament.getState().create({
      name: '手动赛',
      date: '2026-11-07',
      doubles: true,
      entrants: people,
      mode: 'manual',
      slots,
    })
    expect(slotsOf(t.matches)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('格子换了才重排，只改名字不重排', () => {
    const before = {
      entrants: people,
      mode: 'manual' as const,
      matches: buildBracket(slots),
    }
    expect(
      needsRedraw(before, {
        entrants: people,
        mode: 'manual',
        slots: ['a', 'c', 'b', 'd'],
      }),
    ).toBe(false)
    expect(
      needsRedraw(before, {
        entrants: people,
        mode: 'manual',
        slots: ['a', 'b', 'c', 'd'],
      }),
    ).toBe(true)
  })

  it('改了对阵存回去，表跟着换', () => {
    useTournament.setState({ list: [] })
    const t = useTournament.getState().create({
      name: '手动赛',
      date: '2026-11-07',
      doubles: true,
      entrants: people,
      mode: 'manual',
      slots,
    })
    const swapped = ['a', 'b', 'c', 'd'].map((id) => byId.get(id)!)
    useTournament.getState().update(t.id, {
      name: '手动赛',
      date: '2026-11-07',
      doubles: true,
      entrants: people,
      mode: 'manual',
      slots: swapped,
    })
    expect(slotsOf(useTournament.getState().list[0].matches)).toEqual(['a', 'b', 'c', 'd'])
  })
})
