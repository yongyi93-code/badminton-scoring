import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { useAuth } from '@/store/useAuth'
import { cloudReady } from '@/lib/supabase'
import { clearInvite, pendingInvite, type Invite } from '@/lib/invite'
import { joinAndEnterClub, useSyncStatus } from '@/lib/sync'
import { Button, Sheet } from '@/components/ui'

/* ------------------------------------------------------------------ *
 * 有人点了球局链接进来
 *
 * 从「点了链接」到「站在那场球局里」，中间可能要拐三道弯：
 *
 *   1. 没登录  —— 先登录（而登录会跳走再跳回来，所以邀请要存着）
 *   2. 不在群里 —— 用链接里带的邀请码进群
 *   3. 数据还没拉下来 —— 球局这时候还不存在，急着跳过去是空的
 *
 * 每一道弯都得等，所以这里是个状态机而不是一段直着往下走的代码。
 * 每一步都告诉人现在在做什么 —— 点了链接之后干等着，人只会以为坏了。
 * ------------------------------------------------------------------ */

type Phase =
  | { kind: 'idle' }
  /** 等他登录 */
  | { kind: 'need-signin'; invite: Invite }
  /** 正在进群 */
  | { kind: 'joining'; invite: Invite }
  /** 进群失败，或者那场球局根本找不到 */
  | { kind: 'failed'; message: string }

export function InviteHandler() {
  const t = useT()
  const { session } = useAuth()
  const sync = useSyncStatus()
  const resetTo = useNav((s) => s.resetTo)
  const sessions = useApp((s) => s.sessions)
  const clubId = useApp((s) => s.clubId)
  const clubs = useApp((s) => s.clubs)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  useEffect(() => {
    const invite = pendingInvite()
    if (!invite) return

    // 没接云端就没有球群这回事，本机有那场球局就直接过去
    if (!cloudReady) {
      if (sessions.some((s) => s.id === invite.sessionId)) {
        clearInvite()
        resetTo({ name: 'board', sessionId: invite.sessionId })
      }
      return
    }

    if (session === undefined) return // 还在确认登录状态
    if (!session) {
      setPhase({ kind: 'need-signin', invite })
      return
    }

    /*
     * 球局已经在本机了 —— 说明群也对、数据也拉下来了，直接过去。
     * 这是最常见的一条路：群里的人点了链接。
     */
    if (sessions.some((s) => s.id === invite.sessionId)) {
      clearInvite()
      setPhase({ kind: 'idle' })
      resetTo({ name: 'board', sessionId: invite.sessionId })
      return
    }

    /*
     * 还没同步完就先等着。这一步很要紧：数据没拉下来的时候，
     * 「本机找不到这场球局」和「这场球局真的不存在」长得一模一样，
     * 急着下结论就会把一个正常的邀请判成失效。
     */
    if (sync.state === 'syncing' || sync.state === 'off') return

    // 已经在这个群里、也同步完了，却还是没有这场球局 —— 那是真没了
    const inThatClub = invite.clubCode
      ? clubs.some((c) => c.code.toUpperCase() === invite.clubCode)
      : true
    if (inThatClub && clubId) {
      clearInvite()
      setPhase({
        kind: 'failed',
        message: t(
          '这场球局找不到了 —— 可能已经结束或者被删掉了。',
          'That session is gone — it was probably ended or deleted.',
        ),
      })
      return
    }

    // 不在那个群里：拿链接带的邀请码进去
    if (!invite.clubCode) {
      clearInvite()
      setPhase({
        kind: 'failed',
        message: t(
          '这条链接没带球群邀请码，进不去。跟开局的人要一次邀请码。',
          'This link has no club code, so it cannot let you in. Ask whoever started the session for the invite code.',
        ),
      })
      return
    }

    if (phase.kind === 'joining') return // 已经在进了，别重复发请求
    setPhase({ kind: 'joining', invite })
    void joinAndEnterClub(invite.clubCode).then((res) => {
      if (res.ok) {
        // 进群会重新拉数据；拉完这个 effect 会再跑一次，那时候球局就在了
        setPhase({ kind: 'idle' })
      } else {
        clearInvite()
        setPhase({ kind: 'failed', message: res.error })
      }
    })
  }, [session, sync.state, sessions, clubId, clubs, resetTo, t, phase.kind])

  if (phase.kind === 'idle') return null

  return (
    <Sheet
      open
      onClose={() => {
        if (phase.kind !== 'joining') {
          clearInvite()
          setPhase({ kind: 'idle' })
        }
      }}
      title={t('有人约你打球', 'You were invited to play')}
    >
      {phase.kind === 'need-signin' && (
        <div className="space-y-3">
          <p className="text-label">
            {t(
              '先登录一下，登录完会直接带你进那场球局。',
              'Sign in first — you will be taken straight into the session.',
            )}
          </p>
          <p className="text-ink-500 text-caption">
            {t(
              '登录在「我的」那一页最底下。这条邀请给你留着，不用再点一次链接。',
              'Sign-in is at the bottom of the Me tab. This invite is saved — you do not need the link again.',
            )}
          </p>
          <Button
            block
            variant="primary"
            onClick={() => {
              setPhase({ kind: 'idle' })
              resetTo({ name: 'me' })
            }}
          >
            {t('去登录', 'Go to sign in')}
          </Button>
        </div>
      )}

      {phase.kind === 'joining' && (
        <p className="text-label">
          {t('正在把你加进这个球群…', 'Adding you to the club…')}
        </p>
      )}

      {phase.kind === 'failed' && (
        <div className="space-y-3">
          <p className="text-label">{phase.message}</p>
          <Button block variant="soft" onClick={() => setPhase({ kind: 'idle' })}>
            {t('知道了', 'OK')}
          </Button>
        </div>
      )}
    </Sheet>
  )
}
