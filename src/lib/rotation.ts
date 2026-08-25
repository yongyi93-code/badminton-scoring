import type { Match, MatchType, PairingMode, Player } from '@/types'

/* ------------------------------------------------------------------ *
 * 公平轮转配对
 *
 * 纯随机会产生三种抱怨，这里逐条用规则挡掉：
 *   1. 有人连坐冷板凳  → 「已打场数最少的人必须上场」是硬约束，不是罚分
 *   2. 同一对搭档反复凑 → 近几场同队过的组合重罚
 *   3. 高手扎堆打菜鸟   → 按 MMR 罚分，两种口径二选一：
 *      均衡（默认）一场里高分带低分，两队平均分尽量相等；
 *      同级        挑水平接近的人凑一场，高分打高分、低分打低分。
 * ------------------------------------------------------------------ */

/** 回避重复搭档/对手时往回看几场 */
const DEFAULT_LOOKBACK = 3

/** 同等已打场数的候选人最多取几个进搜索池，控制组合爆炸 */
const MAX_OPTIONAL_POOL = 10

const W = {
  /** 近期同队过（每次） */
  recentPartner: 100,
  /** 近期对阵过（每次） */
  recentOpponent: 25,
  /** 历史累计同队次数（每次），做长期搭档多样性的微调 */
  totalPartner: 6,
  /** 历史累计对阵次数（每次） */
  totalOpponent: 2,
  /**
   * 两队平均 MMR 每差 1 分。用平均而不是求和，单打双打的尺度才一致。
   *
   * 这个数原来是 0.4，等于形同虚设：两队平均差 100 分才值 40 分代价，
   * 还不如「近期同队过一次」（100）贵，于是实力平衡从来没赢过搭档多样性，
   * 排出来的场看着就是没规律。2.0 让 100 分差 = 200 代价，压过一次重复搭档，
   * 实力这条才真的说了算。
   */
  mmrGap: 2,
  /**
   * 同级模式专用：一场里最高分和最低分每差 1 分。
   * 光让两队平均相等是不够的 —— 300+10 对 290+20 两队平均只差 0，
   * 但那个 10 分的上去就是挨打。要高打高、低打低，就得直接罚这个跨度。
   */
  mmrSpread: 2,
  /** 休息轮数：等得越久越该上，每轮减分 */
  restBonus: 12,
  /** 随机抖动上限，避免每晚排出一模一样的顺序 */
  jitter: 15,
}

export type PlayerLoad = {
  playerId: string
  /** 本球局已打（含正在打与已排队）的场数 */
  games: number
  /** 距离上次上场过了几场比赛；从没上过场则等于本局总场数 */
  restRounds: number
  /** 最后一次上场的比赛序号，没上过为 0 */
  lastSeq: number
}

export type Pairing = {
  teamA: string[]
  teamB: string[]
  type: MatchType
}

export type RotationInput = {
  /** 今晚出席的球员 */
  attending: Player[]
  /** 本球局所有比赛（排队中、正在打、已结束都要传） */
  matches: Match[]
  /** 已在场上或已排进队列的球员 id，不能重复选 */
  busyIds?: string[]
  type: MatchType
  /** 临时不参与排场（受伤、去买水） */
  excludeIds?: string[]
  /** 必须被排进这一场的球员 */
  mustInclude?: string[]
  /**
   * 每个人的 MMR，用来做两队实力平衡。
   * 由调用方从「所有球局」算好传进来 —— MMR 是跨球局的整体水平，
   * 只看今晚这一场的战绩配不准。缺省当 0，等于不做平衡。
   */
  mmrById?: Map<string, number>
  /**
   * 怎么用 MMR 配对，缺省 'balanced'。
   * 两种模式都不动「已打场数最少的人必须上场」这条硬约束。
   */
  pairingMode?: PairingMode
  lookback?: number
  /** 注入随机源便于测试 */
  random?: () => number
}

export type RotationOutcome = {
  pairing: Pairing | null
  /** 排不出来时给界面一句人话解释 */
  reason?: string
}

/* ------------------------------------------------------------------ *
 * 负载统计
 * ------------------------------------------------------------------ */

const inMatch = (m: Match, playerId: string) =>
  m.teamA.includes(playerId) || m.teamB.includes(playerId)

/** 每人在本球局的已打场数与休息轮数，按「该谁上场」的优先度排序 */
export function playerLoads(
  attending: Player[],
  matches: Match[],
): PlayerLoad[] {
  const ordered = [...matches].sort((a, b) => a.seq - b.seq)
  const total = ordered.length

  const loads = attending.map((p) => {
    let games = 0
    let lastSeq = 0
    for (const m of ordered) {
      if (inMatch(m, p.id)) {
        games++
        lastSeq = m.seq
      }
    }
    return {
      playerId: p.id,
      games,
      lastSeq,
      restRounds: lastSeq === 0 ? total : total - lastSeq,
    }
  })

  return loads.sort(
    (a, b) => a.games - b.games || b.restRounds - a.restRounds,
  )
}

/* ------------------------------------------------------------------ *
 * 搭档/对手历史
 * ------------------------------------------------------------------ */

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

type PairCounts = {
  recentPartner: Map<string, number>
  recentOpponent: Map<string, number>
  totalPartner: Map<string, number>
  totalOpponent: Map<string, number>
}

const bump = (map: Map<string, number>, key: string) =>
  map.set(key, (map.get(key) ?? 0) + 1)

export function pairCounts(matches: Match[], lookback: number): PairCounts {
  const counts: PairCounts = {
    recentPartner: new Map(),
    recentOpponent: new Map(),
    totalPartner: new Map(),
    totalOpponent: new Map(),
  }
  const ordered = [...matches].sort((a, b) => a.seq - b.seq)
  const recentFrom = Math.max(0, ordered.length - lookback)

  ordered.forEach((m, idx) => {
    const isRecent = idx >= recentFrom
    for (const team of [m.teamA, m.teamB]) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const k = pairKey(team[i], team[j])
          bump(counts.totalPartner, k)
          if (isRecent) bump(counts.recentPartner, k)
        }
      }
    }
    for (const x of m.teamA) {
      for (const y of m.teamB) {
        const k = pairKey(x, y)
        bump(counts.totalOpponent, k)
        if (isRecent) bump(counts.recentOpponent, k)
      }
    }
  })

  return counts
}

/* ------------------------------------------------------------------ *
 * 组合枚举
 * ------------------------------------------------------------------ */

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const out: T[][] = []
  const walk = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc])
      return
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i])
      walk(i + 1, acc)
      acc.pop()
    }
  }
  walk(0, [])
  return out
}

/** 把 4 人分成两队的三种方式；单打则一种 */
function splits(group: string[]): { teamA: string[]; teamB: string[] }[] {
  if (group.length === 2) {
    return [{ teamA: [group[0]], teamB: [group[1]] }]
  }
  const [p0, p1, p2, p3] = group
  return [
    { teamA: [p0, p1], teamB: [p2, p3] },
    { teamA: [p0, p2], teamB: [p1, p3] },
    { teamA: [p0, p3], teamB: [p1, p2] },
  ]
}

/* ------------------------------------------------------------------ *
 * 主函数
 * ------------------------------------------------------------------ */

export function pickNextMatch(input: RotationInput): RotationOutcome {
  const {
    attending,
    matches,
    busyIds = [],
    type,
    excludeIds = [],
    mustInclude = [],
    mmrById,
    pairingMode = 'balanced',
    lookback = DEFAULT_LOOKBACK,
    random = Math.random,
  } = input

  const byId = new Map(attending.map((p) => [p.id, p]))
  const blocked = new Set([...busyIds, ...excludeIds])
  const need = type === 'singles' ? 2 : 4

  let available = attending.filter((p) => !blocked.has(p.id))

  // 混双必须每队一男一女，没填性别的人无法自动排
  if (type === 'mixed') {
    const genderless = available.filter((p) => p.gender === '-')
    available = available.filter((p) => p.gender !== '-')
    const males = available.filter((p) => p.gender === 'M').length
    const females = available.filter((p) => p.gender === 'F').length
    if (males < 2 || females < 2) {
      return {
        pairing: null,
        reason: genderless.length
          ? `混双需要至少 2 男 2 女，且有 ${genderless.length} 人没填性别，无法自动排`
          : '混双需要至少 2 男 2 女在等待区',
      }
    }
  }

  if (available.length < need) {
    return {
      pairing: null,
      reason: `等待区只有 ${available.length} 人，${type === 'singles' ? '单打' : '双打'}需要 ${need} 人`,
    }
  }

  const missingMust = mustInclude.filter((id) => !available.some((p) => p.id === id))
  if (missingMust.length) {
    return { pairing: null, reason: '指定上场的球员当前不在等待区' }
  }

  const loads = playerLoads(available, matches)
  const loadById = new Map(loads.map((l) => [l.playerId, l]))
  const counts = pairCounts(matches, lookback)

  const evaluate = (pool: Player[], mandatory: string[]): Pairing | null => {
    const optional = pool
      .map((p) => p.id)
      .filter((id) => !mandatory.includes(id))
    const groups = combinations(optional, need - mandatory.length).map((rest) => [
      ...mandatory,
      ...rest,
    ])

    let best: Pairing | null = null
    let bestCost = Infinity

    for (const group of groups) {
      for (const split of splits(group)) {
        const teams = [split.teamA, split.teamB]

        // 混双硬约束
        if (type === 'mixed') {
          const ok = teams.every((t) => {
            const g = t.map((id) => byId.get(id)?.gender)
            return g.filter((x) => x === 'M').length === 1 &&
              g.filter((x) => x === 'F').length === 1
          })
          if (!ok) continue
        }

        let cost = 0

        // 搭档多样性
        for (const t of teams) {
          for (let i = 0; i < t.length; i++) {
            for (let j = i + 1; j < t.length; j++) {
              const k = pairKey(t[i], t[j])
              cost += W.recentPartner * (counts.recentPartner.get(k) ?? 0)
              cost += W.totalPartner * (counts.totalPartner.get(k) ?? 0)
            }
          }
        }

        // 对手多样性
        for (const x of split.teamA) {
          for (const y of split.teamB) {
            const k = pairKey(x, y)
            cost += W.recentOpponent * (counts.recentOpponent.get(k) ?? 0)
            cost += W.totalOpponent * (counts.totalOpponent.get(k) ?? 0)
          }
        }

        // 实力平衡：看两队的平均 MMR
        const mmrOf = (id: string) => mmrById?.get(id) ?? 0
        const avgMmr = (t: string[]) =>
          t.length ? t.reduce((s, id) => s + mmrOf(id), 0) / t.length : 0
        cost += W.mmrGap * Math.abs(avgMmr(split.teamA) - avgMmr(split.teamB))

        /*
         * 同级模式再罚一次这四个人之间的分差跨度。
         * 两队平均相等只保证「队伍之间」公平，不保证场上四个人水平接近；
         * 罚跨度才会把 300 分和 10 分拆到不同场次去。
         */
        if (pairingMode === 'tiered') {
          const vals = group.map(mmrOf)
          cost += W.mmrSpread * (Math.max(...vals) - Math.min(...vals))
        }

        // 等久的人优先上场
        for (const id of group) {
          cost -= W.restBonus * (loadById.get(id)?.restRounds ?? 0)
        }

        cost += random() * W.jitter

        if (cost < bestCost) {
          bestCost = cost
          best = { teamA: split.teamA, teamB: split.teamB, type }
        }
      }
    }

    return best
  }

  // 硬性公平：已打场数严格少于「第 need 少」的人必须上场
  const gamesSorted = [...available]
    .map((p) => loadById.get(p.id)!.games)
    .sort((a, b) => a - b)
  const threshold = gamesSorted[need - 1]

  const mandatory = available
    .filter((p) => loadById.get(p.id)!.games < threshold)
    .map((p) => p.id)

  // mustInclude 也是硬约束，合并进去（可能超过 need，此时无解）
  const merged = Array.from(new Set([...mandatory, ...mustInclude]))
  if (merged.length > need) {
    return {
      pairing: null,
      reason: '指定上场的人和「该轮到的人」加起来超过一场的人数，请先取消部分指定',
    }
  }

  // 搜索池：与 threshold 同场数的人（等最久的优先），控制组合数量
  const tier = available
    .filter(
      (p) =>
        loadById.get(p.id)!.games === threshold && !merged.includes(p.id),
    )
    .sort((a, b) => {
      const la = loadById.get(a.id)!
      const lb = loadById.get(b.id)!
      return lb.restRounds - la.restRounds || random() - 0.5
    })
    .slice(0, MAX_OPTIONAL_POOL)

  const tierPool = [
    ...merged.map((id) => byId.get(id)!),
    ...tier,
  ]

  let pairing =
    tierPool.length >= need ? evaluate(tierPool, merged) : null

  // 混双的性别约束可能让同场数分层里凑不出合法阵容，放宽到全部等待区
  if (!pairing) {
    pairing = evaluate(available, merged)
  }

  if (!pairing) {
    return {
      pairing: null,
      reason:
        type === 'mixed'
          ? '等待区凑不出「每队一男一女」的阵容'
          : '等待区凑不出合法阵容',
    }
  }

  return { pairing }
}
