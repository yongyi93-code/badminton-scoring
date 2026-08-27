import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DRESS_CANVAS,
  DRESS_DEFAULTS,
  DRESS_ITEMS,
  DRESS_SLOTS,
  DRESS_STARTERS,
  dressCrop,
  dressId,
  dressLayer,
  dressUpFor,
  hasDressUp,
  TIERS_PER_SLOT,
} from '@/lib/dressup'
import { grantDressUp, newAvatar, shopFor, type AvatarProfile } from '@/lib/avatar'

/*
 * 分层换装最容易出的错，是「商店卖了一件，但那件没有素材」——
 * 界面上不报错，点了就是没反应。所以第一条测试把商店和素材整个对一遍。
 *
 * 整套素材是可以删干净的（hasDressUp 为 false 就退回按段位换立绘的老路），
 * 所以跟素材有关的几条用 skipIf 挡着：素材不在的时候这些断言没有意义，
 * 但业务逻辑那几条照跑。
 */

describe('换装商店', () => {
  it('四个槽位各 11 件，编号从 01 起', () => {
    expect(DRESS_ITEMS).toHaveLength(DRESS_SLOTS.length * TIERS_PER_SLOT)
    expect(dressId('top', 0)).toBe('top-01')
    expect(dressId('racket', 10)).toBe('racket-11')
  })

  it('每个槽位第一件白送，其余越往后越贵、门槛越高', () => {
    for (const slot of DRESS_SLOTS) {
      const line = DRESS_ITEMS.filter((i) => i.slot === slot)
      expect(line[0].price, slot).toBe(0)
      for (let i = 1; i < line.length; i++) {
        expect(line[i].price, `${slot}-${i}`).toBeGreaterThan(line[i - 1].price)
        expect(line[i].minLevel, `${slot}-${i}`).toBeGreaterThanOrEqual(
          line[i - 1].minLevel,
        )
      }
    }
  })

  it('每件都有名字，没有重名', () => {
    const names = DRESS_ITEMS.map((i) => i.name)
    for (const n of names) expect(n.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(names.length)
  })

  it('白送的正好是每个槽位第一件', () => {
    expect(DRESS_STARTERS.sort()).toEqual(
      DRESS_SLOTS.map((s) => dressId(s, 0)).sort(),
    )
    expect(Object.values(DRESS_DEFAULTS).sort()).toEqual(DRESS_STARTERS.sort())
  })
})

describe.skipIf(!hasDressUp)('素材', () => {
  it('商店卖的每一件都有图层和掩膜', () => {
    // 少了掩膜就没法「先擦再画」，换上短的那件时底图的旧衣服会露在外面
    for (const item of DRESS_ITEMS) {
      const layer = dressLayer(item.id)
      expect(layer, item.id).not.toBeNull()
      expect(layer!.art, item.id).toBeTruthy()
      expect(layer!.mask, item.id).toBeTruthy()
    }
  })

  it('每一层都落在画布里', () => {
    const [W, H] = DRESS_CANVAS
    for (const item of DRESS_ITEMS) {
      const { box } = dressLayer(item.id)!
      expect(box.w, item.id).toBeGreaterThan(0)
      expect(box.h, item.id).toBeGreaterThan(0)
      expect(box.x, item.id).toBeGreaterThanOrEqual(0)
      expect(box.y, item.id).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w, item.id).toBeLessThanOrEqual(W)
      expect(box.y + box.h, item.id).toBeLessThanOrEqual(H)
    }
  })

  it('商店小图的取景框也在画布里，而且是正方形', () => {
    const [W, H] = DRESS_CANVAS
    for (const item of DRESS_ITEMS) {
      const crop = dressCrop(item.id)!
      expect(crop, item.id).not.toBeNull()
      expect(crop.w, item.id).toBe(crop.h)
      expect(crop.x, item.id).toBeGreaterThanOrEqual(0)
      expect(crop.y, item.id).toBeGreaterThanOrEqual(0)
      expect(crop.x + crop.w, item.id).toBeLessThanOrEqual(W)
      expect(crop.y + crop.h, item.id).toBeLessThanOrEqual(H)
    }
  })

  it('没有素材的 id 返回 null，不会画出一块空白', () => {
    expect(dressLayer('top-99')).toBeNull()
    expect(dressCrop('nope')).toBeNull()
  })

  /*
   * 掩膜的区域必须在 alpha 通道里。
   *
   * 栽过一次：掩膜存成了灰度图，没有 alpha 通道。合成那一步是
   * destination-out，它按来源的 alpha 擦 —— 一张不透明的灰度图
   * 等于「整块都擦」，于是每换一件都把那一件的整个方框连人带背景挖掉。
   * 浅色底上看不出来，放到 App 的深色卡片上就是一块挖空的补丁。
   *
   * 这个错单看代码和看浅色预览都发现不了，所以直接验文件本身。
   */
  it('每张掩膜都带 alpha 通道（少了会把整个方框擦掉）', () => {
    for (const item of DRESS_ITEMS) {
      const buf = readFileSync(`src/assets/dressup/${item.id}.mask.webp`)
      expect(webpHasAlpha(buf), `${item.id}.mask.webp`).toBe(true)
    }
  })
})

/** 扫一遍 WebP 的 RIFF 分块，看这张图声明了 alpha 没有 */
function webpHasAlpha(buf: Buffer): boolean {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return false
  let at = 12
  while (at + 8 <= buf.length) {
    const tag = buf.toString('ascii', at, at + 4)
    const size = buf.readUInt32LE(at + 4)
    const body = at + 8
    // 扩展格式：标志位里有一位专门表示带 alpha
    if (tag === 'VP8X') return (buf[body] & 0x10) !== 0
    // 有损 + 独立的 alpha 分块
    if (tag === 'ALPH') return true
    // 无损：签名字节之后 14 位宽、14 位高，第 29 位就是 alpha_is_used
    if (tag === 'VP8L') return ((buf.readUInt32LE(body + 1) >>> 28) & 1) === 1
    at = body + size + (size % 2)
  }
  return false
}

describe('谁走分层换装', () => {
  it('女生走分层换装，男生还是按段位换立绘', () => {
    // 素材目前只有女生版。男号套一身女装比不换更糟
    expect(dressUpFor('f')).toBe(hasDressUp)
    expect(dressUpFor('m')).toBe(false)
  })

  it.skipIf(!hasDressUp)('女号商店只卖换装那四类，不再卖发型战服武器', () => {
    const slots = new Set(shopFor('f').map((i) => i.slot))
    for (const s of DRESS_SLOTS) expect(slots.has(s), s).toBe(true)
    for (const s of ['hair', 'outfit', 'weapon']) {
      expect(slots.has(s as never), s).toBe(false)
    }
    // 画在人外面的三类两边都还有，不然有立绘之后金币没处花
    for (const s of ['background', 'frame', 'title']) {
      expect(slots.has(s as never), s).toBe(true)
    }
  })

  it('男号商店照旧', () => {
    const slots = new Set(shopFor('m').map((i) => i.slot))
    expect(slots.has('hair')).toBe(true)
    expect(slots.has('outfit')).toBe(true)
    for (const s of DRESS_SLOTS) expect(slots.has(s), s).toBe(false)
  })
})

describe('补发开局装备', () => {
  const pet = (patch: Partial<AvatarProfile> = {}): AvatarProfile => ({
    playerId: 'p1',
    sex: 'f',
    skin: 0,
    owned: [],
    equipped: {},
    spent: 0,
    createdAt: 0,
    ...patch,
  })

  it.skipIf(!hasDressUp)('女号新建就穿戴整齐', () => {
    const a = newAvatar('p1', 'f')
    for (const slot of DRESS_SLOTS) {
      expect(a.equipped[slot], slot).toBe(dressId(slot, 0))
      expect(a.owned, slot).toContain(dressId(slot, 0))
    }
  })

  it.skipIf(!hasDressUp)('老存档补齐：空着的槽位穿上第一件', () => {
    const after = grantDressUp(pet({ owned: ['tee'], equipped: { outfit: 'tee' } }))
    for (const slot of DRESS_SLOTS) {
      expect(after.equipped[slot], slot).toBe(dressId(slot, 0))
    }
    // 老的东西一件都不能少
    expect(after.owned).toContain('tee')
    expect(after.equipped.outfit).toBe('tee')
  })

  it.skipIf(!hasDressUp)('已经穿着的不会被顶掉', () => {
    const before = pet({
      owned: [...DRESS_STARTERS, 'racket-09'],
      equipped: { ...DRESS_DEFAULTS, racket: 'racket-09' },
    })
    expect(grantDressUp(before).equipped.racket).toBe('racket-09')
  })

  it('反复补发结果一样（迁移、换性别、新建都在调它）', () => {
    const once = grantDressUp(pet({ owned: ['tee'] }))
    expect(grantDressUp(once)).toEqual(once)
  })

  it('男号一件换装都不给', () => {
    const before = pet({ sex: 'm', owned: ['tee'], equipped: { outfit: 'tee' } })
    expect(grantDressUp(before)).toEqual(before)
  })
})
