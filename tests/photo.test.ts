import { describe, expect, it } from 'vitest'
import { PHOTO_MAX_BYTES, PHOTO_SIZE, checkFile, fitBox, photoPath } from '@/lib/photo'
import { setLang } from '@/lib/i18n'

/*
 * 照片头像里纯逻辑的那几块。
 *
 * 真正把门的（谁看得到谁的照片、只能往自己那个文件夹里传）在
 * supabase/022-photo-avatar.sql 的策略上，那些在本机跑真 Postgres
 * 撞过，不在这儿。压缩本身要 canvas，也测不了。
 *
 * 这个文件钉的是三件会静悄悄出错的事：
 *   · 小图被放大（文件更大、人更糊）
 *   · 文件名用了 uid（公开桶 + 榜上公开的 uid = 谁都能挨个翻人脸）
 *   · 明明不行的文件先压了几秒才说不行
 */

setLang('zh')

describe('压成多大', () => {
  it('长边压到 512，短边按比例', () => {
    expect(fitBox(2000, 1000)).toEqual({ w: 512, h: 256 })
    expect(fitBox(1000, 2000)).toEqual({ w: 256, h: 512 })
  })

  /*
   * 这一条最容易漏。一张 200×200 的小头像被拉成 512×512 之后，
   * **文件反而更大，人还更糊** —— 放大不会凭空造出细节。
   */
  it('比 512 小的不放大', () => {
    expect(fitBox(200, 200)).toEqual({ w: 200, h: 200 })
    expect(fitBox(100, 300)).toEqual({ w: 100, h: 300 })
  })

  it('正好 512 的不动', () => {
    expect(fitBox(512, 512)).toEqual({ w: 512, h: 512 })
  })

  it('极端长条也不会算出 0 —— canvas 宽高是 0 会直接抛', () => {
    const r = fitBox(10000, 3)
    expect(r.w).toBe(512)
    expect(r.h).toBeGreaterThanOrEqual(1)
  })

  it('宽高是 0 或负数时退回一个方框，不炸', () => {
    expect(fitBox(0, 0)).toEqual({ w: PHOTO_SIZE, h: PHOTO_SIZE })
    expect(fitBox(-5, 100)).toEqual({ w: PHOTO_SIZE, h: PHOTO_SIZE })
  })
})

describe('选完文件先判一次', () => {
  it('图片放行', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
      expect(checkFile({ type, size: 3_000_000 })).toBeNull()
    }
  })

  /* 压一张图要好几秒，而那几秒之后再说「不行」，人已经等过了 */
  it('不是图片的当场拦住，不用先压', () => {
    expect(checkFile({ type: 'application/pdf', size: 1000 })).not.toBeNull()
    expect(checkFile({ type: 'video/mp4', size: 1000 })).not.toBeNull()
    expect(checkFile({ type: '', size: 1000 })).not.toBeNull()
  })

  it('大得不像照片的也拦住 —— 老手机啃一亿像素会崩', () => {
    expect(checkFile({ type: 'image/jpeg', size: 25 * 1024 * 1024 })).not.toBeNull()
  })

  it('手机原图那个量级（5MB）是放行的 —— 压缩就是为它准备的', () => {
    expect(checkFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toBeNull()
  })
})

describe('文件名', () => {
  const UID = '11111111-2222-3333-4444-555555555555'

  /*
   * 这一条是这个文件里最要紧的。
   *
   * 桶是**公开读**的，而 uid 在全国榜上是公开的。文件名要是用 uid，
   * 拿榜上那一列就能把所有人的脸挨个翻出来 —— 而且是永久有效的地址。
   */
  it('文件名不含 uid', () => {
    const p = photoPath(UID, 'image/webp')
    const file = p.split('/')[1]
    expect(file).not.toContain(UID)
    expect(file).not.toContain(UID.slice(0, 8))
  })

  it('文件夹是 uid —— 写入策略靠它认人', () => {
    expect(photoPath(UID, 'image/webp').split('/')[0]).toBe(UID)
  })

  it('每次都不一样 —— 同一个路径覆盖的话，缓存里还是旧照片', () => {
    const a = photoPath(UID, 'image/webp')
    const b = photoPath(UID, 'image/webp')
    expect(a).not.toBe(b)
  })

  it('扩展名跟着实际格式走', () => {
    expect(photoPath(UID, 'image/webp')).toMatch(/\.webp$/)
    expect(photoPath(UID, 'image/jpeg')).toMatch(/\.jpg$/)
  })

  /* randomUUID 在非安全上下文里没有。退路不能算出空文件名 */
  it('没有 randomUUID 的时候也算得出名字', () => {
    const real = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...real, randomUUID: undefined },
      configurable: true,
    })
    try {
      const p = photoPath(UID, 'image/webp')
      expect(p.split('/')[1]).toMatch(/^.+\.webp$/)
      expect(p.split('/')[1].length).toBeGreaterThan(8)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true })
    }
  })
})

describe('两个上限要对得上', () => {
  /*
   * 桶那边卡 512 KB（022 里写死的）。这边要是比它松，压出来的图会被
   * 服务端拒掉 —— 而那个错发生在传到一半，比在客户端拦住难看得多。
   */
  it('客户端的上限比桶那边严', () => {
    expect(PHOTO_MAX_BYTES).toBeLessThan(512 * 1024)
  })
})
