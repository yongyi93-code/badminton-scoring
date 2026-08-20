import { useMemo, useState } from 'react'
import { playerMap, sessionMatches, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Card,
  EmptyState,
  Pill,
  Screen,
  Segmented,
  TopBar,
  cx,
} from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import { RankTable } from '@/components/RankTable'
import { computeStats, rankPlayers } from '@/lib/ranking'
import {
  matchesAtVenue,
  playerIdsAtVenue,
  venueLabel,
  venueSummaries,
} from '@/lib/venues'
import { formatDate, percent, signed } from '@/lib/format'
import {
  LOSS_POINTS,
  progressByPlayer,
  UPSET_MULTIPLIER,
  WIN_POINTS,
} from '@/lib/avatar'
import { RANK_MIN_GAMES } from '@/types'

type Scope = 'session' | 'all'

/** '' 是「没填球馆」那一档，所以用 null 表示「全部场馆」 */
type VenueFilter = string | null

export function Leaderboard({ sessionId }: { sessionId?: string }) {
  const { players, sessions, matches, avatars } = useApp()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const [scope, setScope] = useState<Scope>(sessionId ? 'session' : 'all')
  const [venue, setVenue] = useState<VenueFilter>(null)

  const session = sessions.find((s) => s.id === sessionId)
  const names = useMemo(() => playerMap(players), [players])
  const venues = useMemo(
    () => venueSummaries(sessions, matches),
    [sessions, matches],
  )

  const ranked = useMemo(() => {
    if (scope === 'session' && session) {
      const ms = sessionMatches(matches, session.id)
      return rankPlayers(computeStats(ms, session.playerIds))
    }
    if (venue !== null) {
      // 分场馆：只算这个场馆打过的比赛和在这里打过球的人
      return rankPlayers(
        computeStats(
          matchesAtVenue(sessions, matches, venue),
          playerIdsAtVenue(sessions, matches, venue),
        ),
      )
    }
    // 全部场馆累计，把所有出现过的球员都算进来，包含已移出球员库的人
    const everyone = Array.from(
      new Set([
        ...players.map((p) => p.id),
        ...matches.flatMap((m) => [...m.teamA, ...m.teamB]),
      ]),
    )
    return rankPlayers(computeStats(matches, everyone))
  }, [scope, session, venue, sessions, matches, players])

  /**
   * 段位一律按「所有比赛」算，不跟着场馆筛选走。
   * 段位是这个人的整体水平，换个场馆看名次会变、但段位不该变，
   * 否则同一个人在两个榜上显示两个段位，谁也说不清哪个才算数。
   */
  const progressById = useMemo(() => progressByPlayer(matches), [matches])

  /** 头像用角色，没建角色的人会自动退回名字色块 */
  const avatarsById = useMemo(
    () => new Map(avatars.map((a) => [a.playerId, a])),
    [avatars],
  )

  const champion = ranked.find((r) => r.qualified) ?? null
  /**
   * 只要有打过球的场馆就把这排显示出来。
   * 原来限定「超过 1 个场馆」才显示，结果一直在同一个球馆打的人
   * 整排按钮和「本馆之王」都看不到，会以为压根没有分场馆这回事。
   */
  const showVenueRow = scope === 'all' && venues.length > 0
  const current = venues.find((v) => v.key === venue)

  return (
    <Screen>
      <TopBar
        title="排行榜"
        subtitle={
          scope === 'session' && session
            ? `${venueLabel(session.venue)} · ${formatDate(session.date)}`
            : venue !== null
              ? `${(current?.label ?? venueLabel(venue))} · 累计`
              : '所有球局累计'
        }
        onBack={back}
      />
      <Body>
        {session && (
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'session', label: '今晚' },
              { value: 'all', label: '累计' },
            ]}
          />
        )}

        {showVenueRow && (
          <div className="space-y-2">
            <p className="text-xs text-ink-400">
              按球馆看排名（点一下切换，各馆分开算）
            </p>
            <div className="-mx-4 overflow-x-auto px-4">
              <div className="flex w-max gap-2">
                <VenueChip
                  label="全部场馆"
                  active={venue === null}
                  onClick={() => setVenue(null)}
                />
                {venues.map((v) => (
                  <VenueChip
                    key={v.key || '__unnamed__'}
                    label={v.label}
                    meta={`${v.matchCount} 场`}
                    active={venue === v.key}
                    onClick={() => setVenue(v.key)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 谁是这个场的第一 —— 挑战者一眼就知道该找谁 */}
        {scope === 'all' && venue !== null && champion && (
          <Card className="border-lime-glow/40 bg-lime-glow/5">
            <div className="flex items-center gap-4">
              <span className="text-3xl">👑</span>
              <div className="min-w-0 flex-1">
                <Pill tone="lime">{(current?.label ?? venueLabel(venue))}之王</Pill>
                <p className="mt-1.5 truncate text-xl font-bold">
                  {names.get(champion.playerId)?.name ?? '已删除的球员'}
                </p>
                <p className="tnum text-sm text-ink-400">
                  在这里打了 {champion.games} 场 · 胜率{' '}
                  {percent(champion.winRate)} · 净分 {signed(champion.diff)}
                </p>
              </div>
              <Avatar
                name={names.get(champion.playerId)?.name ?? '?'}
                avatar={avatarsById.get(champion.playerId)}
                size="lg"
              />
            </div>
          </Card>
        )}

        {current && (
          <p className="text-xs text-ink-400">
            {current.sessionCount} 次球局 · {current.matchCount} 场 ·{' '}
            {current.playerCount} 人在这里打过
          </p>
        )}

        {ranked.length === 0 ? (
          <EmptyState
            icon="📊"
            title={
              venue !== null ? '这个场馆还没有战绩' : '还没有打完的比赛'
            }
            hint={`排名按胜率排，同胜率看净分差；至少 ${RANK_MIN_GAMES} 场才上榜`}
          />
        ) : (
          <>
            <RankTable
              ranked={ranked}
              playersById={names}
              progressById={progressById}
              avatarsById={avatarsById}
              minGames={RANK_MIN_GAMES}
              onPick={(playerId) => push({ name: 'profile', playerId })}
            />
            <p className="pt-2 pb-4 text-xs leading-relaxed text-ink-400">
              排名口径：胜率 ↓ → 净分差 ↓ → 场数 ↓。
              净分差 = 本人所在队伍的总得分 − 总失分，
              双打里搭档的表现也会算进你的净分差。
              <br />
              段位看 MMR：赢一场 +{WIN_POINTS}，输一场 −{LOSS_POINTS}，但扣到 0 就打住，不会变负。
              赢了 MMR 比自己高的一队算爆冷，那一场拿 {WIN_POINTS * UPSET_MULTIPLIER} 分。
              算的是跨场馆的整体水平，不会因为切换场馆而变。
              {scope === 'all' && venue !== null && (
                <>
                  <br />
                  这里只统计在{(current?.label ?? venueLabel(venue))}打的比赛，换个场馆名次会不一样。
                </>
              )}
            </p>
          </>
        )}
      </Body>
    </Screen>
  )
}

function VenueChip({
  label,
  meta,
  active,
  onClick,
}: {
  label: string
  meta?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'shrink-0 rounded-full border px-3.5 py-2 text-sm whitespace-nowrap transition-colors',
        active
          ? 'border-lime-glow bg-lime-glow/15 text-lime-glow'
          : 'border-ink-700 bg-ink-850 text-ink-300 active:bg-ink-800',
      )}
    >
      {label}
      {meta && (
        <span className={cx('ml-1.5 text-xs', active ? 'text-lime-glow/70' : 'text-ink-500')}>
          {meta}
        </span>
      )}
    </button>
  )
}
