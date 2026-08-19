import { create } from 'zustand'

export type Route =
  | { name: 'home' }
  | { name: 'players' }
  | { name: 'setup' }
  | { name: 'board'; sessionId: string }
  | { name: 'score'; matchId: string }
  | { name: 'leaderboard'; sessionId?: string }
  | { name: 'summary'; sessionId: string }
  | { name: 'profile'; playerId: string }
  | { name: 'avatar'; playerId: string }

type NavState = {
  stack: Route[]
  push: (route: Route) => void
  replace: (route: Route) => void
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
