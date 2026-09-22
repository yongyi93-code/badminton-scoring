import { describe, expect, it } from 'vitest'
import {
  AUDIO_BPS,
  CANDIDATES,
  HOLD_MS,
  MAX_RECORD_MS,
  VIDEO_BPS,
  estimateBytes,
  gesture,
  pickMimeType,
} from '@/lib/camera'
import { VIDEO_MAX_BYTES, VIDEO_TYPES, baseType, isVideoType, mediaExt } from '@/lib/media'

/* ------------------------------------------------------------------ *
 * 自己做的那个相机
 *
 * 这一块最贵的错误不是「开不起来」（那个一眼看得见），是**录出来
 * 发不出去**：格式挑错、码率定太高、type 里那串 codecs 忘了切。
 * 三样在手机上都表现成一句没头没脑的上传失败。
 * ------------------------------------------------------------------ */

describe('轻点还是按住', () => {
  it('松得快是拍照', () => {
    expect(gesture(0)).toBe('photo')
    expect(gesture(HOLD_MS - 1)).toBe('photo')
  })

  it('按到 250ms 就是录像', () => {
    expect(gesture(HOLD_MS)).toBe('video')
    expect(gesture(3000)).toBe('video')
  })
})

describe('录出来多大', () => {
  /*
   * 这一条是这个相机存在的理由之一：码率自己定，所以**录满也超不了**。
   * 有人把码率调高的话这条会先红，而不是等某个人录满 15 秒才发现
   * 发不出去。
   */
  it('录满 15 秒也撞不到 20MB 那个上限', () => {
    expect(estimateBytes(MAX_RECORD_MS)).toBeLessThan(VIDEO_MAX_BYTES)
  })

  it('留了至少一半余量 —— 码率是估的，不能卡着上限', () => {
    expect(estimateBytes(MAX_RECORD_MS)).toBeLessThan(VIDEO_MAX_BYTES / 2)
  })

  it('算的是这两个码率加起来', () => {
    /* 1 秒 = (2_500_000 + 96_000) / 8 字节 */
    expect(estimateBytes(1000)).toBe(Math.round((VIDEO_BPS + AUDIO_BPS) / 8))
  })
})

describe('挑一个录得出来的格式', () => {
  const only = (...ok: string[]) => (t: string) => ok.includes(t)

  it('Safari 那种只认 mp4 的，挑 mp4', () => {
    expect(pickMimeType(only('video/mp4'))).toBe('video/mp4')
  })

  it('两样都认的时候优先 mp4 —— 它到处都播得了', () => {
    expect(pickMimeType(only('video/mp4', 'video/webm;codecs=vp9,opus'))).toBe('video/mp4')
  })

  it('没有 mp4 就挑 vp9，比 vp8 小三成', () => {
    const f = only('video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm')
    expect(pickMimeType(f)).toBe('video/webm;codecs=vp9,opus')
  })

  it('老设备退到 vp8', () => {
    expect(pickMimeType(only('video/webm;codecs=vp8,opus', 'video/webm'))).toBe(
      'video/webm;codecs=vp8,opus',
    )
  })

  /* 一个都不认就返回 null —— 那时候只该拍照，不该录出一个发不了的文件 */
  it('一个都不认就是 null', () => {
    expect(pickMimeType(() => false)).toBeNull()
  })

  /*
   * 挑出来的每一个，切完参数之后**必须**在桶收的那张白名单里。
   * 这一条是整块最要紧的：漏了它，录出来的文件会在上传时被桶拒掉，
   * 而报的是一句 "mime type not supported"，看不出是哪一步错的。
   */
  it('挑得出来的每一种，桶都收得下', () => {
    /*
     * 遍历的是**代码里真正那份清单**，不是这儿抄的一份。
     * 第一版抄了一份，于是「往 CANDIDATES 里加一个桶不收的格式」
     * 这个变异全绿通过 —— 抄的那份根本不知道有人加了东西。
     */
    for (const t of CANDIDATES) {
      expect(VIDEO_TYPES).toContain(baseType(t))
    }
  })

  /* 而且每一种都要算得出正确的后缀，不然显示的时候会被当成图片 */
  it('挑得出来的每一种，后缀都是视频的', () => {
    for (const t of CANDIDATES) {
      expect(['mp4', 'webm', 'mov']).toContain(mediaExt(t))
      expect(isVideoType(t)).toBe(true)
    }
  })

  /* 而且真的挑得出来 —— 上面两条只管「清单干净」，这条管「用得上」 */
  it('清单里每一种单独摆出来都挑得中', () => {
    for (const t of CANDIDATES) {
      expect(pickMimeType(only(t))).toBe(t)
    }
  })
})

describe('切掉 codecs 那一串', () => {
  it('切得干净', () => {
    expect(baseType('video/webm;codecs=vp8,opus')).toBe('video/webm')
    expect(baseType('video/mp4;codecs=avc1.42E01E')).toBe('video/mp4')
  })

  it('本来就没有参数的原样返回', () => {
    expect(baseType('image/jpeg')).toBe('image/jpeg')
  })

  it('大小写和空格都收拾掉', () => {
    expect(baseType(' VIDEO/WEBM ; codecs=vp8 ')).toBe('video/webm')
  })
})
