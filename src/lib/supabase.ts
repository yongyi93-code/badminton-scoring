import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/* ------------------------------------------------------------------ *
 * Supabase 客户端
 *
 * 这个 App 一直是本地优先的：所有数据在 localStorage 里，离线能用，
 * 关掉网络照样记分。云端是「加上去」的一层，不是「换过去」——
 * 所以：
 *
 * - 没配连接参数时，supabase 是 null，整个 App 照常跑。
 *   离线可用是这个 App 的底线，不能因为云端没接上就起不来。
 * - 每一处用到它的地方都必须先判空，别假设它一定在。
 *
 * 打包进前端的那个 key 是 publishable 的，公开的，谁都看得到 ——
 * 安全靠数据库里的 RLS 规则，不靠藏它。
 * ------------------------------------------------------------------ */

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/**
 * 这次打开，地址里是不是真的带着一张登录凭证？
 *
 * 「忘记密码」的邮件链接会把令牌带回来，supabase 得去 URL 里捡它 ——
 * 但那个开关一旦常开，就会把我们自己加的 ?_v=（检查更新用的）也当成
 * 一次没认出来的登录回调，顺手把存着的会话清掉。那个 bug 出过一次，
 * 表现是「点完检查更新发现自己被登出了」，很难往这上面想。
 *
 * 所以不常开，只在这一次打开确实带着凭证时才开。两种形式都认：
 *   #access_token=…&type=recovery   旧的隐式流
 *   ?code=…                          PKCE 流
 *   #error_code=otp_expired          链接过期，也要让 supabase 接住并报错
 *
 * 这个 App 自己只会往地址上加 ?_v=，绝不会加 code / access_token，
 * 所以看到那几个就一定是从邮件回来的。
 */
export function looksLikeAuthCallback(href: string): boolean {
  try {
    const url = new URL(href)
    const hash = url.hash
    return (
      /(^|[#&])(access_token|refresh_token|error_code|error_description)=/.test(hash) ||
      /(^|[#&])type=recovery/.test(hash) ||
      url.searchParams.has('code')
    )
  } catch {
    return false
  }
}

/** 记下来给界面用：这次打开是不是从「忘记密码」邮件点回来的 */
export const arrivedFromAuthLink =
  typeof window !== 'undefined' && looksLikeAuthCallback(window.location.href)

/** 配齐了才建客户端；缺一个就当没有云端 */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          /*
           * 只在这一次打开确实带着凭证时才开，平时一律关着。
           *
           * 这个开关让 supabase 在启动时去 URL 里找登录令牌。「忘记密码」
           * 的邮件链接需要它 —— 令牌就在地址里，不捡就没了。
           *
           * 但常开会出事：「检查更新」重载时会往地址上加一个 ?_v= 绕过
           * 缓存，它把那个当成一次没认出来的登录回调，顺手就把存着的
           * 会话清了 —— 表现是点完更新发现自己被登出。这个 bug 真出过。
           *
           * 所以按 URL 决定（见上面 hasAuthCallback），两头都占住。
           */
          detectSessionInUrl: arrivedFromAuthLink,
        },
      })
    : null

/** 云端到底有没有接上。界面上要按这个决定显不显示同步那一栏 */
export const cloudReady = supabase !== null
