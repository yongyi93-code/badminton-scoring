import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useApp } from '@/store/useApp'
import { emptyProgress, progressByPlayer, type Progress } from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * 全局的 MMR／段位表
 *
 * 段位是把所有比赛按时间重放一遍算出来的（有 0 分下限和爆冷翻倍，
 * 不能用一条公式直接求），一次算完全部人比每处各算各的划算得多。
 *
 * 更要紧的是一致性：头像出现在十来处（排行榜、场地看板、等待队列、
 * 散场结算……），如果段位靠 props 一层层传，迟早漏掉几处，
 * 就会出现「排行榜是传奇形象、看板还是新手」这种自相矛盾的画面。
 * 放在 context 里，取不到的地方一个都没有。
 * ------------------------------------------------------------------ */

const Ctx = createContext<Map<string, Progress> | null>(null)

export function ProgressProvider({ children }: { children: ReactNode }) {
  const matches = useApp((s) => s.matches)
  const value = useMemo(() => progressByPlayer(matches), [matches])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 全部人的战绩表。没套 Provider（比如单测里直接渲染组件）时给一张空表。 */
export function useProgressMap(): Map<string, Progress> {
  return useContext(Ctx) ?? EMPTY
}

/** 某个人的战绩，没打过球也返回一份 0 分的，调用处不用到处判空 */
export function useProgress(playerId: string | undefined): Progress {
  const map = useProgressMap()
  return (playerId && map.get(playerId)) || emptyProgress()
}

const EMPTY: Map<string, Progress> = new Map()
