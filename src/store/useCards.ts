import { useEffect } from 'react'
import { create } from 'zustand'
import { useApp } from '@/store/useApp'
import { fetchCards, type Card } from '@/lib/profile'

/* ------------------------------------------------------------------ *
 * 一份名片表，全 App 共用
 *
 * 照片长在**账号**上（profiles，按 uid），而这个 App 的大部分屏幕
 * 拿在手里的是**球员**（按 playerId）。两边靠球员行上的 ownerId 接上。
 *
 * -------------------------------------------------------------------
 * 为什么是一个 store，不是每屏各拉一次
 *
 * 头像出现在十来屏（排行榜、看板、等待队列、散场结算、比赛结果、
 * 好友、朋友圈……）。每屏各调一次 fetchCards，切一次 tab 就是一个
 * 新请求，而这张表一小时也变不了一次。
 *
 * 更要紧的是**一致**：各拉各的话，排行榜上已经换了新照片、看板上
 * 还是旧的 —— 而它们在同一个 App 里隔一个手势的距离。
 *
 * -------------------------------------------------------------------
 * 拿不到就是一张空表，不是错
 *
 * 没跑过 022/023、离线、没登录，都会拿到空的。那时候头像退回换装角色，
 * 再退回名字首字的色块 —— 和照片这个功能出现之前一模一样。
 * 这一层是锦上添花，不该因为它挂了让整屏出错。
 * ------------------------------------------------------------------ */

type State = {
  cards: Map<string, Card>
  /** 拉过一次没有。用来避免每次挂载都发请求 */
  loaded: boolean
  load: (force?: boolean) => Promise<void>
}

export const useCards = create<State>((set, get) => ({
  cards: new Map(),
  loaded: false,
  load: async (force = false) => {
    if (get().loaded && !force) return
    const cards = await fetchCards()
    set({ cards, loaded: true })
  },
}))

/**
 * 换了自己的照片或名字之后叫一声，别等下次开 App。
 *
 * 不做的话，换完头像回到上一屏，看到的还是旧的那张 —— 而人会再换一次。
 */
export const refreshCards = () => useCards.getState().load(true)

/**
 * 开 App 拉一次。挂在最外层，所以每一屏都不用自己操心。
 *
 * 跟着球员表变一次：球员是云端同步下来的，第一次开 App 时它是空的，
 * 等同步回来才知道谁是谁 —— 那一刻正好也是该有照片的时候。
 */
export function useLoadCards(): void {
  const players = useApp((s) => s.players)
  const load = useCards((s) => s.load)
  useEffect(() => {
    void load()
  }, [load, players.length])
}

/**
 * 这个球员的照片地址。没有就是 null。
 *
 * 传 playerId 而不是 uid，因为调用它的地方（头像）手上只有球员。
 * 球员没绑账号（比如代打的、退群的）就没有照片 —— 那是对的，
 * 照片属于账号，而那一行不属于任何账号。
 */
export function usePhotoOf(playerId?: string | null): string | null {
  const owner = useApp((s) =>
    playerId ? (s.players.find((p) => p.id === playerId)?.ownerId ?? null) : null,
  )
  return useCards((s) => (owner ? (s.cards.get(owner)?.photo ?? null) : null))
}
