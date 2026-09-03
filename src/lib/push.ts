import { useSyncExternalStore } from 'react'
import { pick } from './i18n'
import { supabase } from './supabase'

/* ------------------------------------------------------------------ *
 * 开局提醒（Web Push）
 *
 * 别人开了球局，你手机上直接弹一条 —— 不用打开 App 才发现。
 *
 * 三方接力，缺一不可：
 *   1. 这里：向浏览器要一个订阅（endpoint + 两把公钥），存进 Supabase
 *   2. 数据库：records 里新增一条 kind='session' 时触发 Webhook
 *   3. Edge Function：拿着 VAPID 私钥，把消息推给所有订阅
 *
 * iOS 的硬限制：必须是「加到主屏幕」的那个图标打开才有 PushManager，
 * Safari 标签页里根本没有这个能力。所以判断不能只看 API 在不在，
 * 还要把「你得先加到主屏幕」这句话说出来 —— 不然用户点了没反应，
 * 只会以为坏了。
 * ------------------------------------------------------------------ */

/** 打进前端的公钥。公开的：它的作用只是让推送服务认得出是谁发的 */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export type PushState =
  /** 这个浏览器根本没有推送能力（iOS 上没加到主屏幕就是这个） */
  | 'unsupported'
  /** 后端没配 VAPID 公钥，功能整个不出现 */
  | 'off'
  | 'idle'
  | 'on'
  /** 用户点过「不允许」。这个状态下再问也弹不出来了，只能去系统设置改 */
  | 'denied'

/** 装成 PWA 打开的（iOS 用 navigator.standalone，其余看 display-mode） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    nav.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  )
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export const pushConfigured = () => VAPID_PUBLIC_KEY.length > 0

/* ------------------------------------------------------------------ *
 * 状态：给界面用，开关一动就重渲染
 * ------------------------------------------------------------------ */

let state: PushState = 'idle'
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
const setState = (next: PushState) => {
  state = next
  emit()
}

export function usePushState(): PushState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    () => state,
    () => 'idle' as PushState,
  )
}

/** 启动时问一次现在是什么状态 */
export async function initPush(): Promise<void> {
  if (!pushConfigured()) return setState('off')
  if (!pushSupported()) return setState('unsupported')
  if (Notification.permission === 'denied') return setState('denied')
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    setState(sub ? 'on' : 'idle')
  } catch {
    setState('idle')
  }
}

/* ------------------------------------------------------------------ *
 * 订阅 / 退订
 * ------------------------------------------------------------------ */

/**
 * base64url 的公钥转成 pushManager 要的字节数组。
 *
 * 这一步看着多余，但 applicationServerKey 只吃 Uint8Array 或 ArrayBuffer，
 * 直接塞字符串会抛一个跟原因八竿子打不着的 InvalidCharacterError。
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

export type PushResult = { ok: true } | { ok: false; error: string }

/**
 * 把数据库那边的报错说成人话。
 *
 * 推送要装两半：前端这半跟着 App 自动更新，后台那张表得有人手动建。
 * 两半之间必然有一段时间对不上 —— 那段时间里点「打开」，
 * 原样抛一句 relation does not exist 出来，除了写代码的人没人看得懂。
 */
function readableDbError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('does not exist') || m.includes('schema cache')) {
    return pick(
      '云端还没建订阅表 —— 去 Supabase 后台把 002-push.sql 跑一遍',
      'The subscription table does not exist yet — run 002-push.sql in Supabase',
    )
  }
  /*
   * 这两句必须分开说。
   *
   * 授权（grant）和策略（policy）是两道不同的门，Postgres 报出来的
   * 错却很像。合成一句「grant 那句没跑到」的代价是真发生过的：
   * 那次实际上是策略的问题，而这句话把人指去查授权，查了半天全都
   * 正常，线索就断在这里。
   */
  if (m.includes('permission denied')) {
    return pick(
      '数据库不让碰订阅表 —— 002-push.sql 里的 grant 那几句没跑全，重跑一遍',
      'The database refused access — the grant lines in 002-push.sql did not all run; re-run it',
    )
  }
  if (m.includes('row-level security')) {
    return pick(
      '订阅表的策略挡住了 —— 重跑一遍 002-push.sql（多半是缺了 user_id 那一列）',
      'A row-level security policy blocked it — re-run 002-push.sql (the user_id column is probably missing)',
    )
  }
  return message
}

export async function enablePush(playerId: string | null): Promise<PushResult> {
  if (!pushConfigured()) {
    return { ok: false, error: pick('还没配推送', 'Push is not set up') }
  }
  if (!pushSupported()) {
    return {
      ok: false,
      error: isStandalone()
        ? pick('这台手机的浏览器不支持推送', 'This browser cannot do push notifications')
        : pick(
            'iPhone 上要先把 RALLY 加到主屏幕，从那个图标打开才收得到通知',
            'On iPhone, add RALLY to your Home Screen first — notifications only work from that icon',
          ),
    }
  }

  try {
    const permission = await Notification.requestPermission()
    if (permission === 'denied') {
      setState('denied')
      return {
        ok: false,
        error: pick(
          '通知被拒了。去手机设置里找到 RALLY，把通知打开',
          'Notifications are blocked. Turn them on for RALLY in your phone settings.',
        ),
      }
    }
    if (permission !== 'granted') {
      return { ok: false, error: pick('没有允许通知', 'Notifications were not allowed') }
    }

    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        // 必须 true：只在有事时才推，浏览器不允许静默推送
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY),
      }))

    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: pick('订阅信息不完整', 'The subscription came back incomplete') }
    }

    if (supabase) {
      /*
       * endpoint 当主键：同一台手机重复开关不会堆出一堆行，
       * 而换了手机就是另一个 endpoint，两台都收得到。
       */
      const { error } = await supabase.from('push_subscribers').upsert(
        {
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          player_id: playerId,
        },
        { onConflict: 'endpoint' },
      )
      if (error) return { ok: false, error: readableDbError(error.message) }
    }

    setState('on')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function disablePush(): Promise<PushResult> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      /*
       * 先删库里那条再退订。
       *
       * 反过来的话，退订成功但删库失败，那条订阅就永远留在库里 ——
       * 服务端每次开局都会往一个已经失效的 endpoint 上推，
       * 推不动也没人知道。
       */
      if (supabase) {
        await supabase.from('push_subscribers').delete().eq('endpoint', sub.endpoint)
      }
      await sub.unsubscribe()
    }
    setState('idle')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
