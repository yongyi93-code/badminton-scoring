import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useT } from '@/lib/i18n'
import { useTheme } from '@/store/useTheme'

/* ------------------------------------------------------------------ *
 * 球馆地图
 *
 * 画的是「有人标过位置的球馆」。没标位置的不出现 —— 地图上一个
 * 猜出来的点，比没有点糟得多。
 *
 * 为什么用 Leaflet + OpenStreetMap：不要 API key、不要绑信用卡、
 * 不按次收费。Google Maps 的地图组件三样都要，而这个 App 现在
 * 只有一个球群、十几个人 —— 为一张图去开一个计费账号不值得。
 * 导航还是交给 Google Maps（点「带我去」跳出去），那一半它做得最好。
 * ------------------------------------------------------------------ */

export type MapPin = {
  key: string
  label: string
  lat: number
  lng: number
  address?: string
}

/** 自己画的图钉。Leaflet 自带的图标在打包工具下会丢图片，而且也不是我们的样子 */
const pinIcon = (highlight: boolean) =>
  L.divIcon({
    className: '',
    html: `<svg viewBox="0 0 24 24" width="30" height="30" fill="${
      highlight ? '#0a9f9a' : '#0a9f9a'
    }" stroke="white" stroke-width="1.4" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Z"/>
      <circle cx="12" cy="9" r="2.6" fill="white" stroke="none"/>
    </svg>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
  })

export function VenueMap({
  pins,
  onPick,
  height = 280,
}: {
  pins: MapPin[]
  onPick?: (pin: MapPin) => void
  height?: number
}) {
  const t = useT()
  const { theme } = useTheme()
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const meRef = useRef<L.CircleMarker | null>(null)
  const [locating, setLocating] = useState(false)

  /* 建图。只建一次 —— Leaflet 的实例自己管着 DOM，重建会闪 */
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const map = L.map(boxRef.current, {
      zoomControl: false,
      attributionControl: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // OSM 的使用条款要求署名，这一行不能去掉
      attribution: '© OpenStreetMap',
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // 初始视野：吉隆坡。等下面那个 effect 有点了就会重新框
    map.setView([3.139, 101.6869], 11)

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      meRef.current = null
    }
  }, [])

  /* 点变了就重画，并且把视野框到所有点上 */
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    if (pins.length === 0) return

    for (const pin of pins) {
      const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(false) })
        .addTo(layer)
        .bindTooltip(pin.label, { direction: 'top', offset: [0, -26] })
      if (onPick) marker.on('click', () => onPick(pin))
    }

    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]))
    if (pins.length === 1) {
      map.setView(bounds.getCenter(), 16)
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
    }
  }, [pins, onPick])

  /*
   * 「我在哪」。只在按了之后才问定位 —— 一进页面就弹权限框，
   * 十个人有九个会直接拒，之后再想要就难了。
   */
  const locateMe = () => {
    const map = mapRef.current
    if (!map || !('geolocation' in navigator)) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const here: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        meRef.current?.remove()
        meRef.current = L.circleMarker(here, {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: '#2563eb',
          fillOpacity: 1,
        }).addTo(map)
        map.setView(here, Math.max(map.getZoom(), 14))
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="border-line rounded-card relative overflow-hidden border">
      <div
        ref={boxRef}
        style={{ height }}
        /*
         * 深色模式下把瓦片反过来。
         *
         * 只作用在瓦片那一层，不碰图钉 —— 整块反的话图钉会变成
         * 一个诡异的粉色。这不是「真正的深色地图」（那要另一套瓦片，
         * 而那要 API key），但比在一片深色界面里嵌一块刺眼的白强得多。
         */
        className={
          theme === 'dark'
            ? '[&_.leaflet-tile-pane]:invert [&_.leaflet-tile-pane]:hue-rotate-180 [&_.leaflet-tile-pane]:brightness-95 [&_.leaflet-tile-pane]:contrast-90'
            : ''
        }
      />
      <button
        onClick={locateMe}
        disabled={locating}
        className="bg-surface text-ink-900 border-line shadow-card absolute top-3 right-3 z-[500] rounded-lg border px-3 py-2 text-caption font-semibold active:brightness-95"
      >
        {locating ? t('定位中…', 'Locating…') : t('我在哪', 'Where am I')}
      </button>
    </div>
  )
}
