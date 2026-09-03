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
 * 「球员库」那个入口去掉了就没再回来：翻一遍所有人的名册除了让人
 * 互相打量之外没有用途。
 *
 * 「全体排名」按用户要求加回来了，但和当初那个全员榜不是一回事：
 * 它只排名次，按 MMR —— 一个跨场馆累计、和「今晚谁状态好」无关的
 * 长期数字。名册是「这些人都是谁」，排名是「大家现在到哪一档了」。
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
          {t('全体排名，和你常去的球馆', 'The overall ranking, and your regular venues')}
        </p>
      </header>

      <Body>
        <Card onClick={() => push({ name: 'ranking' })}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-title">{t('全体排名', 'Everyone')}</p>
              <p className="text-ink-500 mt-0.5 text-label">
                {t(
                  '所有人放在一起按 MMR 排，看得到段位和各自的主场',
                  'Everyone ranked together by MMR, with their tier and home venue',
                )}
              </p>
            </div>
            <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>
        </Card>

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
