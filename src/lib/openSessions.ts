import { supabase } from '@/lib/supabase'
import { openDiff, sortOpen, type OpenRow } from '@/lib/openBoard'

/* ------------------------------------------------------------------ *
 * 公开球局：真正发请求的那一层
 *
 * 纯逻辑（哪一场该公开、行长什么样、差在哪）在 lib/openBoard.ts。
 * 这个文件只负责和那张表说话，不做判断。
 *
 * -------------------------------------------------------------------
 * 拿不到就是一张空列表，不是错
 *
 * 没跑过 030、离线、没登录，都会拿到空的。那时候「公开」那一栏
 * 显示「这会儿没有公开的局」—— 和这个功能出现之前一模一样。
 * 这一层是锦上添花，不该因为它挂了让整屏出错。
 * ------------------------------------------------------------------ */

const COLS =
  'session_id,host_uid,club_code,venue,state,date,time,courts,joined,max_players,host_name'

/** 一次最多拉多少。几百场之后要翻页，那是以后的事 */
const LIMIT = 200

/** 全 App 的公开球局。按日期时间排好 */
export async function fetchOpenSessions(): Promise<OpenRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('open_sessions')
    .select(COLS)
    .order('date', { ascending: true })
    .limit(LIMIT)
  if (error) {
    /* 没跑过 030 和「一场都没有」在这里是同一个结果：空列表 */
    console.warn('公开球局没拿到:', error.message)
    return []
  }
  return sortOpen((data ?? []) as OpenRow[])
}

/** 我发布过的那几行。同步那一步要拿它和本机比 */
export async function fetchMyOpenSessions(): Promise<OpenRow[]> {
  if (!supabase) return []
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('open_sessions')
    .select(COLS)
    .eq('host_uid', uid)
  if (error) return []
  return (data ?? []) as OpenRow[]
}

/**
 * 把「本机该公开的那几场」和「云端已经公开的那几行」对齐。
 *
 * 只动自己那几行 —— 写策略是 `host_uid = auth.uid()`，想动别人的
 * 也动不了（本机跑真 Postgres 撞过：改 0 行、删 0 行）。
 *
 * -------------------------------------------------------------------
 * 为什么先 diff 再写
 *
 * 这段代码跟着本机球局的任何一点变动跑（加一个人、打完一场），
 * 一晚上是几十次。不 diff 的话就是几十次写同样的内容 —— 免费版的
 * 数据库不该这么用，而且每一次写都是一次可能失败的网络请求。
 *
 * -------------------------------------------------------------------
 * 失败了不吭声，但**要说清楚失败了**
 *
 * 发布不成功不该挡住任何事：球照打、分照记，只是别人在列表上看不到
 * 这一场。所以这里不抛错，只把结果返回去 —— 界面要不要提一句由它定。
 *
 * -------------------------------------------------------------------
 * scope = 这台手机现在在哪个球群
 *
 * `fetchMyOpenSessions` 拉的是**我发布过的全部**，不分球群；而 `want`
 * 只算得出**当前球群**那几场。撤行必须限制在 scope 底下，不然换个群
 * 就会把上一个群里正开着的局撤掉（理由写在 openDiff 上）。
 */
export async function syncOpenSessions(
  want: OpenRow[],
  scope: string | null,
): Promise<{ ok: boolean; upserted: number; removed: number; error?: string }> {
  if (!supabase) return { ok: true, upserted: 0, removed: 0 }
  const have = await fetchMyOpenSessions()
  const { upsert, remove } = openDiff(want, have, { scope })
  if (upsert.length === 0 && remove.length === 0) {
    return { ok: true, upserted: 0, removed: 0 }
  }

  if (upsert.length > 0) {
    /*
     * upsert 而不是先查再决定 insert/update：并发下那两步中间会有
     * 另一台手机插进来（同一个人两台设备都开着这个 App）。
     * 主键是 session_id，撞上就覆盖 —— 覆盖的是自己那一行，没损失。
     */
    const { error } = await supabase
      .from('open_sessions')
      .upsert(upsert, { onConflict: 'session_id' })
    if (error) return { ok: false, upserted: 0, removed: 0, error: error.message }
  }

  if (remove.length > 0) {
    /*
     * 删完数一下真的删了几行，别只看 error 是不是 null。
     *
     * 被策略挡下来的 DELETE **不报错**，只是动了 0 行 —— 这个仓库
     * 栽过好几次，最近一次是 029（清过期 Story 那个函数白跑了一整天）。
     */
    const { data: gone, error } = await supabase
      .from('open_sessions')
      .delete()
      .in('session_id', remove)
      .select('session_id')
    if (error) return { ok: false, upserted: upsert.length, removed: 0, error: error.message }
    const removed = (gone ?? []).length
    if (removed !== remove.length) {
      console.warn(`该从公开列表撤掉 ${remove.length} 行，实际撤掉 ${removed} 行`)
    }
    return { ok: true, upserted: upsert.length, removed }
  }

  return { ok: true, upserted: upsert.length, removed: 0 }
}
