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
 * 注销 Service Worker 再重载，下次进来必定拉最新的。
 *
 * 只动 Service Worker，绝对不碰 localStorage ——
 * 球员、球局、比赛、角色全存在那里，清掉就等于把大家的战绩删了。
 *
 * 为什么不再顺手清 Cache Storage：
 *
 * 注销之前，当前这个页面仍然被旧的 Service Worker 接管着（注销要等
 * 页面卸载才真正生效）。在那个窗口里把它的缓存删掉，等于让一个还在
 * 干活的 Service Worker 突然找不到自己预缓存的东西 —— 它接下来怎么
 * 响应资源请求就说不准了，各家浏览器还不一样。曾经有人点完更新
 * 拿到一个没有样式的白板页面。
 *
 * 而且删缓存本来也没必要：注销之后就没人读那些缓存了，
 * 新装上的 Service Worker 会自己建一套新的。
 */
/**
 * 把「检查更新」留在地址栏上的 ?_v=… 抹掉。
 *
 * 它的作用只是那一次重载时绕过缓存，之后就是个多余的尾巴 ——
 * 留着的话，任何会去解析 URL 的东西（比如 supabase 找登录令牌）
 * 都可能被它绊一下。用 replaceState 换掉，不产生新的历史记录。
 */
export function clearUpdateMarker(): void {
  try {
    const url = new URL(location.href)
    if (!url.searchParams.has('_v')) return
    url.searchParams.delete('_v')
    history.replaceState(history.state, '', url.toString())
  } catch {
    /* 抹不掉也不影响用，忽略 */
  }
}

export async function forceUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch {
    // 注销不掉也没关系，下面照样重载，最差就是还得再点一次
  }
  /*
   * 带上时间戳绕开浏览器那层 HTTP 缓存。
   * 用 assign 不用 replace：万一新版本有问题，用户还能靠返回键
   * 退回上一个能用的页面，不至于卡在原地。
   */
  const url = new URL(location.href)
  url.searchParams.set('_v', String(Date.now()))
  location.assign(url.toString())
}
