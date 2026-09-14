import { useEffect } from 'react'
import { useNav } from '@/store/useNav'

/* ------------------------------------------------------------------ *
 * 点通知之后落在哪一屏
 *
 * 推送里带着一个地址（notify-social 发的是 ./#friends）。它要在
 * 两种完全不同的情形下都管用，而这两种情形走的是两条路：
 *
 *   App 没开   系统新开一个窗口，地址里带着 #friends —— 启动时读一次
 *   App 开着   Service Worker 只能把它调到前台，停在他离开时那一屏。
 *              所以 SW 还会往页面喊一句「去这儿」，这里接住
 *
 * 少了第二条的后果不是报错，是「点了有人给你发消息，落回昨晚的
 * 记分板」—— 看起来像通知点错了。
 *
 * 为什么只认 #friends 而不做一套真正的地址路由：这个 App 的界面栈
 * 在内存里，不在地址栏。为了一条通知把整套路由改成地址驱动，
 * 是拿一个大改动换一个小便利。要认的地址多起来再说。
 * ------------------------------------------------------------------ */

/** 认得出来的那几个去处。认不出来的一律不动，停在原地 */
export function routeForHash(hash: string): 'friends' | null {
  return hash.includes('friends') ? 'friends' : null
}

/**
 * 把地址栏那截 #friends 抹掉。
 *
 * 不抹的话刷新一次又跳一次好友页 —— 人明明在记分，刷新之后
 * 莫名其妙被带走，而且怎么都回不去。
 */
function scrubHash(): void {
  try {
    if (!window.location.hash) return
    const url = new URL(window.location.href)
    url.hash = ''
    history.replaceState(history.state, '', url.toString())
  } catch {
    /* 抹不掉也不影响用 */
  }
}

export function useOpenFromPush(): void {
  const push = useNav((s) => s.push)

  useEffect(() => {
    /* 冷启动：地址里带着就跳一次，然后把它抹掉 */
    const first = routeForHash(window.location.hash)
    if (first === 'friends') {
      push({ name: 'friends' })
      scrubHash()
    }

    /* 已经开着：Service Worker 喊一声，这里接住 */
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null
      if (data?.type !== 'rally-navigate') return
      if (routeForHash(data.url ?? '') === 'friends') push({ name: 'friends' })
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [push])
}
