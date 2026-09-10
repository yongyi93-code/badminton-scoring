import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { playerMap, useApp } from '@/store/useApp'
import { Button, Card, inputClass } from '@/components/ui'

/* ------------------------------------------------------------------ *
 * 局内消息
 *
 * 「六点半改去力天」「我迟到十分钟」「谁带球」这类事算不出来，只能有人说。
 * 以前这些话散在微信群里，会被别的话题顶走，来晚的人根本翻不到。
 *
 * 这一块原来摆在首页，发给整个球群。球群开放给所有人之后那就不成立了：
 * 「今晚改去力天」对不去的人是纯噪音，而首页是每个人打开 App 第一眼
 * 看到的地方。
 *
 * 所以消息现在跟着球局走 —— 在局内发，也只有这一局的人看得见。
 * 收信人是谁，从一开始就是确定的。
 * ------------------------------------------------------------------ */

/** 一次最多显示几条，多的收起来 */
const SHOWN = 3

/** 一条最多多长。写长文该去微信，这里是「一句话通知」 */
const MAX_LEN = 140

function timeAgo(ts: number, t: ReturnType<typeof useT>): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return t('刚刚', 'just now')
  if (mins < 60) return t(`${mins} 分钟前`, `${mins}m ago`)
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t(`${hours} 小时前`, `${hours}h ago`)
  const days = Math.floor(hours / 24)
  return t(`${days} 天前`, `${days}d ago`)
}

export function Announcements({ sessionId }: { sessionId: string }) {
  const t = useT()
  const { players, announcements, meId } = useApp()
  const postAnnouncement = useApp((s) => s.postAnnouncement)
  const deleteAnnouncement = useApp((s) => s.deleteAnnouncement)

  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const [showAll, setShowAll] = useState(false)

  const names = useMemo(() => playerMap(players), [players])

  /**
   * 这一场球局里的消息，新的在上面 —— 消息的价值随时间掉得很快。
   *
   * 没有 sessionId 的是老数据（那时候消息是发给整个球群的）。
   * 它们不属于任何一场球局，一律不显示：消息本来就是几天就过期的东西，
   * 为它们做迁移不值得，而把它们塞进随便哪一场球局只会让人莫名其妙。
   */
  const sorted = useMemo(
    () =>
      announcements
        .filter((a) => a.sessionId === sessionId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [announcements, sessionId],
  )
  const visible = showAll ? sorted : sorted.slice(0, SHOWN)

  const send = () => {
    if (!meId) return
    if (postAnnouncement(text, meId, sessionId)) {
      setText('')
      setWriting(false)
    }
  }

  /* 一条都没有、又还没建角色：整块不出现，别摆一个点了没反应的东西 */
  if (sorted.length === 0 && !meId) return null

  return (
    <div className="space-y-2">
      {visible.map((a) => {
        const author = names.get(a.authorId)
        return (
          <Card key={a.id} className="border-brand-500/25 bg-brand-50">
            <div className="flex items-start gap-2">
              <span className="shrink-0 text-title leading-none">📢</span>
              <div className="min-w-0 flex-1">
                <p className="text-label break-words whitespace-pre-wrap">{a.text}</p>
                <p className="text-ink-500 mt-1 text-caption">
                  {author?.name ?? t('已退出的球友', 'A former member')} · {timeAgo(a.createdAt, t)}
                </p>
              </div>
              {/* 只有发的人自己能撤 —— 别人的话不该被随手删掉 */}
              {meId === a.authorId && (
                <button
                  className="text-ink-500 shrink-0 text-caption"
                  onClick={() => deleteAnnouncement(a.id)}
                >
                  {t('撤回', 'Remove')}
                </button>
              )}
            </div>
          </Card>
        )
      })}

      {sorted.length > SHOWN && (
        <button
          className="text-brand-600 block w-full text-center text-caption"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? t('收起', 'Collapse')
            : t(`还有 ${sorted.length - SHOWN} 条`, `${sorted.length - SHOWN} more`)}
        </button>
      )}

      {meId &&
        (writing ? (
          <Card>
            <textarea
              className={inputClass}
              rows={3}
              autoFocus
              maxLength={MAX_LEN}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t(
                '例如：我迟到十分钟，先开打不用等我',
                'e.g. Running ten minutes late — start without me',
              )}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button variant="primary" size="sm" disabled={!text.trim()} onClick={send}>
                {t('发出去', 'Post')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setWriting(false)
                  setText('')
                }}
              >
                {t('算了', 'Cancel')}
              </Button>
              <span className="text-ink-500 ml-auto text-caption">
                {text.length}/{MAX_LEN}
              </span>
            </div>
          </Card>
        ) : (
          <button
            className="text-brand-600 block w-full text-center text-caption"
            onClick={() => setWriting(true)}
          >
            {t('+ 发一条消息给这一局的人', '+ Post a message to this session')}
          </button>
        ))}
    </div>
  )
}
