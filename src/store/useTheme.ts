import { useSyncExternalStore } from 'react'

/*
 * 主题只有两个值，浅色是默认。
 *
 * 单独存一个 key，不进 useApp 那份 —— 它是这台手机的显示偏好，
 * 不该跟着备份跑到别人手机上，也不该在导入备份时被覆盖掉。
 */

export type Theme = 'light' | 'dark'

const KEY = 'rally-theme'

const read = (): Theme => {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    // 隐私模式下 localStorage 会直接抛，按默认走，别让整个 App 起不来
    return 'light'
  }
}

let current: Theme = 'light'
const listeners = new Set<() => void>()

/** 深色时打 data-theme，浅色时干脆去掉属性 —— CSS 那边浅色就是裸 :root */
function paint(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')

  // 手机上状态栏和地址栏跟着主题走，否则深色界面顶着一条白边
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
  if (meta) meta.content = theme === 'dark' ? '#0d1d24' : '#f6fafa'
}

export function setTheme(theme: Theme) {
  current = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* 存不下就只在这一次会话里生效 */
  }
  paint(theme)
  listeners.forEach((fn) => fn())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/**
 * 在 React 渲染之前调一次。放在 main.tsx 里而不是某个组件的 effect 里 ——
 * 否则深色的人每次开 App 都会先白闪一帧。
 */
export function initTheme() {
  current = read()
  paint(current)
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'light' as Theme,
  )
  return { theme, setTheme }
}
