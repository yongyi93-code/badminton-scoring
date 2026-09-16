import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { deleteMyAccount } from '@/lib/account'
import { Button, Segmented, Sheet, inputClass } from '@/components/ui'

/* ------------------------------------------------------------------ *
 * 注销账号
 *
 * 这一屏唯一的工作是**把后果说清楚**，然后挡住手滑。
 *
 * 不可逆的操作里，最糟的设计是「你确定吗？」—— 它什么都没说，
 * 而按下去的人其实并不知道自己会失去什么。所以这里不问「确定吗」，
 * 直接摊开两张单子：什么会没、什么会留。
 *
 * -------------------------------------------------------------------
 * 为什么比分会留下来
 *
 * 一个人打过的四十场比赛，是另外三个人战绩的一部分。整条删掉的话，
 * 别人的 MMR、胜负、历史全乱 —— 而那是**别人的**数据。
 *
 * 所以球员行和比赛留着，只把「这个球员属于哪个账号」那根线剪断。
 * 剪断之后那一行就是个没有主人的名字，和一个代建的球友没有区别。
 *
 * 这件事必须在按之前说，不能事后解释：一个以为「删号 = 什么都没了」
 * 的人，事后发现名字还在别人的历史里，会觉得被骗了。
 * ------------------------------------------------------------------ */

/** 要打对才让按。两种语言各认一个词 */
const CONFIRM_WORDS = ['注销', 'delete']

export const confirmed = (typed: string) =>
  CONFIRM_WORDS.includes(typed.trim().toLowerCase())

export function DeleteAccountSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const clubs = useApp((s) => s.clubs)
  const [scrubName, setScrubName] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (busy) return
    setTyped('')
    setError(null)
    onClose()
  }

  const go = async () => {
    setBusy(true)
    setError(null)
    const r = await deleteMyAccount({ scrubName })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    /*
     * 成功之后不弹「注销成功了」——账号已经没了，本机也擦了，
     * 界面会自己回到没登录的样子。再弹一句提示只是拖着他多看一眼
     * 一个已经不属于他的屏幕。
     */
    onClose()
  }

  return (
    <Sheet open={open} onClose={close} title={t('注销账号', 'Delete account')}>
      <div className="space-y-5">
        <div className="border-danger-600/30 bg-danger-50 rounded-card border p-4">
          <p className="text-label font-semibold">
            {t('这一步没法撤销。', 'This cannot be undone.')}
          </p>
          <p className="text-ink-700 mt-1 text-caption">
            {t(
              '没有「反悔」按钮，也没有回收站。想回来的话只能重新注册一个新账号，而它和现在这个没有任何关系。',
              'There is no undo and no trash can. You can register again, but it will be a new account with no connection to this one.',
            )}
          </p>
        </div>

        <div>
          <p className="text-ink-900 text-label font-medium">
            {t('会没掉的', 'What goes')}
          </p>
          <ul className="text-ink-700 mt-1.5 space-y-1 text-caption">
            <li>· {t('你的登录账号，和它绑的邮箱', 'Your account and its email')}</li>
            <li>
              ·{' '}
              {t(
                `你在 ${clubs.length} 个球群里的成员资格`,
                `Your membership in ${clubs.length} club(s)`,
              )}
            </li>
            <li>· {t('全部私聊和语音消息（双方都看不到了）', 'All private chats and voice messages — for both sides')}</li>
            <li>· {t('好友关系、拉黑名单', 'Friends and blocks')}</li>
            <li>· {t('你发过的举报和反馈，以及别人对你的举报', 'Reports and feedback you sent, and reports about you')}</li>
            <li>· {t('全国榜上你那一行、这台手机的推送订阅', 'Your row on the national board, and push on this phone')}</li>
          </ul>
        </div>

        <div>
          <p className="text-ink-900 text-label font-medium">
            {t('会留下的', 'What stays')}
          </p>
          <p className="text-ink-700 mt-1.5 text-caption">
            {t(
              '你打过的比赛留在球群里，球员那一行也留着 —— 但它不再属于任何账号。',
              'The matches you played stay in the club, and so does your player row — but it no longer belongs to any account.',
            )}
          </p>
          {/*
            这一句是整屏最要紧的。不说的话，事后发现自己的名字还在
            别人的历史里，人会觉得被骗了 —— 哪怕理由是成立的。
          */}
          <p className="text-ink-500 mt-1.5 text-caption">
            {t(
              '为什么不一起删：那几场比赛同时是另外三个人的战绩。整条删掉的话，别人的排名和历史会跟着乱，而那是别人的数据。',
              'Why they stay: each match is also part of three other people’s records. Deleting them would scramble other people’s rankings — and that is their data, not yours.',
            )}
          </p>
        </div>

        <div>
          <p className="text-ink-900 text-label font-medium">
            {t('留下来的那个名字呢？', 'What about the name?')}
          </p>
          <div className="mt-2">
            <Segmented
              value={scrubName ? 'scrub' : 'keep'}
              onChange={(v) => setScrubName(v === 'scrub')}
              options={[
                { value: 'keep', label: t('保留名字', 'Keep it') },
                { value: 'scrub', label: t('抹成「已注销」', 'Replace it') },
              ]}
            />
          </div>
          <p className="text-ink-500 mt-2 text-caption">
            {scrubName
              ? t(
                  '别人的历史里你会显示成「已注销」。战绩一场不少，但看的人认不出那是你 —— 如果群里还有别人也注销了，两个人会分不清。',
                  'You will show up as “Deleted” in everyone’s history. The matches are all still there, but nobody can tell which ones were yours — and if someone else also deletes their account, the two of you become indistinguishable.',
                )
              : t(
                  '别人的历史里还是你现在这个名字。他们看得出那几场是跟你打的 —— 只是那个名字不再连着任何账号。',
                  'Your current name stays in everyone’s history, so they can still tell those matches were against you — the name just is not attached to an account any more.',
                )}
          </p>
        </div>

        <div>
          <p className="text-ink-900 text-label font-medium">
            {t('打「注销」两个字确认', 'Type “delete” to confirm')}
          </p>
          <input
            className={`${inputClass} mt-2`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('注销', 'delete')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
          />
          <p className="text-ink-500 mt-1.5 text-caption">
            {t(
              '要打字，是因为这一步没法撤销 —— 一个按钮太容易手滑了。',
              'Typing it is the point: this cannot be undone, and a single button is too easy to hit by accident.',
            )}
          </p>
        </div>

        {error && (
          <div className="border-danger-600/30 bg-danger-50 rounded-card border p-3.5">
            <p className="text-danger-600 text-label font-medium">
              {t('没注销成', 'Not deleted')}
            </p>
            <p className="text-ink-700 mt-1 text-caption">{error}</p>
            <p className="text-ink-700 mt-1 text-caption">
              {t(
                '你的账号还在，什么都没变。',
                'Your account is untouched — nothing has changed.',
              )}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Button
            block
            variant="danger"
            disabled={busy || !confirmed(typed)}
            onClick={() => void go()}
          >
            {busy
              ? t('正在注销…', 'Deleting…')
              : t('永久注销这个账号', 'Delete my account permanently')}
          </Button>
          <button
            disabled={busy}
            onClick={close}
            className="text-ink-500 active:text-ink-900 w-full py-2 text-center text-caption"
          >
            {t('算了，不注销', 'Never mind')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
