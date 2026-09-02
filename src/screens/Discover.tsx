import { useT } from '@/lib/i18n'
import { useMemo } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Card, Screen, SectionTitle } from '@/components/ui'
import { venueSummaries } from '@/lib/venues'
import { formatDate } from '@/lib/format'

/*
 * 发现。
 *
 * 现在只有球馆一件事。
 *
 * 原来还有「排行榜」和「球员库」两个入口，一起去掉了：这个 App 不再有
 * 「翻一遍所有人」这件事 —— 你只在自己打过的球局和常去的球馆里看见别人，
 * 而那两处的排名各自就在那两处点得到。全员榜和名册除了让人互相打量之外
 * 没有用途，而它们恰恰是最容易让人不舒服的两页。
 */

export function Discover() {
  const t = useT()
  const { sessions, matches } = useApp()
  const push = useNav((s) => s.push)

  const venues = useMemo(() => venueSummaries(sessions, matches), [sessions, matches])

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-3">
        <h1 className="text-h1">{t('发现', 'Discover')}</h1>
        <p className="text-ink-500 mt-1 text-label">
          {t('你常去的球馆，和每个馆的排名', 'Your regular venues, and how everyone ranks at each')}
        </p>
      </header>

      <Body>
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
                  <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Body>
    </Screen>
  )
}
