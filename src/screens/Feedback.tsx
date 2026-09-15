import { useEffect, useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { refreshSocial, useSocial } from '@/store/useSocial'
import {
  Body,
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  Toast,
  TopBar,
} from '@/components/ui'
import {
  fetchFeedback,
  kindLabel,
  markFeedbackDone,
  openFeedbackCount,
  type Feedback as Row,
} from '@/lib/feedback'
import { relativeTime } from '@/lib/format'

/* ------------------------------------------------------------------ *
 * 收到的反馈（只有管理员进得来）
 *
 * 比举报那一屏简单得多，因为反馈没有第三方：这里没有证据快照、
 * 没有「结案之后关掉某扇门」、也没有两种结论 —— 看过了就是看过了。
 *
 * 版本号和机型显示在每一条上。它们是这一屏真正的价值：
 * 「点不动」这三个字本身查不了任何东西，
 * 「iOS 17 · Safari · 主屏幕 · d386f88」才查得了。
 * ------------------------------------------------------------------ */

export function Feedback() {
  const t = useT()
  const back = useNav((s) => s.back)
  const social = useSocial()
  const players = useApp((s) => s.players)

  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const byUid = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of players) if (p.ownerId) map.set(p.ownerId, p.name)
    return map
  }, [players])

  const load = async () => setRows(await fetchFeedback())

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const done = async (id: string) => {
    setBusy(true)
    const r = await markFeedbackDone(id)
    setBusy(false)
    if (!r.ok) {
      setNote(r.error)
      return
    }
    /* 列表和「我的」那一栏上的红点一起刷，不然处理完红点还挂着 */
    await Promise.all([load(), refreshSocial()])
  }

  if (!social.isAdmin) {
    return (
      <Screen>
        <TopBar title={t('反馈', 'Feedback')} onBack={back} />
        <Body>
          <EmptyState
            icon="🔒"
            title={t('这一屏只有管理员看得到', 'Admins only')}
            hint={t(
              '真正把门的是数据库那边的规则，不是这一屏。',
              'The database rules are what gate this, not this screen.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  const open = rows ? openFeedbackCount(rows) : 0

  return (
    <Screen>
      <TopBar
        title={t('反馈', 'Feedback')}
        subtitle={
          rows === null
            ? t('正在拿…', 'Loading…')
            : open > 0
              ? t(`${open} 条没看`, `${open} unread`)
              : t('都看完了', 'All caught up')
        }
        onBack={back}
      />
      <Body>
        {rows === null ? (
          <p className="text-ink-500 text-caption">{t('正在拿…', 'Loading…')}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📮"
            title={t('还没人说过话', 'Nothing yet')}
            hint={t(
              '球友在「我的」里点「说点什么」就会到这儿。',
              'Anything sent from “Tell us” on the Me tab lands here.',
            )}
          />
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <Card key={r.id} className={r.status === 'open' ? 'border-brand-500/40' : undefined}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-ink-900 text-label font-medium">
                      {byUid.get(r.author) ?? t('不在你的球群里', 'Not in your club')}
                    </p>
                    <p className="text-ink-500 text-caption">
                      {kindLabel(r.kind)} · {relativeTime(Date.parse(r.created_at))}
                    </p>
                  </div>
                  <Pill tone={r.status === 'open' ? 'brand' : 'success'} className="shrink-0">
                    {r.status === 'open' ? t('没看', 'New') : t('看过了', 'Done')}
                  </Pill>
                </div>

                <p className="bg-fill text-ink-900 mt-2 rounded-lg px-3 py-2 text-body whitespace-pre-wrap">
                  {r.body}
                </p>

                {/* 这一行才是能拿去查问题的东西 */}
                {(r.device || r.app_build) && (
                  <p className="text-ink-500 tnum mt-2 text-caption">
                    {[r.device, r.app_build].filter(Boolean).join(' · ')}
                  </p>
                )}

                {r.status === 'open' && (
                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={busy}
                    onClick={() => void done(r.id)}
                  >
                    {t('看过了', 'Mark as read')}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </Body>

      <Toast message={note} tone="error" onClose={() => setNote(null)} />
    </Screen>
  )
}
