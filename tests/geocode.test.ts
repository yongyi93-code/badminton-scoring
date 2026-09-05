import { describe, expect, it } from 'vitest'
import { byDistance, distanceKm, parsePlaces, type Place } from '@/lib/geocode'

/* ------------------------------------------------------------------ *
 * 地址搜索回来的东西怎么读
 *
 * 沙箱连不上那两个地理搜索服务，所以这一组测的是「拿到 JSON 之后
 * 怎么读」——真正会写错的地方也在这儿：GeoJSON 的坐标是经度在前，
 * 和人念的顺序反过来，写反了不报错，只会把球馆标到别的洲去。
 * ------------------------------------------------------------------ */

describe('读地址搜索的结果', () => {
  it('GeoJSON：坐标是经度在前，别读反了', () => {
    const photon = {
      features: [
        {
          geometry: { type: 'Point', coordinates: [101.6236, 3.1119] },
          properties: {
            name: 'Twin Ark Badminton',
            street: 'Jalan SS 2/24',
            city: 'Petaling Jaya',
            state: 'Selangor',
            postcode: '47300',
            country: 'Malaysia',
          },
        },
      ],
    }
    const [p] = parsePlaces(photon)
    // 马来西亚：纬度 3 出头，经度 101 出头。读反了这里会是 lat=101
    expect(p.lat).toBe(3.1119)
    expect(p.lng).toBe(101.6236)
    expect(p.name).toBe('Twin Ark Badminton')
    expect(p.address).toContain('Jalan SS 2/24')
    expect(p.address).toContain('Petaling Jaya')
  })

  it('平铺数组也认（万一那边回的是另一种格式）', () => {
    const nominatim = [
      { lat: '3.0738', lon: '101.5183', name: '某球馆', display_name: '某球馆, Puchong, Selangor' },
    ]
    const [p] = parsePlaces(nominatim)
    expect(p.lat).toBe(3.0738)
    expect(p.lng).toBe(101.5183)
    expect(p.address).toBe('某球馆, Puchong, Selangor')
  })

  it('坐标缺了、坏了、超范围的，直接扔掉', () => {
    expect(parsePlaces({ features: [{ properties: { name: '没有坐标' } }] })).toHaveLength(0)
    expect(
      parsePlaces({ features: [{ geometry: { coordinates: ['x', 'y'] }, properties: {} }] }),
    ).toHaveLength(0)
    // 纬度不可能超过 90
    expect(
      parsePlaces({ features: [{ geometry: { coordinates: [101, 999] }, properties: { name: 'x' } }] }),
    ).toHaveLength(0)
  })

  it('名字和地址都空的条目没用，不要', () => {
    const json = { features: [{ geometry: { coordinates: [101.6, 3.1] }, properties: {} }] }
    expect(parsePlaces(json)).toHaveLength(0)
  })

  it('乱七八糟的输入不许把界面搞崩', () => {
    expect(parsePlaces(null)).toEqual([])
    expect(parsePlaces('不是 JSON')).toEqual([])
    expect(parsePlaces({ features: 'not an array' })).toEqual([])
    expect(parsePlaces({})).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 按远近重排
 *
 * 这一组是实测出来的：打「Sport arena」，服务端回的是俄罗斯、意大利、
 * 匈牙利、立陶宛、奥地利 —— 一条马来西亚的都没有，而人就站在马来西亚。
 * 服务端的「位置偏好」是个尽量，靠不住；近的排前面这件事我们自己做。
 * ------------------------------------------------------------------ */

const place = (name: string, lat: number, lng: number): Place => ({
  name,
  address: name,
  lat,
  lng,
})

const KL = { lat: 3.139, lng: 101.6869 }

describe('按离你多远重排', () => {
  it('马来西亚的排在俄罗斯前面', () => {
    const raw = [
      place('圣彼得堡', 59.95, 30.32),
      place('都灵', 45.07, 7.68),
      place('八打灵再也', 3.1119, 101.6236),
      place('维尔纽斯', 54.68, 25.28),
      place('浦种', 3.0738, 101.5183),
    ]
    const sorted = byDistance(raw, KL).map((p) => p.name)
    // 两条马来西亚的必须在最前面，顺序不重要（都在吉隆坡附近）
    expect(sorted.slice(0, 2).sort()).toEqual(['八打灵再也', '浦种'].sort())
    /*
     * 最远的是都灵，不是圣彼得堡 —— 我第一版这里断言错了。
     * 吉隆坡到都灵约 10,200 公里，到圣彼得堡约 8,600 公里：
     * 欧洲西边比俄罗斯西北更远。写测试时想当然了，被它抓了出来。
     */
    expect(sorted[sorted.length - 1]).toBe('都灵')
  })

  it('不删远的，只是排后面 —— 人真在国外时也得搜得到', () => {
    const raw = [place('圣彼得堡', 59.95, 30.32), place('八打灵再也', 3.1119, 101.6236)]
    expect(byDistance(raw, KL)).toHaveLength(2)
  })

  it('没有参考点就原样返回，不瞎排', () => {
    const raw = [place('a', 1, 1), place('b', 2, 2)]
    expect(byDistance(raw, undefined).map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('距离算得大致对', () => {
    // 吉隆坡 → 新加坡，直线约 320 公里
    const km = distanceKm(KL, { lat: 1.3521, lng: 103.8198 })
    expect(km).toBeGreaterThan(280)
    expect(km).toBeLessThan(360)
    // 同一个点就是 0
    expect(distanceKm(KL, KL)).toBeCloseTo(0)
  })
})
