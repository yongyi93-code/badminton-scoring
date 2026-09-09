/* ------------------------------------------------------------------ *
 * 分享球局的链接
 *
 * 开完局把链接甩到 WhatsApp 群里，球友点一下就进来。
 *
 * 链接里带两样东西：
 *   j = 球局 id      —— 进来之后落在哪一场
 *   c = 球群邀请码   —— 他可能还不在你的球群里
 *
 * 第二样是关键。数据是按球群隔离的（数据库那层拦着），不在群里的人
 * 连这场球局的存在都看不到 —— 只给球局 id 的话，他点进来看到的是
 * 一片空白，而这恰恰是最需要顺畅的那一刻：人已经愿意点了。
 *
 * 所以邀请码要跟着走：一条链接同时办两件事，进群 + 进局。
 *
 * ------------------------------------------------------------------
 * 关于「有 App 就跳进 App」
 *
 * Android 上成立：装成 PWA 之后系统会把这个网址交给它。
 * iPhone 上不成立，而且不是我没做 —— iOS 不让网页应用接管链接，
 * 点开永远是 Safari。这一条谁也绕不过去，除非上架真的 App Store。
 * 从 Safari 里照样能用，只是多顶一条浏览器地址栏。
 * ------------------------------------------------------------------ */

/** 球局 id 那个参数。取一个字母，链接短一点 —— 是要发到聊天里的 */
const P_SESSION = 'j'
const P_CODE = 'c'

export type Invite = {
  sessionId: string
  /** 球群邀请码。分享的人自己也可能没有（理论上不会），所以可选 */
  clubCode?: string
}

/**
 * 拼一条分享链接。
 *
 * 用当前页面的 origin + pathname：这个 App 在自己的域名下是根路径，
 * 但在 GitHub Pages 的子路径下也跑得起来（早期就是那样）。写死路径
 * 的话，换一个部署方式链接就全废了。
 */
export function inviteUrl(invite: Invite, base?: string): string {
  const origin =
    base ??
    (typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : '/')
  const url = new URL(origin, 'https://rallybadminton.com')
  url.searchParams.set(P_SESSION, invite.sessionId)
  if (invite.clubCode) url.searchParams.set(P_CODE, invite.clubCode.toUpperCase())
  return url.toString()
}

/** 从一个网址里读出邀请。不是邀请链接就返回 null */
export function readInvite(href: string): Invite | null {
  try {
    const url = new URL(href)
    const sessionId = url.searchParams.get(P_SESSION)?.trim()
    if (!sessionId) return null
    const clubCode = url.searchParams.get(P_CODE)?.trim().toUpperCase()
    return clubCode ? { sessionId, clubCode } : { sessionId }
  } catch {
    return null
  }
}

/** 把邀请参数从地址栏抹掉，留下干净的网址（原样返回其余部分） */
export function stripInvite(href: string): string {
  try {
    const url = new URL(href)
    url.searchParams.delete(P_SESSION)
    url.searchParams.delete(P_CODE)
    return url.toString()
  } catch {
    return href
  }
}

/**
 * 发到群里的那段话。
 *
 * 链接单独放最后一行：WhatsApp 只把链接那一段变成可点的，
 * 夹在句子中间的话，标点很容易被算进链接里，点开就是 404。
 */
export function shareText(
  info: { venue: string; when: string; host?: string; url: string },
  zh: boolean,
): string {
  const head = zh
    ? info.host
      ? `${info.host} 开了一场球局`
      : '一起来打球'
    : info.host
      ? `${info.host} started a session`
      : 'Come play badminton'
  const line = zh
    ? `${info.venue} · ${info.when}`
    : `${info.venue} · ${info.when}`
  const tail = zh
    ? '点进去就能加入（没装过会先教你装到手机上）'
    : 'Tap to join — it will help you install the app first if you do not have it'
  return `${head}\n${line}\n${tail}\n${info.url}`
}

/* ------------------------------------------------------------------ *
 * 待处理的邀请
 *
 * 存起来是因为中间可能要拐好几道弯：没登录要先登录、不在群里要先进群，
 * 而登录会跳走再跳回来。不存的话，回来时地址栏已经干净了，
 * 那个人只会莫名其妙地落在首页 —— 他明明是点了球局链接来的。
 * ------------------------------------------------------------------ */

const KEY = 'rally-pending-invite'

export function rememberInvite(invite: Invite) {
  try {
    localStorage.setItem(KEY, JSON.stringify(invite))
  } catch {
    // 隐私模式下写不进去。那就只能这一次处理完，不能跨跳转 —— 不致命
  }
}

export function pendingInvite(): Invite | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { sessionId?: unknown; clubCode?: unknown }
    const sessionId = typeof v.sessionId === 'string' ? v.sessionId.trim() : ''
    if (!sessionId) return null
    const clubCode = typeof v.clubCode === 'string' ? v.clubCode.trim() : ''
    return clubCode ? { sessionId, clubCode } : { sessionId }
  } catch {
    return null
  }
}

export function clearInvite() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 同上 */
  }
}
