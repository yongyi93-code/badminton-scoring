import { pick } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { silencedText } from '@/lib/ban'

/* ------------------------------------------------------------------ *
 * 朋友圈的评论
 *
 * 规则在 supabase/027-comments.sql，那边写了为什么不抄微信那条
 * 「只看共同好友的评论」、为什么动态的作者也删得掉、为什么评论不能改。
 * 这一层只管把话说对。
 *
 * -------------------------------------------------------------------
 * 一次把整屏的评论拉回来
 *
 * 和点赞同一条：二十条动态各查一次就是二十个请求。
 * 拉回来在这一层按 post_id 分堆，界面拿现成的。
 * ------------------------------------------------------------------ */

/** 一条评论最多多少字。和 027 里那条 check 是同一个数，改一处要改两处 */
export const COMMENT_MAX = 500

export type Comment = {
  id: string
  post_id: string
  author: string
  body: string
  created_at: string
  /** 被管理员下架了。写它的人自己还看得到，别人看不到（027） */
  hidden_at?: string | null
}

export type CommentResult = { ok: true } | { ok: false; error: string }

const COLS = 'id, post_id, author, body, created_at, hidden_at'

/**
 * 这条评论能不能发。
 *
 * 判的是**收拾之后**的：一串空格发出去，界面上是一条空白评论，
 * 看着像坏了。数据库那条 check 也判 btrim，两处是同一个口径。
 */
export function checkComment(body: string): string | null {
  const text = body.trim()
  if (!text) return pick('写点什么再发', 'Write something first')
  if (text.length > COMMENT_MAX) {
    return pick(`最多 ${COMMENT_MAX} 字`, `${COMMENT_MAX} characters max`)
  }
  return null
}

/**
 * 按动态分堆。
 *
 * 顺着时间排，不像动态那样倒着 —— 对话要顺着读，倒着看的是
 * 「最新的在最上面」那种列表，而评论是一段接话。
 */
export function groupByPost(rows: Comment[]): Map<string, Comment[]> {
  const out = new Map<string, Comment[]>()
  for (const c of rows) {
    const list = out.get(c.post_id) ?? []
    list.push(c)
    out.set(c.post_id, list)
  }
  for (const list of out.values()) {
    list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  }
  return out
}

/** 这几条动态下面的全部评论。谁看得到谁由数据库那边挡 */
export async function fetchComments(postIds: string[]): Promise<Map<string, Comment[]>> {
  if (!supabase || postIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('post_comments')
    .select(COLS)
    .in('post_id', postIds.slice(0, 50))
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) {
    /* 没跑过 027 和「一条评论都没有」在这里是同一个结果：一条都不显示 */
    console.warn('评论没拿到:', error.message)
    return new Map()
  }
  return groupByPost((data ?? []) as Comment[])
}

/** 说一句 */
export async function addComment(postId: string, body: string): Promise<CommentResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const bad = checkComment(body)
  if (bad) return { ok: false, error: bad }

  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }

  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, author: uid, body: body.trim() })
    .select(COLS)
  if (error) {
    /* 被禁言的人撞的是触发器，抛回来的是暗号，不是人话 */
    return { ok: false, error: silencedText(error.message) ?? error.message }
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没发出去 —— 这条动态你看不到了', 'Not posted — you can no longer see that post') }
  }
  return { ok: true }
}

/**
 * 删一条。
 *
 * 两种人删得掉，而这一层不用分：策略里写着「自己说的，或者自己
 * 动态下面的」。动了 0 行就是两样都不是。
 */
export async function deleteComment(id: string): Promise<CommentResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data, error } = await supabase
    .from('post_comments')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, error: error.message }
  /* 被策略挡下来的删不报错，只是动了 0 行 —— 这个仓库栽过好几次 */
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      error: pick('删不掉 —— 只能删自己说的，或者自己动态下面的', 'Cannot delete — only your own, or ones under your post'),
    }
  }
  return { ok: true }
}

/** 下架 / 恢复一条评论。只有管理员，而且他只翻得动这一个开关 */
export async function setCommentHidden(id: string, hidden: boolean): Promise<CommentResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data, error } = await supabase
    .from('post_comments')
    .update({ hidden_at: hidden ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没动 —— 只有管理员可以', 'Nothing changed — admins only') }
  }
  return { ok: true }
}
