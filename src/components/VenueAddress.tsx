import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { mapsUrl, venueByKey, venueKey, venueLabel } from '@/lib/venues'
import { Button, Field, Sheet, inputClass } from '@/components/ui'

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

  return (
    <Sheet open={open} onClose={onClose} title={venueLabel(venue)}>
      <div className="space-y-4">
        <Field
          label={t('地址', 'Address')}
          hint={t(
            '照着 Google Maps 上的写，或者直接从地图 App 复制粘贴过来。',
            'Copy it from Google Maps, or paste it straight from your map app.',
          )}
        >
          <textarea
            className={`${inputClass} h-24 resize-none py-2.5`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t('例：Jalan SS 2/24, SS 2, 47300 Petaling Jaya', 'e.g. Jalan SS 2/24, SS 2, 47300 Petaling Jaya')}
            maxLength={200}
          />
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
            saveVenue(key, { address, note }, meId)
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
        {saved?.address ? (
          <>
            <div className="text-ink-500 flex items-start gap-2 text-label">
              <span className="mt-0.5">{PIN}</span>
              <span className="whitespace-pre-wrap">{saved.address}</span>
            </div>
            {saved.note && (
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
            <p className="text-title">{t('还没有地址', 'No address yet')}</p>
            <p className="text-ink-500 mt-1 text-label">
              {t(
                '填一次，全群都能一键导航过来 —— 不用每次在群里问「在哪」。',
                'Fill it in once and everyone in the club can navigate here — no more asking where it is.',
              )}
            </p>
            <div className="mt-3">
              <Button block variant="ghost" onClick={() => setOpen(true)}>
                {t('填个地址', 'Add the address')}
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
 * 球局里那一行。只在填过地址时出现 —— 正在打球的界面上，
 * 一句「还没有地址」除了占地方没有别的作用。
 */
export function VenueAddressLine({ venue }: { venue: string }) {
  const t = useT()
  const key = venueKey(venue)
  const saved = useApp((s) => venueByKey(s.venues, key))
  const url = mapsUrl(venueLabel(venue), saved)
  if (!key || !saved?.address || !url) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="border-line bg-surface active:bg-fill flex items-center gap-2 rounded-xl border px-3.5 py-2.5"
    >
      <span className="text-brand-600">{PIN}</span>
      <span className="text-ink-700 min-w-0 flex-1 truncate text-label">
        {saved.address}
      </span>
      <span className="text-brand-600 shrink-0 text-caption font-semibold">
        {t('带我去', 'Directions')}
      </span>
    </a>
  )
}
