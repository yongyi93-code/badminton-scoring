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
 * 只动 Service Worker 和它的缓存，绝对不碰 localStorage ——
 * 球员、球局、比赛、角色全存在那里，清掉就等于把大家的战绩删了。
 *
 * 关于清 Cache Storage：曾经因为怀疑它引起白屏而把这一步拿掉过，
 * 拿掉之后白屏照旧 —— 那个判断是错的，现在加回来。真正的原因在
 * 另一头：注销要等页面卸载才生效，那次重载的导航请求仍然可能被旧的
 * Service Worker 接住，端出它预缓存的旧 index.html。所以两头一起堵：
 *
 *   - 这里把缓存删干净，旧的 Service Worker 就算还在也没东西可端
 *   - vite.config.ts 里 navigateFallbackDenylist 让带 ?_v= 的导航
 *     一律走网络（那条只对新装上的 Service Worker 生效）
 *   - index.html 里还留了一段救急脚本，万一真白了也能自己点出来
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

/**
 * 把 Service Worker 和它的缓存清干净。不碰 localStorage。
 *
 * forceUpdate 和自动自愈走的是同一段，改一处两边都改到。
 */
async function wipeCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // 清不干净也没关系，调用方照样会重载，最差就是还得再来一次
  }
}

/**
 * 重载，带上一个绕开缓存的时间戳。
 *
 * 用 assign 不用 replace：万一新版本有问题，用户还能靠返回键退回
 * 上一个能用的页面，不至于卡在原地。
 */
function reloadFresh(): void {
  const url = new URL(location.href)
  url.searchParams.set('_v', String(Date.now()))
  location.assign(url.toString())
}

/*
 * 已经为哪个版本自愈过了。
 *
 * 存在 sessionStorage 而不是变量里：自愈的动作就是重载，重载之后
 * 变量全没了。不记这一笔的话，服务器要是因为别的原因一直和本地对不上，
 * 页面会自己一直重载下去 —— 那比停在旧版本糟糕得多。
 */
const HEALED_KEY = 'rally-healed-for'

/**
 * 看看服务器上现在是哪一版，和自己对不上就自己清掉重来一次。
 *
 * 这个 App 反复栽在同一个地方：Service Worker 端出一份旧的 index.html，
 * 页面上什么都看不出来 —— 「更新完还是旧版本」，严重时那份旧 HTML 引用的
 * JS 已经不在了，就是一片白。iOS 上没有开发者工具，用户能做的只有猜。
 *
 * 所以不再指望 Service Worker 自己守规矩，改成页面主动去问一次网络。
 * 离线、请求失败、文件不存在（老版本没这个文件）一律当没事发生 ——
 * 离线可用是这个 App 的底线，绝不能因为问不到版本就把人拦在外面。
 */
export async function healIfStale(): Promise<void> {
  if (!navigator.onLine) return
  try {
    const res = await fetch(new URL('./version.json', location.href), {
      cache: 'no-store',
    })
    if (!res.ok) return
    const remote = String((await res.json())?.build ?? '')
    if (!remote || remote === BUILD_ID) return

    // 同一个版本只自愈一次，清完还对不上就别再折腾了
    if (sessionStorage.getItem(HEALED_KEY) === remote) return
    sessionStorage.setItem(HEALED_KEY, remote)

    await wipeCaches()
    reloadFresh()
  } catch {
    // 问不到就算了，接着用手上这份
  }
}

export async function forceUpdate(): Promise<void> {
  await wipeCaches()
  /*
   * 手动点的这次，把自愈的记号也抹掉：用户明确说了「我要最新的」，
   * 不该因为这一版之前自愈过就跳过检查。
   */
  try {
    sessionStorage.removeItem(HEALED_KEY)
  } catch {
    /* 用不了 sessionStorage 也不影响重载 */
  }
  reloadFresh()
}
