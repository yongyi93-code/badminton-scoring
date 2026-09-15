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
  Segmented,
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
import {
  deleteErrorGroup,
  fetchErrors,
  groupErrors,
  markErrorGroupDone,
  type ErrorGroup,
} from '@/lib/errorlog'
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
 *
 * -------------------------------------------------------------------
 * 两个 tab，不是两个入口
 *
 *   反馈  人主动说的
 *   报错  App 自己撞上的
 *
 * 合在一屏是因为它们是同一件事的两半：「这个 App 现在怎么样」。
 * 而且人说的那句「点不动」，答案多半就在旁边那个 tab 里 ——
 * 分成两个菜单项只会让人来回跳。
 * ------------------------------------------------------------------ */

export function Feedback() {
  const t = useT()
  const back = useNav((s) => s.back)
  const social = useSocial()
  const players = useApp((s) => s.players)

  const [tab, setTab] = useState<'says' | 'crashes'>('says')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [errs, setErrs] = useState<ErrorGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /** 展开了哪几个 bug 的堆栈。默认收着 —— 堆栈很长，摊开没法翻 */
  const [openIds, setOpenIds] = useState<string[]>([])

  const byUid = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of players) if (p.ownerId) map.set(p.ownerId, p.name)
    return map
  }, [players])

  const load = async () => {
    const [fb, er] = await Promise.all([fetchFeedback(), fetchErrors()])
    setRows(fb)
    setErrs(groupErrors(er))
  }

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
        <TopBar title={t('反馈与报错', 'Feedback and crashes')} onBack={back} />
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
  const openBugs = errs ? errs.filter((g) => g.anyOpen).length : 0
  const waiting = tab === 'says' ? open : openBugs

  return (
    <Screen>
      <TopBar
        title={t('反馈与报错', 'Feedback and crashes')}
        subtitle={
          rows === null
            ? t('正在拿…', 'Loading…')
            : waiting > 0
              ? t(`${waiting} 条没看`, `${waiting} unread`)
              : t('都看完了', 'All caught up')
        }
        onBack={back}
      />
      <Body>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'says', label: t(`反馈${open ? ` (${open})` : ''}`, `Feedback${open ? ` (${open})` : ''}`) },
            { value: 'crashes', label: t(`报错${openBugs ? ` (${openBugs})` : ''}`, `Crashes${openBugs ? ` (${openBugs})` : ''}`) },
          ]}
        />

        {tab === 'crashes' ? (
          <CrashList
            groups={errs}
            busy={busy}
            openIds={openIds}
            onToggle={(fp) =>
              setOpenIds((ids) => (ids.includes(fp) ? ids.filter((x) => x !== fp) : [...ids, fp]))
            }
            onDone={async (fp) => {
              setBusy(true)
              await markErrorGroupDone(fp)
              setBusy(false)
              await Promise.all([load(), refreshSocial()])
            }}
            onDelete={async (fp) => {
              setBusy(true)
              await deleteErrorGroup(fp)
              setBusy(false)
              await Promise.all([load(), refreshSocial()])
            }}
          />
        ) : rows === null ? (
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

/* ------------------------------------------------------------------ *
 * 报错那一半
 *
 * 按指纹归并过了：一个 bug 一行，写着撞了几次、都在哪些机型上。
 * 摊开列每一条的话，一个循环里的错误能刷四十行，而它们是同一件事。
 * ------------------------------------------------------------------ */

function CrashList({
  groups,
  busy,
  openIds,
  onToggle,
  onDone,
  onDelete,
}: {
  groups: ErrorGroup[] | null
  busy: boolean
  openIds: string[]
  onToggle: (fingerprint: string) => void
  onDone: (fingerprint: string) => void | Promise<void>
  onDelete: (fingerprint: string) => void | Promise<void>
}) {
  const t = useT()

  if (groups === null) {
    return <p className="text-ink-500 text-caption">{t('正在拿…', 'Loading…')}</p>
  }
  if (groups.length === 0) {
    return (
      <EmptyState
        icon="🌤️"
        title={t('一条报错都没有', 'No crashes')}
        hint={t(
          'App 撞上没接住的错误时会自己报上来，不用等人说。',
          'The app reports unhandled errors by itself — nobody has to tell you.',
        )}
      />
    )
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const expanded = openIds.includes(g.fingerprint)
        return (
          <Card
            key={g.fingerprint}
            className={g.anyOpen ? 'border-danger-600/30' : undefined}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-ink-900 text-label font-medium break-words">
                  {g.latest.message}
                </p>
                <p className="text-ink-500 text-caption">
                  {g.latest.route ? `${g.latest.route} · ` : ''}
                  {relativeTime(Date.parse(g.latest.created_at))}
                </p>
              </div>
              {/* 撞的次数比「新/旧」更值得占这个位置 */}
              <Pill tone={g.anyOpen ? 'danger' : 'neutral'} className="tnum shrink-0">
                {t(`${g.count} 次`, `${g.count}×`)}
              </Pill>
            </div>

            <p className="text-ink-500 tnum mt-2 text-caption">
              {[g.devices.join('、'), g.builds.join('、')].filter(Boolean).join(' · ')}
            </p>

            {g.latest.stack && (
              <>
                <button
                  className="text-brand-600 mt-2 text-caption"
                  onClick={() => onToggle(g.fingerprint)}
                >
                  {expanded ? t('收起堆栈', 'Hide stack') : t('看堆栈', 'Show stack')}
                </button>
                {expanded && (
                  <pre className="bg-fill text-ink-700 mt-2 overflow-x-auto rounded-lg p-3 text-caption">
                    {g.latest.stack}
                  </pre>
                )}
              </>
            )}

            <div className="mt-3 flex gap-2">
              {g.anyOpen && (
                <Button size="sm" disabled={busy} onClick={() => void onDone(g.fingerprint)}>
                  {t('看过了', 'Mark as read')}
                </Button>
              )}
              {/* 修好之后整组清掉 —— 报错是会堆积的，清理是常规操作 */}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void onDelete(g.fingerprint)}
              >
                {t('修好了，清掉', 'Fixed — clear')}
              </Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
