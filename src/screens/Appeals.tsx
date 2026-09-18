import { useEffect, useMemo, useState } from 'react'
import { lang, useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { refreshSocial, useSocial } from '@/store/useSocial'
import { Body, Button, Card, EmptyState, Screen, Toast, TopBar } from '@/components/ui'
import { reasonLabel } from '@/lib/report'
import {
  type Appeal,
  type Ban,
  banLine,
  fetchBansOf,
  fetchOpenAppeals,
  judgeAppeal,
} from '@/lib/ban'
import { relativeTime } from '@/lib/format'

/* ------------------------------------------------------------------ *
 * 申诉队列（只有管理员进得来）
 *
 * 这一屏和举报队列是一对，而且这一边更容易被忽略：举报有人催
 * （被骚扰的人会再来一次），申诉没人催 —— 申诉的人已经被禁言了，
 * 他连问一句「看了吗」都发不出来。
 *
 * 所以「我的」那一栏上给它一个和举报一样的红点。一条没人看的申诉，
 * 比没有申诉这条路更伤人：它让人以为自己说出去了。
 *
 * -------------------------------------------------------------------
 * 「通过」那一下会自动解封
 *
 * 数据库那边的触发器做的（025）。这里不再调一次解封 —— 两处都做的话，
 * 总有一天其中一处忘了，而那时候人会看到「申诉通过」却还是发不出话。
 * ------------------------------------------------------------------ */

export function Appeals() {
  const t = useT()
  const zh = lang() === 'zh'
  const back = useNav((s) => s.back)
  const social = useSocial()
  const players = useApp((s) => s.players)

  const [rows, setRows] = useState<Appeal[] | null>(null)
  const [bans, setBans] = useState<Map<string, Ban>>(new Map())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const byUid = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of players) if (p.ownerId) map.set(p.ownerId, p.name)
    return map
  }, [players])
  const nameOf = (uid: string) => byUid.get(uid) ?? t('不在你的球群里', 'Not in your club')

  const load = async () => {
    const list = await fetchOpenAppeals()
    setRows(list)
    /*
     * 每条申诉配上它对应的那条封号。
     *
     * 不配的话这一屏只有一段辩解，没有「他被封了什么、为什么」——
     * 那等于让人在不知道判了什么的情况下决定要不要改判。
     */
    const uids = [...new Set(list.map((a) => a.uid))]
    const all = await Promise.all(uids.map((u) => fetchBansOf(u)))
    const map = new Map<string, Ban>()
    for (const b of all.flat()) map.set(b.id, b)
    setBans(map)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const judge = async (id: string, ok: boolean) => {
    setBusy(true)
    const r = await judgeAppeal(id, ok)
    setBusy(false)
    if (!r.ok) {
      setNote(r.error)
      return
    }
    /* 列表和「我的」那个红点一起刷 —— 只刷一边的话红点会说谎 */
    await Promise.all([load(), refreshSocial()])
  }

  if (!social.isAdmin) {
    return (
      <Screen>
        <TopBar title={t('申诉', 'Appeals')} onBack={back} />
        <Body>
          <EmptyState
            title={t('只有管理员看得到', 'Admins only')}
            hint={t(
              '真正把门的是数据库那边的策略，不是这一屏 —— 进来了也读不到一行。',
              'The database policies are what actually gate this, not this screen — you would read zero rows anyway.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  return (
    <Screen>
      <TopBar
        title={t('申诉', 'Appeals')}
        subtitle={t('被封的人说的话', 'What suspended people wrote')}
        onBack={back}
      />
      <Body>
        {rows === null ? (
          <p className="text-ink-500 text-caption">{t('正在拿…', 'Loading…')}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📭"
            title={t('没有等着处理的申诉', 'No appeals waiting')}
            hint={t('封了人之后，他写的申诉会出现在这里。', 'When someone you suspended appeals, it shows up here.')}
          />
        ) : (
          <div className="space-y-2">
            {rows.map((a) => {
              const b = bans.get(a.ban_id)
              return (
                <Card key={a.id} className="border-danger-600/30">
                  <p className="text-ink-900 text-label font-medium">
                    {nameOf(a.uid)}
                  </p>
                  {/* 判了什么，摆在辩解上面 */}
                  {b ? (
                    <p className="text-ink-500 text-caption">
                      {banLine(b, zh)} · {reasonLabel(b.reason)}
                      {b.note ? ` · 「${b.note}」` : ''}
                    </p>
                  ) : (
                    <p className="text-ink-500 text-caption">
                      {t('那条封号读不到了', 'That suspension is no longer readable')}
                    </p>
                  )}
                  <p className="text-ink-500 text-caption">
                    {relativeTime(Date.parse(a.created_at))}
                  </p>

                  <p className="bg-fill text-ink-700 mt-2 whitespace-pre-wrap rounded-lg px-3 py-2 text-body">
                    {a.body}
                  </p>

                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy}
                      onClick={() => void judge(a.id, false)}
                    >
                      {t('维持原判', 'Keep it')}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      className="flex-1"
                      disabled={busy}
                      onClick={() => void judge(a.id, true)}
                    >
                      {t('通过 · 解封', 'Accept · lift')}
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        <p className="text-ink-500 pb-2 text-caption">
          {t(
            '点「通过」的那一下就解封了，不用再去解一次。「维持原判」之后他可以再写一条 —— 一条封号同时只能有一条没处理的申诉，所以刷不了屏。',
            'Accepting lifts the suspension right there — no second step. After “keep it” they may write once more; only one open appeal per suspension, so it cannot be spammed.',
          )}
        </p>
      </Body>

      <Toast message={note} tone="error" onClose={() => setNote(null)} />
    </Screen>
  )
}
