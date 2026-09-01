import { useT } from '@/lib/i18n'
import { useMemo } from 'react'
import { playerMap, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Card,
  EmptyState,
  Pill,
  Screen,
  SectionTitle,
  TopBar,
} from '@/components/ui'
import { RankTable } from '@/components/RankTable'
import { computeStats, decidedMatches, rankPlayers } from '@/lib/ranking'
import { progressByPlayer } from '@/lib/avatar'
import {
  matchesAtVenue,
  playerIdsAtVenue,
  sessionsAtVenue,
  venueKey,
  venueLabel,
  venueSummaries,
} from '@/lib/venues'
import { formatDate, percent } from '@/lib/format'
import { FORMAT_LABELS, formatOf, RANK_MIN_GAMES } from '@/types'

/* ------------------------------------------------------------------ *
 * 球馆详情（规格 §I 的战绩那一半）
 *
 * 全部是从现有记录算出来的：没有「球馆」这个实体，球局上的 venue
 * 只是一段自由文本，归组靠 venueKey（去空白、转小写）。
 *
 * 所以这一屏没有地址、没有照片、没有地图 —— 那些要先给球馆建实体，
 * 而实体的形状取决于以后云端怎么存，现在拍一版本地的大概率要推翻。
 * 战绩这一半不需要等：数据全都已经在了。
 * ------------------------------------------------------------------ */

export function VenueDetail({ venue }: { venue: string }) {
  const t = useT()
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const matches = useApp((s) => s.matches)
  const avatars = useApp((s) => s.avatars)
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)

  const key = venueKey(venue)

  /** 显示名取最近一次用过的写法，和「常去的球馆」那份列表口径一致 */
  const summary = useMemo(
    () => venueSummaries(sessions, matches).find((v) => v.key === key),
    [sessions, matches, key],
  )

  const here = useMemo(
    () => sessionsAtVenue(sessions, key).slice().sort((a, b) =>
      (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt),
    ),
    [sessions, key],
  )

  const ranked = useMemo(() => {
    const ms = matchesAtVenue(sessions, matches, key)
    const ids = playerIdsAtVenue(sessions, matches, key)
    return rankPlayers(computeStats(ms, ids))
  }, [sessions, matches, key])

  const names = useMemo(() => playerMap(players), [players])
  /** 段位按所有球局的总战绩算，不只这个馆 —— 它反映的是整体水平 */
  const progressById = useMemo(() => progressByPlayer(matches), [matches])
  const avatarsById = useMemo(
    () => new Map(avatars.map((a) => [a.playerId, a])),
    [avatars],
  )

  /** 打完的场次按球局分组，列表上每条显示「打了几场」 */
  const doneBySession = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of decidedMatches(matches)) {
      map.set(m.sessionId, (map.get(m.sessionId) ?? 0) + 1)
    }
    return map
  }, [matches])

  const label = summary?.label ?? venueLabel(venue)
  const king = ranked.find((r) => r.qualified)

  if (!summary) {
    return (
      <Screen>
        <TopBar title={label} onBack={back} />
        <Body>
          <EmptyState
            icon="🏟"
            title={t('这个球馆还没有战绩', 'Nothing recorded here yet')}
            hint={t(
              '在这里打完一场并结束球局，战绩就会出现。',
              'Finish a match here and the record shows up.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  const stats = [
    {
      label: t('球局', 'Sessions'),
      value: String(summary.sessionCount),
    },
    {
      label: t('打了', 'Matches'),
      value: String(summary.matchCount),
    },
    {
      label: t('来过', 'Players'),
      value: String(summary.playerCount),
    },
  ]

  return (
    <Screen>
      <TopBar
        title={label}
        subtitle={t(
          `最近 ${formatDate(new Date(summary.lastPlayedAt).toISOString().slice(0, 10))}`,
          `Last played ${formatDate(new Date(summary.lastPlayedAt).toISOString().slice(0, 10))}`,
        )}
        onBack={back}
      />
      <Body>
        <div className="grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="border-line bg-surface rounded-xl border px-3 py-2.5"
            >
              <p className="text-ink-500 text-caption">{s.label}</p>
              <p className="tnum mt-0.5 font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {/* 场馆之王：来这个馆的人最想知道的一件事 —— 该挑战谁 */}
        {king && (
          <button
            onClick={() => push({ name: 'profile', playerId: king.playerId })}
            className="border-brand-500/40 bg-brand-50 active:bg-fill flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left"
          >
            <span className="text-2xl">👑</span>
            <span className="min-w-0 flex-1">
              <Pill tone="brand">{t('场馆之王', 'King of this court')}</Pill>
              <span className="mt-1 block truncate font-semibold">
                {names.get(king.playerId)?.name ?? t('已删除的球员', 'Deleted player')}
              </span>
            </span>
            <span className="tnum shrink-0 text-right">
              <span className="block font-bold">{percent(king.winRate)}</span>
              <span className="text-ink-500 block text-caption">
                {t(`${king.games} 场`, `${king.games} games`)}
              </span>
            </span>
          </button>
        )}

        <SectionTitle>{t('这个馆的排行榜', 'Ranked at this venue')}</SectionTitle>
        <RankTable
          ranked={ranked}
          playersById={names}
          progressById={progressById}
          avatarsById={avatarsById}
          minGames={RANK_MIN_GAMES}
          onPick={(playerId) => push({ name: 'profile', playerId })}
        />

        <SectionTitle>
          {t(`在这里打过的球局（${here.length}）`, `Sessions here (${here.length})`)}
        </SectionTitle>
        <div className="space-y-2">
          {here.map((s) => {
            const played = doneBySession.get(s.id) ?? 0
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
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {formatDate(s.date)}
                      </span>
                      {active && <Pill tone="brand">{t('进行中', 'Live')}</Pill>}
                    </p>
                    <p className="text-ink-500 mt-0.5 text-caption">
                      {t(...FORMAT_LABELS[formatOf(s)])} ·{' '}
                      {t(`${s.playerIds.length} 人`, `${s.playerIds.length} players`)} ·{' '}
                      {t(`打了 ${played} 场`, `${played} played`)}
                    </p>
                  </div>
                  <span className="text-brand-600 shrink-0 text-label">
                    {active ? t('去记分 →', 'Score →') : t('看战绩 ›', 'Results ›')}
                  </span>
                </div>
              </Card>
            )
          })}
        </div>

      </Body>
    </Screen>
  )
}
