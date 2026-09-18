import { useEffect, useState } from 'react'
import { lang, useT } from '@/lib/i18n'
import { Button, Sheet, cx, inputClass } from '@/components/ui'
import { REPORT_REASONS, reasonLabel, type ReportReason } from '@/lib/report'
import {
  BAN_SPANS,
  type Ban,
  type BanKind,
  banLine,
  createBan,
  fetchBansOf,
  liftBan,
} from '@/lib/ban'
import { relativeTime } from '@/lib/format'

/* ------------------------------------------------------------------ *
 * 管理员封人那一层
 *
 * 三个决定，摆在同一屏上，因为它们是一起做的：
 *
 *   多重   禁言（发不了话）还是封号（连加好友、上榜、改名片都不行）
 *   多久   1 天 / 7 天 / 30 天 / 永久
 *   为什么 理由 + 一句话 —— **那句话被封的人看得到**
 *
 * 上面先列这个人的前科。决定「这次封多久」时最该看的就是
 * 「他上次是因为什么、封了多久」，翻到另一屏去看的话没人会翻。
 * ------------------------------------------------------------------ */

export function BanSheet({
  open,
  uid,
  name,
  defaultReason,
  onClose,
  onDone,
}: {
  open: boolean
  uid: string
  name: string
  /** 从哪条举报点过来的，理由先替他选上 —— 十次里九次就是那个 */
  defaultReason?: ReportReason
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const zh = lang() === 'zh'
  const [kind, setKind] = useState<BanKind>('mute')
  const [reason, setReason] = useState<ReportReason>(defaultReason ?? 'harassment')
  const [hours, setHours] = useState<number | null>(24 * 7)
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<Ban[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind('mute')
    setReason(defaultReason ?? 'harassment')
    setHours(24 * 7)
    setNote('')
    setError(null)
    let alive = true
    void fetchBansOf(uid).then((h) => {
      if (alive) setHistory(h)
    })
    return () => {
      alive = false
    }
  }, [open, uid, defaultReason])

  const reload = async () => setHistory(await fetchBansOf(uid))

  const apply = async () => {
    setBusy(true)
    setError(null)
    const r = await createBan({ uid, kind, reason, note, hours })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onDone()
    onClose()
  }

  const lift = async (id: string) => {
    setBusy(true)
    setError(null)
    const r = await liftBan(id)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    await reload()
    onDone()
  }

  const span = BAN_SPANS.find((s) => s.hours === hours)
  const live = history.filter(
    (b) => !b.lifted_at && (!b.until || Date.parse(b.until) > Date.now()),
  )

  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={t(`处理 ${name}`, `Act on ${name}`)}
    >
      <div className="space-y-4">
        {/* 现在正封着的话，这一屏的第一件事是解封，不是再封一次 */}
        {live.length > 0 && (
          <div className="border-danger-600/30 bg-danger-50 rounded-card border p-3.5">
            {live.map((b) => (
              <div key={b.id} className="space-y-1.5">
                <p className="text-danger-600 text-label font-medium">{banLine(b, zh)}</p>
                <p className="text-ink-700 text-caption">
                  {reasonLabel(b.reason)}
                  {b.note ? ` · 「${b.note}」` : ''}
                </p>
                <Button size="sm" disabled={busy} onClick={() => void lift(b.id)}>
                  {t('解除', 'Lift')}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* 前科。决定封多久最该看的就是这个，所以摆在选项上面 */}
        {history.length > live.length && (
          <div className="border-line rounded-card border p-3">
            <p className="text-ink-500 text-caption">
              {t(`以前被处理过 ${history.length} 次`, `Handled ${history.length} time(s) before`)}
            </p>
            {history.slice(0, 4).map((b) => (
              <p key={b.id} className="text-ink-500 mt-1 text-caption">
                {relativeTime(Date.parse(b.created_at))} ·{' '}
                {b.kind === 'ban' ? t('封号', 'Suspended') : t('禁言', 'Muted')} ·{' '}
                {reasonLabel(b.reason)}
                {b.lifted_at ? t(' · 已解除', ' · lifted') : ''}
              </p>
            ))}
          </div>
        )}

        <Choice
          label={t('多重', 'How hard')}
          value={kind}
          onChange={setKind}
          options={[
            {
              value: 'mute' as BanKind,
              title: t('禁言', 'Mute'),
              hint: t('发不了私信和动态', 'No messages, no posts'),
            },
            {
              value: 'ban' as BanKind,
              title: t('封号', 'Suspend'),
              hint: t('再加：加好友、上榜、改名片', 'Also: friends, board, card'),
            },
          ]}
        />

        <Choice
          label={t('多久', 'How long')}
          value={hours}
          onChange={setHours}
          options={BAN_SPANS.map((s) => ({
            value: s.hours,
            title: zh ? s.zh : s.en,
            hint: '',
          }))}
        />

        <div>
          <p className="text-label font-medium">{t('为什么', 'Why')}</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {REPORT_REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setReason(r.value)}
                className={cx(
                  'rounded-lg border px-3 py-2 text-left text-caption',
                  reason === r.value
                    ? 'border-brand-500 bg-brand-100 font-medium'
                    : 'border-line bg-surface',
                )}
              >
                {zh ? r.zh : r.en}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-label font-medium" htmlFor="ban-note">
            {t('给他的一句话', 'A line for them')}
          </label>
          {/*
            这一栏不是内部备注 —— 被封的人原样看得到它。
            写清楚做了什么，他才可能改；写一句火气话，只会换来一条申诉。
          */}
          <p className="text-ink-500 mt-1 text-caption">
            {t(
              '他会原样看到这句话。写他做了什么，不是写你怎么想他。',
              'They see this verbatim. Say what they did, not what you think of them.',
            )}
          </p>
          <textarea
            id="ban-note"
            className={cx(inputClass, 'mt-2 min-h-20 resize-none')}
            value={note}
            disabled={busy}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('比如：在球局群里连续辱骂两个人', 'e.g. Repeated insults in a session chat')}
          />
        </div>

        {error && (
          <div className="border-danger-600/30 bg-danger-50 rounded-card border p-3.5">
            <p className="text-ink-700 text-caption">{error}</p>
          </div>
        )}

        {/*
          按钮上把「封多重、封多久」原样念一遍。
          一屏三组选项之后，最后那一下该看得见自己按的是什么 ——
          「确定」两个字什么都没说。
        */}
        <Button block variant="primary" disabled={busy} onClick={() => void apply()}>
          {busy
            ? t('正在处理…', 'Working…')
            : t(
                `${kind === 'ban' ? '封号' : '禁言'} · ${span?.zh ?? ''}`,
                `${kind === 'ban' ? 'Suspend' : 'Mute'} · ${span?.en ?? ''}`,
              )}
        </Button>

        <p className="text-ink-500 text-caption">
          {t(
            '记分、开球局、看排行榜都不受影响 —— 这是社交上的处理，不是不让人打球。他可以申诉，你会在「申诉」那一屏看到。',
            'Scoring, sessions and leaderboards are untouched — this is a social sanction, not a ban from playing. They can appeal, and you will see it under Appeals.',
          )}
        </p>
      </div>
    </Sheet>
  )
}

function Choice<T extends string | number | null>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; title: string; hint: string }[]
}) {
  return (
    <div>
      <p className="text-label font-medium">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-lg border px-3 py-2 text-left',
              value === o.value
                ? 'border-brand-500 bg-brand-100'
                : 'border-line bg-surface',
            )}
          >
            <span className="block text-caption font-medium">{o.title}</span>
            {o.hint && <span className="text-ink-500 block text-caption">{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
