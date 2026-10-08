import { useEffect } from 'react'
import { create } from 'zustand'
import { useApp } from '@/store/useApp'
import { loadCards, type Card } from '@/lib/profile'
import { shouldLoadCards } from '@/lib/cardLoad'

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
  /**
   * 上一次**拉成功**时登录的是谁。undefined = 从来没成功过。
   *
   * 这里原来是一个 `loaded: boolean`，而那个布尔同时漏掉了两件事：
   * 分不出「拉失败」和「真的没有」，也分不出「换人了」。
   * 两个窟窿都表现成「头像不见了」，一行报错都没有 ——
   * 整段原委写在 lib/cardLoad.ts 开头。
   */
  loadedFor: string | null | undefined
  load: (uid: string | null, force?: boolean) => Promise<void>
}

export const useCards = create<State>((set, get) => ({
  cards: new Map(),
  loadedFor: undefined,
  load: async (uid, force = false) => {
    if (!force && !shouldLoadCards({ loadedFor: get().loadedFor, uid })) return
    const res = await loadCards()
    /*
     * 失败就什么都不记：表留着旧的（总比突然全变卡通强），
     * loadedFor 也不动 —— 下次问起来还是「该拉」，于是回前台
     * 那一下自然就重试了。
     */
    if (!res.ok) return
    set({ cards: res.cards, loadedFor: uid })
  },
}))

/**
 * 换了自己的照片或名字之后叫一声，别等下次开 App。
 *
 * 不做的话，换完头像回到上一屏，看到的还是旧的那张 —— 而人会再换一次。
 */
export const refreshCards = () =>
  useCards.getState().load(useCards.getState().loadedFor ?? null, true)

/**
 * 开 App 拉一次。挂在最外层，所以每一屏都不用自己操心。
 *
 * 三个时机，各补一个窟窿：
 *
 *   换人       登录 / 登出 / 换账号。这张表是按「谁在看」过滤的 ——
 *              登录前拉到的基本是空的，不跟着重拉的话，他登录之后
 *              整个 App 的头像还是卡通，直到彻底关掉重开
 *   球员表变   球员是云端同步下来的，开 App 头几秒还是空的，
 *              等同步回来那一刻正好也是该有照片的时候
 *   回前台     上面两次要是都拉失败了（地铁里开的 App），
 *              这是唯一的重试机会，而且不花定时器
 *
 * uid 收成参数、不在这里 import useAuth：useAuth 一被 import 就会挂上
 * supabase 的会话监听，而这个 store 被每一个画头像的地方间接 import 到。
 * 那等于谁碰一下头像就拖起一整个客户端 —— 测试里当场就炸了。
 */
export function useLoadCards(uid: string | null): void {
  const players = useApp((s) => s.players)
  const load = useCards((s) => s.load)

  useEffect(() => {
    void load(uid)
  }, [load, uid, players.length])

  useEffect(() => {
    /*
     * 只认「回到前台」。visibilitychange 两个方向都会触发，
     * 切出去那一下去拉是白花一个请求 —— 那时候没人在看。
     */
    const onShow = () => {
      if (document.visibilityState === 'visible') void load(uid)
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [load, uid])
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
