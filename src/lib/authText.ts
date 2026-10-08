import { pick } from '@/lib/i18n'
import { channelName } from '@/lib/phone'

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
      /**
       * 注册时发现这个邮箱早就注册过了。
       *
       * 放在 ok:false 这边是因为「账号没建成」，但它**不该画成红色报错**：
       * 他什么都没做错，只是走错了门。界面认出这一条之后该做的事是
       * 把他切到「登录」，而不是让他对着一句红字发愣。
       */
      already?: boolean
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
  /* ---------------------------------------------------------------- *
    手机号那条路上的几句。
    它们和邮箱那几句一样要紧 —— 这一屏是陌生人见到这个 App 的第一屏，
    而手机号这条本来就是做给「连邮箱都嫌麻烦」的人用的：
    说错一句，他连第一步都迈不过去。
  * ---------------------------------------------------------------- */
  if (m.includes('invalid phone') || m.includes('unable to validate phone')) {
    return pick('这个号码不对，检查一下', 'That number does not look right')
  }
  /*
   * 验证码错了和过期了，Supabase 回的是同一句。
   * 不分开猜 —— 两种的下一步都是「再要一条」，说成一句反而清楚。
   */
  if (m.includes('token has expired') || m.includes('invalid otp') || m.includes('otp_expired')) {
    return pick('验证码不对，或者已经过期了 —— 重新要一条', 'That code is wrong or has expired — ask for a new one')
  }
  /*
   * 后台还没配发消息那一端。
   *
   * 这一句**用户什么都做不了**，所以不提任何后台名词，
   * 只告诉他还有另一条路能走。
   */
  if (
    m.includes('provider is not enabled') ||
    m.includes('phone provider') ||
    m.includes('sms provider') ||
    m.includes('unsupported phone provider')
  ) {
    return pick(
      '手机号登录暂时用不了，先用邮箱注册吧',
      'Phone sign-in is not available right now — use email for now',
    )
  }
  if (m.includes('error sending') || m.includes('failed to send')) {
    return pick(
      `验证码发不出去 —— 确认这个号码能收${channelName(true)}，或者改用邮箱`,
      `Could not send the code — check this number can receive ${channelName(false)}, or use email`,
    )
  }
  /*
   * 「等 X 秒再试」是 Supabase 给验证码那条路的防刷。
   * 把秒数留着：一句带数字的话，人会真的等；一句「太频繁了」，
   * 人只会一直点。
   */
  const wait = /after (\d+) seconds?/.exec(m)
  if (wait) {
    return pick(`太快了，等 ${wait[1]} 秒再要一次`, `Too fast — wait ${wait[1]} seconds`)
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
 * 拆出来是为了测得到 —— 这一步的三条路在界面上差别很大，而它本身
 * 只是两个 if：
 *
 *   有 session        已经登录进去了，关掉弹层就行
 *   这个邮箱有人用了  **没建成**，该让他去登录
 *   都不是            账号建好了，只差他去点一下那封邮件里的链接
 *
 * -------------------------------------------------------------------
 * 中间那一条是补上的，而它是线上真的坑到人的那一条
 *
 * 用一个已经注册过、而且已经验证过的邮箱再注册一次，Supabase
 * **不报错、也不发信**，只回一个空壳用户（这是它防「拿注册接口
 * 扫谁有没有账号」的设计，装在这个仓库里的那份 auth-js 的注释原话是
 * 「an obfuscated/fake user object is returned」）。
 *
 * 旧代码只看有没有 session，于是这一条和「要去验证邮箱」长得一模一样 ——
 * App 当着他的面说「我们往 … 发了一封验证邮件」，而那封信**根本不存在**。
 * 他会一直等、一直点重发、翻垃圾邮件，最后认定这个 App 坏了。
 *
 * 这种错最毒的地方是它不报错：日志里那一行是干干净净的 200。
 */
export function signUpOutcome(d: {
  hasSession: boolean
  /** Supabase 回了个空壳用户（identities 是空的）—— 这个邮箱已经有人用了 */
  alreadyRegistered: boolean
  email: string
}): AuthResult {
  if (d.hasSession) return { ok: true }
  if (d.alreadyRegistered) {
    return {
      ok: false,
      already: true,
      error: pick(
        '这个邮箱已经注册过了 —— 已经帮你切到「登录」，填密码就行。密码忘了就点下面那个「忘记密码了？」。',
        'That email is already registered — switched you to Sign in. Enter your password, or use “Forgot your password?” below.',
      ),
    }
  }
  return { ok: true, confirm: d.email }
}

/* ------------------------------------------------------------------ *
 * 改密码
 * ------------------------------------------------------------------ */

/** 密码最短多少位。和注册那一屏、和 Supabase 后台那个数是同一个 */
export const PASSWORD_MIN = 6

/**
 * 这三个格子填得对不对。不对就给一句人话。
 *
 * 在发请求之前判一遍：改密码要先拿旧密码去验一次身份（一个来回），
 * 让人等完那一下才说「两次输的不一样」，是最没必要的一种等待。
 *
 * 顺序有讲究，从「最可能填错」排到「最不可能」：空着 → 太短 →
 * 两次不一致 → 和旧的一样。反过来的话，一个什么都没填的人先被告知
 * 「新密码和现在的一样」，那句话毫无意义。
 */
export function checkPasswordChange(d: {
  current: string
  next: string
  again: string
}): string | null {
  if (!d.current) return pick('先填现在的密码', 'Enter your current password first')
  if (d.next.length < PASSWORD_MIN) {
    return pick(`新密码至少 ${PASSWORD_MIN} 位`, `New password needs ${PASSWORD_MIN}+ characters`)
  }
  /*
   * 两次不一致要挡死。
   *
   * 这是这一屏唯一能把人锁在自己账号外面的错误：改成了一个他以为的
   * 密码，而真正生效的是打错的那个 —— 下次登录才发现，那时候已经
   * 想不起自己打错了什么。
   */
  if (d.next !== d.again) return pick('两次输的新密码不一样', 'The two new passwords do not match')
  if (d.next === d.current) return pick('新密码和现在的一样', 'That is already your password')
  return null
}
