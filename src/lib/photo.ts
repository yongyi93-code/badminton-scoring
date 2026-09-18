import { pick } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ *
 * 照片头像
 *
 * 名字旁边那个小圆放照片，换装角色留在个人主页 —— 两张脸各回答一个
 * 问题（「你是谁」和「你有多强」）。决定和理由在 docs/社交化.md。
 *
 * -------------------------------------------------------------------
 * 压缩必须在这一端做，而且有两个理由，第二个才是硬的
 *
 * **一、省钱。** 手机原图 3–5 MB。一个球群十几个人各传一张，就是几十兆；
 * 而免费版的存储和流量是有额度的，超了不是报错，是账单。
 * 服务端压等于原图已经传上去了 —— 流量已经花掉了，压了也追不回来。
 *
 * **二、EXIF 里有 GPS。**
 * 手机拍的照片带着拍摄地点的经纬度。原样传上去，等于每个人的家庭
 * 住址跟着头像一起公开 —— 而这张照片在一个**公开读**的桶里。
 *
 * canvas 重绘天然把 EXIF 丢掉：画到画布上的只有像素，别的什么都不带。
 * 这不是压缩的副作用，这是选 canvas 的主要理由。
 *
 * -------------------------------------------------------------------
 * 为什么是 512
 *
 * 这张图最大出现在「点开看大图」那一屏，手机上撑死 400 多个 CSS 像素，
 * 2 倍屏就是 800 多物理像素 —— 但那是一张脸，不是文字，糊一点看不出。
 * 512 在小圆圈（40px）和大图之间是够的，而再往上每一档都是真金白银。
 * ------------------------------------------------------------------ */

/** 长边压到多少像素 */
export const PHOTO_SIZE = 512

/**
 * 压完之后不许超过多大。
 *
 * 桶那边卡的是 512 KB（见 022），这里留一档余量 —— 压出来正好卡在
 * 桶的上限上会被服务端拒掉，而那个错发生在传的一半，比在这儿拦住难看。
 */
export const PHOTO_MAX_BYTES = 400 * 1024

/** 认得的格式。和桶上那张白名单是同一份，改一处要改两处 */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export type PhotoResult = { ok: true; path: string } | { ok: false; error: string }

/**
 * 算出压完之后的宽高。
 *
 * 规矩只有一条：**长边压到 PHOTO_SIZE，短边按比例，而且绝不放大**。
 *
 * 不放大那一条常被忘掉，后果是一张 200×200 的小头像被拉成 512×512 ——
 * 文件反而变大，人还变糊。
 */
export function fitBox(w: number, h: number, box = PHOTO_SIZE): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: box, h: box }
  const scale = Math.min(box / w, box / h, 1)
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/**
 * 这个文件能不能当头像。
 *
 * 在选完文件、还没开始压之前判一次 —— 压一张 20 MB 的图要好几秒，
 * 而那几秒之后再说「不行」，人已经等过了。
 */
export function checkFile(f: { type: string; size: number }): string | null {
  if (!PHOTO_TYPES.includes(f.type)) {
    return pick('只能用图片（JPG、PNG、WebP）', 'Images only (JPG, PNG, WebP)')
  }
  /*
   * 原图大小也拦一道，宽松得多（20 MB）。
   * 拦的不是「太大」—— 压完就小了；拦的是「这多半不是一张照片」，
   * 以及别让一台老手机在 canvas 上啃一张一亿像素的图啃到崩。
   */
  if (f.size > 20 * 1024 * 1024) {
    return pick('这张图太大了（超过 20MB）', 'That image is too large (over 20MB)')
  }
  return null
}

/**
 * 把一张图压成方形的小图。
 *
 * 裁成正方形是因为它到处都画在圆圈里 —— 不裁的话，横图缩进圆圈里
 * 只剩中间一条，人脸在不在里面全看运气。裁中间那一块最接近
 * 「人对着镜头」的常态。
 */
export async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    /* 先裁成正方形：取中间那一块 */
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = Math.round((bitmap.width - side) / 2)
    const sy = Math.round((bitmap.height - side) / 2)
    const { w } = fitBox(side, side)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = w
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(pick('这台设备画不了图', 'This device cannot draw images'))
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, w, w)

    /*
     * 先试 webp，不行退回 jpeg。
     *
     * webp 同等画质小三四成，但 iOS 16 以下的 Safari 导不出 ——
     * 而且它不报错，是**悄悄给你一张 png**（体积反而大得多）。
     * 所以不能只看有没有抛异常，要看回来的 type 对不对。
     */
    const webp = await toBlob(canvas, 'image/webp', 0.82)
    if (webp && webp.type === 'image/webp') return webp
    const jpeg = await toBlob(canvas, 'image/jpeg', 0.82)
    if (jpeg) return jpeg
    throw new Error(pick('这台设备压不了图', 'This device cannot compress images'))
  } finally {
    bitmap.close()
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> =>
  new Promise((res) => c.toBlob(res, type, q))

/**
 * 随机文件名。
 *
 * **不能用 uid 当文件名**：桶是公开读的，而 uid 在全国榜上是公开的 ——
 * 那样谁都能拿榜上的 uid 挨个把人脸翻出来。
 *
 * 路径的第一段还是 uid，那是给写入策略用的（只能往自己那个文件夹里传），
 * 不是给人猜的：知道文件夹不等于知道文件名。
 */
export function photoPath(uid: string, type: string): string {
  const ext = type === 'image/webp' ? 'webp' : 'jpg'
  const rand =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${uid}/${rand}.${ext}`
}

/** 桶里那条路径对应的公开地址。没有路径就是没设过照片 */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path || !supabase) return null
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

/**
 * 换一张头像。
 *
 * 顺序是「先传新的、再改指向、最后删旧的」：
 *
 *   · 传失败 → 什么都没变，旧照片还在
 *   · 改指向失败 → 桶里多一张没人用的图（下次换会再删一次），旧照片还在
 *   · 删旧的失败 → 桶里多一张没人用的图，但新的已经生效了
 *
 * 反过来（先删旧的）的话，中间任何一步失败，这个人就没有头像了 ——
 * 而那张照片已经删掉，找不回来。
 */
export async function setMyPhoto(file: Blob): Promise<PhotoResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }

  let small: Blob
  try {
    small = await shrink(file)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (small.size > PHOTO_MAX_BYTES) {
    return { ok: false, error: pick('这张图压不下来，换一张', 'Could not compress that one — try another') }
  }

  const old = await myPhotoPath()
  const path = photoPath(uid, small.type)

  const up = await supabase.storage.from('avatars').upload(path, small, {
    contentType: small.type,
    cacheControl: '31536000',
  })
  if (up.error) return { ok: false, error: up.error.message }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ uid, photo_path: path }, { onConflict: 'uid' })
    .select('uid')
  if (error) return { ok: false, error: error.message }
  /* 被策略挡下来的写不报错，只是动了 0 行 —— 这个仓库栽过好几次 */
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没设上 —— 只能改自己的', 'You can only change your own') }
  }

  /* 旧的那张删掉。失败了只是桶里多一张没人用的图，不拦住换头像这件事 */
  if (old && old !== path) {
    const rm = await supabase.storage.from('avatars').remove([old])
    if (rm.error) console.warn('旧头像没删掉:', rm.error.message)
  }
  return { ok: true, path }
}

/** 撤掉头像。文件和指向一起清 */
export async function clearMyPhoto(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }

  const old = await myPhotoPath()
  const { error } = await supabase.from('profiles').update({ photo_path: null }).eq('uid', uid)
  if (error) return { ok: false, error: error.message }
  if (old) {
    const rm = await supabase.storage.from('avatars').remove([old])
    if (rm.error) console.warn('头像文件没删掉:', rm.error.message)
  }
  return { ok: true }
}

/** 我现在那张照片在哪。没设过就是 null */
export async function myPhotoPath(): Promise<string | null> {
  if (!supabase) return null
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('photo_path')
    .eq('uid', uid)
    .limit(1)
  if (error) return null
  return ((data ?? [])[0] as { photo_path: string | null } | undefined)?.photo_path ?? null
}

/*
 * 「一批人的照片」在 lib/profile.ts 那边（fetchCards）——
 * 名字和照片是同一张表上的同一件事（「你对外是谁」），分两次查
 * 等于同一张表查两遍。这个文件只管**一张图怎么变成桶里那个文件**。
 */
