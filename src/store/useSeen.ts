import { create } from 'zustand'
import { clearSeen, prune, readSeen, writeSeen, type SeenMap } from '@/lib/seen'

/* ------------------------------------------------------------------ *
 * 看过哪几条 Story，全 App 共用的那一份
 *
 * 做成一个 store 而不是每个组件各读各的 localStorage：那一排圈圈同时
 * 出现在首页和朋友圈（两个 <StoryStrip />）。各读各的话，在首页看完
 * 一条，切到朋友圈那一排还是亮的 —— 直到重新挂载才对上。
 *
 * 真正的那份数据在 localStorage 里（lib/seen.ts 写了为什么不上云）。
 * 这一层只是让两个组件看到同一份，并且在变的时候一起重画。
 * ------------------------------------------------------------------ */

type State = {
  seen: SeenMap
  /** 看了一条。重复调同一条不会多写一次（下面那句挡住了） */
  mark: (id: string) => void
  /** 退出登录时清空 */
  reset: () => void
}

export const useSeen = create<State>((set, get) => ({
  /* 开 App 读一次。读的时候会顺手清掉过期的（见 lib/seen 的 readSeen） */
  seen: readSeen(),

  mark(id) {
    /*
     * 已经记过就什么都不做。
     *
     * 不挡的话，全屏播放那边每渲染一次就 set 一次 —— 而 set 会让它
     * 重渲染，于是转起来停不下来。
     */
    if (id in get().seen) return
    const next = prune({ ...get().seen, [id]: Date.now() }, Date.now())
    set({ seen: next })
    writeSeen(next)
  },

  reset() {
    clearSeen()
    set({ seen: {} })
  },
}))
