import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, cx, inputClass } from '@/components/ui'
import { relativeTime } from '@/lib/format'
import {
  COMMENT_MAX,
  type Comment,
  addComment,
  deleteComment,
  setCommentHidden,
} from '@/lib/comments'

/* ------------------------------------------------------------------ *
 * 一条动态下面那几句
 *
 * 全部摊开，不折叠成「查看 3 条评论」——一条动态下面通常两三句，
 * 而折叠起来的那一下点击，正好卡在「有人回我了」和「他说了什么」中间。
 *
 * 输入框默认收着：一屏五条动态就是五个输入框，那一屏会变成一张表格。
 * 点「评论」才展开，展开之后自动聚焦。
 * ------------------------------------------------------------------ */

export function Comments({
  postId,
  rows,
  meUid,
  postAuthor,
  isAdmin,
  silenced,
  nameOf,
  onChanged,
  onError,
}: {
  postId: string
  rows: Comment[]
  meUid: string | null
  /** 这条动态是谁发的 —— 他删得掉自己动态下面的任何一句 */
  postAuthor: string
  isAdmin: boolean
  /** 被禁言了就别给输入框：写完一段再被拒，比一开始就说清楚糟 */
  silenced: boolean
  nameOf: (uid: string) => string
  onChanged: () => void
  onError: (msg: string) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setBusy(true)
    const r = await addComment(postId, body)
    setBusy(false)
    if (!r.ok) {
      onError(r.error)
      return
    }
    setBody('')
    setOpen(false)
    onChanged()
  }

  const remove = async (id: string) => {
    setBusy(true)
    const r = await deleteComment(id)
    setBusy(false)
    if (!r.ok) {
      onError(r.error)
      return
    }
    onChanged()
  }

  const hide = async (c: Comment) => {
    setBusy(true)
    const r = await setCommentHidden(c.id, !c.hidden_at)
    setBusy(false)
    if (!r.ok) {
      onError(r.error)
      return
    }
    onChanged()
  }

  const left = COMMENT_MAX - body.trim().length

  return (
    <div>
      {rows.length > 0 && (
        <div className="bg-fill mt-2.5 space-y-1.5 rounded-lg px-3 py-2">
          {rows.map((c) => (
            <div key={c.id}>
              <p className="text-body">
                {/*
                  名字和话连在一行，像微信 —— 分两行的话，两三句评论
                  就占掉半屏，而每一句其实只有几个字。
                */}
                <span className="text-brand-600 font-medium">{nameOf(c.author)}</span>
                <span className="text-ink-500">：</span>
                <span className="text-ink-900 whitespace-pre-wrap break-words">{c.body}</span>
              </p>
              <p className="text-ink-500 flex items-center gap-3 text-caption">
                <span>{relativeTime(Date.parse(c.created_at))}</span>
                {/*
                  被下架了。这一条只有写它的人和管理员看得到（策略挡着），
                  所以这行字只会出现在他们眼前 —— 而写它的人**必须**看到：
                  一条悄悄消失的评论，他只会以为没发出去，然后再发一遍。
                */}
                {c.hidden_at && (
                  <span className="text-danger-600">
                    {c.author === meUid
                      ? t('已被下架，别人看不到', 'Taken down — nobody else sees it')
                      : t('已下架', 'Taken down')}
                  </span>
                )}
                {/*
                  删得掉的有两种人：说这句话的，和这条动态的作者。
                  后者是「你的地盘」—— 别人在你的动态下面留一句难听的，
                  你不该只能等管理员。
                */}
                {(c.author === meUid || postAuthor === meUid) && (
                  <button
                    disabled={busy}
                    onClick={() => void remove(c.id)}
                    className="active:text-danger-600"
                  >
                    {t('删掉', 'Delete')}
                  </button>
                )}
                {isAdmin && (
                  <button
                    disabled={busy}
                    onClick={() => void hide(c)}
                    className="active:text-danger-600"
                  >
                    {c.hidden_at ? t('恢复', 'Restore') : t('下架', 'Take down')}
                  </button>
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {!silenced &&
        (open ? (
          <div className="mt-2 space-y-2">
            <textarea
              autoFocus
              className={cx(inputClass, 'min-h-16 resize-none')}
              value={body}
              disabled={busy}
              maxLength={COMMENT_MAX}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('说一句…', 'Say something…')}
              aria-label={t('写评论', 'Write a comment')}
            />
            {left < 100 && (
              <p className="text-ink-500 text-right text-caption">{left}</p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  setBody('')
                }}
              >
                {t('算了', 'Cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                disabled={busy || !body.trim()}
                onClick={() => void send()}
              >
                {busy ? t('正在发…', 'Sending…') : t('发出去', 'Send')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="text-ink-500 active:text-brand-600 mt-2 text-caption"
          >
            {rows.length > 0 ? t('也说一句', 'Add a comment') : t('评论', 'Comment')}
          </button>
        ))}
    </div>
  )
}
