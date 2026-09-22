import { pick } from '@/lib/i18n'
import { checkFile, randomPath } from '@/lib/photo'

/* ------------------------------------------------------------------ *
 * 视频：Story 和动态里那一段能动的
 *
 * 这个文件只管**纯逻辑**：什么算视频、传上去叫什么名字、这个文件能不能
 * 发。真正压图的在 lib/photo.ts，真正上传的在 lib/moments.ts。
 *
 * -------------------------------------------------------------------
 * 视频不压，所以只能靠「卡大小」
 *
 * 图片那条路是「在手机上压到 200 KB 再传」（lib/photo.ts），花几百毫秒。
 * 视频没有这条路：浏览器里重新编码一段视频要**照着原速播一遍**
 * —— 15 秒的片子就等 15 秒，而且 Safari 上能不能编出来还要看系统版本。
 * 为了一个发 Story 的动作让人盯着转圈等十几秒，这个交易不划算。
 *
 * 所以这一版直接传原文件，代价改成明码标价的一条：**上限 20 MB**。
 * 超了当场说「拍短一点」，不是传到一半失败。
 *
 * -------------------------------------------------------------------
 * 这个上限是按流量算的，不是按存储
 *
 * 存储不是问题：Story 24 小时后连文件一起删（028 + cleanup-stories），
 * 桶不会越积越多。
 *
 * 真正花钱的是**下行流量** —— 一段 20 MB 的视频，球群里十个人点开看
 * 就是 200 MB。免费版一个月 5 GB，也就是二十几段。这个数字写在这儿，
 * 不是写在某个人的记忆里：以后要调，先读这一段。
 *
 * 时长没有单独卡。卡时长挡的和卡大小挡的是同一件事（片子太大），
 * 而多一道判断就多一种「明明能发却说不行」的出错方式。
 * ------------------------------------------------------------------ */

/**
 * 认得的视频格式。**和 031 里桶上那张白名单是同一份**，改一处要改两处。
 *
 * quicktime 就是 .mov —— iPhone 录出来的十有八九是它，漏了这一个等于
 * iPhone 上整个功能不存在。
 */
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

/** 一段视频最多多大。上面那段写了这个数是怎么来的 */
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024

/** 一条里最多几段视频 */
export const MAX_VIDEOS = 1

/** 相机/相册那个框接受什么。图片和视频都要，不然 iOS 上录不了 */
export const MEDIA_ACCEPT = 'image/*,video/*'

/**
 * 把 `video/webm;codecs=vp8,opus` 切成 `video/webm`。
 *
 * 自己录的那个相机（lib/camera.ts）吐出来的 type 就带着这一串参数，
 * 而下面每一处都要拿它去**严格比对**：
 *
 *   · 传上去的 contentType —— 桶上那张白名单是一个字都不能差的，
 *     带着 codecs 会被拒，报一句没头没脑的 "mime type not supported"
 *   · 算扩展名 —— 认不出来就当 jpg，于是一段视频画进 <img> 里裂掉
 *   · 判能不能发 —— 同上
 *
 * 所以只留一份，三处都过它。
 */
export function baseType(type: string): string {
  return type.split(';')[0].trim().toLowerCase()
}

/** 这个 MIME 是不是视频 */
export function isVideoType(type: string): boolean {
  return baseType(type).startsWith('video/')
}

/**
 * 这个路径（或者签出来的地址）指的是不是一段视频。
 *
 * 认的是**扩展名**，不是 MIME —— 到了要显示的时候手上只有一个字符串：
 * 桶里那条路径，或者签出来带一长串 token 的网址。MIME 早就不在手上了。
 *
 * 所以必须先把 ?token=… 和 #… 切掉再看：那串签名是 base64，里面什么
 * 字母组合都可能出现，连着它一起匹配迟早会把一张图认成视频。
 */
export function isVideo(pathOrUrl: string): boolean {
  const clean = pathOrUrl.split('#')[0].split('?')[0].toLowerCase()
  return /\.(mp4|mov|webm)$/.test(clean)
}

/**
 * 传上去叫什么后缀。
 *
 * 后缀不是装饰：上面那个 isVideo 就靠它认人。写错了的后果是一段视频
 * 被当成图片画进 <img> 里 —— 一个裂图，而文件其实好好的。
 */
export function mediaExt(type: string): string {
  const t = baseType(type)
  if (t === 'video/mp4') return 'mp4'
  if (t === 'video/quicktime') return 'mov'
  if (t === 'video/webm') return 'webm'
  if (t === 'image/webp') return 'webp'
  return 'jpg'
}

/** 传进 moments 桶里那条路径。随机名那一段和头像共用（见 photo.ts） */
export function mediaPath(uid: string, type: string): string {
  return randomPath(uid, mediaExt(type))
}

/**
 * 这个文件能不能发。发不了就给一句人话。
 *
 * 图片那半交给 checkFile —— 那边已经有一份规矩了，抄第二份迟早会和
 * 第一份不一样。这里只加视频那半。
 *
 * 在**选完、还没开始传**的时候判：传一段 20 MB 的视频要好几十秒，
 * 而那几十秒之后再说「不行」，人已经等过了。
 */
export function checkMedia(f: { type: string; size: number }): string | null {
  if (!isVideoType(f.type)) return checkFile(f)

  if (!VIDEO_TYPES.includes(baseType(f.type))) {
    return pick('这种视频格式发不了（能发 MP4、MOV）', 'That video format is not supported (MP4, MOV)')
  }
  if (f.size > VIDEO_MAX_BYTES) {
    const mb = Math.round(f.size / (1024 * 1024))
    return pick(
      `这段视频 ${mb}MB，太大了 —— 拍短一点（最多 20MB）`,
      `That clip is ${mb}MB — too large. Keep it shorter (20MB max)`,
    )
  }
  return null
}
