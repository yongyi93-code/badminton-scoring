import { supabase } from '@/lib/supabase'
import { BUILD_ID } from '@/lib/update'

/* ------------------------------------------------------------------ *
 * 自动报错
 *
 * 「说点什么」只收得到人家注意到、而且愿意打字告诉你的那部分。
 * 而最该知道的那几类 —— 白屏、点了没反应、一进去就退出 ——
 * 人多半不会打字，只会卸载。这里收的是 App 自己撞上的异常。
 *
 * -------------------------------------------------------------------
 * 这个文件里最要紧的不是「怎么报」，是「怎么不报」
 *
 * 一个渲染循环里的错误，一秒能报几百条。免费版数据库 500 MB，
 * 淹掉它比想象中容易 —— 而且淹掉之后，真正的那一条也就看不见了。
 *
 * 所以拦在三处：
 *   同一个错，一次会话只报第一次（seen）
 *   一次会话最多 MAX_PER_SESSION 条
 *   报错这件事本身出错，绝不再报（reporting 那个闩）
 *
 * 数据库那边还有一层长度上限兜底（015 那段 SQL）——
 * 因为这三层都在客户端，而客户端是改一行 JS 就能绕过的。
 *
 * -------------------------------------------------------------------
 * 不收完整网址
 *
 * 重设密码那条链接回来时，地址栏里是 `#access_token=...`，
 * 那是一把能登录的钥匙。真在那一屏上崩了，把网址原样存进数据库
 * 等于把钥匙抄一份留在日志里。
 *
 * 所以只报「当时在哪一屏」（路由名）。这个值由 App 那边喂进来，
 * 见 setRoute。
 * ------------------------------------------------------------------ */

/** 一次会话最多报几条。够看出「出事了」，不够淹掉数据库 */
const MAX_PER_SESSION = 5

/** 这次会话已经报过的指纹 */
const seen = new Set<string>()
let sent = 0

/**
 * 正在报错的路上。
 *
 * 少了这个闩，报错失败本身会再触发一次 unhandledrejection，
 * 那一条又去报，又失败 —— 一个能把数据库写满的完美循环。
 */
let reporting = false

/** 当前在哪一屏。App 那边每次导航喂一次 */
let route = ''
export const setRoute = (name: string) => {
  route = name
}

/**
 * 同一个 bug 的指纹。
 *
 * 用报错文本加堆栈第一帧 —— 只用文本的话，同一句
 * 「Cannot read properties of null」在三个地方出的错会被并成一条；
 * 用整个堆栈的话，行号一变就成了新的一条。第一帧是这两者之间
 * 那个刚好的粒度。
 */
export function fingerprintOf(message: string, stack: string): string {
  const frame = stack.split('\n').find((l) => l.includes('at ') || l.includes('@')) ?? ''
  const raw = `${message}|${frame.trim()}`
  /* 不需要密码学强度，只要同样的输入给同样的短字符串 */
  let h = 0
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

/** 和反馈那边同一份写法。「打不开」没有机型和版本号什么都查不了 */
function deviceLine(): string {
  if (typeof navigator === 'undefined') return ''
  const ua = navigator.userAgent
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : '其他'
  const browser =
    /EdgA?\//.test(ua) ? 'Edge'
    : /CriOS|Chrome/.test(ua) ? 'Chrome'
    : /FxiOS|Firefox/.test(ua) ? 'Firefox'
    : /Safari/.test(ua) ? 'Safari'
    : '其他'
  const standalone =
    (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as { standalone?: boolean }).standalone === true
  const ver = ua.match(/OS (\d+[_.]\d+)|Android (\d+)/)
  const v = (ver?.[1] ?? ver?.[2] ?? '').replace('_', '.')
  return [os + (v ? ` ${v}` : ''), browser, standalone ? '主屏幕' : '浏览器'].join(' · ')
}

/**
 * 决定这一条报不报。
 *
 * 抽出来是为了能单独测 —— 限流是这个文件里唯一会出事的逻辑，
 * 而它在浏览器里很难验（要真的造几百个错）。
 */
export function shouldReport(fingerprint: string): boolean {
  if (sent >= MAX_PER_SESSION) return false
  if (seen.has(fingerprint)) return false
  return true
}

/** 测试用：把这次会话的计数清掉 */
export function resetThrottle(): void {
  seen.clear()
  sent = 0
  reporting = false
}

export async function report(message: string, stack = ''): Promise<void> {
  if (!supabase || reporting) return
  const msg = String(message || '').slice(0, 500)
  if (!msg) return
  const fp = fingerprintOf(msg, stack)
  if (!shouldReport(fp)) return

  seen.add(fp)
  sent += 1
  reporting = true
  try {
    await supabase.from('errors').insert({
      message: msg,
      stack: stack ? stack.slice(0, 2000) : null,
      route: route.slice(0, 60) || null,
      app_build: BUILD_ID,
      device: deviceLine(),
      fingerprint: fp,
    })
  } catch {
    /*
     * 报错报不出去，就到此为止。
     *
     * 这里一个字都不能往外抛，也不能 console.error —— 那正是
     * 上面那个闩要防的：报错失败触发新的报错，无限转下去。
     */
  } finally {
    reporting = false
  }
}

/**
 * 挂上全局的两个口子。在 App 启动时调一次。
 *
 * 两个都要：error 接的是同步抛出来的，unhandledrejection 接的是
 * 没人 catch 的 Promise —— 而这个 App 里绝大多数出错的地方
 * （网络、Supabase、录音）都是后者。
 */
export function initErrorLog(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (e) => {
    /*
     * 图片、脚本加载失败也会触发 error，但它们没有 error 对象。
     * 那一类现在不报 —— 换装素材改成按需下载之后，离线时取不到
     * 某一张衣服图是预期之内的事，报上来只是噪音。
     */
    if (!e.error) return
    void report(e.message || String(e.error), e.error?.stack ?? '')
  })

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    const msg = r instanceof Error ? r.message : String(r)
    const stack = r instanceof Error ? (r.stack ?? '') : ''
    void report(msg, stack)
  })
}

/* ------------------------------------------------------------------ *
 * 读（管理员那一屏用）
 * ------------------------------------------------------------------ */

export type ErrorRow = {
  id: string
  message: string
  stack: string | null
  route: string | null
  app_build: string | null
  device: string | null
  fingerprint: string
  status: 'open' | 'done'
  created_at: string
}

/** 同一个 bug 收成一行：撞了几次、最近一次什么时候、都在哪些机型上 */
export type ErrorGroup = {
  fingerprint: string
  latest: ErrorRow
  count: number
  devices: string[]
  builds: string[]
  anyOpen: boolean
}

export async function fetchErrors(): Promise<ErrorRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('errors')
    .select('id,message,stack,route,app_build,device,fingerprint,status,created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) {
    console.warn('报错没拉到:', error.message)
    return []
  }
  return (data ?? []) as ErrorRow[]
}

/** 还有几个**没看过的 bug**（不是几条记录）—— 红点上那个数 */
export async function fetchOpenErrorCount(): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase
    .from('errors')
    .select('fingerprint')
    .eq('status', 'open')
    .limit(500)
  if (error) {
    console.warn('报错条数没拿到:', error.message)
    return 0
  }
  return new Set((data ?? []).map((r: { fingerprint: string }) => r.fingerprint)).size
}

/**
 * 按指纹归并。
 *
 * 管理员要看的是「有几个 bug」，不是「撞了几次」—— 一个循环里的
 * 错误能刷出四十条记录，摊开来列出来那一屏没法看，而它们是同一件事。
 *
 * rows 是按时间倒序进来的，所以每组第一个遇到的就是最近那次。
 */
export function groupErrors(rows: ErrorRow[]): ErrorGroup[] {
  const by = new Map<string, ErrorGroup>()
  for (const r of rows) {
    const g = by.get(r.fingerprint)
    if (!g) {
      by.set(r.fingerprint, {
        fingerprint: r.fingerprint,
        latest: r,
        count: 1,
        devices: r.device ? [r.device] : [],
        builds: r.app_build ? [r.app_build] : [],
        anyOpen: r.status === 'open',
      })
      continue
    }
    g.count += 1
    if (r.device && !g.devices.includes(r.device)) g.devices.push(r.device)
    if (r.app_build && !g.builds.includes(r.app_build)) g.builds.push(r.app_build)
    if (r.status === 'open') g.anyOpen = true
  }
  /* 没看过的排前面，同样状态里撞得多的排前面 */
  return [...by.values()].sort(
    (a, b) => Number(b.anyOpen) - Number(a.anyOpen) || b.count - a.count,
  )
}

/** 标记这个 bug 看过了 —— 按指纹整组标，不是一条条点 */
export async function markErrorGroupDone(fingerprint: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('errors')
    .update({ status: 'done' })
    .eq('fingerprint', fingerprint)
  if (error) console.warn('标记没成功:', error.message)
}

/** 修好之后整组清掉。报错是会堆积的，清理是常规操作 */
export async function deleteErrorGroup(fingerprint: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('errors').delete().eq('fingerprint', fingerprint)
  if (error) console.warn('清不掉:', error.message)
}
