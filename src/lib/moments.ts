import { pick } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { photoPath, shrinkImage } from '@/lib/photo'
import { silencedText } from '@/lib/ban'

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
/* ------------------------------------------------------------------ *
 * 签出来的那些链接要留着重用，不然每刷一次就把所有图重下一遍
 *
 * 私有桶没有固定地址，每次显示都要签一个临时链接。而**浏览器是按
 * 完整网址缓存的**，签名在查询串里 —— 每次签出来的都是一个新网址，
 * 于是手机上明明有那张图，还是会再下一遍。
 *
 * 头像那边不受影响（公开桶，地址固定），所以这件事只在朋友圈发生，
 * 而朋友圈正好是图最多的一屏。
 *
 * 解法是把签好的链接连同到期时间存下来，没过期就接着用同一个网址 ——
 * 网址一样，浏览器才认得出是同一张图。
 *
 * 代价写在明面上：那些链接存在这台手机的 localStorage 里，在有效期内
 * 谁拿到这台手机都打得开。而那些图本来就是这个人看得到的内容，
 * 所以这一步没有放大任何权限 —— 放大的只是「拿到手机之后还能看多久」。
 * ------------------------------------------------------------------ */

/** Story 活多久。和 028 里那个夹子是同一个数，改一处要改两处 */
export const STORY_MS = 24 * 60 * 60 * 1000

/**
 * 链接签多久。
 *
 * 从 1 小时拉到 6 —— 短不等于安全：短了只会让同一张图在一天里被
 * 重新签、重新下好几遍，而每一遍都是真金白银的流量。
 * 6 小时够一个晚上的球局从头看到尾。
 */
export const SIGN_SECONDS = 6 * 60 * 60

/**
 * 还剩这么多才敢接着用。
 *
 * 不留余量的话，一个快到期的链接会在人慢慢往下翻的时候失效 ——
 * 翻到一半突然一屏裂图，而他什么都没做错。
 */
export const SIGN_MARGIN_MS = 10 * 60 * 1000

/** 最多记住多少条。再多也没用 —— 老的图早就滚出时间线了 */
export const SIGN_CACHE_MAX = 300

const SIGN_CACHE_KEY = 'rally.moments.signed'

/** 一条：这个路径签出来的网址，和它什么时候到期 */
export type Signed = { url: string; expires: number }

/**
 * 谁看得到。**和 026 里那条 check 是同一份清单**，改一处要改两处。
 *
 * 默认写成一个导出的常量而不是散在各处的字面量：这是这一块里最危险的
 * 一个默认值 —— 反过来的话，每一条不去点的动态都发给了全世界，
 * 而发的人以为自己只是在跟球友说话。
 */
export const VISIBILITIES = ['friends', 'public'] as const
export type Visibility = (typeof VISIBILITIES)[number]
export const defaultVisibility: Visibility = 'friends'

export type Post = {
  id: string
  author: string
  body: string | null
  photos: string[]
  created_at: string
  /**
   * 什么时候消失（028）。null = 永久，有值 = Story。
   *
   * 「Story」在数据库里不是另一张表，就是这一列 —— 理由见
   * supabase/028-stories.sql 开头：另起一张表意味着可见范围、下架、
   * 评论、点赞、禁言那六样全要抄一遍。
   */
  expires_at?: string | null
  /**
   * 谁看得到（026）。
   *
   *   friends  只有好友。默认，绝大多数
   *   public   任何登录的人，点进作者主页都看得到
   *
   * 发出去之后改不了 —— 和正文、照片同一条规矩，冻在触发器里。
   */
  visibility?: Visibility
  /** 被管理员下架了。**作者自己还看得到**，别人看不到（025） */
  hidden_at?: string | null
}

/** 界面上那一条：动态本身，加上签好的图和赞 */
export type FeedItem = Post & {
  /** 签出来的临时地址，和 photos 一一对应。签不出来的那张会被去掉 */
  urls: string[]
  likes: number
  /** 我点过没有 */
  liked: boolean
}

const COLS = 'id, author, body, photos, created_at, hidden_at, visibility, expires_at'

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
  visibility?: Visibility
  /** 真 = 这是一条 Story，24 小时之后自己消失 */
  story?: boolean
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
    .insert({
      author: uid,
      body: draft.body.trim() || null,
      photos: paths,
      visibility: draft.visibility ?? defaultVisibility,
      /*
       * 报一个 24 小时之后。真正说了算的是数据库那个触发器 ——
       * 它会夹住（最多 24 小时），所以这台手机的时钟偏了也不要紧。
       */
      expires_at: draft.story ? new Date(Date.now() + STORY_MS).toISOString() : null,
    })
    .select('id')
  if (error) {
    await cleanUp(paths)
    /* 被禁言的人撞的是触发器，抛回来的是暗号，不是人话 */
    return { ok: false, error: silencedText(error.message) ?? error.message }
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
  /**
   * 只看这几个人的（主时间线用：我 + 我的好友）。
   *
   * 这一条**必须**有，而且必须在这一层，不能靠策略：026 之后
   * 「公开」的动态谁都读得到，不收窄的话主时间线会变成一个
   * 所有人的广场 —— 而朋友圈不是广场（理由见 026 开头）。
   *
   * 策略管的是「读不读得到」，这里管的是「这一屏想显示谁」，
   * 两件事分开。
   */
  authors?: string[]
  before?: string
  limit?: number
  meUid?: string | null
  /**
   * 要哪一种。
   *
   *   'posts'（默认）  只要永久的 —— 时间线上不混 Story
   *   'stories'        只要会过期的 —— 顶上那一排圈圈
   *
   * 分开是因为它们在界面上是两个东西：时间线是往下翻的，
   * Story 是横着一排、点开全屏看的。混在一起两边都不像。
   */
  kind?: 'posts' | 'stories'
} = {}): Promise<FeedItem[]> {
  if (!supabase) return []
  let q = supabase
    .from('posts')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 20)
  if (opts.uid) q = q.eq('author', opts.uid)
  else if (opts.authors) q = q.in('author', opts.authors.slice(0, 200))
  if (opts.before) q = q.lt('created_at', opts.before)
  /*
   * 过期的那些**这里必须自己再挡一次**。
   *
   * 原来这儿写的是「策略那边已经读不到了，判两遍迟早不一样」。那句话
   * 错了，而且错得很隐蔽：028 那条读策略的第一支是
   * `is_admin(auth.uid())` —— 管理员看得到所有动态，过期的也包括在内
   * （那一支是故意留的：一条被举报的 Story 在处理时多半已经过期了）。
   *
   * 于是这个 bug 只有管理员自己撞得到，别人那边一切正常 —— 而管理员
   * 恰好是最不会怀疑「是不是我看到的和别人不一样」的那个人。
   * 线上就是这么撞出来的：过了 24 小时那条还挂在圈圈里，点开一片黑
   * （照片已经被清理函数删掉了，行还在）。
   *
   * 所以：策略管「谁有资格读」，这一层管「这一屏要显示什么」。
   * 这两件事本来就不同，admin 那一支正好把它们劈开了。
   */
  if (opts.kind === 'stories') {
    q = q.not('expires_at', 'is', null).gt('expires_at', new Date().toISOString())
  } else {
    q = q.is('expires_at', null)
  }

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
  const unique = [...new Set(paths)]
  if (!supabase || unique.length === 0) return new Map()

  const cache = readSignCache()
  const { hits, misses } = pickCached(cache, unique)
  if (misses.length === 0) return hits

  const { data, error } = await supabase.storage
    .from('moments')
    .createSignedUrls(misses, SIGN_SECONDS)
  if (error) {
    console.warn('动态照片没签出来:', error.message)
    /* 签不出来的那几张不显示，但缓存里有的那几张照常 —— 别一起丢掉 */
    return hits
  }
  const expires = Date.now() + SIGN_SECONDS * 1000
  for (const row of data ?? []) {
    if (row.signedUrl && !row.error && row.path) {
      hits.set(row.path, row.signedUrl)
      cache.set(row.path, { url: row.signedUrl, expires })
    }
  }
  writeSignCache(trimCache(cache, SIGN_CACHE_MAX))
  return hits
}

/**
 * 缓存里哪几条还能用，哪几条要重签。
 *
 * 纯函数，所以测得了 —— 这一块出错的样子是「过期的链接被当成好的」，
 * 而那在界面上是一屏裂图，不是一句报错。
 */
export function pickCached(
  cache: Map<string, Signed>,
  paths: string[],
  now = Date.now(),
): { hits: Map<string, string>; misses: string[] } {
  const hits = new Map<string, string>()
  const misses: string[] = []
  for (const p of paths) {
    const got = cache.get(p)
    /* 留一段余量：快到期的当成没有，免得人翻到一半图失效 */
    if (got && got.expires - now > SIGN_MARGIN_MS) hits.set(p, got.url)
    else misses.push(p)
  }
  return { hits, misses }
}

/** 只留最晚到期的那几条。老的图早就滚出时间线了 */
export function trimCache(cache: Map<string, Signed>, max: number): Map<string, Signed> {
  if (cache.size <= max) return cache
  const kept = [...cache.entries()].sort((a, b) => b[1].expires - a[1].expires).slice(0, max)
  return new Map(kept)
}

/*
 * 存取那一层。
 *
 * 每一处都包在 try 里：无痕窗口、关掉了站点数据、存满了，读和写都可能
 * 直接抛 —— 而这只是个缓存，挂了应该退回「每次重签」，不是让整屏白掉。
 */
function readSignCache(): Map<string, Signed> {
  try {
    const raw = globalThis.localStorage?.getItem(SIGN_CACHE_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, Signed>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function writeSignCache(cache: Map<string, Signed>): void {
  try {
    globalThis.localStorage?.setItem(SIGN_CACHE_KEY, JSON.stringify(Object.fromEntries(cache)))
  } catch {
    /* 存满了就算了 —— 下次照样签得出来，只是多花一点流量 */
  }
}

/**
 * 退出登录时清掉。
 *
 * 这些链接在有效期内是能直接打开的，而换一个人登录这台手机之后，
 * 他不该还能打开上一个人好友的照片。
 */
export function clearSignCache(): void {
  try {
    globalThis.localStorage?.removeItem(SIGN_CACHE_KEY)
  } catch {
    /* 清不掉也不拦着退出登录 */
  }
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
    return { ok: false, error: silencedText(error.message) ?? error.message }
  }
  return { ok: true }
}
