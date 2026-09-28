import { describe, expect, it } from 'vitest'
import {
  addRow,
  canRemove,
  dropRow,
  emptyRow,
  ensureTail,
  filledRows,
  hasRoom,
  isBlank,
  type EntryRow,
} from '@/lib/entryRows'

/* ------------------------------------------------------------------ *
 * 报名名单：底下永远有一行空的等着填
 *
 * 这一条是用户真被卡住之后才写下来的。他填了 4 队，把底下那行空的
 * 用 ✕ 删掉了，然后就再也加不了第 5 队 —— 屏幕上一张好好的名单，
 * 没有任何东西告诉他路已经没了。
 *
 * 所以这里不测「行数对不对」，测那句话本身。
 * ------------------------------------------------------------------ */

const row = (a = '', b = '', seed = ''): EntryRow => ({ ...emptyRow(), a, b, seed })
const start = () => [emptyRow()]

describe('空行', () => {
  it('三个框都空才算空行', () => {
    expect(isBlank(row())).toBe(true)
    expect(isBlank(row('阿伟'))).toBe(false)
    expect(isBlank(row('', '小明'))).toBe(false)
    /* 只填了种子号也不算空 —— 那是人敲进去的东西，不能当没看见 */
    expect(isBlank(row('', '', '1'))).toBe(false)
  })
})

describe('自动续行', () => {
  it('在最后一行打字，底下多一行', () => {
    const rows = ensureTail(start(), 0)
    expect(rows).toHaveLength(2)
    expect(isBlank(rows[1])).toBe(true)
  })

  it('在中间那行打字，不多给', () => {
    const rows = [row('阿伟'), emptyRow()]
    expect(ensureTail(rows, 0)).toHaveLength(2)
  })

  it('一路填下去，底下一直空着一行', () => {
    let rows = start()
    for (let i = 0; i < 20; i++) {
      rows = rows.map((r, k) => (k === i ? row(`第${i}人`) : r))
      rows = ensureTail(rows, i)
      expect(hasRoom(rows)).toBe(true)
    }
    expect(filledRows(rows, false)).toHaveLength(20)
  })
})

describe('明着加一行', () => {
  it('底下没空行时，加一行', () => {
    expect(addRow([row('阿伟')])).toHaveLength(2)
  })

  it('底下已经空着时，不再堆一行', () => {
    /*
     * 承诺是「按完底下有地方填」，不是「行数加一」。
     * 再堆一行只会在名单中间留下一串空行。
     */
    const rows = [row('阿伟'), emptyRow()]
    expect(addRow(rows)).toHaveLength(2)
  })

  it('不管什么时候按，按完底下都有地方填', () => {
    for (const rows of [start(), [row('阿伟')], [row('阿伟'), emptyRow()], []]) {
      expect(hasRoom(addRow(rows))).toBe(true)
    }
  })
})

describe('删一行', () => {
  it('最后那行空的删不得 —— 删了就再也加不了人', () => {
    const rows = [row('阿伟'), emptyRow()]
    expect(canRemove(rows, 1)).toBe(false)
    expect(dropRow(rows, 1)).toHaveLength(2)
  })

  it('填了东西的行删得掉', () => {
    const rows = [row('阿伟'), row('小明'), emptyRow()]
    expect(canRemove(rows, 0)).toBe(true)
    expect(dropRow(rows, 0).map((r) => r.a)).toEqual(['小明', ''])
  })

  it('中间那些空行删得掉 —— 它们不是那行「等着填的」', () => {
    const rows = [row('阿伟'), emptyRow(), row('小明'), emptyRow()]
    expect(canRemove(rows, 1)).toBe(true)
    expect(dropRow(rows, 1)).toHaveLength(3)
  })

  it('只剩一行时不给删', () => {
    expect(canRemove(start(), 0)).toBe(false)
    expect(dropRow(start(), 0)).toHaveLength(1)
  })
})

describe('那句话本身：怎么折腾都还有地方填', () => {
  it('用户踩的那一步：填满之后想删掉底下那行空的', () => {
    /* 4 队 + 1 行空的 */
    let rows: EntryRow[] = start()
    for (let i = 0; i < 4; i++) {
      rows = rows.map((r, k) => (k === i ? row(`甲${i}`, `乙${i}`) : r))
      rows = ensureTail(rows, i)
    }
    expect(filledRows(rows, true)).toHaveLength(4)

    /* 去点那行空的的 ✕ —— 现在点不到，就算点了也不掉 */
    const tail = rows.length - 1
    expect(canRemove(rows, tail)).toBe(false)
    rows = dropRow(rows, tail)
    expect(hasRoom(rows)).toBe(true)
  })

  it('乱删一通之后，按一下「加一队」总能接着填', () => {
    let rows: EntryRow[] = start()
    for (let i = 0; i < 6; i++) {
      rows = rows.map((r, k) => (k === i ? row(`人${i}`) : r))
      rows = ensureTail(rows, i)
    }
    /* 从后往前一行行删，每一步都得还有出路 */
    for (let guard = 0; guard < 20; guard++) {
      const i = rows.length - 1
      const before = rows.length
      rows = dropRow(rows, i)
      if (rows.length === before) rows = dropRow(rows, Math.max(0, i - 1))
      if (rows.length === before) break
      expect(hasRoom(addRow(rows))).toBe(true)
    }
    expect(hasRoom(addRow(rows))).toBe(true)
  })
})

describe('算人数', () => {
  it('空行不算', () => {
    expect(filledRows([row('阿伟'), emptyRow()], false)).toHaveLength(1)
  })

  it('双打：只填了队员二也算这一队报了名', () => {
    expect(filledRows([row('', '小明')], true)).toHaveLength(1)
  })

  it('单打：队员二那一格当不存在', () => {
    expect(filledRows([row('', '小明')], false)).toHaveLength(0)
  })

  it('只填了种子号、没填名字 —— 不算一队', () => {
    expect(filledRows([row('', '', '1')], true)).toHaveLength(0)
  })
})

describe('每一行的身份', () => {
  it('新生的行各有各的 id', () => {
    const a = emptyRow()
    const b = emptyRow()
    expect(a.id).toBeTruthy()
    expect(a.id).not.toBe(b.id)
  })

  it('改名字不动 id —— 赛表认的是 id，名字只是贴上去的标签', () => {
    const r = row('阿伟')
    const renamed = { ...r, a: '阿明' }
    expect(renamed.id).toBe(r.id)
  })
})
