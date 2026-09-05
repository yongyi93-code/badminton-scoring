import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { hasLocation, mapsUrl, parseLatLng, venueByKey, venueKey, venueLabel } from '@/lib/venues'
import { Button, Field, Sheet, inputClass } from '@/components/ui'
import { MIN_QUERY, searchPlaces, type Place } from '@/lib/geocode'

/* ------------------------------------------------------------------ *
 * 球馆地址
 *
 * 球馆的战绩（打了几场、谁是第一）一直是从球局算出来的，不用谁维护。
 * 但「这个馆在哪」算不出来 —— 得有人填一次，然后全群都看得到。
 *
 * 这是地图那件事的地基：先让球馆有地址，能一键导航。等球群多起来
 * 再把它们铺到地图上，那时候这条记录已经在所有人手机上了。
 * ------------------------------------------------------------------ */

const PIN = (
  <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

/** 填 / 改地址的弹层 */
function AddressSheet({
  venue,
  open,
  onClose,
}: {
  venue: string
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const key = venueKey(venue)
  const saved = useApp((s) => venueByKey(s.venues, key))
  const saveVenue = useApp((s) => s.saveVenue)
  const meId = useApp((s) => s.meId)
  const [address, setAddress] = useState(saved?.address ?? '')
  const [note, setNote] = useState(saved?.note ?? '')

  /** 坐标：null = 还没有 */
  const [xy, setXy] = useState<{ lat: number; lng: number } | null>(
    saved?.lat != null && saved?.lng != null ? { lat: saved.lat, lng: saved.lng } : null,
  )
  /** 定位精度（米），只在刚定完位时有值 —— 用来告诉人这一下准不准 */
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')

  /**
   * 「我就在球馆」—— 直接拿手机的定位。
   *
   * 这是坐标最主要的来源：开局的人本来就站在球馆里，按一下就完事，
   * 比让他去地图上找那个点靠谱得多，也准得多。
   */
  const locate = () => {
    if (!('geolocation' in navigator)) {
      setLocError(t('这个浏览器不给定位', 'This browser cannot do location'))
      return
    }
    setLocating(true)
    setLocError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setXy({
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
        })
        setAccuracy(Math.round(pos.coords.accuracy))
      },
      (err) => {
        setLocating(false)
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? t(
                '定位被拒了。到手机设置里给浏览器开定位，或者在下面粘坐标。',
                'Location was denied. Allow it in your phone settings, or paste the coordinates below.',
              )
            : t(
                '一时定不到位。走到窗边或者场馆外面再试一次，或者在下面粘坐标。',
                'Could not get a fix. Try again near a window or outside, or paste the coordinates below.',
              ),
        )
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  const pasted = parseLatLng(paste)

  /* ---------------- 地址搜索：边打边给建议 ---------------- */

  const [hits, setHits] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  /*
   * 这一次的地址变化不该触发搜索。两种情况：
   *   刚从建议里选了一条 —— 再搜一遍会立刻弹出一模一样的列表
   *   弹层刚打开、地址是存过的 —— 人还没打字，凭什么给他弹建议
   */
  const skipSearch = useRef(Boolean(saved?.address))

  /*
   * 往哪儿偏：拿球群里已经标过坐标的任何一个球馆当参考点。
   * 「Twin Ark」这种名字全世界有好几个，不给个参考点，第一条
   * 很可能是德国的某处。用已有的球馆而不是问人要定位 —— 为了
   * 一个搜索框弹权限框太重了。
   */
  const near = useApp((st) =>
    st.venues.find((v) => v.lat != null && v.lng != null),
  )

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false
      return
    }
    const q = address.trim()
    if (q.length < MIN_QUERY) {
      setHits([])
      setSearchErr(null)
      return
    }
    /*
     * 防抖 + 可取消。
     *
     * 不防抖的话，打「Twin Ark 养身局」是十几次请求 —— 对一个免费的
     * 公共服务来说这是滥用，对用的人来说是列表在眼前乱跳。
     */
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      void searchPlaces(q, {
        near: near?.lat != null && near?.lng != null ? { lat: near.lat, lng: near.lng } : undefined,
        signal: ctrl.signal,
      }).then((res) => {
        if (ctrl.signal.aborted) return
        setSearching(false)
        if (res.ok) {
          setHits(res.places)
          setSearchErr(null)
        } else {
          setHits([])
          setSearchErr(res.error)
        }
      })
    }, 500)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [address, near])

  const usePlace = (place: Place) => {
    skipSearch.current = true
    setAddress(place.address || place.name)
    setXy({ lat: place.lat, lng: place.lng })
    setAccuracy(null)
    setHits([])
  }

  return (
    <Sheet open={open} onClose={onClose} title={venueLabel(venue)}>
      <div className="space-y-4">
        <Field
          label={t('地址', 'Address')}
          hint={t(
            '打几个字会跳出建议，选一条地址和坐标就一起有了。搜不到就自己写，或者用下面的定位。',
            'Type a few letters and suggestions appear — picking one fills the address and the exact spot. Otherwise just type it, or use locate below.',
          )}
        >
          <textarea
            className={`${inputClass} h-24 resize-none py-2.5`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t('例：Jalan SS 2/24, SS 2, 47300 Petaling Jaya', 'e.g. Jalan SS 2/24, SS 2, 47300 Petaling Jaya')}
            maxLength={200}
          />

          {/*
            边打边给的建议。选一条，地址和坐标一起有了 ——
            这是唯一一条不用人站在球馆里就能拿到坐标的路。

            搜不到、连不上都不挡着手打：这是个免费的公共服务，
            而且 OpenStreetMap 在马来西亚对小球馆的覆盖本来就一般。
          */}
          {searching && (
            <p className="text-ink-500 mt-2 text-caption">{t('搜索中…', 'Searching…')}</p>
          )}
          {hits.length > 0 && (
            <div className="border-line divide-line mt-2 divide-y overflow-hidden rounded-xl border">
              {hits.map((h, i) => (
                <button
                  key={`${h.lat},${h.lng},${i}`}
                  onClick={() => usePlace(h)}
                  className="active:bg-fill block w-full px-3.5 py-2.5 text-left"
                >
                  {h.name && <p className="text-label font-semibold">{h.name}</p>}
                  <p className="text-ink-500 text-caption">{h.address || t('（没有详细地址）', '(no street address)')}</p>
                </button>
              ))}
              <p className="text-ink-500 px-3.5 py-2 text-caption">
                {t('选一条，地址和坐标一起填好', 'Pick one and it fills both the address and the exact spot')}
              </p>
            </div>
          )}
          {searchErr && (
            <p className="text-ink-500 mt-2 text-caption">
              {searchErr}
              {t(' —— 手打也行，不影响。', ' — typing it by hand works just as well.')}
            </p>
          )}
        </Field>

        <Field
          label={t('备注（可留空）', 'Note (optional)')}
          hint={t(
            '地址说不清的那些：停车在哪、从哪个门进、我们一般在几号场。',
            'What the address cannot say: where to park, which door, which courts you usually take.',
          )}
        >
          <input
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('例：后面停车场进，5-8 号场', 'e.g. park at the back, courts 5–8')}
            maxLength={60}
          />
        </Field>

        {/*
          精确位置。
          主要来源是「我就在球馆」那一下 —— 开局的人本来就站在场里，
          按一次比让他去地图上找那个点又快又准。粘贴是兜底：
          不在现场的人也能把地图 App 里复制的坐标贴进来。
        */}
        <div className="border-line rounded-xl border p-3.5">
          <p className="text-label font-semibold">
            {t('精确位置（可留空）', 'Exact spot (optional)')}
          </p>
          <p className="text-ink-500 mt-0.5 text-caption">
            {t(
              '有坐标的话，导航直接指到门口，不会被地址写法带偏。',
              'With coordinates, navigation lands at the door instead of guessing from the text.',
            )}
          </p>

          {xy ? (
            <div className="mt-3">
              <p className="tnum text-label">
                {xy.lat}, {xy.lng}
              </p>
              {accuracy !== null && (
                <p
                  className={
                    accuracy > 100
                      ? 'text-warning-600 mt-0.5 text-caption'
                      : 'text-ink-500 mt-0.5 text-caption'
                  }
                >
                  {accuracy > 100
                    ? t(
                        `误差约 ${accuracy} 米 —— 有点大，走到室外再定一次会准很多`,
                        `About ${accuracy} m off — that is a lot; try again outdoors`,
                      )
                    : t(`误差约 ${accuracy} 米`, `About ${accuracy} m accurate`)}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="soft" disabled={locating} onClick={locate}>
                  {locating ? t('定位中…', 'Locating…') : t('重新定位', 'Locate again')}
                </Button>
                <Button
                  size="sm"
                  variant="soft"
                  onClick={() => {
                    setXy(null)
                    setAccuracy(null)
                  }}
                >
                  {t('清掉', 'Clear')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <Button block variant="ghost" disabled={locating} onClick={locate}>
                {locating
                  ? t('定位中…', 'Locating…')
                  : t('我就在球馆，用我的位置', 'I am at the venue — use my location')}
              </Button>
              <input
                className={inputClass}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={t('或者粘坐标：3.1234, 101.5678', 'or paste: 3.1234, 101.5678')}
              />
              {paste.trim() !== '' &&
                (pasted ? (
                  <Button
                    block
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      setXy(pasted)
                      setAccuracy(null)
                      setPaste('')
                    }}
                  >
                    {t(`用这个：${pasted.lat}, ${pasted.lng}`, `Use ${pasted.lat}, ${pasted.lng}`)}
                  </Button>
                ) : (
                  <p className="text-ink-500 text-caption">
                    {t(
                      '认不出坐标。在 Google Maps 上长按球馆 → 复制那一串数字，粘进来。短链（maps.app.goo.gl）不行，得先在地图里打开它。',
                      'No coordinates in there. Long-press the venue in Google Maps, copy the numbers, and paste them. Short links (maps.app.goo.gl) do not work — open them in Maps first.',
                    )}
                  </p>
                ))}
            </div>
          )}

          {locError && <p className="text-danger-600 mt-2 text-caption">{locError}</p>}
        </div>

        <p className="text-ink-500 text-caption">
          {t(
            '填了全群都看得到，谁都能改 —— 填错了让球友顺手改掉就行。',
            'Everyone in the club sees this, and anyone can correct it.',
          )}
        </p>

        <Button
          block
          variant="primary"
          onClick={() => {
            saveVenue(
              key,
              { address, note, lat: xy?.lat ?? null, lng: xy?.lng ?? null },
              meId,
            )
            onClose()
          }}
        >
          {t('保存', 'Save')}
        </Button>
      </div>
    </Sheet>
  )
}

/**
 * 球馆页上那张地址卡。没填过的时候是一句邀请，不是一片空白 ——
 * 空白不会让任何人动手，而这件事只要有一个人填，全群就都有了。
 */
export function VenueAddressCard({ venue }: { venue: string }) {
  const t = useT()
  const key = venueKey(venue)
  const saved = useApp((s) => venueByKey(s.venues, key))
  const players = useApp((s) => s.players)
  const [open, setOpen] = useState(false)
  const url = mapsUrl(venueLabel(venue), saved)
  const by = saved?.updatedBy ? players.find((p) => p.id === saved.updatedBy) : undefined

  // 没填球馆的那一档不是一个馆，没有地址可言
  if (!key) return null

  return (
    <>
      <div className="border-line bg-surface rounded-card border p-4">
        {/* 有地址或有坐标都算填过了 —— 光有坐标一样导航得到 */}
        {hasLocation(saved) ? (
          <>
            <div className="text-ink-500 flex items-start gap-2 text-label">
              <span className="mt-0.5">{PIN}</span>
              <span className="whitespace-pre-wrap">
                {saved?.address ||
                  t('只标了位置，没写地址', 'Pinned on the map, no written address')}
              </span>
            </div>
            {saved?.note && (
              <p className="text-ink-500 mt-2 text-caption">{saved.note}</p>
            )}
            <div className="mt-3 flex gap-2">
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-brand-solid text-on-brand rounded-btn flex h-11 flex-1 items-center justify-center text-label font-semibold active:brightness-95"
                >
                  {t('带我去', 'Take me there')}
                </a>
              )}
              <Button size="sm" variant="soft" onClick={() => setOpen(true)}>
                {t('改', 'Edit')}
              </Button>
            </div>
            {by && (
              <p className="text-ink-500 mt-2 text-caption">
                {t(`${by.name} 填的`, `Added by ${by.name}`)}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-title">{t('还没有位置', 'No location yet')}</p>
            <p className="text-ink-500 mt-1 text-label">
              {t(
                '人在球馆的话按一下定位就好，一次就够 —— 之后全群都能一键导航过来，不用再在群里问「在哪」。',
                'If you are at the venue, one tap on locate does it. After that everyone in the club can navigate here.',
              )}
            </p>
            <div className="mt-3">
              <Button block variant="ghost" onClick={() => setOpen(true)}>
                {t('加上位置', 'Add the location')}
              </Button>
            </div>
          </>
        )}
      </div>
      {/*
        关着的时候不挂载。挂着的话输入框的初始值只在第一次挂载时取一次，
        别人从另一台手机改了地址同步过来，这里打开还是旧的那份。
      */}
      {open && <AddressSheet venue={venue} open onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * 球局里那一行。
 *
 * 填过了就是「带我去」；没填过就是一句邀请 —— 而且是**在球局里**问，
 * 这是故意的：坐标最好的来源就是人正站在球馆里的那一刻，
 * 按一下定位就完事。放在别处问，人都不在现场，只能去地图上找那个点。
 */
export function VenueAddressLine({ venue }: { venue: string }) {
  const t = useT()
  const key = venueKey(venue)
  const saved = useApp((s) => venueByKey(s.venues, key))
  const [open, setOpen] = useState(false)
  const url = mapsUrl(venueLabel(venue), saved)

  // 没填球馆的那一档不是一个馆
  if (!key) return null

  if (!url) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="border-line active:bg-fill flex w-full items-center gap-2 rounded-xl border border-dashed px-3.5 py-2.5 text-left"
        >
          <span className="text-ink-500">{PIN}</span>
          <span className="text-ink-500 min-w-0 flex-1 text-label">
            {t('这个球馆还没有位置', 'This venue has no location yet')}
          </span>
          <span className="text-brand-600 shrink-0 text-caption font-semibold">
            {t('顺手定个位', 'Pin it')}
          </span>
        </button>
        {open && <AddressSheet venue={venue} open onClose={() => setOpen(false)} />}
      </>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="border-line bg-surface active:bg-fill flex items-center gap-2 rounded-xl border px-3.5 py-2.5"
    >
      <span className="text-brand-600">{PIN}</span>
      <span className="text-ink-700 min-w-0 flex-1 truncate text-label">
        {saved?.address || t('已标位置', 'Pinned on the map')}
      </span>
      <span className="text-brand-600 shrink-0 text-caption font-semibold">
        {t('带我去', 'Directions')}
      </span>
    </a>
  )
}
