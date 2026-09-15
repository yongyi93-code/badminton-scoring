import { useSyncExternalStore } from 'react'
import {
  fetchBlocked,
  fetchFriendships,
  fetchMessages,
  unwatchSocial,
  watchSocial,
  type Friendship,
  type Message,
} from '@/lib/social'
import {
  fetchIsAdmin,
  fetchMyReports,
  fetchOpenReportCount,
  type Report,
} from '@/lib/report'
import { fetchOpenFeedbackCount } from '@/lib/feedback'
import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ *
 * 好友和私聊 —— 状态那一层
 *
 * 故意不用 zustand persist：这几样东西一个字都不落本机。
 * 私信留在这台手机上，下一个用这台手机的人就翻得到 ——
 * 而球馆里一台手机轮流记分是常事。
 *
 * 于是断网时这一块是空的。这是选择，不是遗漏：发不出去的消息
 * 不是消息，而一个「看起来有、其实发不出去」的聊天界面比没有更糟。
 *
 * 这一层只干两件别处不该重复的事：
 *   1. 球员 id ↔ auth uid 的换算（全 App 只有这一处）
 *   2. 从一堆平铺的消息里，算出「会话」和「未读」
 * ------------------------------------------------------------------ */

export type SocialState = {
  /** 拉过一次没有。false 时界面该显示「正在拿」，不是「你没有好友」 */
  ready: boolean
  /** 我牵涉在内的全部好友关系，申请中的也算 */
  friendships: Friendship[]
  /** 我参与的最近那些私信，按时间顺着排 */
  messages: Message[]
  /** 我拉黑了谁 */
  blocked: string[]
  /**
   * 我举报过谁。不带证据 —— 列表上用不着，而证据是一整段聊天记录。
   * 查不到「谁举报了我」，那是故意的，见 lib/report.ts。
   */
  myReports: Report[]
  /**
   * 我是不是管理员。
   *
   * 只用来决定那个入口显不显示 —— 真正的把门在数据库的策略上，
   * 不在这个布尔值上。把它改成 true 也一行举报都读不到。
   */
  isAdmin: boolean
  /** 队列里还有几条没处理。不是管理员时永远是 0 */
  openReports: number
  /** 还有几条反馈没看。不是管理员时永远是 0 */
  openFeedback: number
  /** 我自己的 auth uid。没登录就是 null */
  meUid: string | null
}

const EMPTY: SocialState = {
  ready: false,
  friendships: [],
  messages: [],
  blocked: [],
  myReports: [],
  isAdmin: false,
  openReports: 0,
  openFeedback: 0,
  meUid: null,
}

let current: SocialState = EMPTY
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

const set = (patch: Partial<SocialState>) => {
  current = { ...current, ...patch }
  emit()
}

/*
 * 同一时间只跑一次重拉。
 *
 * realtime 推过来的事件是连着来的（发一条消息，对面收到一次
 * INSERT，标记已读又是一次 UPDATE），每一次都重拉的话，
 * 三条并发的请求回来的顺序不保证，最后落下的可能是最旧的那份。
 */
let loading = false
let again = false

export async function refreshSocial(): Promise<void> {
  if (!supabase) {
    set({ ready: true })
    return
  }
  if (loading) {
    again = true
    return
  }
  loading = true
  try {
    const { data } = await supabase.auth.getSession()
    const meUid = data.session?.user.id ?? null
    if (!meUid) {
      current = { ...EMPTY, ready: true }
      emit()
      return
    }
    const [friendships, messages, blocked, myReports, isAdmin] = await Promise.all([
      fetchFriendships(),
      fetchMessages(),
      fetchBlocked(),
      fetchMyReports(),
      fetchIsAdmin(),
    ])
    /*
     * 队列那个数只有管理员才问得对 —— 普通人问回来的是「我自己
     * 发出去还没人处理的那几条」，摆在「举报队列」旁边是错的
     * （见 lib/report.ts）。所以它单独多跑一趟，而且只对管理员跑。
     */
    const [openReports, openFeedback] = isAdmin
      ? await Promise.all([fetchOpenReportCount(), fetchOpenFeedbackCount()])
      : [0, 0]
    set({
      ready: true,
      friendships,
      messages,
      blocked,
      myReports,
      isAdmin,
      openReports,
      openFeedback,
      meUid,
    })
  } finally {
    loading = false
    if (again) {
      again = false
      void refreshSocial()
    }
  }
}

/** 登录之后开起来；退出时关掉。挂在 useAuth 的 follow 里，不挂在组件上 */
export function startSocial(): void {
  void refreshSocial()
  watchSocial(() => void refreshSocial())
}

export function stopSocial(): void {
  unwatchSocial()
  current = EMPTY
  emit()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function useSocial(): SocialState {
  return useSyncExternalStore(subscribe, () => current, () => EMPTY)
}

export const socialState = () => current

/* ------------------------------------------------------------------ *
 * 从平铺的数据里算出「关系」
 *
 * 全是纯函数，好测，也好在组件里用 useMemo 包住。
 * ------------------------------------------------------------------ */

/** 一段关系里，对方是谁 */
export const otherSide = (f: Friendship, meUid: string) =>
  f.requester === meUid ? f.addressee : f.requester

/** 已经是好友的那些人的 uid */
export function friendUids(s: SocialState): string[] {
  if (!s.meUid) return []
  return s.friendships
    .filter((f) => f.status === 'accepted')
    .map((f) => otherSide(f, s.meUid!))
}

/** 别人发给我、我还没处理的申请 */
export function incomingRequests(s: SocialState): Friendship[] {
  if (!s.meUid) return []
  return s.friendships.filter((f) => f.status === 'pending' && f.addressee === s.meUid)
}

/** 我发出去、对方还没点头的 */
export function outgoingRequests(s: SocialState): Friendship[] {
  if (!s.meUid) return []
  return s.friendships.filter((f) => f.status === 'pending' && f.requester === s.meUid)
}

/**
 * 我和某个人现在是什么关系。
 *
 * 界面上那个按钮要显示「加好友 / 等他同意 / 同意 / 已是好友」，
 * 全靠这一个函数 —— 分散到各处去判 status 和方向，
 * 迟早有一处把「他等我」显示成「我等他」。
 */
export type Standing =
  | { kind: 'none' }
  | { kind: 'friends'; id: string }
  | { kind: 'sent'; id: string }
  | { kind: 'received'; id: string }
  | { kind: 'blocked' }

export function standingWith(s: SocialState, uid: string | null | undefined): Standing {
  if (!uid || !s.meUid || uid === s.meUid) return { kind: 'none' }
  if (s.blocked.includes(uid)) return { kind: 'blocked' }
  const f = s.friendships.find(
    (x) =>
      (x.requester === s.meUid && x.addressee === uid) ||
      (x.addressee === s.meUid && x.requester === uid),
  )
  if (!f) return { kind: 'none' }
  if (f.status === 'accepted') return { kind: 'friends', id: f.id }
  return f.requester === s.meUid ? { kind: 'sent', id: f.id } : { kind: 'received', id: f.id }
}

/** 和某个人之间的全部消息，顺着时间排 */
export function threadWith(s: SocialState, uid: string): Message[] {
  return s.messages.filter(
    (m) =>
      (m.sender === uid && m.recipient === s.meUid) ||
      (m.sender === s.meUid && m.recipient === uid),
  )
}

export type Thread = {
  uid: string
  last: Message
  unread: number
}

/**
 * 会话列表：每个聊过的人一行，按最后一条消息的时间倒着排。
 *
 * 只列聊过的 —— 好友列表是另一份。一个刚加上的好友出现在
 * 「聊天」里、显示一句空白，那一行不告诉人任何事。
 */
export function threads(s: SocialState): Thread[] {
  if (!s.meUid) return []
  const byUid = new Map<string, Thread>()
  for (const m of s.messages) {
    const other = m.sender === s.meUid ? m.recipient : m.sender
    const unread = m.recipient === s.meUid && m.read_at === null ? 1 : 0
    const prev = byUid.get(other)
    /* messages 是顺着时间来的，所以后面的一定更新，直接盖过去就行 */
    byUid.set(other, {
      uid: other,
      last: m,
      unread: (prev?.unread ?? 0) + unread,
    })
  }
  return [...byUid.values()].sort((a, b) => b.last.created_at.localeCompare(a.last.created_at))
}

/** 一共多少条没读。tab 栏上那个小红点看这个 */
export function unreadCount(s: SocialState): number {
  if (!s.meUid) return 0
  return s.messages.filter((m) => m.recipient === s.meUid && m.read_at === null).length
}

/** 好友申请 + 未读私信，合起来是「我的」那一栏上的小红点 */
export const socialBadge = (s: SocialState): number =>
  unreadCount(s) + incomingRequests(s).length
