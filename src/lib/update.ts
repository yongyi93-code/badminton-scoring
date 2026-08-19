/* ------------------------------------------------------------------ *
 * 版本标识与强制更新
 *
 * 装成 PWA 之后最难受的一点：更新到底生效没有，谁也说不准 ——
 * Service Worker 会一直拿旧缓存顶着，界面看起来一模一样。
 * 所以做两件事：
 *   1. 把构建版本印在首页，一眼就能对上是不是最新的
 *   2. 给一个按钮，一键把 Service Worker 和它的缓存清掉重来
 * ------------------------------------------------------------------ */

/** 构建时注入，见 vite.config.ts 的 define */
declare const __BUILD_ID__: string
declare const __BUILD_TIME__: string

export const BUILD_ID = __BUILD_ID__
export const BUILD_TIME = __BUILD_TIME__

/** 构建时间显示成本地时间的 yyyy-mm-dd hh:mm */
export function buildStamp(): string {
  const d = new Date(BUILD_TIME)
  if (Number.isNaN(d.getTime())) return BUILD_TIME
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 把 Service Worker 连同它的缓存全部清掉再重载，下次进来必定拉最新的。
 *
 * 只动 Service Worker 和 Cache Storage，绝对不碰 localStorage ——
 * 球员、球局、比赛、宠物全存在那里，清掉就等于把大家的战绩删了。
 */
export async function forceUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // 清不掉也没关系，下面照样重载，最差就是还得再点一次
  }
  // 带上时间戳，绕开浏览器自己那层 HTTP 缓存
  const url = new URL(location.href)
  url.searchParams.set('_v', String(Date.now()))
  location.replace(url.toString())
}
