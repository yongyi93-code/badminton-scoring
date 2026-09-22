import { describe, expect, it } from 'vitest'
import {
  MEDIA_ACCEPT,
  VIDEO_MAX_BYTES,
  VIDEO_TYPES,
  checkMedia,
  isVideo,
  isVideoType,
  mediaExt,
  mediaPath,
} from '@/lib/media'

/* ------------------------------------------------------------------ *
 * 视频
 *
 * 这一块最容易错的不是「能不能传上去」，是**认不认得出来**：
 * 一段视频被当成图片画进 <img> 里，看到的是一个裂图，而文件好好的。
 * 所以 isVideo / mediaExt 这两个是重点。
 * ------------------------------------------------------------------ */

describe('认得出是不是视频', () => {
  it('按 MIME 认', () => {
    expect(isVideoType('video/mp4')).toBe(true)
    expect(isVideoType('video/quicktime')).toBe(true)
    expect(isVideoType('image/jpeg')).toBe(false)
    /* 空字符串也不能算视频 —— 有些浏览器给不出 type */
    expect(isVideoType('')).toBe(false)
  })

  it('按扩展名认路径', () => {
    expect(isVideo('abc/xyz.mp4')).toBe(true)
    expect(isVideo('abc/xyz.mov')).toBe(true)
    expect(isVideo('abc/xyz.webm')).toBe(true)
    expect(isVideo('abc/xyz.webp')).toBe(false)
    expect(isVideo('abc/xyz.jpg')).toBe(false)
  })

  it('大写后缀一样认', () => {
    expect(isVideo('abc/XYZ.MP4')).toBe(true)
    expect(isVideo('abc/XYZ.MOV')).toBe(true)
  })

  /*
   * 到了要显示的时候，手上多半是**签出来那条带 token 的网址**，
   * 不是干净的路径。不把查询串切掉的话，后缀根本不在结尾上。
   */
  it('签出来的网址也认得', () => {
    const url =
      'https://x.supabase.co/storage/v1/object/sign/moments/u/abc.mp4?token=eyJhbGciOi.def'
    expect(isVideo(url)).toBe(true)
  })

  /*
   * 反过来那一半更要紧：那串 token 是 base64，什么字母组合都可能出现。
   * 一张图因为 token 里碰巧有 mp4 就被当成视频，是一个**随机出现**的
   * bug —— 换个人看同一条就好了。
   */
  it('token 里带 .mp4 的一张图还是图', () => {
    const url = 'https://x.supabase.co/storage/v1/object/sign/moments/u/abc.webp?token=zz.mp4'
    expect(isVideo(url)).toBe(false)
  })

  it('#号后面的也不算数', () => {
    expect(isVideo('u/abc.webp#a.mp4')).toBe(false)
  })
})

describe('传上去叫什么名字', () => {
  it('每种格式一个后缀', () => {
    expect(mediaExt('video/mp4')).toBe('mp4')
    expect(mediaExt('video/quicktime')).toBe('mov')
    expect(mediaExt('video/webm')).toBe('webm')
    expect(mediaExt('image/webp')).toBe('webp')
    /* 认不出来的当 jpg —— 和 photoPath 那边一个口径 */
    expect(mediaExt('image/jpeg')).toBe('jpg')
    expect(mediaExt('')).toBe('jpg')
  })

  /*
   * 后缀和 isVideo 必须对得上。这两个函数分开写的时候最容易出的事
   * 就是「传上去叫 .quicktime，显示的时候认不出来」。
   */
  it('视频传上去的路径，isVideo 一定认得出来', () => {
    for (const type of VIDEO_TYPES) {
      expect(isVideo(mediaPath('u-1', type))).toBe(true)
    }
  })

  it('图片传上去的路径，isVideo 一定认不出来', () => {
    for (const type of ['image/webp', 'image/jpeg', 'image/png', 'image/heic']) {
      expect(isVideo(mediaPath('u-1', type))).toBe(false)
    }
  })

  /* 路径第一段是 uid：写入策略和那个触发器都认这一段（024） */
  it('第一段是 uid，只有一层文件夹', () => {
    const p = mediaPath('u-1', 'video/mp4')
    expect(p.startsWith('u-1/')).toBe(true)
    expect(p.split('/')).toHaveLength(2)
  })

  /* 文件名不能是 uid —— 那样谁都能拿榜上的 uid 挨个把人的东西翻出来 */
  it('文件名不是 uid', () => {
    const p = mediaPath('u-1', 'video/mp4')
    expect(p.split('/')[1]).not.toContain('u-1')
  })
})

describe('这个文件能不能发', () => {
  const file = (type: string, mb: number) => ({ type, size: mb * 1024 * 1024 })

  it('一段小视频可以', () => {
    expect(checkMedia(file('video/mp4', 8))).toBeNull()
    expect(checkMedia(file('video/quicktime', 8))).toBeNull()
  })

  it('太大的那段发不了，而且要说出多大', () => {
    const msg = checkMedia(file('video/mp4', 45))
    expect(msg).toBeTruthy()
    expect(msg).toContain('45')
  })

  /* 正好卡在上限上要放过去 —— 桶那边收的也是 <= */
  it('正好 20MB 可以', () => {
    expect(checkMedia({ type: 'video/mp4', size: VIDEO_MAX_BYTES })).toBeNull()
  })

  it('多一个字节就不行', () => {
    expect(checkMedia({ type: 'video/mp4', size: VIDEO_MAX_BYTES + 1 })).toBeTruthy()
  })

  it('不认得的视频格式发不了', () => {
    expect(checkMedia(file('video/x-msvideo', 2))).toBeTruthy()
  })

  /*
   * 图片那半原样交给 checkFile，不在这儿再写一份规矩。
   * 这两条是为了钉住「真的交过去了」—— 漏接的话视频能发、图片全挂。
   */
  it('图片还是走原来那套', () => {
    expect(checkMedia(file('image/jpeg', 2))).toBeNull()
    expect(checkMedia(file('application/pdf', 1))).toBeTruthy()
    /* 图片那边的上限是 20MB 原图，和视频那条是两个数，别搞混 */
    expect(checkMedia(file('image/jpeg', 30))).toBeTruthy()
  })
})

describe('相机那个框', () => {
  /*
   * accept 里少了 video/* 的话，相机上就没有「视频」那一档 ——
   * 表现正是用户报的那句「story 放不到视频」。
   */
  it('图片和视频都收', () => {
    expect(MEDIA_ACCEPT).toContain('image/*')
    expect(MEDIA_ACCEPT).toContain('video/*')
  })
})
