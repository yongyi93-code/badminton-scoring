import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, Sheet, cx, inputClass } from '@/components/ui'
import { FEEDBACK_KINDS, sendFeedback, type FeedbackKind } from '@/lib/feedback'

/* ------------------------------------------------------------------ *
 * 提一条反馈
 *
 * 这一屏的全部目的，是让一个撞上问题的人有地方说。
 * 在它之前，他手上一条出路都没有：App 里没有入口，仓库地址他也不
 * 知道 —— 他只会默默卸载，而球主永远不知道发生过这件事。
 *
 * 所以这里刻意做得很短：选一类、写一句、发。不问邮箱（他已经登录了）、
 * 不问机型（App 自己填）、不要求写复现步骤 —— 每多问一样，
 * 就少一部分人愿意说。
 * ------------------------------------------------------------------ */

export function FeedbackSheet({
  open,
  onClose,
  onDone,
  onError,
}: {
  open: boolean
  onClose: () => void
  onDone: (message: string) => void
  onError: (message: string) => void
}) {
  const t = useT()
  const [kind, setKind] = useState<FeedbackKind | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    setKind(null)
    setBody('')
    onClose()
  }

  const submit = async () => {
    if (!kind || busy) return
    setBusy(true)
    const r = await sendFeedback(kind, body)
    setBusy(false)
    if (!r.ok) {
      /* 写了一段话发失败，不能顺手清空 —— 重打一遍是最气人的那部分 */
      onError(r.error)
      return
    }
    close()
    onDone(t('收到了，谢谢。', 'Got it — thank you.'))
  }

  return (
    <Sheet open={open} onClose={close} title={t('说点什么', 'Tell us')}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k.value}
              onClick={() => setKind(k.value)}
              className={cx(
                'flex w-full items-start gap-3 rounded-btn border px-3 py-2.5 text-left transition-colors',
                kind === k.value ? 'border-brand-600 bg-brand-100/40' : 'border-line active:bg-fill',
              )}
            >
              <span
                className={cx(
                  'mt-0.5 size-5 shrink-0 rounded-full border-2',
                  kind === k.value ? 'border-brand-600 bg-brand-600' : 'border-ink-300',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="text-ink-900 block text-label font-medium">{t(k.zh, k.en)}</span>
                <span className="text-ink-500 block text-caption">{t(k.hintZh, k.hintEn)}</span>
              </span>
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-ink-700 mb-1.5 block text-sm">
            {t('发生了什么', 'What happened')}
          </span>
          <textarea
            className={cx(inputClass, 'h-auto min-h-24 resize-none py-3')}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            placeholder={t(
              '比如：点「结束球局」之后没反应，昨晚八点在 Sunway 打的那场',
              'e.g. Tapping “End session” did nothing, last night at Sunway',
            )}
          />
        </label>

        <p className="text-ink-500 text-caption">
          {t(
            '会一起带上你的 App 版本号和手机型号（不是位置、不是通讯录）—— 少了这两样，「打不开」这种问题查不了。',
            'Your app version and phone type are sent along (not your location or contacts) — without them, “it does not work” cannot be investigated.',
          )}
        </p>

        <Button block variant="primary" disabled={!kind || !body.trim() || busy} onClick={() => void submit()}>
          {busy ? t('送出去…', 'Sending…') : t('发出去', 'Send')}
        </Button>
      </div>
    </Sheet>
  )
}
