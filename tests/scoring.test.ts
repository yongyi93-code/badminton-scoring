import { describe, expect, it } from 'vitest'
import {
  activeGameIndex,
  addPoint,
  deriveServe,
  emptyGame,
  gameWinner,
  gamesWon,
  isGameOver,
  isGamePoint,
  matchWinner,
  nextGame,
  undoPoint,
} from '@/lib/scoring'
import { capFor, DEFAULT_RULES, type Match, type Rules, type TeamSide } from '@/types'

const rules: Rules = DEFAULT_RULES
const noWinBy2: Rules = { ...DEFAULT_RULES, winBy2: false }
const bestOf3: Rules = { ...DEFAULT_RULES, bestOf: 3 }

function doublesMatch(): Match {
  return {
    id: 'm1',
    sessionId: 's1',
    courtIndex: 0,
    type: 'doubles',
    teamA: ['a1', 'a2'],
    teamB: ['b1', 'b2'],
    games: [],
    status: 'playing',
    seq: 1,
  }
}

function singlesMatch(): Match {
  return { ...doublesMatch(), type: 'singles', teamA: ['a1'], teamB: ['b1'] }
}

/** 按逐分记录构造一局，方便测试推导 */
function withPoints(match: Match, points: TeamSide[], servingTeam: TeamSide = 'A') {
  const g = emptyGame(match, servingTeam)
  const a = points.filter((p) => p === 'A').length
  const b = points.filter((p) => p === 'B').length
  return { ...match, games: [{ ...g, a, b, points }] }
}

describe('一局的胜负判定', () => {
  it('21 分且净胜 2 分才算赢', () => {
    expect(isGameOver(21, 19, rules)).toBe(true)
    expect(isGameOver(21, 20, rules)).toBe(false)
    expect(isGameOver(22, 20, rules)).toBe(true)
    expect(isGameOver(20, 20, rules)).toBe(false)
  })

  it('20 平之后要一直打到净胜 2 分', () => {
    expect(isGameOver(23, 22, rules)).toBe(false)
    expect(isGameOver(24, 22, rules)).toBe(true)
  })

  it('29 平后 30 分封顶，先到 30 者直接胜', () => {
    expect(isGameOver(29, 29, rules)).toBe(false)
    expect(isGameOver(30, 29, rules)).toBe(true)
    expect(gameWinner(30, 29, rules)).toBe('A')
    expect(gameWinner(29, 30, rules)).toBe('B')
  })

  it('关掉净胜 2 分后 21:20 直接结束', () => {
    expect(isGameOver(21, 20, noWinBy2)).toBe(true)
  })

  it('局点提示', () => {
    expect(isGamePoint(20, 15, rules)).toBe('A')
    expect(isGamePoint(15, 20, rules)).toBe('B')
    expect(isGamePoint(20, 20, rules)).toBe(null) // 20 平谁都还差 2 分
    expect(isGamePoint(21, 20, rules)).toBe('A')
    expect(isGamePoint(29, 29, rules)).toBe('A') // 封顶分下双方都是局点
  })

  it('15 分制：14 平后打净胜 2 分，21 分封顶', () => {
    const r: Rules = { pointsToWin: 15, winBy2: true, cap: capFor(15), bestOf: 1 }
    expect(isGameOver(15, 13, r)).toBe(true)
    expect(isGameOver(15, 14, r)).toBe(false)
    expect(isGameOver(16, 14, r)).toBe(true)
    expect(isGameOver(20, 20, r)).toBe(false)
    expect(gameWinner(21, 20, r)).toBe('A')
  })

  it('11 分制：10 平后打净胜 2 分，15 分封顶', () => {
    const r: Rules = { pointsToWin: 11, winBy2: true, cap: capFor(11), bestOf: 1 }
    expect(isGameOver(11, 9, r)).toBe(true)
    expect(isGameOver(11, 10, r)).toBe(false)
    expect(isGameOver(12, 10, r)).toBe(true)
    expect(isGameOver(14, 14, r)).toBe(false)
    expect(gameWinner(15, 14, r)).toBe('A')
  })

  it('封顶分跟着每局分数走，不会让 11 分制拖到 30 分', () => {
    expect(capFor(21)).toBe(30)
    expect(capFor(15)).toBe(21)
    expect(capFor(11)).toBe(15)
    // 表里没有的分制走兜底公式，仍然大于目标分
    expect(capFor(7)).toBeGreaterThan(7)
  })

  it('封顶分低于目标分时不会卡死', () => {
    const broken: Rules = { pointsToWin: 21, winBy2: true, cap: 5, bestOf: 1 }
    expect(isGameOver(3, 1, broken)).toBe(false)
    expect(isGameOver(21, 20, broken)).toBe(false)
    expect(isGameOver(22, 20, broken)).toBe(true)
  })
})

describe('整场的胜负判定', () => {
  it('一局定胜负', () => {
    expect(matchWinner([{ a: 21, b: 15, points: null, serveInit: null }], rules)).toBe('A')
  })

  it('三局两胜要拿下两局', () => {
    const g = (a: number, b: number) => ({ a, b, points: null, serveInit: null })
    expect(matchWinner([g(21, 15)], bestOf3)).toBe(null)
    expect(matchWinner([g(21, 15), g(18, 21)], bestOf3)).toBe(null)
    expect(matchWinner([g(21, 15), g(18, 21), g(21, 19)], bestOf3)).toBe('A')
    expect(gamesWon([g(21, 15), g(18, 21), g(21, 19)], bestOf3)).toEqual({ A: 2, B: 1 })
  })

  it('下一局由上一局胜方先发球', () => {
    const m = doublesMatch()
    const started = { ...m, games: [{ ...emptyGame(m, 'A'), a: 18, b: 21 }] }
    const g2 = nextGame(started, bestOf3)
    expect(g2?.serveInit?.servingTeam).toBe('B')
  })

  it('上一局还没打完时不能开下一局', () => {
    const m = doublesMatch()
    const started = { ...m, games: [{ ...emptyGame(m, 'A'), a: 18, b: 20 }] }
    expect(nextGame(started, bestOf3)).toBe(null)
  })

  it('找出当前正在打的那一局', () => {
    const m = doublesMatch()
    const g = (a: number, b: number) => ({ a, b, points: null, serveInit: null })
    expect(activeGameIndex({ ...m, games: [g(21, 15), g(5, 3)] }, bestOf3)).toBe(1)
    expect(activeGameIndex({ ...m, games: [g(21, 15), g(21, 3)] }, bestOf3)).toBe(1)
  })
})

describe('双打发球方与站位推导', () => {
  it('开局：发球方站右区的人发球，斜对角接发', () => {
    const m = doublesMatch()
    const s = deriveServe(withPoints(m, []), 0)!
    expect(s.servingTeam).toBe('A')
    expect(s.serverId).toBe('a1')
    expect(s.serveCourt).toBe('right')
    expect(s.receiverId).toBe('b1')
  })

  it('发球方得分：同一人继续发球，本方两人交换左右区', () => {
    const m = doublesMatch()
    const s = deriveServe(withPoints(m, ['A']), 0)!
    expect(s.scoreA).toBe(1)
    expect(s.servingTeam).toBe('A')
    expect(s.serverId).toBe('a1') // 还是他发
    expect(s.serveCourt).toBe('left') // 1 分是奇数 → 左区
    expect(s.positions.A).toEqual({ right: 'a2', left: 'a1' }) // 换过位了
    expect(s.positions.B).toEqual({ right: 'b1', left: 'b2' }) // 对方不动
    expect(s.receiverId).toBe('b2')
  })

  it('接发方得分：夺得发球权，站位不变，由本方分数奇偶决定谁发', () => {
    const m = doublesMatch()
    const s = deriveServe(withPoints(m, ['A', 'B']), 0)!
    expect(s.scoreA).toBe(1)
    expect(s.scoreB).toBe(1)
    expect(s.servingTeam).toBe('B')
    expect(s.positions.B).toEqual({ right: 'b1', left: 'b2' }) // 接发得分不换位
    expect(s.serveCourt).toBe('left') // B 队 1 分 → 左区
    expect(s.serverId).toBe('b2')
    expect(s.receiverId).toBe('a1') // a1 此刻在左区
  })

  it(
    '不变式：发球者永远是发球方站在发球区的那个人',
    () => {
      // 用固定种子的伪随机跑 200 条不同的逐分序列，每加一分都校验一次不变式。
      //
      // 违规先收集、最后一次性断言：deriveServe 每次都从头重推（O(n²)），
      // 再叠加每分 4 次 expect 的话，这个测试会卡在默认 5 秒超时上下抖动，
      // CI 上会随机翻车。收集写法把 expect 从上万次降到 1 次。
      let seed = 20260810
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed / 2147483648
      }
      const m = doublesMatch()
      const violations: string[] = []

      for (let trial = 0; trial < 200; trial++) {
        const points: TeamSide[] = []
        for (let i = 0; i < 30; i++) {
          points.push(rand() < 0.5 ? 'A' : 'B')
          const s = deriveServe(withPoints(m, points), 0)!
          const where = `trial ${trial} 第 ${i + 1} 分 [${points.join('')}]`

          if (s.serverId !== s.positions[s.servingTeam][s.serveCourt]) {
            violations.push(`${where}：发球者不在发球区`)
          }
          // 接发球员必是对方站在同名发球区的人（右发右、左发左）
          const receiving = s.servingTeam === 'A' ? 'B' : 'A'
          if (s.receiverId !== s.positions[receiving][s.serveCourt]) {
            violations.push(`${where}：接发球员站位不对`)
          }
          // 每队两人始终一左一右，不会重叠
          if (
            s.positions.A.right === s.positions.A.left ||
            s.positions.B.right === s.positions.B.left
          ) {
            violations.push(`${where}：同队两人站到同一区`)
          }
        }
      }

      expect(violations).toEqual([])
    },
    15_000,
  )

  it('直接输入比分的局没有逐分记录，推导返回 null', () => {
    const m = doublesMatch()
    const direct = { ...m, games: [{ a: 21, b: 18, points: null, serveInit: null }] }
    expect(deriveServe(direct, 0)).toBe(null)
  })
})

describe('单打发球推导', () => {
  it('自己分数偶数在右区，奇数在左区', () => {
    const m = singlesMatch()
    expect(deriveServe(withPoints(m, []), 0)!.serveCourt).toBe('right')
    expect(deriveServe(withPoints(m, ['A']), 0)!.serveCourt).toBe('left')
    expect(deriveServe(withPoints(m, ['A', 'A']), 0)!.serveCourt).toBe('right')
  })

  it('接发方得分则换发球权', () => {
    const m = singlesMatch()
    const s = deriveServe(withPoints(m, ['B']), 0)!
    expect(s.servingTeam).toBe('B')
    expect(s.serverId).toBe('b1')
    expect(s.receiverId).toBe('a1')
    expect(s.serveCourt).toBe('left') // B 队 1 分
  })
})

describe('加分与撤销', () => {
  it('加分同时写进逐分记录', () => {
    const m = doublesMatch()
    let g = emptyGame(m, 'A')
    g = addPoint(g, 'A', rules)
    g = addPoint(g, 'B', rules)
    expect(g).toMatchObject({ a: 1, b: 1, points: ['A', 'B'] })
  })

  it('已结束的局不再加分', () => {
    const m = doublesMatch()
    const g = { ...emptyGame(m, 'A'), a: 21, b: 15 }
    expect(addPoint(g, 'A', rules)).toBe(g)
  })

  it('撤销回滚比分与发球状态', () => {
    const m = doublesMatch()
    let g = emptyGame(m, 'A')
    g = addPoint(g, 'A', rules)
    const before = deriveServe({ ...m, games: [g] }, 0)!
    g = addPoint(g, 'B', rules)
    g = undoPoint(g)
    const after = deriveServe({ ...m, games: [g] }, 0)!
    expect(g).toMatchObject({ a: 1, b: 0, points: ['A'] })
    expect(after).toEqual(before)
  })

  it('0 分时撤销无副作用', () => {
    const m = doublesMatch()
    const g = emptyGame(m, 'A')
    expect(undoPoint(g)).toBe(g)
  })
})
