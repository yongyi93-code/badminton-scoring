import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, Sheet, Toggle, cx, inputClass } from '@/components/ui'
import { REPORT_REASONS, sendReport, withdrawReport, type ReportReason } from '@/lib/report'
import { blockUser } from '@/lib/social'
import { openReportAgainst } from '@/lib/report'
import { refreshSocial, standingWith, useSocial } from '@/store/useSocial'

/* ------------------------------------------------------------------ *
 * 举报一个人
 *
 * 私聊那一屏和战绩页都用这一个 —— 被骚扰的人不该还要先想清楚
 * 「这事该从哪儿点」。
 *
 * -------------------------------------------------------------------
 * 三件事写在界面上，不藏着
 *
 *   1. 最近的对话会一起交上去
 *      不说的话，这就成了背着人把他的私聊交出去。而且不说也没好处：
 *      一个正在被骂的人本来就巴不得有人看见那几句。
 *
 *   2. 他不会知道是谁举报的
 *      这是很多人不敢点那一下的唯一原因 —— 一个球群十几个人，
 *      下周三还要见面。
 *
 *   3. 顺手拉黑，默认开着
 *      举报是「有人会看」，拉黑是「现在就别烦我」。一个正在被骚扰
 *      的人两件事都要，而等人处理的那几天他还得继续收消息。
 *      默认开、可以关 —— 有人只是想反映一下，并不想断了联系。
 * ------------------------------------------------------------------ */

export function ReportSheet({
  open,
  onClose,
  uid,
  name,
  onDone,
  onError,
}: {
  open: boolean
  onClose: () => void
  uid: string
  /** 显示用的名字。查不到人时给一句实话，别显示一串 uuid */
  name: string
  /** 成功之后说一句。Toast 归调用的那一屏管 */
  onDone: (message: string) => void
  onError: (message: string) => void
}) {
  const t = useT()
  const social = useSocial()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)
  const [busy, setBusy] = useState(false)

  const already = openReportAgainst(social.myReports, uid)
  const blocked = standingWith(social, uid).kind === 'blocked'

  const close = () => {
    /* 关掉就清干净。下次点开是一张白纸，不是上次选到一半的样子 */
    setReason(null)
    setNote('')
    setAlsoBlock(true)
    onClose()
  }

  const submit = async () => {
    if (!reason || busy) return
    setBusy(true)
    const r = await sendReport(uid, reason, note)
    if (!r.ok) {
      setBusy(false)
      onError(r.error)
      return
    }
    /*
     * 举报成功了才拉黑，而且拉黑失败不回滚举报 ——
     * 两件事各自成立（见 lib/report.ts 开头）。拉黑没成的话
     * 他还能在好友页自己拉，而举报已经送出去了，那才是重的那件。
     */
    if (alsoBlock && !blocked) {
      const b = await blockUser(uid)
      if (!b.ok) console.warn('举报成功，但拉黑没成:', b.error)
    }
    await refreshSocial()
    setBusy(false)
    close()
    onDone(
      t(
        '举报已经送出去了。他不会知道是谁举报的。',
        'Report sent. They are not told who reported them.',
      ),
    )
  }

  const withdraw = async () => {
    if (!already || busy) return
    setBusy(true)
    const r = await withdrawReport(already.id)
    setBusy(false)
    if (!r.ok) {
      onError(r.error)
      return
    }
    await refreshSocial()
    close()
    onDone(t('举报撤回了。', 'Report withdrawn.'))
  }

  return (
    <Sheet open={open} onClose={close} title={t(`举报 ${name}`, `Report ${name}`)}>
      {already ? (
        /*
         * 已经举报过了。这里不给他再举报一次的入口 —— 数据库那边
         * 本来就只让一对人有一条没处理完的，与其点下去撞一句
         * 「你已经举报过了」，不如一开始就说清楚现在到哪一步了。
         */
        <div className="space-y-3">
          <p className="text-ink-700 text-body">
            {t(
              '你已经举报过他了，现在还在等处理。同一个人不用重复举报 —— 多点几次不会让它排得更前面。',
              'You already reported them and it is still being reviewed. Reporting again does not move it up the queue.',
            )}
          </p>
          <p className="text-ink-500 text-caption">
            {t(
              '如果是误会、或者已经讲开了，可以撤回。处理过之后就撤不掉了。',
              'If it was a misunderstanding or you have sorted it out, you can withdraw it — until someone has acted on it.',
            )}
          </p>
          <Button block variant="ghost" disabled={busy} onClick={() => void withdraw()}>
            {t('撤回这条举报', 'Withdraw this report')}
          </Button>
        </div>
      ) : (
        /*
          间距收得比别处紧一点点：这张表本来只比一屏高 37px，
          收一收就整个放得下。少一次「还要往下翻才找得到按钮」——
          点开这张表的人正在气头上，不该还要找。
        */
        <div className="space-y-3">
          <div className="space-y-1.5">
            {REPORT_REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setReason(r.value)}
                className={cx(
                  'flex w-full items-start gap-3 rounded-btn border px-3 py-2.5 text-left transition-colors',
                  reason === r.value
                    ? 'border-brand-600 bg-brand-100/40'
                    : 'border-line active:bg-fill',
                )}
              >
                <span
                  className={cx(
                    'mt-0.5 size-5 shrink-0 rounded-full border-2',
                    reason === r.value ? 'border-brand-600 bg-brand-600' : 'border-ink-300',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-ink-900 block text-label font-medium">
                    {t(r.zh, r.en)}
                  </span>
                  <span className="text-ink-500 block text-caption">{t(r.hintZh, r.hintEn)}</span>
                </span>
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-ink-700 mb-1.5 block text-sm">
              {t('还想说什么（可以不填）', 'Anything else (optional)')}
            </span>
            <textarea
              className={cx(inputClass, 'h-auto min-h-20 resize-none py-3')}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 1000))}
              placeholder={t('什么时候、发生了什么', 'When it happened, and what happened')}
            />
          </label>

          {!blocked && (
            <Toggle
              checked={alsoBlock}
              onChange={setAlsoBlock}
              label={t('同时把他拉黑', 'Also block them')}
            />
          )}

          <p className="text-ink-500 text-caption">
            {t(
              '举报会把你们最近的对话一起交上去，由管理员看。他不会知道是谁举报的，也收不到任何提醒。乱举报的话，被举报的是你。',
              'Your recent conversation is submitted with the report for an admin to read. They are not told who reported them, and get no notification. Abusing this will count against you.',
            )}
          </p>

          <Button
            block
            variant="dangerSoft"
            disabled={!reason || busy}
            onClick={() => void submit()}
          >
            {busy ? t('送出去…', 'Sending…') : t('确定举报', 'Submit report')}
          </Button>
        </div>
      )}
    </Sheet>
  )
}
