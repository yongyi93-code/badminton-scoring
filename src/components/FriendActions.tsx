import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useNav } from '@/store/useNav'
import { Button, Toast } from '@/components/ui'
import { refreshSocial, standingWith, useSocial } from '@/store/useSocial'
import { acceptFriendRequest, removeFriendship, sendFriendRequest } from '@/lib/social'
import { openReportAgainst } from '@/lib/report'
import { ReportSheet } from '@/components/ReportSheet'

/* ------------------------------------------------------------------ *
 * 「加好友 / 私聊 / 举报」那一排
 *
 * 两屏共用：球群里的战绩页（PlayerProfile）和账号那一层的个人主页
 * （Person）。共用的理由不是省代码，是**两屏同时开着的时候不能打架**：
 * 在主页上加了好友，退回战绩页那一屏要立刻也变成「私聊」。
 * 两份实现迟早有一份忘了刷新。
 *
 * 四种状态各说各的，全靠 standingWith 那一个函数 —— 分散到各处去判
 * status 和方向，迟早有一处把「他等我」显示成「我等他」。
 *
 * 这个组件按 **uid**（账号）走，不按球员 id：好友本来就是跨球群的，
 * 而别的群那个人在我这台手机上根本没有球员记录。
 * ------------------------------------------------------------------ */

export function FriendActions({
  uid,
  name,
  className,
}: {
  uid?: string | null
  /** 举报那张卡上要显示的名字。调用的那一屏本来就知道他叫什么 */
  name: string
  className?: string
}) {
  const t = useT()
  const social = useSocial()
  const push = useNav((s) => s.push)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const standing = useMemo(() => standingWith(social, uid), [social, uid])
  const reported = Boolean(openReportAgainst(social.myReports, uid ?? ''))

  /*
   * 没有 uid 的人这一块整个不出现：那是别人代建的、没装 App 的球友，
   * 他没有账号，加了也没人收得到。
   *
   * 自己的那一页上也不出现 —— 没有「加自己为好友」这件事。
   */
  if (!uid || !social.meUid || uid === social.meUid) return null

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setNote(r.error ?? null)
    else await refreshSocial()
  }

  return (
    <div className={className}>
      {standing.kind === 'friends' ? (
        <Button block variant="primary" onClick={() => push({ name: 'chat', uid })}>
          {t('私聊', 'Message')}
        </Button>
      ) : standing.kind === 'received' ? (
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => void run(() => removeFriendship(standing.id))}
          >
            {t('不了', 'No')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={busy}
            onClick={() => void run(() => acceptFriendRequest(standing.id))}
          >
            {t('他加你了 · 同意', 'Accept request')}
          </Button>
        </div>
      ) : standing.kind === 'sent' ? (
        <Button block disabled={busy} onClick={() => void run(() => removeFriendship(standing.id))}>
          {t('等他同意 · 撤回', 'Waiting — cancel')}
        </Button>
      ) : standing.kind === 'blocked' ? (
        <p className="text-ink-500 text-caption">
          {t('你拉黑了他。去好友页可以解除。', 'You blocked them — undo it on the Friends screen.')}
        </p>
      ) : (
        <Button
          block
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => sendFriendRequest(uid))}
        >
          {t('加好友', 'Add friend')}
        </Button>
      )}

      {/*
        举报是一行小字，不是一个按钮 —— 它在这一屏上是最少用到的
        那件事，摆成按钮会天天挡在「加好友」旁边。但它必须在这儿：
        不是好友也举报得了（比分作假就不需要先加好友），
        而私聊那一屏进不去。
      */}
      <button
        className="text-ink-500 active:text-danger-600 mt-3 text-caption"
        onClick={() => setReporting(true)}
      >
        {reported ? t('已举报 · 等处理', 'Reported — under review') : t('举报这个人', 'Report this person')}
      </button>

      <ReportSheet
        open={reporting}
        onClose={() => setReporting(false)}
        uid={uid}
        name={name}
        onDone={(m) => {
          setNote(null)
          setDone(m)
        }}
        onError={setNote}
      />

      {note && <p className="text-danger-600 mt-2 text-caption">{note}</p>}
      <Toast message={done} onClose={() => setDone(null)} />
    </div>
  )
}
