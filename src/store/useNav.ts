import { create } from 'zustand'

export type Route =
  | { name: 'home' }
  | { name: 'sessions' }
  | { name: 'discover' }
  | { name: 'me' }
  | { name: 'players' }
  | { name: 'setup' }
  | { name: 'board'; sessionId: string }
  | { name: 'score'; matchId: string }
  /** 赛后结算：这一场谁赢了、每个人 MMR 变了多少 */
  | { name: 'result'; matchId: string }
  | { name: 'leaderboard'; sessionId?: string }
  | { name: 'summary'; sessionId: string }
  | { name: 'profile'; playerId: string }
  | { name: 'avatar'; playerId: string }

/**
 * 底部导航的四个落脚点（中间的「开球」不是 tab，它推一个流程出来）。
 *
 * 这四个之间互相切换不该往回退栈里堆东西 —— 在 tab 之间点来点去二十次，
 * 再按二十次返回才出得去，那是最烦人的一种。
 */
export const TAB_ROUTES = ['home', 'sessions', 'discover', 'me'] as const
export type TabName = (typeof TAB_ROUTES)[number]

const isTab = (r: Route): r is Route & { name: TabName } =>
  (TAB_ROUTES as readonly string[]).includes(r.name)

type NavState = {
  stack: Route[]
  push: (route: Route) => void
  replace: (route: Route) => void
  /** 切底部导航。栈顶已经是某个 tab 就原地换掉，否则才压一层 */
  switchTab: (tab: TabName) => void
  /** 返回上一屏；已在首屏则不动 */
  back: () => void
  /** 系统返回键触发，不再写 history */
  popFromHistory: () => void
  resetTo: (route: Route) => void
}

export const useNav = create<NavState>((set, get) => ({
  stack: [{ name: 'home' }],

  push(route) {
    set((s) => ({ stack: [...s.stack, route] }))
    if (typeof history !== 'undefined') {
      history.pushState({ depth: get().stack.length }, '')
    }
  },

  replace(route) {
    set((s) => ({ stack: [...s.stack.slice(0, -1), route] }))
  },

  /*
   * 首页是这四个 tab 的根，别的 tab 都停在它上面一层。
   *
   *   首页 → 球局      压一层
   *   球局 → 发现      原地换掉（tab 之间平移不该堆回退栈）
   *   发现 → 首页      退一层，不是再压一层
   *
   * 这样系统返回键在任何一个 tab 上按一下都回首页，在首页上按才退出 App，
   * 而且 history 深度和 stack 始终一比一 —— 少了这条，
   * 返回键会被「吃掉」好几次才有反应。
   */
  switchTab(tab) {
    const stack = get().stack
    const top = stack[stack.length - 1]
    if (top.name === tab) return

    // 从球局看板、记分这些深层页面点 tab：正常压一层，返回还能回去
    if (!isTab(top)) {
      get().push({ name: tab } as Route)
      return
    }
    if (tab === 'home' && stack[stack.length - 2]?.name === 'home') {
      get().back()
      return
    }
    if (top.name === 'home') get().push({ name: tab } as Route)
    else get().replace({ name: tab } as Route)
  },

  back() {
    if (get().stack.length <= 1) return
    // 交给 history 回退，popstate 里再收拢 stack，保证和系统返回键一致
    if (typeof history !== 'undefined') history.back()
    else set((s) => ({ stack: s.stack.slice(0, -1) }))
  },

  popFromHistory() {
    set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : s))
  },

  resetTo(route) {
    set({ stack: [route] })
  },
}))

export const useRoute = () => useNav((s) => s.stack[s.stack.length - 1])
