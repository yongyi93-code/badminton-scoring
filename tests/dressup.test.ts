import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DRESS_ITEMS,
  DRESS_SLOTS,
  dressCrop,
  dressDefaultsFor,
  dressId,
  dressItemsFor,
  dressLayer,
  dressSet,
  dressStartersFor,
  dressUpFor,
  TIERS_PER_SLOT,
} from '@/lib/dressup'
import {
  grantDressUp,
  newAvatar,
  shopFor,
  type AvatarProfile,
  type AvatarSex,
} from '@/lib/avatar'

/*
 * 分层换装最容易出的错，是「商店卖了一件，但那件没有素材」——
 * 界面上不报错，点了就是没反应。所以第一条测试把商店和素材整个对一遍。
 *
 * 男女各一套素材，任意一套都可以整个删干净（dressUpFor 返回 false 就退回
 * 按段位换立绘的老路），所以跟素材有关的几条按性别 skipIf，
 * 业务逻辑那几条照跑。
 */

const SEXES: AvatarSex[] = ['f', 'm']
/** 素材文件夹：男女文件名一样（都是 top-01.webp），靠文件夹分开 */
const DIR: Record<AvatarSex, string> = {
  f: 'src/assets/dressup',
  m: 'src/assets/dressup-m',
}

describe('换装商店', () => {
  it('男女各四个槽位 × 11 件，编号从 01 起', () => {
    expect(DRESS_ITEMS).toHaveLength(2 * DRESS_SLOTS.length * TIERS_PER_SLOT)
    expect(dressId('f', 'top', 0)).toBe('f/top-01')
    expect(dressId('m', 'racket', 10)).toBe('m/racket-11')
  })

  it('id 必须带性别前缀，否则换性别会指到另一套的同名装备', () => {
    // 两套素材的文件名是一样的，光看 top-01 分不出是哪一套
    const ids = DRESS_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of DRESS_ITEMS) {
      expect(item.id, item.id).toMatch(/^[fm]\/(top|bottom|shoes|racket)-\d\d$/)
      expect(item.id.startsWith(`${item.sex}/`), item.id).toBe(true)
    }
  })

  for (const sex of SEXES) {
    it(`${sex}：每个槽位第一件白送，其余越往后越贵、门槛越高`, () => {
      for (const slot of DRESS_SLOTS) {
        const line = DRESS_ITEMS.filter((i) => i.sex === sex && i.slot === slot)
        expect(line).toHaveLength(TIERS_PER_SLOT)
        expect(line[0].price, slot).toBe(0)
        for (let i = 1; i < line.length; i++) {
          expect(line[i].price, `${slot}-${i}`).toBeGreaterThan(line[i - 1].price)
          expect(line[i].minLevel, `${slot}-${i}`).toBeGreaterThanOrEqual(
            line[i - 1].minLevel,
          )
        }
      }
    })

    it(`${sex}：每件都有名字，同一套里没有重名`, () => {
      const names = DRESS_ITEMS.filter((i) => i.sex === sex).map((i) => i.name)
      for (const n of names) expect(n.length).toBeGreaterThan(0)
      expect(new Set(names).size).toBe(names.length)
    })
  }

  it('同一档位男女一样贵，谁也不吃亏', () => {
    for (const slot of DRESS_SLOTS) {
      for (let t = 0; t < TIERS_PER_SLOT; t++) {
        const f = DRESS_ITEMS.find((i) => i.id === dressId('f', slot, t))!
        const m = DRESS_ITEMS.find((i) => i.id === dressId('m', slot, t))!
        expect([m.price, m.minLevel], `${slot}-${t}`).toEqual([f.price, f.minLevel])
      }
    }
  })
})

for (const sex of SEXES) {
  describe.skipIf(!dressUpFor(sex))(`${sex} 的素材`, () => {
    it('商店卖的每一件都有图层和掩膜', () => {
      // 少了掩膜就没法「先擦再画」，换上短的那件时底图的旧衣服会露在外面
      for (const item of dressItemsFor(sex)) {
        const layer = dressLayer(item.id)
        expect(layer, item.id).not.toBeNull()
        expect(layer!.art, item.id).toBeTruthy()
        expect(layer!.mask, item.id).toBeTruthy()
      }
    })

    it('每一层都落在画布里', () => {
      const [W, H] = dressSet(sex)!.canvas
      for (const item of dressItemsFor(sex)) {
        const { box } = dressLayer(item.id)!
        expect(box.w, item.id).toBeGreaterThan(0)
        expect(box.h, item.id).toBeGreaterThan(0)
        expect(box.x, item.id).toBeGreaterThanOrEqual(0)
        expect(box.y, item.id).toBeGreaterThanOrEqual(0)
        expect(box.x + box.w, item.id).toBeLessThanOrEqual(W)
        expect(box.y + box.h, item.id).toBeLessThanOrEqual(H)
      }
    })

    it('全身和头肩两个取景框都在画布里，头肩框得更近', () => {
      const set = dressSet(sex)!
      const [W, H] = set.canvas
      for (const [name, box] of [['body', set.body], ['head', set.head]] as const) {
        expect(box.w, name).toBeGreaterThan(0)
        expect(box.x, name).toBeGreaterThanOrEqual(0)
        expect(box.x + box.w, name).toBeLessThanOrEqual(W)
        expect(box.y + box.h, name).toBeLessThanOrEqual(H)
      }
      // 头像不裁近的话，缩进小圆圈里人只有几像素高，认不出是谁
      expect(set.head.h).toBeLessThan(set.body.h / 2)
    })

    it('商店小图的取景框也在画布里，而且是正方形', () => {
      const [W, H] = dressSet(sex)!.canvas
      for (const item of dressItemsFor(sex)) {
        const crop = dressCrop(item.id)!
        expect(crop, item.id).not.toBeNull()
        expect(crop.w, item.id).toBe(crop.h)
        expect(crop.x, item.id).toBeGreaterThanOrEqual(0)
        expect(crop.y, item.id).toBeGreaterThanOrEqual(0)
        expect(crop.x + crop.w, item.id).toBeLessThanOrEqual(W)
        expect(crop.y + crop.h, item.id).toBeLessThanOrEqual(H)
      }
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
      for (const item of dressItemsFor(sex)) {
        const key = item.id.split('/')[1]
        const buf = readFileSync(`${DIR[sex]}/${key}.mask.webp`)
        expect(webpHasAlpha(buf), `${item.id} 的掩膜`).toBe(true)
      }
    })
  })
}

describe('素材缺失', () => {
  it('没有素材的 id 返回 null，不会画出一块空白', () => {
    expect(dressLayer('f/top-99')).toBeNull()
    expect(dressLayer('x/top-01')).toBeNull()
    // 不带前缀的旧 id 也要认得出是坏的
    expect(dressLayer('top-01')).toBeNull()
    expect(dressCrop('nope')).toBeNull()
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
  for (const sex of SEXES) {
    it.skipIf(!dressUpFor(sex))(`${sex} 号商店只卖换装那四类，不再卖发型战服武器`, () => {
      const items = shopFor(sex)
      const slots = new Set(items.map((i) => i.slot))
      for (const s of DRESS_SLOTS) expect(slots.has(s), s).toBe(true)
      for (const s of ['hair', 'outfit', 'weapon']) {
        expect(slots.has(s as never), s).toBe(false)
      }
      // 画在人外面的三类照旧，不然有立绘之后金币没处花
      for (const s of ['background', 'frame', 'title']) {
        expect(slots.has(s as never), s).toBe(true)
      }
      // 只卖自己这一套，不能把异性那 44 件也摆出来
      for (const i of items) {
        if (DRESS_SLOTS.includes(i.slot as never)) {
          expect(i.id.startsWith(`${sex}/`), i.id).toBe(true)
        }
      }
    })
  }
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

  for (const sex of SEXES) {
    it.skipIf(!dressUpFor(sex))(`${sex} 号新建就穿戴整齐`, () => {
      const a = newAvatar('p1', sex)
      for (const slot of DRESS_SLOTS) {
        expect(a.equipped[slot], slot).toBe(dressId(sex, slot, 0))
        expect(a.owned, slot).toContain(dressId(sex, slot, 0))
      }
      expect(dressStartersFor(sex).sort()).toEqual(
        DRESS_SLOTS.map((s) => dressId(sex, s, 0)).sort(),
      )
      expect(Object.values(dressDefaultsFor(sex)).sort()).toEqual(
        dressStartersFor(sex).sort(),
      )
    })
  }

  it.skipIf(!dressUpFor('f'))('老存档补齐：空着的槽位穿上第一件', () => {
    const after = grantDressUp(pet({ owned: ['tee'], equipped: { outfit: 'tee' } }))
    for (const slot of DRESS_SLOTS) {
      expect(after.equipped[slot], slot).toBe(dressId('f', slot, 0))
    }
    // 老的东西一件都不能少
    expect(after.owned).toContain('tee')
    expect(after.equipped.outfit).toBe('tee')
  })

  it.skipIf(!dressUpFor('f'))('已经穿着的不会被顶掉', () => {
    const before = pet({
      owned: [...dressStartersFor('f'), 'f/racket-09'],
      equipped: { ...dressDefaultsFor('f'), racket: 'f/racket-09' },
    })
    expect(grantDressUp(before).equipped.racket).toBe('f/racket-09')
  })

  it.skipIf(!(dressUpFor('f') && dressUpFor('m')))(
    '换性别：穿上那边买过的最好的一件，换回来照样穿回好东西',
    () => {
      /*
       * 两套的 id 不通用，所以换过去身上那件必然失效。
       * 挑「已买过的最贵的一件」而不是无脑穿白送的 ——
       * owned 从来不清空，换过去换回来，攒下的家当还在身上。
       */
      const she = pet({
        owned: [...dressStartersFor('f'), 'f/top-09', ...dressStartersFor('m'), 'm/top-05'],
        equipped: { ...dressDefaultsFor('f'), top: 'f/top-09' },
      })
      const he = grantDressUp({ ...she, sex: 'm' })
      expect(he.equipped.top).toBe('m/top-05')
      expect(he.equipped.shoes).toBe(dressId('m', 'shoes', 0))
      // 买过的一件都没没收
      expect(he.owned).toContain('f/top-09')

      const back = grantDressUp({ ...he, sex: 'f' })
      expect(back.equipped.top).toBe('f/top-09')
    },
  )

  it('反复补发结果一样（迁移、换性别、新建都在调它）', () => {
    const once = grantDressUp(pet({ owned: ['tee'] }))
    expect(grantDressUp(once)).toEqual(once)
  })

  it.skipIf(dressUpFor('m'))('没素材的性别一件换装都不给', () => {
    const before = pet({ sex: 'm', owned: ['tee'], equipped: { outfit: 'tee' } })
    expect(grantDressUp(before)).toEqual(before)
  })
})
