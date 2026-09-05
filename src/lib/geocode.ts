import { pick } from './i18n'

/* ------------------------------------------------------------------ *
 * 地址搜索（边打边跳建议）
 *
 * 用 Photon —— komoot 基于 OpenStreetMap 数据的搜索服务。选它的理由
 * 和选地图一样：不要 API key、不要绑信用卡、不按次收费。而且它本来
 * 就是为「输入框边打边给建议」设计的；Nominatim 的使用条款明确
 * 不鼓励拿来做自动补全。
 *
 * 一箭双雕：选中一条建议，地址和坐标一起有了 —— 在这之前，坐标只能
 * 靠人站在球馆里按定位，或者自己去地图上复制。
 *
 * 但它是个免费的公共服务，没有任何保证。所以这里的每一处失败都是
 * 静默的：搜不到、连不上、超时，一律不挡着人手打地址。搜索是加分项，
 * 不是必经之路。
 * ------------------------------------------------------------------ */

export type Place = {
  /** 地点名字，例如「Twin Ark Badminton」。可能为空 */
  name: string
  /** 拼好的一行地址 */
  address: string
  lat: number
  lng: number
}

/**
 * 把服务端回的东西转成我们要的形状。
 *
 * 认两种形状，不是为了通用，是为了不把整件事押在「我记对了返回格式」上：
 *
 *   GeoJSON（Photon）    { features: [{ geometry: { coordinates: [经度, 纬度] }, properties: {…} }] }
 *   一个数组（Nominatim）[{ lat, lon, display_name, name }]
 *
 * 沙箱连不上那两个服务，这个函数是照着它们的文档写的 —— 万一有出入，
 * 认两种至少让「另一种也能用」，而不是整个功能悄悄地什么都不返回。
 *
 * 注意 GeoJSON 的坐标是「经度在前」，和人念的顺序相反。这一处写反了
 * 不会报错，只会把马来西亚的球馆标到索马里外海去。
 */
export function parsePlaces(json: unknown): Place[] {
  const rows: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { features?: unknown[] })?.features)
      ? (json as { features: unknown[] }).features
      : []

  const out: Place[] = []
  for (const row of rows) {
    const r = row as Record<string, unknown>
    const props = (r.properties ?? r) as Record<string, unknown>
    const geo = r.geometry as { coordinates?: unknown[] } | undefined

    let lat: number, lng: number
    if (Array.isArray(geo?.coordinates) && geo.coordinates.length >= 2) {
      // GeoJSON：经度在前
      lng = Number(geo.coordinates[0])
      lat = Number(geo.coordinates[1])
    } else {
      lat = Number(props.lat)
      lng = Number(props.lon ?? props.lng)
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue

    const name = String(props.name ?? '').trim()
    const address =
      typeof props.display_name === 'string'
        ? props.display_name
        : [
            [props.housenumber, props.street].filter(Boolean).join(' '),
            props.district,
            props.postcode,
            props.city,
            props.state,
            props.country,
          ]
            .map((x) => (typeof x === 'string' ? x.trim() : ''))
            .filter(Boolean)
            .join(', ')

    // 名字和地址都空的条目没有任何用，扔掉
    if (!name && !address) continue
    out.push({ name, address, lat, lng })
  }
  return out
}

export type SearchOutcome =
  | { ok: true; places: Place[] }
  | { ok: false; error: string }

/** 太短的词搜出来全是噪音，也白白把人的每一次按键都发出去 */
export const MIN_QUERY = 3

/**
 * 搜地址。
 *
 * near 是「往哪儿偏」—— 传了的话，同名的地方优先给附近那个。
 * 传球群里已经标过的某个球馆的坐标就行，不用问人要定位。
 */
export async function searchPlaces(
  query: string,
  opts: { near?: { lat: number; lng: number }; signal?: AbortSignal } = {},
): Promise<SearchOutcome> {
  const q = query.trim()
  if (q.length < MIN_QUERY) return { ok: true, places: [] }

  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '5')
  if (opts.near) {
    url.searchParams.set('lat', String(opts.near.lat))
    url.searchParams.set('lon', String(opts.near.lng))
  }

  try {
    /*
     * 自己兜一个超时。这是个免费的公共服务，慢下来的时候会很慢，
     * 而一个吊在那儿转圈的建议列表比没有建议还烦。
     */
    const ctrl = new AbortController()
    const cut = setTimeout(() => ctrl.abort(), 6000)
    /*
     * 手工把外面那个取消信号接过来，不用 AbortSignal.any()。
     *
     * any() 是很新的东西（Safari 17.4 才有），而马来西亚球场上
     * 大把是撑了好几年的旧 iPhone —— 在那些机器上它会直接抛错，
     * 而这一段是在一个「本来就该悄悄失败」的功能里，抛出来就是
     * 一个没人看得懂的红字。两行代码换掉整类兼容问题。
     */
    const onOuter = () => ctrl.abort()
    opts.signal?.addEventListener('abort', onOuter)

    let res: Response
    try {
      res = await fetch(url, { signal: ctrl.signal })
    } finally {
      clearTimeout(cut)
      opts.signal?.removeEventListener('abort', onOuter)
    }
    if (!res.ok) {
      return { ok: false, error: pick('地址搜索暂时用不了', 'Address search is unavailable') }
    }
    return { ok: true, places: parsePlaces(await res.json()) }
  } catch (e) {
    // 主动取消（人又打了一个字）不是错误，别把它显示出来
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: true, places: [] }
    }
    return { ok: false, error: pick('地址搜索暂时用不了', 'Address search is unavailable') }
  }
}
