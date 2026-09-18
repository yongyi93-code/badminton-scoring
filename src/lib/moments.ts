import { pick } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { photoPath, shrinkImage } from '@/lib/photo'

/* ------------------------------------------------------------------ *
 * 朋友圈
 *
 * 规则在 supabase/024-moments.sql，那边写了为什么这一版没有「公开」
 * 那一档、为什么动态不能改、为什么照片放私有桶。这一层只管把话说对。
 *
 * -------------------------------------------------------------------
 * 这一版只有好友看得到，而且连那个字段都没有
 *
 * 产品定的是「默认好友可见，单条可以选公开」。公开那一档要等封号做完 ——
 * 一条公开的动态，陌生人看得到，而「举报之后管理员能做什么」现在的
 * 答案还是「只能点一下已处理」。
 *
 * -------------------------------------------------------------------
 * 照片是**签出来**的，不是拼出来的
 *
 * moments 桶是私有的，所以没有固定地址：每次要显示，拿路径去换一个
 * 有期限的链接。换的时候服务端会过一遍策略（自己 / 好友），所以
 * 「谁看得到」这件事在两端是同一个答案，不是靠客户端自觉。
 *
 * 链接会过期。这一屏一次签一批（不是一张一次），过期了就是下次进来
 * 重签 —— 所以**不能把签出来的地址存进任何地方**。
 * ------------------------------------------------------------------ */

/** 正文最多多少字。和 024 里那条 check 是同一个数，改一处要改两处 */
export const BODY_MAX = 1000
/** 一条最多几张图。同上 */
export const MAX_PHOTOS = 9
/** 动态照片长边压到多少。比头像大得多 —— 这个是要看内容的，不是看脸的 */
export const POST_BOX = 1080
/** 压完不许超过多大。桶那边卡 1 MB，这里留一档余量 */
export const POST_MAX_BYTES = 900 * 1024
/** 链接签多久。一屏刷完足够，而越短越安全 */
export const SIGN_SECONDS = 60 * 60

export type Post = {
  id: string
  author: string
  body: string | null
  photos: string[]
  created_at: string
}

/** 界面上那一条：动态本身，加上签好的图和赞 */
export type FeedItem = Post & {
  /** 签出来的临时地址，和 photos 一一对应。签不出来的那张会被去掉 */
  urls: string[]
  likes: number
  /** 我点过没有 */
  liked: boolean
}

const COLS = 'id, author, body, photos, created_at'

/**
 * 这条动态能不能发。发不了就给一句人话。
 *
 * 在按下「发」之前判 —— 压几张手机原图要好几秒，而那几秒之后再说
 * 「不行」，人已经等过了。头像那边（checkFile）是同一条道理。
 */
export function checkDraft(d: { body: string; count: number }): string | null {
  const body = d.body.trim()
  if (!body && d.count === 0) {
    return pick('写点什么，或者放一张照片', 'Write something, or add a photo')
  }
  if (body.length > BODY_MAX) {
    return pick(`最多 ${BODY_MAX} 字`, `${BODY_MAX} characters max`)
  }
  if (d.count > MAX_PHOTOS) {
    return pick(`最多 ${MAX_PHOTOS} 张`, `${MAX_PHOTOS} photos max`)
  }
  return null
}

/**
 * 几张图摆成什么样。
 *
 * 一张就铺满（横竖都看得出是什么），四张摆成 2×2（摆成 3+1 会在
 * 第二行留一个尴尬的空位），其余一律三列 —— 和微信一样，
 * 因为那个布局大家已经认得了。
 */
export function gridCols(n: number): number {
  if (n <= 1) return 1
  if (n === 2 || n === 4) return 2
  return 3
}

/**
 * 一堆赞的行，算成每条动态「几个赞、我点没点」。
 *
 * 一次把整屏的赞拉回来再分配，而不是每条各查一次 ——
 * 二十条动态就是二十个请求。
 */
export function tallyLikes(
  rows: { post_id: string; uid: string }[],
  meUid: string | null,
): Map<string, { likes: number; liked: boolean }> {
  const out = new Map<string, { likes: number; liked: boolean }>()
  for (const r of rows) {
    const cur = out.get(r.post_id) ?? { likes: 0, liked: false }
    cur.likes += 1
    if (meUid && r.uid === meUid) cur.liked = true
    out.set(r.post_id, cur)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 发
 * ------------------------------------------------------------------ */

export type PostResult = { ok: true; id: string } | { ok: false; error: string }

/**
 * 发一条。
 *
 * 顺序是「先传图、再插行」，和换头像那边（setMyPhoto）**反过来**，
 * 而理由也反过来：
 *
 *   头像   先传新的再改指向 —— 中间失败了，旧照片还在，人不会没脸
 *   动态   先传图再插行     —— 中间失败了，桶里多几张没人引用的图，
 *                              但**不会出现一条图裂掉的动态**
 *
 * 插行失败时把刚传的几张删掉。删不掉也不拦着报错 —— 那几张图谁也
 * 看不到（没有动态引用它们），只是占地方。
 */
export async function createPost(draft: {
  body: string
  files: Blob[]
}): Promise<PostResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const bad = checkDraft({ body: draft.body, count: draft.files.length })
  if (bad) return { ok: false, error: bad }

  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }

  const paths: string[] = []
  for (const f of draft.files) {
    let small: Blob
    try {
      small = await shrinkImage(f, { box: POST_BOX, square: false })
    } catch (e) {
      await cleanUp(paths)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (small.size > POST_MAX_BYTES) {
      await cleanUp(paths)
      return {
        ok: false,
        error: pick('有一张压不下来，换一张', 'One photo would not compress — swap it out'),
      }
    }
    const path = photoPath(uid, small.type)
    const up = await supabase.storage.from('moments').upload(path, small, {
      contentType: small.type,
      cacheControl: '31536000',
    })
    if (up.error) {
      await cleanUp(paths)
      return { ok: false, error: up.error.message }
    }
    paths.push(path)
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({ author: uid, body: draft.body.trim() || null, photos: paths })
    .select('id')
  if (error) {
    await cleanUp(paths)
    return { ok: false, error: error.message }
  }
  const id = ((data ?? [])[0] as { id: string } | undefined)?.id
  if (!id) {
    await cleanUp(paths)
    /* 被策略挡下来的写不报错，只是动了 0 行 —— 这个仓库栽过好几次 */
    return { ok: false, error: pick('没发出去 —— 只能以自己的身份发', 'Not posted — you can only post as yourself') }
  }
  return { ok: true, id }
}

const cleanUp = async (paths: string[]) => {
  if (!supabase || paths.length === 0) return
  const { error } = await supabase.storage.from('moments').remove(paths)
  if (error) console.warn('没用上的动态照片没删掉:', error.message)
}

/**
 * 删一条。
 *
 * 先删行再删图：反过来的话，中间失败就是一条图全裂的动态挂在那儿，
 * 而作者已经以为删掉了。
 */
export async function deletePost(
  post: Pick<Post, 'id' | 'photos'>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data, error } = await supabase.from('posts').delete().eq('id', post.id).select('id')
  if (error) return { ok: false, error: error.message }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('删不掉 —— 只能删自己发的', 'Cannot delete — only your own') }
  }
  await cleanUp(post.photos)
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * 读
 * ------------------------------------------------------------------ */

/**
 * 刷一屏。
 *
 * uid 给了就是「只看这个人的」（他的主页上用），不给就是整个朋友圈。
 * before 是上一屏最后那条的时间，往下翻用 —— 用时间不用页码：
 * 翻页的时候有人发了新的，按页码翻会把同一条看两遍。
 */
export async function fetchMoments(opts: {
  uid?: string
  before?: string
  limit?: number
  meUid?: string | null
} = {}): Promise<FeedItem[]> {
  if (!supabase) return []
  let q = supabase
    .from('posts')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 20)
  if (opts.uid) q = q.eq('author', opts.uid)
  if (opts.before) q = q.lt('created_at', opts.before)

  const { data, error } = await q
  if (error) {
    /* 没跑过 024 和「一条都没有」在这里是同一个结果：一屏空的 */
    console.warn('动态没拿到:', error.message)
    return []
  }
  const posts = (data ?? []) as Post[]
  if (posts.length === 0) return []

  const [urls, likes] = await Promise.all([
    signPhotos(posts.flatMap((p) => p.photos)),
    fetchLikes(posts.map((p) => p.id)),
  ])
  const tally = tallyLikes(likes, opts.meUid ?? null)

  return posts.map((p) => ({
    ...p,
    /* 签不出来的那张直接不显示 —— 一个裂图比少一张糟 */
    urls: p.photos.map((path) => urls.get(path)).filter((u): u is string => Boolean(u)),
    likes: tally.get(p.id)?.likes ?? 0,
    liked: tally.get(p.id)?.liked ?? false,
  }))
}

/**
 * 一批路径换一批临时地址。
 *
 * 一次签一批，不是一张签一次 —— 九张图的一条动态就是九个请求。
 * 签的时候服务端会过一遍策略，所以这里不用再判「我能不能看」。
 */
export async function signPhotos(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(paths)]
  if (!supabase || unique.length === 0) return out
  const { data, error } = await supabase.storage
    .from('moments')
    .createSignedUrls(unique, SIGN_SECONDS)
  if (error) {
    console.warn('动态照片没签出来:', error.message)
    return out
  }
  for (const row of data ?? []) {
    if (row.signedUrl && !row.error && row.path) out.set(row.path, row.signedUrl)
  }
  return out
}

async function fetchLikes(ids: string[]): Promise<{ post_id: string; uid: string }[]> {
  if (!supabase || ids.length === 0) return []
  const { data, error } = await supabase
    .from('post_likes')
    .select('post_id, uid')
    .in('post_id', ids)
  if (error) return []
  return (data ?? []) as { post_id: string; uid: string }[]
}

/** 点赞 / 收回。传的是**现在**的状态，这一层负责翻过去 */
export async function toggleLike(
  postId: string,
  liked: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }

  if (liked) {
    const { error } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('uid', uid)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }
  const { error } = await supabase.from('post_likes').insert({ post_id: postId, uid })
  /*
   * 重复点同一个赞会撞主键。那不是错 —— 两台手机上各点了一下，
   * 结果和想要的一模一样，所以咽掉。
   */
  if (error && !/duplicate|23505/i.test(error.message)) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
