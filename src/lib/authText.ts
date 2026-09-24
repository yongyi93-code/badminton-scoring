import { pick } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 注册登录这一屏上说的话，和它那两条岔路
 *
 * 单拎出来只有一个理由：**它们测得到**。store/useAuth 一被 import
 * 就会挂上 supabase 的会话监听，在测试里那会拖起一整个客户端 ——
 * 于是这几句话反而成了整个 App 里最难测的部分，而它们是陌生人
 * 见到这个 App 的第一屏。
 *
 * 这一屏说错一句，人就走了，而且不会告诉你为什么。
 * ------------------------------------------------------------------ */

export type AuthResult =
  | {
      ok: true
      /**
       * 注册成功了，但还差去邮箱点一下链接。
       *
       * 这**不是失败**，所以它在 ok 这一边。放错边的后果是界面弹一个
       * 红色报错框说「注册成功了」—— 而人看到红色就以为自己没注册上，
       * 会再注册一遍，然后撞上「这个邮箱已经注册过了」。
       *
       * 值是那个邮箱地址：界面要把它显示出来（人常常打错），
       * 并且拿它去重发。
       */
      confirm?: string
    }
  | {
      ok: false
      error: string
      /** 登录被挡是因为邮箱还没验证 —— 界面要顺手给个「重发」按钮 */
      unconfirmed?: boolean
    }

/**
 * 把 Supabase 的报错翻译成人话。
 *
 * 原样把英文错误抛给用户是最省事也最没用的做法 —— 「Invalid login
 * credentials」对着一个只想记分的人说不出任何有用的信息。
 * 认不出来的才退回原文，至少还能搜。
 */
export function readableError(message: string): string {
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
  /*
   * 这一句原来写的是「去 Supabase 后台把 Confirm email 关掉」。
   *
   * 那是写给我自己看的 —— 而它出现在一个刚装上 App 的陌生人眼前。
   * 用户界面上不该出现任何一个只有开发者才懂的名词：他既进不去那个
   * 后台，也不该知道这个 App 是拿什么搭的。
   *
   * 现在这一句只说他能做的那件事，界面那边还会跟着给一个「重发」按钮。
   */
  if (m.includes('email not confirmed')) {
    return pick(
      '这个邮箱还没验证 —— 去收件箱点一下那个链接。找不到就翻翻垃圾邮件。',
      'This email is not verified yet — open the link in your inbox. Check your spam folder too.',
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

/**
 * 注册回来之后该给界面什么。
 *
 * 拆出来是为了测得到 —— 这一步的两条路在界面上差别很大，而它本身
 * 只是一个 if：
 *
 *   有 session   已经登录进去了，关掉弹层就行
 *   没有 session 后台开着邮箱验证。**这不是失败**：账号建好了，
 *                只差他去点一下那个链接
 *
 * 第二条原来是当成失败返回的，弹出来的是红色报错框，里面还写着
 * 「在 Supabase 后台把 Confirm email 关掉」—— 一句他既看不懂、
 * 也做不到的话。人看到红色会再注册一遍，然后撞上「这个邮箱已经
 * 注册过了」，于是彻底卡在门口。
 */
export function signUpOutcome(hasSession: boolean, email: string): AuthResult {
  return hasSession ? { ok: true } : { ok: true, confirm: email }
}
