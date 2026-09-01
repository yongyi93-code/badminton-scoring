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

/** 配齐了才建客户端；缺一个就当没有云端 */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // 邮件链接点回来时，token 在 URL 里，交给客户端自己捞
          detectSessionInUrl: true,
        },
      })
    : null

/** 云端到底有没有接上。界面上要按这个决定显不显示同步那一栏 */
export const cloudReady = supabase !== null
