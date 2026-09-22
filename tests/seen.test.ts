import { beforeEach, describe, expect, it } from 'vitest'
import {
  SEEN_KEY,
  SEEN_MAX,
  SEEN_TTL_MS,
  allSeen,
  clearSeen,
  prune,
  readSeen,
  writeSeen,
} from '@/lib/seen'

/* ------------------------------------------------------------------ *
 * Story 看过没看过
 *
 * 那一圈绿边说的是「这里有你还没看过的东西」。这一块错了的样子有两种，
 * 都不报错：
 *
 *   算宽了  看了一条就把整个人标成看过 —— 剩下两条再也没人点开
 *   算窄了  看完了圈还亮着 —— 那一排永远满的，于是它什么都不说了
 * ------------------------------------------------------------------ */

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  /* 跑在 node 里，没有 localStorage —— 自己给一个，顺便能测它抛的时候 */
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

describe('这个人的算不算看过了', () => {
  const items = (...ids: string[]) => ids.map((id) => ({ id }))

  it('都看过才算看过', () => {
    expect(allSeen(items('a', 'b'), { a: 1, b: 1 })).toBe(true)
  })

  /*
   * 这一条是整块的重点：他今晚发了三条，你只看了第一条，圈还该亮着。
   * 算宽了的话剩下两条就再也没人点开了 —— 而那是真的少看了东西，
   * 不是少了一圈颜色。
   */
  it('只看了一条不算 —— 剩下那两条还没人看', () => {
    expect(allSeen(items('a', 'b', 'c'), { a: 1 })).toBe(false)
  })

  it('一条都没看当然不算', () => {
    expect(allSeen(items('a'), {})).toBe(false)
  })

  /* 他新发了一条，圈要重新亮起来 —— 这就是上面那条的另一面 */
  it('又发了一条，就又有没看过的了', () => {
    const seen = { a: 1, b: 1 }
    expect(allSeen(items('a', 'b'), seen)).toBe(true)
    expect(allSeen(items('a', 'b', '新的'), seen)).toBe(false)
  })
})

describe('不让它无限长', () => {
  const now = 1_000_000_000_000

  it('过期的扔掉', () => {
    const map = { 老的: now - SEEN_TTL_MS - 1, 新的: now - 1000 }
    expect(Object.keys(prune(map, now))).toEqual(['新的'])
  })

  /* 正好卡在 48 小时上算过期 —— Story 本身 24 小时就没了，宽松一点没坏处 */
  it('正好到点就算过期', () => {
    expect(prune({ x: now - SEEN_TTL_MS }, now)).toEqual({})
    expect(prune({ x: now - SEEN_TTL_MS + 1 }, now)).toHaveProperty('x')
  })

  it('太多了只留最近看的那几条', () => {
    const map: Record<string, number> = {}
    for (let i = 0; i < SEEN_MAX + 50; i++) map[`p${i}`] = now - i
    const out = prune(map, now)
    expect(Object.keys(out)).toHaveLength(SEEN_MAX)
    /* 留下的是最近的那一头 */
    expect(out.p0).toBeDefined()
    expect(out[`p${SEEN_MAX + 49}`]).toBeUndefined()
  })

  it('没超就一条不动', () => {
    const map = { a: now, b: now }
    expect(prune(map, now)).toEqual(map)
  })
})

describe('存取', () => {
  it('存进去读得回来', () => {
    writeSeen({ a: Date.now() })
    expect(readSeen()).toHaveProperty('a')
  })

  /* 读的时候顺手清 —— 那是唯一保证它不会无限长的时机 */
  it('读的时候把过期的清掉', () => {
    const now = Date.now()
    writeSeen({ 老的: now - SEEN_TTL_MS - 1, 新的: now })
    expect(Object.keys(readSeen(now))).toEqual(['新的'])
  })

  it('没存过就是空的', () => {
    expect(readSeen()).toEqual({})
  })

  /* 存坏了（手改过、版本对不上）不能让整屏白掉，退回「都当没看过」 */
  it('存的东西坏了就当没有', () => {
    store.set(SEEN_KEY, '{不是 json')
    expect(readSeen()).toEqual({})
  })

  /*
   * 无痕窗口、关掉了站点数据 —— 读和写都可能直接抛。
   * 这只是个「圈是绿的还是灰的」，挂了不该把别的一起带下水。
   */
  it('localStorage 整个抛也不炸', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('没得用')
      },
      setItem: () => {
        throw new Error('没得用')
      },
      removeItem: () => {
        throw new Error('没得用')
      },
    }
    expect(readSeen()).toEqual({})
    expect(() => writeSeen({ a: 1 })).not.toThrow()
    expect(() => clearSeen()).not.toThrow()
  })

  /*
   * 退出登录要清干净。换一个人登录这台手机，他看到的不该是一排已经
   * 变灰的圈 —— 那是上一个人看的。
   */
  it('清掉就是真的清掉', () => {
    writeSeen({ a: Date.now() })
    clearSeen()
    expect(readSeen()).toEqual({})
  })
})
