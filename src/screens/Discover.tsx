import { useT } from '@/lib/i18n'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Card, Screen, SectionTitle } from '@/components/ui'
import { decidedMatches } from '@/lib/ranking'
import { venueSummaries } from '@/lib/venues'
import { formatDate } from '@/lib/format'

/*
 * 发现。
 *
 * 规格给了四个入口：排行榜、球员库、球馆、比赛活动。
 * 「比赛活动」在优先级里是 P1，现在一行代码都没有 —— 放一个点进去空空如也的
 * 入口，比不放更伤，所以这里只列真的能用的三个。做出来了再加。
 */

const ARROW = (
  <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
)

function Entry({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <Card onClick={onClick}>
      <div className="flex items-center gap-4">
        <span className="bg-brand-100 text-brand-600 flex size-11 shrink-0 items-center justify-center rounded-xl">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-title">{title}</span>
          <span className="text-ink-500 mt-0.5 block truncate text-label">{hint}</span>
        </span>
        {ARROW}
      </div>
    </Card>
  )
}

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

export function Discover() {
  const t = useT()
  const { players, sessions, matches } = useApp()
  const push = useNav((s) => s.push)

  const played = decidedMatches(matches).length
  const roster = players.filter((p) => !p.archived).length
  const venues = useMemo(() => venueSummaries(sessions, matches), [sessions, matches])

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-3">
        <h1 className="text-h1">{t('发现', 'Discover')}</h1>
        <p className="text-ink-500 mt-1 text-label">
          {t('排行榜、球友和常去的球馆', 'Rankings, players and your regular venues')}
        </p>
      </header>

      <Body>
        <Entry
          icon={icon('M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0V4ZM6 6H3v2a4 4 0 0 0 3 3.9M18 6h3v2a4 4 0 0 1-3 3.9')}
          title={t('排行榜', 'Leaderboard')}
          hint={t(
            `${played} 场已记录 · 按球馆分开看`,
            `${played} matches recorded · filter by venue`,
          )}
          onClick={() => push({ name: 'leaderboard' })}
        />
        <Entry
          icon={icon('M16 20a4 4 0 0 0-8 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 20a3.5 3.5 0 0 0-4-3.3M18.5 10.5a3 3 0 0 0 0-5')}
          title={t('球员库', 'Players')}
          hint={t(`${roster} 位球友`, `${roster} players`)}
          onClick={() => push({ name: 'players' })}
        />

        <SectionTitle>{t('常去的球馆', 'Your venues')}</SectionTitle>
        {venues.length === 0 ? (
          <Card>
            <p className="text-ink-500 text-label">
              {t(
                '打完第一场球之后，去过的球馆会自动出现在这里。',
                'Venues show up here once you have played a match at one.',
              )}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {venues.map((v) => (
              <Card key={v.key} onClick={() => push({ name: 'venue', venue: v.label })}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-title">{v.label}</p>
                    <p className="text-ink-500 mt-0.5 text-label">
                      {t(
                        `${v.sessionCount} 次球局 · ${v.matchCount} 场 · ${v.playerCount} 人`,
                        `${v.sessionCount} sessions · ${v.matchCount} matches · ${v.playerCount} players`,
                      )}
                    </p>
                    <p className="text-ink-500 mt-0.5 text-caption">
                      {t('最近：', 'Last played ')}
                      {formatDate(new Date(v.lastPlayedAt).toISOString().slice(0, 10))}
                    </p>
                  </div>
                  {ARROW}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Body>
    </Screen>
  )
}
