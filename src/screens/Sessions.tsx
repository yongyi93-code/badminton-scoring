import { useT } from '@/lib/i18n'
import { useMemo, useState } from 'react'
import { activeSessionOf, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Button, Card, EmptyState, Pill, Screen, Segmented, cx } from '@/components/ui'
import {
  formatDate,
  formatMonth,
  formatTime,
  shiftDays,
  todayISO,
  weekOf,
  weekdayShort,
} from '@/lib/format'
import { FORMAT_LABELS, formatOf, type Session } from '@/types'
import { venueLabel } from '@/lib/venues'

type Filter = 'byDate' | 'past'

/**
 * 球局列表。
 *
 * 两档：按日期、历史。
 *
 * 「按日期」是主入口 —— 找球局时人脑子里想的是「周五有没有」，
 * 不是「往下翻到第几条」。一周七天摆一排，有球局的那天底下一个小点，
 * 点哪天看哪天，往前往后翻周。
 *
 * 「历史」保留原来那份按月分组的全部记录：打了一年之后，
 * 要找去年三月那一场，一周一周往回翻是翻不动的。
 */
export function Sessions() {
  const t = useT()
  const { sessions, matches, meId } = useApp()
  const push = useNav((s) => s.push)
  /** 我现在在哪一场里。在的话就开不了新的（见 store 的 createSession） */
  const inSession = useMemo(() => activeSessionOf(sessions, meId), [sessions, meId])
  const [filter, setFilter] = useState<Filter>('byDate')
  /** 日历那一条选中的是哪一天 */
  const [day, setDay] = useState(todayISO())

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

  const past = sessions.filter((s) => s.status === 'ended').sort(recent)

  /*
   * 哪几天有球局 —— 日历上那些小圆点。
   * 进行中和打完的都算：翻到上个月是为了找那天打了什么，
   * 只标进行中的话整条日历上永远只有今天有点。
   */
  const daysWithSessions = useMemo(
    () => new Set(sessions.map((s) => s.date)),
    [sessions],
  )

  /*
   * 选中那天的球局。进行中的排前面 —— 那几场是现在还能加进去的，
   * 而打完的只能看战绩。
   */
  const onDay = useMemo(
    () =>
      sessions
        .filter((s) => s.date === day)
        .sort((a, b) => {
          if ((a.status === 'active') !== (b.status === 'active')) {
            return a.status === 'active' ? -1 : 1
          }
          // 同一天里按开打时间排；没填时间的（老球局）排最后
          return (a.time ?? '99:99').localeCompare(b.time ?? '99:99')
        }),
    [sessions, day],
  )

  const week = useMemo(() => weekOf(day), [day])

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
    const go = () =>
      push(
        active
          ? { name: 'board', sessionId: s.id }
          : { name: 'summary', sessionId: s.id },
      )
    return (
      <Card key={s.id} className={active ? 'border-brand-500/40' : undefined}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-title">{venueLabel(s.venue)}</p>
              {active && <Pill tone="brand">{t('进行中', 'Live')}</Pill>}
            </div>
            <p className="text-ink-500 mt-1 text-label">
              {formatDate(s.date)}
              {formatTime(s.time) ? ` · ${formatTime(s.time)}` : ''} ·{' '}
              {t(`${s.playerIds.length} 人`, `${s.playerIds.length} players`)} ·{' '}
              {t(`${s.courtCount} 片场`, `${s.courtCount} courts`)}
            </p>
            <p className="text-ink-500 mt-0.5 text-label">
              {t(...FORMAT_LABELS[formatOf(s)])} ·{' '}
              {t(`${s.rules.pointsToWin} 分制`, `to ${s.rules.pointsToWin}`)} ·{' '}
              {t(`已打 ${played} 场`, `${played} played`)}
            </p>
          </div>
        </div>

        {/*
          进行中的那几场给一个实心按钮，打完的给一条淡的。
          原来整张卡都能点、右上角一行小字写「继续记分 →」——
          一列卡里每一张都长一样，要读完那行小字才知道点进去是记分
          还是翻旧账。两件事轻重差得远，就别让它们长得一样。
        */}
        <Button
          variant={active ? 'primary' : 'soft'}
          size={active ? 'md' : 'sm'}
          block
          className="mt-3"
          onClick={go}
        >
          {active ? t('进入球局', 'Enter session') : t('看战绩', 'Results')}
        </Button>
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
            { value: 'byDate', label: t('按日期', 'By date') },
            { value: 'past', label: `${t('历史', 'History')} (${past.length})` },
          ]}
        />

        {filter === 'byDate' ? (
          <>
            {/*
              一周七天摆一排，点哪天看哪天。
              比一条长长的列表好使的地方在于：找球局时人想的是「周五有没有」，
              不是「往下翻到第几条」。有球局的那天底下点一个小圆点。
            */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-title">{formatMonth(day.slice(0, 7))}</p>
                <button
                  className="text-brand-600 text-label"
                  onClick={() => setDay(todayISO())}
                >
                  {t('回到今天', 'Today')}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="text-ink-500 active:text-ink-900 shrink-0 px-1 py-2"
                  aria-label={t('上一周', 'Previous week')}
                  onClick={() => setDay(shiftDays(day, -7))}
                >
                  ‹
                </button>
                <div className="flex flex-1 gap-1">
                  {week.map((d) => {
                    const picked = d === day
                    const isToday = d === todayISO()
                    return (
                      <button
                        key={d}
                        onClick={() => setDay(d)}
                        aria-current={picked ? 'date' : undefined}
                        className={cx(
                          'flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 transition-colors',
                          picked
                            ? 'bg-brand-solid text-on-brand'
                            : 'active:bg-fill text-ink-700',
                        )}
                      >
                        <span
                          className={cx(
                            'text-caption',
                            picked ? 'opacity-90' : 'text-ink-500',
                          )}
                        >
                          {weekdayShort(d)}
                        </span>
                        <span
                          className={cx(
                            'tnum text-title',
                            !picked && isToday && 'text-brand-600',
                          )}
                        >
                          {Number(d.slice(8))}
                        </span>
                        {/* 有球局的那天点一个小点。选中那天用白点，不然压在底色上看不见 */}
                        <span
                          className={cx(
                            'size-1.5 rounded-full',
                            daysWithSessions.has(d)
                              ? picked
                                ? 'bg-on-brand'
                                : 'bg-brand-500'
                              : 'bg-transparent',
                          )}
                        />
                      </button>
                    )
                  })}
                </div>
                <button
                  className="text-ink-500 active:text-ink-900 shrink-0 px-1 py-2"
                  aria-label={t('下一周', 'Next week')}
                  onClick={() => setDay(shiftDays(day, 7))}
                >
                  ›
                </button>
              </div>
            </div>

            <p className="text-ink-500 text-label">
              {formatDate(day)} ·{' '}
              {t(`${onDay.length} 场球局`, `${onDay.length} sessions`)}
            </p>

            {onDay.length === 0 ? (
              <>
                <EmptyState
                  title={t('这一天没有球局', 'Nothing on this day')}
                  hint={t(
                    '换一天看看，或者自己开一个 —— 开了之后所有人在首页都看得到',
                    'Try another day, or start one — everyone sees it on their home screen',
                  )}
                />
                {/* 已经在一场里就开不了新的 —— 那时候给的出路是回去那一场 */}
                {inSession ? (
                  <Button
                    variant="primary"
                    size="lg"
                    block
                    onClick={() => push({ name: 'board', sessionId: inSession.id })}
                  >
                    {t(`回到「${venueLabel(inSession.venue)}」那一场`, 'Back to your session')}
                  </Button>
                ) : (
                  <Button variant="primary" size="lg" block onClick={() => push({ name: 'setup' })}>
                    {t('开新球局', 'New session')}
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="space-y-3">{onDay.map(row)}</div>
                {/*
                  列完那天的球局，底下留一个「再开一个」。
                  原来只有空着的那天才有这个按钮 —— 可是「今晚已经有一场，
                  但时间／地点不合适，我想自己开一个」正是最常见的一种。
                  已经在一场里的人开不了新的（store 那层拦着），
                  那时候这个按钮改成回去那一场，不让他填完四步再被拒。
                */}
                {!inSession ? (
                  <Button variant="ghost" size="lg" block onClick={() => push({ name: 'setup' })}>
                    {t('发起新球局', 'New session')}
                  </Button>
                ) : (
                  /* 我那一场就在这一天的列表里的话，上面那张卡已经能进去了 */
                  !onDay.some((x) => x.id === inSession.id) && (
                    <Button
                      variant="ghost"
                      size="lg"
                      block
                      onClick={() => push({ name: 'board', sessionId: inSession.id })}
                    >
                      {t(`回到「${venueLabel(inSession.venue)}」那一场`, 'Back to your session')}
                    </Button>
                  )
                )}
              </>
            )}
          </>
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
