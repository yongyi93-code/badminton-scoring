import { useEffect, useState } from 'react'
import { lang, useT } from '@/lib/i18n'
import { Button, Card, Sheet, cx, inputClass } from '@/components/ui'
import { reasonLabel } from '@/lib/report'
import {
  APPEAL_MAX,
  type Appeal,
  type Ban,
  banLine,
  blockedThings,
  fetchMyAppeals,
  fetchMyBan,
  sendAppeal,
} from '@/lib/ban'

/* ------------------------------------------------------------------ *
 * 「你被封了」那张卡
 *
 * 三件事一起说，缺一件都不行（025 开头那段的界面版）：
 *
 *   为什么   管理员写的那句话，原样给他看
 *   到什么时候   永久的就说永久，不编一个日期
 *   还能做什么   一条申诉的路，**而且封着也走得通**
 *
 * 一个说不出理由、没有下一步的封号，在当事人那里和「App 坏了」
 * 是同一件事 —— 他只会以为出了 bug，然后一遍遍重试。
 * ------------------------------------------------------------------ */

/** 拿自己那条封号。哪一屏要拦人就在哪一屏调 */
export function useMyBan(): { ban: Ban | null; reload: () => void } {
  const [ban, setBan] = useState<Ban | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    void fetchMyBan().then((b) => {
      if (alive) setBan(b)
    })
    return () => {
      alive = false
    }
  }, [n])
  return { ban, reload: () => setN((x) => x + 1) }
}

export function BanNotice({ ban, compact }: { ban: Ban; compact?: boolean }) {
  const t = useT()
  const zh = lang() === 'zh'
  const [appealing, setAppealing] = useState(false)
  const [appeals, setAppeals] = useState<Appeal[]>([])
  const [n, setN] = useState(0)

  useEffect(() => {
    let alive = true
    void fetchMyAppeals().then((a) => {
      if (alive) setAppeals(a)
    })
    return () => {
      alive = false
    }
  }, [n])

  const mine = appeals.filter((a) => a.ban_id === ban.id)
  const open = mine.find((a) => a.status === 'open')
  const rejected = mine.find((a) => a.status === 'rejected')

  return (
    <>
      <Card className="border-danger-600/40 bg-danger-50">
        <p className="text-danger-600 text-label font-semibold">
          {banLine(ban, zh)}
        </p>
        <p className="text-ink-700 mt-1.5 text-caption">
          {t('理由：', 'Reason: ')}
          {reasonLabel(ban.reason)}
        </p>
        {/* 管理员写的那句话原样给他看 —— 这是他唯一知道发生了什么的渠道 */}
        {ban.note && <p className="text-ink-700 mt-1 text-caption">「{ban.note}」</p>}

        {!compact && (
          <>
            <p className="text-ink-500 mt-2.5 text-caption">
              {t('这段时间做不了：', 'While this lasts you cannot: ')}
              {blockedThings(ban.kind, zh).join(zh ? '、' : ', ')}
            </p>
            {/*
              这一句是这张卡上最该说的：被封不等于不能打球。
              不说的话，一个被禁言的人会以为整个 App 都废了。
            */}
            <p className="text-ink-500 mt-2 text-caption">
              {t(
                '记分、开球局、看排行榜都不受影响 —— 球照打。',
                'Scoring, running sessions and leaderboards are untouched — you can still play.',
              )}
            </p>
          </>
        )}

        {open ? (
          <p className="text-ink-500 mt-3 text-caption">
            {t('申诉已经交上去了，等管理员看。', 'Your appeal is in — waiting on an admin.')}
          </p>
        ) : (
          <>
            {rejected && (
              <p className="text-ink-500 mt-3 text-caption">
                {t('上一次申诉没通过。', 'Your last appeal was turned down.')}
              </p>
            )}
            <Button className="mt-3" block onClick={() => setAppealing(true)}>
              {t('我要申诉', 'Appeal this')}
            </Button>
          </>
        )}
      </Card>

      <AppealSheet
        open={appealing}
        banId={ban.id}
        onClose={() => setAppealing(false)}
        onDone={() => setN((x) => x + 1)}
      />
    </>
  )
}

function AppealSheet({
  open,
  banId,
  onClose,
  onDone,
}: {
  open: boolean
  banId: string
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setBody('')
      setError(null)
    }
  }, [open])

  const send = async () => {
    setBusy(true)
    setError(null)
    const r = await sendAppeal(banId, body)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onDone()
    onClose()
  }

  const left = APPEAL_MAX - body.trim().length

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={t('申诉', 'Appeal')}>
      <div className="space-y-4">
        <p className="text-ink-500 text-caption">
          {t(
            '写清楚当时发生了什么。管理员会看到你这段话和当初那条举报，然后决定解不解。',
            'Say what actually happened. An admin reads this next to the original report and decides.',
          )}
        </p>
        <textarea
          className={cx(inputClass, 'min-h-32 resize-none')}
          value={body}
          disabled={busy}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('比如：那天是他先……', 'For example: what actually happened was…')}
          aria-label={t('申诉内容', 'Your appeal')}
        />
        {left < 200 && (
          <p className={cx('text-right text-caption', left < 0 ? 'text-danger-600' : 'text-ink-500')}>
            {left}
          </p>
        )}
        {error && (
          <div className="border-danger-600/30 bg-danger-50 rounded-card border p-3.5">
            <p className="text-ink-700 text-caption">{error}</p>
          </div>
        )}
        <Button block variant="primary" disabled={busy || !body.trim()} onClick={() => void send()}>
          {busy ? t('正在发…', 'Sending…') : t('交上去', 'Send')}
        </Button>
        <p className="text-ink-500 text-caption">
          {t(
            '一条封号只能交一次，等有结果之后才能再交 —— 所以一次说完。',
            'One appeal per suspension until it is answered — so say everything now.',
          )}
        </p>
      </div>
    </Sheet>
  )
}
