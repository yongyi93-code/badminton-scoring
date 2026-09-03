import { useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import { pick } from '@/lib/i18n'
import { arrivedFromAuthLink, supabase } from '@/lib/supabase'
import { flushNow, startSync, stopSync } from '@/lib/sync'
import { useApp } from '@/store/useApp'

/* ------------------------------------------------------------------ *
 * 登录状态
 *
 * 只管「是谁登录了」，不管数据同步 —— 那是下一步的事。
 *
 * 没接云端（supabase 是 null）时，这里一切照旧返回未登录，
 * 整个 App 照常跑。离线可用是底线，不能因为云端没接上就起不来。
 *
 * 用邮箱 + 密码，而不是邮件魔术链接：Supabase 免费版自带的邮件服务
 * 有频率限制，而这个 App 的注册高峰恰恰是「一队人同一晚上一起注册」——
 * 正好撞在限流上。密码注册一封邮件都不发（前提是后台把
 * Confirm email 关掉），八个人一起注册也不会卡。
 * ------------------------------------------------------------------ */

export type AuthState = {
  /** null = 未登录；undefined = 还在问 Supabase，别急着画界面 */
  session: Session | null | undefined
  /**
   * 正在走「忘记密码」的流程。
   *
   * 点邮件链接回来时，supabase 会用那个令牌建一个临时会话 —— 也就是
   * 说这个人此刻「已登录」，但他还没有可用的密码。界面必须认出这个
   * 状态并让他设一个新的，否则他这次关掉 App 就又进不来了。
   */
  recovering: boolean
}

let current: AuthState = {
  session: supabase ? undefined : null,
  /*
   * 从邮件链接进来的，先当成在重设密码。
   *
   * 不等 PASSWORD_RECOVERY 事件才置位：那个事件在 supabase 解析完
   * URL 之后才发，而解析是异步的 —— 中间那几十毫秒界面已经画完了，
   * 画的是「已登录」的样子，重设密码那一屏根本没出现过。
   */
  recovering: supabase !== null && arrivedFromAuthLink,
}
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((fn) => fn())

const set = (next: AuthState) => {
  current = next
  emit()
}

/*
 * 登录状态一变，同步跟着开或关。
 *
 * 放在这里而不是某个组件的 effect 里：同步是整个 App 的事，
 * 不该跟着某一屏挂载卸载。组件里写还会漏掉「App 一启动就已经登录着」
 * 这种情况。
 */
function follow(session: Session | null) {
  set({ ...current, session })
  if (session) void startSync()
  else stopSync()
}

/* 启动时先问一次现有会话，之后交给 onAuthStateChange */
if (supabase) {
  supabase.auth
    .getSession()
    .then(({ data }) => follow(data.session))
    .catch(() => set({ ...current, session: null }))

  supabase.auth.onAuthStateChange((event, session) => {
    // supabase 认出这是重设密码的回调时会发这个事件，跟着置位
    if (event === 'PASSWORD_RECOVERY') set({ ...current, recovering: true })
    follow(session)
  })
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** 组件里用这个，登录状态一变就重渲染 */
export function useAuth() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => ({ session: null, recovering: false }) as AuthState,
  )
}

/** 当前登录的邮箱，没登录返回 null */
export const currentEmail = (): string | null =>
  current.session?.user.email ?? null

/**
 * 把 Supabase 的报错翻译成人话。
 *
 * 原样把英文错误抛给用户是最省事也最没用的做法 —— 「Invalid login
 * credentials」对着一个只想记分的人说不出任何有用的信息。
 * 认不出来的才退回原文，至少还能搜。
 */
function readableError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) {
    return pick('邮箱或密码不对', 'Wrong email or password')
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return pick('这个邮箱已经注册过了，直接登录就行', 'That email is already registered — just sign in')
  }
  if (m.includes('password should be at least')) {
    return pick('密码太短了，至少 6 位', 'Password is too short — at least 6 characters')
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return pick('邮箱格式不对', 'That email does not look right')
  }
  if (m.includes('email not confirmed')) {
    return pick(
      '这个邮箱还没验证。去 Supabase 后台把 Confirm email 关掉，或者点邮件里的链接',
      'Email not confirmed. Turn off "Confirm email" in Supabase, or click the link in the email',
    )
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return pick('太频繁了，等一会儿再试', 'Too many attempts — wait a bit')
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return pick('连不上服务器，检查一下网络', 'Cannot reach the server — check your connection')
  }
  return message
}

/** 云端没接上时统一给这句，省得每个入口各写一遍 */
const noCloud = () =>
  pick('还没接云端', 'Cloud sync is not set up')

export type AuthResult = { ok: true } | { ok: false; error: string }

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  return error ? { ok: false, error: readableError(error.message) } : { ok: true }
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  })
  if (error) return { ok: false, error: readableError(error.message) }
  /*
   * 后台还开着 Confirm email 时，signUp 会成功但不给 session ——
   * 界面上得说清楚，否则用户看到「成功」却没登录进去，一头雾水。
   */
  if (!data.session) {
    return {
      ok: false,
      error: pick(
        '注册成功了，但这个项目还要求验证邮箱。去收件箱点一下链接，或者在 Supabase 后台把 Confirm email 关掉',
        'Signed up, but this project still requires email confirmation. Click the link in your inbox, or turn off "Confirm email" in Supabase',
      ),
    }
  }
  return { ok: true }
}

/**
 * 退出登录：连本机那份缓存一起清掉。
 *
 * 为什么要清：这份数据属于那个账号，不属于这台手机。不清的话，
 * 退出之后「我的」页面还挂着上一个人的名字和角色 —— 而下一个人
 * 在这台手机上登录，看到的第一屏是别人的战绩。
 *
 * 四步的顺序是有讲究的：
 *
 *   1) 先把没推上去的推干净。第 3 步会清掉本机缓存，没推的就没了
 *   2) 再断掉同步。同步是「订阅整个 store 算差异」，同步开着的时候
 *      清空 store，差异算出来就是「这个人把所有东西都删了」，然后
 *      老老实实推上去，把云端所有人的数据一起抹掉 —— 「全部清空，
 *      重新开始」正是靠这个行为把云端一起清掉的，同一个机制用在
 *      退出登录上就是事故。tests 里有一条把这件事钉成了可执行的。
 *   3) 清本机缓存
 *   4) 最后才真的登出
 *
 * 说句老实的：2 和 3 就算写反了，今天也不会出事 —— stopSync 会在
 * 同一个 tick 里把攒着的那个防抖定时器清掉，推送根本没机会发出去。
 * 但那是运气不是设计，中间只要多一个 await 就不成立了。
 */
export async function signOut(): Promise<{ ok: true } | { ok: false; error: string }> {
  const flushed = await flushNow()
  if (!flushed.ok) return flushed

  stopSync()
  useApp.getState().resetAll()
  await supabase?.auth.signOut()
  return { ok: true }
}

/**
 * 发一封重设密码的邮件。
 *
 * redirectTo 必须给全 —— 邮件里的链接跳回哪儿由它决定。默认会用后台
 * 那个 Site URL，而那个多半还是 localhost，点了直接死在一个不存在的
 * 地址上。origin + pathname 正好是 GitHub Pages 那个子路径的样子。
 *
 * 后台 URL Configuration 的 Redirect URLs 里也得有这个地址，
 * 否则 Supabase 会拒绝跳转 —— 这一条只能在后台配，代码里管不了。
 */
export async function sendPasswordReset(email: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const redirectTo = `${window.location.origin}${window.location.pathname}`
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
  return error ? { ok: false, error: readableError(error.message) } : { ok: true }
}

/**
 * 设一个新密码。
 *
 * 只在「点邮件链接回来」那个临时会话里用得上：那时候人是登录着的，
 * 但手上没有可用的密码。设完把 recovering 关掉，界面回到正常。
 */
export async function setNewPassword(password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { ok: false, error: readableError(error.message) }
  set({ ...current, recovering: false })
  scrubAuthParams()
  return { ok: true }
}

/** 放弃重设（比如链接过期了想重新来过） */
export function cancelRecovery(): void {
  set({ ...current, recovering: false })
  scrubAuthParams()
}

/**
 * 把地址上那截登录凭证抹掉。
 *
 * supabase 自己会清掉 hash，但 PKCE 那条路留下的是 ?code=…，它不管。
 * 留着的后果是刷新一次又被当成一次回调 —— 而那个令牌已经用掉了，
 * 于是每次刷新都弹一遍「重设密码」，还报链接失效。
 *
 * 时机很重要：只能在重设结束之后调。提前抹掉，supabase 还没来得及
 * 读，人就白点了那封邮件。
 */
function scrubAuthParams(): void {
  try {
    const url = new URL(location.href)
    let touched = false
    for (const k of ['code', 'error', 'error_code', 'error_description']) {
      if (url.searchParams.has(k)) {
        url.searchParams.delete(k)
        touched = true
      }
    }
    if (url.hash) {
      url.hash = ''
      touched = true
    }
    if (touched) history.replaceState(history.state, '', url.toString())
  } catch {
    /* 抹不掉也不影响用 */
  }
}
