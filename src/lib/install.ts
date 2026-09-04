import { useSyncExternalStore } from 'react'
import { isStandalone } from '@/lib/push'

/* ------------------------------------------------------------------ *
 * 「装到手机上」这件事
 *
 * 装了和没装是两个 App：装了才有桌面图标、才没有浏览器地址栏、
 * iOS 上才收得到推送。但浏览器不会主动告诉人「这个能装」——
 * Android 偶尔弹一条容易被忽略的小提示，iOS 什么都不说。
 * 结果就是：人打开链接，当成一个网页看完，关掉。
 *
 * 所以要自己讲。而怎么讲取决于他现在用什么打开的 ——
 * 这个文件就是把「现在是哪种情况」判出来。
 * ------------------------------------------------------------------ */

/**
 * Chrome 系浏览器在「这个站可以装」时抛出的事件。
 * 拦下来自己存着，之后由我们的按钮触发，而不是听浏览器的安排。
 */
type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallEvent | null = null
const watchers = new Set<() => void>()
const emit = () => watchers.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // 不拦的话浏览器自己弹一条小横幅，位置和时机都由它定，很容易被划掉
    e.preventDefault()
    deferred = e as InstallEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent)

/**
 * iPad 从 iPadOS 13 起把自己报成 Mac，只能靠「Mac 但有多点触摸」认出来。
 * 桌面 Mac 的 maxTouchPoints 是 0。
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(ua())) return true
  return /Mac/.test(ua()) && navigator.maxTouchPoints > 1
}

/**
 * iOS 上所有浏览器内核都是 WebKit，但只有 Safari 的「添加到主屏幕」
 * 装出来的是真的 PWA。Chrome / Firefox / Edge 装出来的是个书签快捷方式，
 * 打开还是带地址栏，也收不到推送 —— 所以要把人请回 Safari。
 */
export function isIOSSafari(): boolean {
  return isIOS() && !/CriOS|FxiOS|EdgiOS|OPT\//.test(ua())
}

/**
 * App 里内嵌的浏览器（WhatsApp、FB、IG、微信…）。
 *
 * 这是马来西亚这边最要命的一种情况：链接一定是从 WhatsApp 群里点开的，
 * 而那种内嵌浏览器要么没有「添加到主屏幕」，要么加出来是坏的。
 * 人不会觉得是浏览器的问题，只会觉得「这个 App 坏了」。
 */
export function isInAppBrowser(): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|MicroMessenger|BytedanceWebview|musical_ly|Twitter/i.test(
    ua(),
  )
}

export type InstallHow =
  /** 已经装好了，什么都不用说 */
  | 'installed'
  /** 能直接弹系统安装框 —— Android Chrome、桌面 Chrome/Edge */
  | 'prompt'
  /** iOS Safari：得教他「分享 → 添加到主屏幕」，没有代码能代劳 */
  | 'ios-safari'
  /** iOS 但不是 Safari：先请他换 Safari 打开 */
  | 'ios-other'
  /** App 内嵌浏览器：先请他用系统浏览器打开 */
  | 'in-app'
  /** 其余情况（事件还没来、或这个浏览器根本不支持）：给一句通用说明 */
  | 'manual'

export function installHow(): InstallHow {
  if (isStandalone()) return 'installed'
  if (isInAppBrowser()) return 'in-app'
  if (isIOS()) return isIOSSafari() ? 'ios-safari' : 'ios-other'
  if (deferred) return 'prompt'
  return 'manual'
}

/**
 * 弹系统安装框。返回他有没有真的装。
 *
 * 事件只能用一次 —— 用完就作废，装没装成都一样。所以这里用完就清掉，
 * 不清的话按钮还亮着，再点一次什么也不会发生。
 */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  deferred = null
  emit()
  try {
    await e.prompt()
    const { outcome } = await e.userChoice
    return outcome === 'accepted'
  } catch {
    return false
  }
}

/* 判断依赖 UA 和 window 的状态，不是 React state —— 用外部 store 订阅 */
const subscribe = (f: () => void) => {
  watchers.add(f)
  const media = window.matchMedia?.('(display-mode: standalone)')
  media?.addEventListener?.('change', f)
  return () => {
    watchers.delete(f)
    media?.removeEventListener?.('change', f)
  }
}

export function useInstallHow(): InstallHow {
  return useSyncExternalStore(subscribe, installHow, () => 'installed' as InstallHow)
}

/* ------------------------------------------------------------------ *
 * 收起来之后别再烦人
 *
 * 装不装是他的自由。划掉一次就记住，别每次打开又顶在最上面 ——
 * 那种 App 只会被更快地删掉。入口留在「我的」里，想装随时找得到。
 * ------------------------------------------------------------------ */

const HIDDEN_KEY = 'rally-install-hidden'

export function installHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function hideInstall(): void {
  try {
    localStorage.setItem(HIDDEN_KEY, '1')
  } catch {
    /* 无痕模式下存不了。存不了就每次都显示，总好过报错 */
  }
}
