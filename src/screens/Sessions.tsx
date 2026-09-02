import { useT } from '@/lib/i18n'
import { useMemo, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Button, Card, EmptyState, Pill, Screen, Segmented } from '@/components/ui'
import { formatDate, formatMonth } from '@/lib/format'
import { FORMAT_LABELS, formatOf, type Session } from '@/types'
import { venueLabel } from '@/lib/venues'

type Filter = 'live' | 'past'

/**
 * 球局列表。
 *
 * 规格里的筛选是「进行中 / 即将开始 / 历史」三档，但 App 里没有
 * 「即将开始」这个状态 —— 球局一建出来就是进行中的，没有预约到场时间
 * 这回事。凭空加一个永远是空的页签只会让人以为功能坏了，所以这里只做两档。
 */
export function Sessions() {
  const t = useT()
  const { sessions, matches } = useApp()
  const push = useNav((s) => s.push)
  const [filter, setFilter] = useState<Filter>('live')

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of matches) {
      if (m.status !== 'done') continue
      map.set(m.sessionId, (map.get(m.sessionId) ?? 0) + 1)
    }
    return map
  }, [matches])

  const recent = <T extends { createdAt: number; endedAt?: number }>(a: T, b: T) =>
    (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt)

  const live = sessions.filter((s) => s.status === 'active').sort(recent)
  const past = sessions.filter((s) => s.status === 'ended').sort(recent)

  /* 历史按月分组 —— 打了一年之后，一条挨一条的列表根本翻不动 */
  const byMonth = useMemo(() => {
    const groups = new Map<string, Session[]>()
    for (const s of past) {
      const key = s.date.slice(0, 7)
      const list = groups.get(key)
      if (list) list.push(s)
      else groups.set(key, [s])
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [past])

  const row = (s: Session) => {
    const played = counts.get(s.id) ?? 0
    const active = s.status === 'active'
    return (
      <Card
        key={s.id}
        className={active ? 'border-brand-500/40' : undefined}
        onClick={() =>
          push(
            active
              ? { name: 'board', sessionId: s.id }
              : { name: 'summary', sessionId: s.id },
          )
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-title">{venueLabel(s.venue)}</p>
              {active && <Pill tone="brand">{t('进行中', 'Live')}</Pill>}
            </div>
            <p className="text-ink-500 mt-1 text-label">
              {formatDate(s.date)} ·{' '}
              {t(`${s.playerIds.length} 人`, `${s.playerIds.length} players`)} ·{' '}
              {t(`${s.courtCount} 片场`, `${s.courtCount} courts`)}
            </p>
            <p className="text-ink-500 mt-0.5 text-label">
              {t(...FORMAT_LABELS[formatOf(s)])} ·{' '}
              {t(`${s.rules.pointsToWin} 分制`, `to ${s.rules.pointsToWin}`)} ·{' '}
              {t(`已打 ${played} 场`, `${played} played`)}
            </p>
          </div>
          <span className="text-brand-600 shrink-0 text-label">
            {active ? t('继续记分 →', 'Score →') : t('看战绩 ›', 'Results ›')}
          </span>
        </div>
      </Card>
    )
  }

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-3">
        <h1 className="text-h1">{t('球局', 'Sessions')}</h1>
      </header>

      <Body>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            {
              value: 'live',
              label: `${t('进行中', 'Live')}${live.length ? ` (${live.length})` : ''}`,
            },
            { value: 'past', label: `${t('历史', 'History')} (${past.length})` },
          ]}
        />

        {filter === 'live' ? (
          live.length === 0 ? (
            <>
              <EmptyState
                title={t('现在没有在打的球局', 'No session running')}
                hint={t(
                  '到了球馆就开一个，其他人在自己首页就能看到，点一下加入',
                  'Start one at the courts, tick who showed up, and RALLY handles the rotation and scoring',
                )}
              />
              <Button variant="primary" size="lg" block onClick={() => push({ name: 'setup' })}>
                {t('开新球局', 'New session')}
              </Button>
            </>
          ) : (
            <div className="space-y-3">{live.map(row)}</div>
          )
        ) : past.length === 0 ? (
          <EmptyState
            title={t('还没有打完的球局', 'No finished sessions yet')}
            hint={t(
              '打完一局并结束，它就会留在这里',
              'Finish a session and it will show up here',
            )}
          />
        ) : (
          byMonth.map(([month, list]) => (
            <div key={month} className="space-y-2">
              <h2 className="text-ink-500 px-1 text-label">
                {formatMonth(month)} ·{' '}
                {t(`${list.length} 场球局`, `${list.length} sessions`)}
              </h2>
              <div className="space-y-3">{list.map(row)}</div>
            </div>
          ))
        )}
      </Body>
    </Screen>
  )
}
