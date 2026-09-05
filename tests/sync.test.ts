import { describe, expect, it } from 'vitest'
import { diffRows, keyOf, type Row } from '@/lib/sync'

/*
 * 同步里最容易写错、后果最严重的就是这个差异计算：
 * 少推一条 = 别人看不到；多推一条 = 白白刷新 updated_at；
 * 删除算错 = 别人手机上那条永远删不掉，或者好端端的记录被抹掉。
 *
 * 推送链路要连数据库才跑得起来，但这一段是纯函数，可以直接测。
 */

const CLUB = 'club_test'

const row = (kind: Row['kind'], id: string, data: unknown): [string, Row] => [
  keyOf(kind, id),
  { kind, id, data, deleted: false, club_id: CLUB },
]

const baselineOf = (rows: [string, Row][]) =>
  new Map(rows.map(([k, r]) => [k, JSON.stringify(r.data)]))

describe('算差异：哪些该推上去', () => {
  it('什么都没改就一条都不推', () => {
    const rows: [string, Row][] = [
      row('player', 'p1', { id: 'p1', name: '阿伟' }),
      row('match', 'm1', { id: 'm1', games: [{ a: 21, b: 15 }] }),
    ]
    expect(diffRows(new Map(rows), baselineOf(rows), CLUB)).toEqual([])
  })

  it('改了内容才推，没改的那些不跟着一起推', () => {
    const before: [string, Row][] = [
      row('player', 'p1', { id: 'p1', name: '阿伟' }),
      row('player', 'p2', { id: 'p2', name: '小林' }),
    ]
    const after: [string, Row][] = [
      row('player', 'p1', { id: 'p1', name: '阿伟' }),
      row('player', 'p2', { id: 'p2', name: '小林改了名' }),
    ]
    const out = diffRows(new Map(after), baselineOf(before), CLUB)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('p2')
    expect(out[0].deleted).toBe(false)
  })

  it('新增的会推', () => {
    const before: [string, Row][] = [row('player', 'p1', { id: 'p1' })]
    const after: [string, Row][] = [
      row('player', 'p1', { id: 'p1' }),
      row('player', 'p2', { id: 'p2' }),
    ]
    const out = diffRows(new Map(after), baselineOf(before), CLUB)
    expect(out.map((r) => r.id)).toEqual(['p2'])
  })

  /*
   * 删除必须是软删除。真 DELETE 出去，别人的手机下次拉取
   * 只会看到「这条不在结果里」，分不出是被删了还是没同步到，
   * 于是它本地那份永远留着。
   */
  it('本机删掉的推成 deleted = true，而不是从推送里消失', () => {
    const before: [string, Row][] = [
      row('session', 's1', { id: 's1' }),
      row('session', 's2', { id: 's2' }),
    ]
    const after: [string, Row][] = [row('session', 's1', { id: 's1' })]
    const out = diffRows(new Map(after), baselineOf(before), CLUB)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'session', id: 's2', deleted: true })
  })

  it('同一轮里既有改动又有删除，两样都推', () => {
    const before: [string, Row][] = [
      row('match', 'm1', { id: 'm1', score: 10 }),
      row('match', 'm2', { id: 'm2' }),
    ]
    const after: [string, Row][] = [row('match', 'm1', { id: 'm1', score: 21 })]
    const out = diffRows(new Map(after), baselineOf(before), CLUB)
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.id === 'm1')?.deleted).toBe(false)
    expect(out.find((r) => r.id === 'm2')?.deleted).toBe(true)
  })

  /*
   * 不同类型的 id 撞车是完全可能的（球员 id 和比赛 id 各生成各的），
   * 所以键必须带上 kind。这条要是错了，一个球员会把一场比赛顶掉。
   */
  it('不同类型的同名 id 互不干扰', () => {
    const before: [string, Row][] = [
      row('player', 'x', { id: 'x', name: '阿伟' }),
      row('match', 'x', { id: 'x', score: 1 }),
    ]
    const after: [string, Row][] = [
      row('player', 'x', { id: 'x', name: '阿伟' }),
      row('match', 'x', { id: 'x', score: 2 }),
    ]
    const out = diffRows(new Map(after), baselineOf(before), CLUB)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'match', id: 'x' })
  })

  it('基线是空的时候，所有东西都算新增 —— 这是开局第一次推', () => {
    const rows: [string, Row][] = [
      row('player', 'p1', { id: 'p1' }),
      row('session', 's1', { id: 's1' }),
      row('match', 'm1', { id: 'm1' }),
      row('avatar', 'p1', { playerId: 'p1' }),
    ]
    const out = diffRows(new Map(rows), new Map(), CLUB)
    expect(out).toHaveLength(4)
    expect(out.every((r) => !r.deleted)).toBe(true)
  })

  it('本机清空时，基线里每一条都推成删除，不会漏', () => {
    const before: [string, Row][] = [
      row('player', 'p1', { id: 'p1' }),
      row('player', 'p2', { id: 'p2' }),
      row('match', 'm1', { id: 'm1' }),
    ]
    const out = diffRows(new Map(), baselineOf(before), CLUB)
    expect(out).toHaveLength(3)
    expect(out.every((r) => r.deleted)).toBe(true)
    expect(out.map((r) => keyOf(r.kind, r.id)).sort()).toEqual(
      ['match m1', 'player p1', 'player p2'],
    )
  })

  it('id 里带空格也能正确还原 —— 键是用空格拼的', () => {
    const before: [string, Row][] = [row('player', 'a b c', { id: 'a b c' })]
    const out = diffRows(new Map(), baselineOf(before), CLUB)
    expect(out[0]).toMatchObject({ kind: 'player', id: 'a b c', deleted: true })
  })
})
