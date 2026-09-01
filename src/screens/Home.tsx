import { lang, useT } from '@/lib/i18n'
import { useMemo } from 'react'
import { playerMap, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Button, Card, Pill, Screen, SectionTitle } from '@/components/ui'
import { Ticker } from '@/components/Ticker'
import { formatDate } from '@/lib/format'
import { buildFeed, type FeedItem } from '@/lib/feed'
import { computeStats, decidedMatches, matchWinnerBySets, sideOf } from '@/lib/ranking'
import { progressOf } from '@/lib/avatar'
import { RankChip } from '@/components/RankMedal'
import { scoreLine } from '@/lib/scoring'
import { venueLabel } from '@/lib/venues'
import { TeamNames } from '@/components/PlayerBits'

/**
 * 早上好 / 下午好 / 晚上好 —— 球局大多在晚上，这句得对得上。
 * 中英文的分段不一样：英文没有「中午好」这个说法，
 * 直译成 Good noon 会很怪，所以两边各按各的习惯分。
 */
function greeting(name: string): string {
  const h = new Date().getHours()
  if (lang() === 'zh') {
    if (h < 6) return `夜里好，${name}`
    if (h < 11) return `早上好，${name}`
    if (h < 14) return `中午好，${name}`
    if (h < 18) return `下午好，${name}`
    return `晚上好，${name}`
  }
  if (h < 5) return `Still up, ${name}?`
  if (h < 12) return `Good morning, ${name}`
  if (h < 18) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

const ARROW = (
  <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export function Home() {
  const t = useT()
  const { players, sessions, matches, meId } = useApp()
  const push = useNav((s) => s.push)
  const switchTab = useNav((s) => s.switchTab)

  const names = useMemo(() => playerMap(players), [players])
  const nameOf = useMemo(
    () => new Map(players.map((p) => [p.id, p.name])),
    [players],
  )
  const me = meId ? names.get(meId) : undefined

  const active = sessions.find((s) => s.status === 'active')
  const past = useMemo(
    () =>
      sessions
        .filter((s) => s.status === 'ended')
        .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt)),
    [sessions],
  )
  const roster = players.filter((p) => !p.archived)
  const totalPlayed = decidedMatches(matches).length

  /* 进行中的那几场，首页直接把实时比分摆出来 —— 规格 §A 的主行动卡 */
  const liveMatches = useMemo(
    () =>
      active
        ? matches
            .filter((m) => m.sessionId === active.id && m.status === 'playing')
            .sort((a, b) => (a.courtIndex ?? 0) - (b.courtIndex ?? 0))
        : [],
    [matches, active],
  )

  const playedIn = (sessionId: string) =>
    matches.filter((m) => m.sessionId === sessionId && m.status === 'done').length

  /* 快讯全部从比赛记录现算，所以删掉一场比赛消息会跟着变，不会留下旧账 */
  const feed = useMemo(
    () => buildFeed(players, sessions, matches),
    [players, sessions, matches],
  )

  const openFeed = (item: FeedItem) => {
    const l = item.link
    if (!l) return
    if (l.kind === 'leaderboard') push({ name: 'leaderboard' })
    else if (l.kind === 'player') push({ name: 'profile', playerId: l.playerId })
    else push({ name: 'summary', sessionId: l.sessionId })
  }

  /* 我的进度：段位、MMR、近 5 场胜负 */
  const myProgress = useMemo(
    () => (me ? progressOf(me.id, matches) : null),
    [me, matches],
  )
  const myStats = useMemo(
    () => (me ? computeStats(matches, [me.id])[0] : null),
    [me, matches],
  )
  const last5 = useMemo(() => {
    if (!me) return [] as boolean[]
    return decidedMatches(matches)
      .filter((m) => sideOf(m, me.id) !== null)
      .slice(-5)
      .reverse()
      .map((m) => matchWinnerBySets(m) === sideOf(m, me.id))
  }, [matches, me])

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-h1 tracking-[0.08em]">RALLY</h1>
            <p className="text-ink-500 mt-0.5 text-label">
              {me ? greeting(me.name) : t('羽球社交竞技平台', 'Badminton, together')}
            </p>
          </div>
          {me && myProgress && (
            <button onClick={() => switchTab('me')} className="shrink-0" aria-label={t('我的', 'Me')}>
              <RankChip level={myProgress.level} />
            </button>
          )}
        </div>
      </header>

      <Body>
        {feed.length > 0 && <Ticker items={feed} onPick={openFeed} />}

        {/* 主行动卡：任何时候都能一次点击回到当前球局 */}
        {active ? (
          <Card
            className="border-brand-500/40 bg-brand-50"
            onClick={() => push({ name: 'board', sessionId: active.id })}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Pill tone="brand">{t('进行中', 'Live')}</Pill>
                <p className="mt-2 truncate text-h2">{venueLabel(active.venue)}</p>
                <p className="text-ink-500 mt-0.5 text-label">
                  {formatDate(active.date)} ·{' '}
                  {t(
                    `${active.playerIds.length} 人 · ${active.courtCount} 片场 · 已打 ${playedIn(active.id)} 场`,
                    `${active.playerIds.length} players · ${active.courtCount} courts · ${playedIn(active.id)} played`,
                  )}
                </p>
              </div>
              <span className="text-brand-600 shrink-0 text-title">{t('继续 →', 'Resume →')}</span>
            </div>

            {liveMatches.length > 0 && (
              <div className="border-brand-500/25 mt-3 space-y-2 border-t pt-3">
                {liveMatches.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-label">
                    <span className="text-ink-500 shrink-0">
                      {t(`${(m.courtIndex ?? 0) + 1} 号场`, `Court ${(m.courtIndex ?? 0) + 1}`)}
                    </span>
                    <TeamNames
                      ids={m.teamA}
                      names={nameOf}
                      className="text-team-a min-w-0 flex-1 text-right"
                    />
                    <span className="tnum shrink-0 font-semibold">
                      {scoreLine(m.games)}
                    </span>
                    <TeamNames
                      ids={m.teamB}
                      names={nameOf}
                      className="text-team-b min-w-0 flex-1"
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <p className="text-h2">{t('今晚去打球？', 'Playing tonight?')}</p>
            <p className="text-ink-500 mt-1 text-label">
              {t(
                '开一个球局，勾上到场的人，RALLY 负责公平排场、记分和算排名。',
                'Start a session, tick who is here, and RALLY handles fair rotation, scoring and rankings.',
              )}
            </p>
            <Button
              variant="primary"
              size="lg"
              block
              className="mt-4"
              onClick={() => push({ name: 'setup' })}
            >
              {t('开新球局', 'New session')}
            </Button>
          </Card>
        )}

        {/* 我的进度 */}
        {me && myProgress && myStats && (
          <Card onClick={() => push({ name: 'profile', playerId: me.id })}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink-500 text-label">{t('我的进度', 'My progress')}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <RankChip level={myProgress.level} />
                  <span className="tnum text-title">MMR {myProgress.mmr}</span>
                </div>
                {last5.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-ink-500 text-caption">{t('近 5 场', 'Last 5')}</span>
                    {last5.map((won, i) => (
                      <span
                        key={i}
                        className={
                          won
                            ? 'bg-success-50 text-success-600 flex size-5 items-center justify-center rounded-md text-caption font-semibold'
                            : 'bg-danger-50 text-danger-600 flex size-5 items-center justify-center rounded-md text-caption font-semibold'
                        }
                      >
                        {won ? t('胜', 'W') : t('负', 'L')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {ARROW}
            </div>
          </Card>
        )}

        {/* 快捷入口 */}
        <SectionTitle>{t('快捷入口', 'Shortcuts')}</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Card onClick={() => push({ name: 'leaderboard' })}>
            <p className="text-ink-500 text-label">{t('排行榜', 'Leaderboard')}</p>
            <p className="tnum mt-1 text-h2">{totalPlayed}</p>
            <p className="text-ink-500 text-caption">{t('场已记录', 'matches')}</p>
          </Card>
          <Card onClick={() => push({ name: 'players' })}>
            <p className="text-ink-500 text-label">{t('球员库', 'Players')}</p>
            <p className="tnum mt-1 text-h2">{roster.length}</p>
            <p className="text-ink-500 text-caption">{t('位球友', 'players')}</p>
          </Card>
        </div>

        {/* 最近球局最多三条，完整的历史在「球局」那个 tab 里 */}
        {past.length > 0 && (
          <>
            <SectionTitle
              right={
                <Button size="sm" variant="tertiary" onClick={() => switchTab('sessions')}>
                  {t('查看全部', 'See all')}
                </Button>
              }
            >
              {t('最近球局', 'Recent sessions')}
            </SectionTitle>
            <div className="space-y-3">
              {past.slice(0, 3).map((s) => (
                <Card key={s.id} onClick={() => push({ name: 'summary', sessionId: s.id })}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-title">{venueLabel(s.venue)}</p>
                      <p className="text-ink-500 mt-0.5 text-label">
                        {formatDate(s.date)} ·{' '}
                        {t(
                          `${s.playerIds.length} 人 · ${playedIn(s.id)} 场`,
                          `${s.playerIds.length} players · ${playedIn(s.id)} matches`,
                        )}
                      </p>
                    </div>
                    {ARROW}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </Body>
    </Screen>
  )
}
