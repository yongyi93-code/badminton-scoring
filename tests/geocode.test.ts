import { describe, expect, it } from 'vitest'
import { parsePlaces } from '@/lib/geocode'

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
