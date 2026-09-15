import { useT } from '@/lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  BottomBar,
  EmptyState,
  Screen,
  Sheet,
  Toast,
  TopBar,
  cx,
  inputClass,
} from '@/components/ui'
import {
  refreshSocial,
  standingWith,
  threadWith,
  useSocial,
} from '@/store/useSocial'
import { blockUser, isVoice, markRead, removeFriendship, sendMessage, sendVoice } from '@/lib/social'
import { openReportAgainst } from '@/lib/report'
import { ReportSheet } from '@/components/ReportSheet'
import { VoiceBubble, VoiceRecorder } from '@/components/VoiceBits'
import type { Recording } from '@/lib/voice'
import { relativeTime } from '@/lib/format'

/* ------------------------------------------------------------------ *
 * 一段私聊
 *
 * 只在好友之间开得了 —— 这条规矩不在这一屏里，在数据库的策略里
 * （见 009 里 messages 的插入策略）。这里做的只是提前说清楚，
 * 免得人打完一段字才被拒。
 * ------------------------------------------------------------------ */

export function Chat({ uid }: { uid: string }) {
  const t = useT()
  const social = useSocial()
  const players = useApp((s) => s.players)
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)

  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [menu, setMenu] = useState(false)
  const [reporting, setReporting] = useState(false)
  /** 举报成功那句话是好消息，用 info 色；出错那条才是红的 */
  const [done, setDone] = useState<string | null>(null)
  /** 正在录音 —— 那会儿输入框和发送键要让位 */
  const [recording, setRecording] = useState(false)

  const other = useMemo(() => players.find((p) => p.ownerId === uid), [players, uid])
  const standing = useMemo(() => standingWith(social, uid), [social, uid])
  const thread = useMemo(() => threadWith(social, uid), [social, uid])
  const reported = Boolean(openReportAgainst(social.myReports, uid))

  const bottom = useRef<HTMLDivElement>(null)

  /*
   * 进来就把他发的都标成已读，之后每来一条新的再标一次。
   *
   * 依赖里放的是「最后一条的 id」，不是整个 thread：thread 每次
   * useMemo 都是新数组，放它进依赖等于每渲染一次就发一个请求。
   */
  const lastId = thread.length ? thread[thread.length - 1].id : null
  useEffect(() => {
    if (!social.meUid) return
    const unread = thread.some((m) => m.recipient === social.meUid && m.read_at === null)
    if (unread) void markRead(uid, social.meUid).then(() => refreshSocial())
  }, [lastId, uid, social.meUid, thread])

  /* 新消息进来滚到底。聊天不滚到底就等于没收到 */
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lastId])

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const r = await sendMessage(uid, text)
    setSending(false)
    if (r.ok) {
      setDraft('')
      await refreshSocial()
    } else {
      /*
       * 发失败了，输入框里的字一个都不能丢 —— 重打一遍是这类
       * 失败里最气人的那部分，而失败本身多半只是网络抖了一下。
       */
      setNote(r.error)
    }
  }

  const sendRecording = async (rec: Recording) => {
    if (!social.meUid || sending) return
    setSending(true)
    const r = await sendVoice(social.meUid, uid, rec)
    setSending(false)
    if (r.ok) await refreshSocial()
    else setNote(r.error)
  }

  const title = other?.name ?? t('私聊', 'Chat')

  if (!social.meUid) {
    return (
      <Screen>
        <TopBar title={title} onBack={back} />
        <Body>
          <EmptyState
            icon="👋"
            title={t('先登录', 'Sign in first')}
            hint={t('私聊存在云端，得先知道你是谁。', 'Chats live in the cloud — sign in first.')}
          />
        </Body>
      </Screen>
    )
  }

  /* 不是好友就没有输入框。数据库那边也会拒，这里只是提前说 */
  const canWrite = standing.kind === 'friends'

  return (
    <Screen>
      <TopBar
        title={title}
        subtitle={
          canWrite
            ? undefined
            : standing.kind === 'blocked'
              ? t('你拉黑了他', 'You blocked them')
              : t('不是好友', 'Not friends')
        }
        onBack={back}
        right={
          <button
            onClick={() => setMenu(true)}
            aria-label={t('更多', 'More')}
            className="text-ink-500 active:bg-fill -mr-1 flex size-9 items-center justify-center rounded-lg"
          >
            ⋯
          </button>
        }
      />

      <Body className="pb-2">
        {thread.length === 0 ? (
          <EmptyState
            icon="💬"
            title={canWrite ? t('还没说过话', 'Nothing here yet') : t('聊不了', 'Chat is closed')}
            hint={
              canWrite
                ? t('说第一句吧。', 'Say something.')
                : standing.kind === 'blocked'
                  ? t('你把他拉黑了，解除之后才能聊。', 'You blocked them — unblock to chat again.')
                  : t(
                      '私聊只在好友之间。先加好友，他同意了才聊得了。',
                      'Chat is friends-only. Add them, and once they accept you can talk.',
                    )
            }
          />
        ) : (
          <div className="space-y-2">
            {thread.map((m, i) => {
              const mine = m.sender === social.meUid
              const prev = thread[i - 1]
              /*
               * 时间戳不是每条都写。连着发的几条挤在一起时，
               * 每条底下一行「3 分钟前」比消息本身还长。
               * 隔了五分钟以上才写一次。
               */
              const showTime =
                !prev || Date.parse(m.created_at) - Date.parse(prev.created_at) > 5 * 60_000
              return (
                <div key={m.id}>
                  {showTime && (
                    <p className="text-ink-500 py-1 text-center text-caption">
                      {relativeTime(Date.parse(m.created_at))}
                    </p>
                  )}
                  <div className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                    {isVoice(m) ? (
                      <VoiceBubble
                        path={m.audio_path!}
                        durationMs={m.duration_ms ?? 0}
                        mine={mine}
                      />
                    ) : (
                      <p
                        className={cx(
                          'max-w-[80%] rounded-2xl px-3.5 py-2 text-body whitespace-pre-wrap',
                          mine
                            ? 'bg-brand-solid text-on-brand rounded-br-md'
                            : 'bg-surface border-line text-ink-900 rounded-bl-md border',
                        )}
                      >
                        {m.body}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottom} />
          </div>
        )}
      </Body>

      {canWrite && (
        <BottomBar>
          {/*
            正在录的时候，那一条占满整行 —— 录音是个有始有终的动作，
            旁边还摆着一个输入框只会让人以为可以边录边打字。
          */}
          <div className="flex items-end gap-2">
            <VoiceRecorder
              busy={sending}
              onError={setNote}
              onRecordingChange={setRecording}
              onSend={(rec) => void sendRecording(rec)}
            />
            {/*
              录的时候输入框和发送键收起来。留着的话那一条被挤成
              一小截，「录音中」压成一个「录」字 —— 而且旁边还摆着
              一个输入框，看起来像可以边录边打字。
            */}
            {!recording && (
              <>
            <textarea
              className={cx(inputClass, 'h-auto max-h-32 min-h-12 resize-none py-3')}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                /* 手机上回车就是换行，所以只有按住 Ctrl/⌘ 才算发送 */
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={t('说点什么', 'Say something')}
              aria-label={t('输入消息', 'Message')}
            />
            <Button
              variant="primary"
              className="shrink-0"
              disabled={sending || !draft.trim()}
              onClick={() => void send()}
            >
              {t('发送', 'Send')}
            </Button>
              </>
            )}
          </div>
        </BottomBar>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={title}>
        <div className="space-y-2">
          {other && (
            <Button
              block
              variant="ghost"
              onClick={() => {
                setMenu(false)
                push({ name: 'profile', playerId: other.id })
              }}
            >
              {t('看他的战绩', 'See their record')}
            </Button>
          )}
          {standing.kind === 'friends' && (
            <Button
              block
              variant="ghost"
              onClick={async () => {
                setMenu(false)
                const r = await removeFriendship(standing.id)
                if (!r.ok) setNote(r.error)
                else await refreshSocial()
              }}
            >
              {t('删掉这个好友', 'Remove friend')}
            </Button>
          )}
          {standing.kind !== 'blocked' && (
            <>
              <Button
                block
                variant="dangerSoft"
                onClick={async () => {
                  setMenu(false)
                  const r = await blockUser(uid)
                  if (!r.ok) setNote(r.error)
                  else await refreshSocial()
                }}
              >
                {t('拉黑', 'Block')}
              </Button>
              <p className="text-ink-500 px-1 text-caption">
                {t(
                  '拉黑之后他发不了消息给你，也发不了好友申请。他那边只看到「发不出去」，不会知道被拉黑了。你在好友页可以随时解除。',
                  'Once blocked they cannot message you or send a friend request. On their side it just fails — they are not told. You can undo it on the Friends screen.',
                )}
              </p>
            </>
          )}
          {/*
            举报摆在最后，而且拉黑了也还在 —— 先拉黑再举报是很常见的
            顺序（先让他别烦我，再让人来管），挡住的话等于逼人二选一。
          */}
          <Button
            block
            variant="dangerSoft"
            onClick={() => {
              setMenu(false)
              setReporting(true)
            }}
          >
            {reported
              ? t('已举报 · 等处理', 'Reported — under review')
              : t('举报他', 'Report them')}
          </Button>
        </div>
      </Sheet>

      <ReportSheet
        open={reporting}
        onClose={() => setReporting(false)}
        uid={uid}
        name={other?.name ?? t('这个人', 'this person')}
        /* 成功了就把上一条错误收掉 —— 两个 Toast 位置一样，会叠在一起 */
        onDone={(m) => {
          setNote(null)
          setDone(m)
        }}
        onError={setNote}
      />

      <Toast message={note} tone="error" onClose={() => setNote(null)} />
      <Toast message={done} onClose={() => setDone(null)} />
    </Screen>
  )
}
