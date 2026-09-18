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
  cx,
} from '@/components/ui'
import {
  fetchAllReports,
  openCount,
  reasonLabel,
  resolveReport,
  type EvidenceMessage,
  type Report,
} from '@/lib/report'
import { VoiceBubble } from '@/components/VoiceBits'
import { BanSheet } from '@/components/BanSheet'
import { relativeTime } from '@/lib/format'

/* ------------------------------------------------------------------ *
 * 举报队列（只有管理员进得来）
 *
 * 这一屏存在的理由很直接：一个没人看的举报按钮，比没有那个按钮
 * 更糟 —— 它让一个正在被骚扰的人以为自己已经说出去了。
 *
 * -------------------------------------------------------------------
 * 这一屏上看得到别人的私聊内容
 *
 * 所以它被三道东西卡着，而且三道都不在这个文件里：
 *   1. 入口只对管理员显示（这个是最弱的一道，随便改）
 *   2. 数据库的读策略只让管理员读得到 reports（真正把门的）
 *   3. 录音那道门只在举报还开着的时候开（012 里那条 storage 策略）
 *
 * 第 1 道写在界面上，第 2、3 道写在数据库里。把 isAdmin 改成 true
 * 一行都读不到 —— 这是故意的，界面从来挡不住会按 F12 的人。
 *
 * -------------------------------------------------------------------
 * 三条路
 *
 *   不处理   看过，觉得没事
 *   处理了   看过，而且做了点什么（私下说了、或者真去管了）
 *   处理这个人   禁言或者封号（025）
 *
 * 第三条以前没有，这个文件里原来写着「做一个按钮假装有比没有更糟，
 * 真要封的时候得先想清楚怎么申诉」—— 025 就是把申诉先想清楚了，
 * 所以那个按钮现在是真的。
 * ------------------------------------------------------------------ */

export function Reports() {
  const t = useT()
  const back = useNav((s) => s.back)
  const social = useSocial()
  const players = useApp((s) => s.players)

  const [rows, setRows] = useState<Report[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /** 展开了哪几条的证据。默认都收着 —— 别人的私聊不该一进来就摊一屏 */
  const [openIds, setOpenIds] = useState<string[]>([])
  /** 正在处理哪个人。null = 没开着 */
  const [acting, setActing] = useState<Report | null>(null)

  const byUid = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of players) if (p.ownerId) map.set(p.ownerId, p.name)
    return map
  }, [players])

  /** 这个 uid 叫什么。查不到就说查不到，别显示一串 uuid */
  const nameOf = (uid: string) => byUid.get(uid) ?? t('不在你的球群里', 'Not in your club')

  const load = async () => {
    setRows(await fetchAllReports())
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const decide = async (id: string, status: 'handled' | 'dismissed') => {
    setBusy(true)
    const r = await resolveReport(id, status)
    setBusy(false)
    if (!r.ok) {
      setNote(r.error)
      return
    }
    /*
     * 两份都要刷：这一屏的列表，和「我的」那一栏上那个红点。
     * 只刷列表的话，处理完了红点还挂着 —— 而那个红点正是
     * 让人再点进来看一眼的东西，它说谎的成本比看起来高。
     */
    await Promise.all([load(), refreshSocial()])
  }

  if (!social.isAdmin) {
    /*
     * 正常点不进来（入口不显示），但地址栏敲得进来。
     * 这里不装作「没有这一屏」—— 直说是权限问题，
     * 免得一个真的管理员在这儿以为 App 坏了。
     */
    return (
      <Screen>
        <TopBar title={t('举报', 'Reports')} onBack={back} />
        <Body>
          <EmptyState
            icon="🔒"
            title={t('这一屏只有管理员看得到', 'Admins only')}
            hint={t(
              '就算进来了也读不到任何一条 —— 真正把门的是数据库那边的规则，不是这一屏。',
              'Even from here you cannot read a single report — the database rules are what gate this, not this screen.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  const open = rows ? openCount(rows) : 0

  return (
    <Screen>
      <TopBar
        title={t('举报', 'Reports')}
        subtitle={
          rows === null
            ? t('正在拿…', 'Loading…')
            : open > 0
              ? t(`${open} 条等处理`, `${open} waiting`)
              : t('都处理完了', 'All clear')
        }
        onBack={back}
      />
      <Body>
        {rows === null ? (
          <p className="text-ink-500 text-caption">{t('正在拿…', 'Loading…')}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🕊️"
            title={t('一条举报都没有', 'No reports')}
            hint={t('这是好事。', 'That is a good thing.')}
          />
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const expanded = openIds.includes(r.id)
              const msgs = r.evidence?.messages ?? []
              return (
                <Card
                  key={r.id}
                  className={r.status === 'open' ? 'border-danger-600/30' : undefined}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-ink-900 text-label font-medium">
                        {t(
                          `${nameOf(r.reporter)} 举报了 ${nameOf(r.reported)}`,
                          `${nameOf(r.reporter)} reported ${nameOf(r.reported)}`,
                        )}
                      </p>
                      <p className="text-ink-500 text-caption">
                        {reasonLabel(r.reason)} · {relativeTime(Date.parse(r.created_at))}
                      </p>
                    </div>
                    <Pill
                      tone={
                        r.status === 'open' ? 'danger' : r.status === 'handled' ? 'success' : 'neutral'
                      }
                      className="shrink-0"
                    >
                      {r.status === 'open'
                        ? t('等处理', 'Open')
                        : r.status === 'handled'
                          ? t('处理了', 'Handled')
                          : t('没事', 'Dismissed')}
                    </Pill>
                  </div>

                  {r.note && (
                    <p className="bg-fill text-ink-700 mt-2 rounded-lg px-3 py-2 text-body whitespace-pre-wrap">
                      {r.note}
                    </p>
                  )}

                  {/*
                    证据默认收着。展开一次是一个动作 ——「我现在要看
                    这两个人的私聊」该是个有意识的决定，不是划过去
                    顺便就看了一屏。
                  */}
                  {msgs.length > 0 ? (
                    <button
                      className="text-brand-600 mt-2 text-caption"
                      onClick={() =>
                        setOpenIds((ids) =>
                          expanded ? ids.filter((x) => x !== r.id) : [...ids, r.id],
                        )
                      }
                    >
                      {expanded
                        ? t('收起对话', 'Hide conversation')
                        : t(`看这 ${msgs.length} 条对话`, `Show ${msgs.length} messages`)}
                    </button>
                  ) : (
                    <p className="text-ink-500 mt-2 text-caption">
                      {t(
                        '没有对话记录 —— 他们没聊过，或者举报的那一下快照没拍成。',
                        'No conversation — they never talked, or the snapshot failed.',
                      )}
                    </p>
                  )}

                  {expanded && (
                    <div className="border-line mt-2 space-y-2 border-t pt-2">
                      {msgs.map((m) => (
                        <EvidenceRow
                          key={m.id}
                          m={m}
                          fromReported={m.sender === r.reported}
                          who={nameOf(m.sender)}
                          /* 结了案那扇门就关了，签不出播放链接，别画一个点不动的按钮 */
                          canPlay={r.status === 'open'}
                        />
                      ))}
                    </div>
                  )}

                  {r.status === 'open' ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={busy}
                          onClick={() => void decide(r.id, 'dismissed')}
                        >
                          {t('看过了，没事', 'Nothing here')}
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          className="flex-1"
                          disabled={busy}
                          onClick={() => void decide(r.id, 'handled')}
                        >
                          {t('处理了', 'Handled it')}
                        </Button>
                      </div>
                      {/*
                        封人单独一行，不和上面两个挤在一起：那两个是
                        「结案」，这个是「对一个人做一件事」，量级不一样。
                        点开还有一层（选多重、多久、写给他的话），
                        所以这里按下去不会立刻发生什么。
                      */}
                      <button
                        className="text-danger-600 text-caption"
                        onClick={() => setActing(r)}
                      >
                        {t('禁言 / 封号…', 'Mute or suspend…')}
                      </button>
                    </div>
                  ) : (
                    <p className="text-ink-500 mt-2 text-caption">
                      {r.handled_at &&
                        t(
                          `${relativeTime(Date.parse(r.handled_at))}结的案`,
                          `Closed ${relativeTime(Date.parse(r.handled_at))}`,
                        )}
                    </p>
                  )}
                </Card>
              )
            })}
          </div>
        )}

        <p className="text-ink-500 pb-2 text-caption">
          {t(
            '这些对话是举报的那一刻拍下来的，之后谁删消息都改不掉它 —— 骂完就删是最常见的一手。被举报的人不知道自己被举报了，也不知道是谁举报的。',
            'These conversations were snapshotted when the report was filed, so deleting messages afterwards changes nothing. The reported person is never told that — or by whom — they were reported.',
          )}
        </p>
      </Body>

      <Toast message={note} tone="error" onClose={() => setNote(null)} />
      {acting && (
        <BanSheet
          open
          uid={acting.reported}
          name={nameOf(acting.reported)}
          defaultReason={acting.reason}
          onClose={() => setActing(null)}
          onDone={() => void load()}
        />
      )}
    </Screen>
  )
}

/** 证据里的一条。语音那条要能点开听，不然「他发语音骂我」没法判 */
function EvidenceRow({
  m,
  fromReported,
  who,
  canPlay,
}: {
  m: EvidenceMessage
  fromReported: boolean
  who: string
  canPlay: boolean
}) {
  const t = useT()
  return (
    <div>
      <p
        className={cx(
          'text-caption',
          /* 被举报的那个人说的话标出来 —— 一屏对话里要一眼找得到是谁在说 */
          fromReported ? 'text-danger-600 font-medium' : 'text-ink-500',
        )}
      >
        {who} · {relativeTime(Date.parse(m.created_at))}
      </p>
      {m.kind === 'voice' && m.audio_path ? (
        canPlay ? (
          <VoiceBubble path={m.audio_path} durationMs={m.duration_ms ?? 0} mine={false} />
        ) : (
          <p className="text-ink-500 text-body">
            {t('[语音] —— 结案之后就听不到了', '[Voice] — no longer playable after closing')}
          </p>
        )
      ) : (
        <p className="text-ink-900 text-body whitespace-pre-wrap">{m.body}</p>
      )}
    </div>
  )
}
