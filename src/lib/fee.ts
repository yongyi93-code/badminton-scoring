import type { Session } from '@/types'

export type FeeSplit = {
  /** 场地费 + 球钱 */
  total: number
  /** 每人应付（向上取整到 0.5，方便现场收钱） */
  perPerson: number
  headcount: number
  shuttleTotal: number
  /** 还没付钱的球员 id */
  unpaidIds: string[]
  /** 已收到的金额 */
  collected: number
  /** 还差多少 */
  outstanding: number
}

/** 向上取整到 0.5，避免现场找零 */
export const roundUpToHalf = (n: number) => Math.ceil(n * 2) / 2

export function splitFee(session: Session): FeeSplit {
  const { fee, playerIds } = session
  const shuttleTotal = Math.max(0, fee.shuttleCount) * Math.max(0, fee.shuttleUnitPrice)
  const total = Math.max(0, fee.courtFee) + shuttleTotal
  const headcount = playerIds.length
  const perPerson = headcount > 0 ? roundUpToHalf(total / headcount) : 0

  const paid = new Set(fee.paidPlayerIds.filter((id) => playerIds.includes(id)))
  const unpaidIds = playerIds.filter((id) => !paid.has(id))

  const collected = paid.size * perPerson
  // 向上取整后总收款可能略高于成本，欠款不应变成负数
  const outstanding = Math.max(0, unpaidIds.length * perPerson)

  return {
    total,
    perPerson,
    headcount,
    shuttleTotal,
    unpaidIds,
    collected,
    outstanding,
  }
}

/** 金额显示：整数不带小数，半数显示一位 */
export const money = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')
