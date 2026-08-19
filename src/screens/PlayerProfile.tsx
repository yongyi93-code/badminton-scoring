import { useMemo } from 'react'
import { petOf, playerMap, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Card,
  EmptyState,
  Pill,
  Screen,
  SectionTitle,
  TopBar,
  cx,
} from '@/components/ui'
import { Avatar, GenderTag, LevelDots } from '@/components/PlayerBits'
import {
  bestPartner,
  chronological,
  computeStats,
  decidedMatches,
  longestWinStreak,
  matchWinnerBySets,
  nemesis,
  sideOf,
} from '@/lib/ranking'
import { formatDate, percent, signed, streakLabel } from '@/lib/format'
import { scoreLine } from '@/lib/scoring'
import { PetView } from '@/components/Pet'
import { RankChip } from '@/components/RankMedal'
import { balanceOf, earnedPoints, levelOf, WIN_POINTS } from '@/lib/pet'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-850 px-3 py-2.5">
      <p className="text-xs text-ink-400">{label}</p>
      <p className="tnum mt-0.5 text-xl font-bold">{value}</p>
      {hint && <p className="text-xs text-ink-400">{hint}</p>}
    </div>
  )
}

export function PlayerProfile({ playerId }: { playerId: string }) {
  const { players, sessions, matches, pets } = useApp()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)

  const pet = petOf(pets, playerId)
  const earned = useMemo(() => earnedPoints(playerId, matches), [playerId, matches])
  const level = levelOf(earned)

  const names = useMemo(() => playerMap(players), [players])
  const player = names.get(playerId)

  const mine = useMemo(
    () => decidedMatches(matches).filter((m) => sideOf(m, playerId) !== null),
    [matches, playerId],
  )
  const stats = useMemo(() => computeStats(matches, [playerId])[0], [matches, playerId])
  const partner = useMemo(() => bestPartner(playerId, matches), [matches, playerId])
  const foe = useMemo(() => nemesis(playerId, matches), [matches, playerId])
  const best = useMemo(() => longestWinStreak(playerId, matches), [matches, playerId])

  const venueOf = (sessionId: string) => {
    const s = sessions.find((x) => x.id === sessionId)
    return s ? `${s.venue || '球局'} · ${formatDate(s.date)}` : ''
  }

  if (!player) {
    return (
      <Screen>
        <TopBar title="球员不存在" onBack={back} />
        <Body>
          <EmptyState title="找不到这个球员" />
        </Body>
      </Screen>
    )
  }

  const streak = streakLabel(stats.streak)

  return (
    <Screen>
      <TopBar title={player.name} onBack={back} />
      <Body>
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={player.name} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-xl font-bold">{player.name}</h2>
                <GenderTag gender={player.gender} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <LevelDots level={player.level} />
                <span className="text-xs text-ink-400">水平 {player.level} 星</span>
              </div>
              {streak && (
                <div className="mt-2">
                  <Pill tone={stats.streak > 0 ? 'lime' : 'neutral'}>{streak}</Pill>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* 宠物入口：养成的东西要一眼看得见，才有人想去赢球赚分 */}
        <Card onClick={() => push({ name: 'pet', playerId })}>
          <div className="flex items-center gap-4">
            <span className="size-16 shrink-0 overflow-hidden rounded-2xl bg-ink-800">
              {pet ? (
                <PetView
                  kind={pet.kind}
                  equipped={pet.equipped}
                  className="h-full w-full"
                  title={pet.name}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-2xl">
                  🥚
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              {pet ? (
                <>
                  <p className="truncate text-lg font-semibold">{pet.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <RankChip level={level} />
                    <span className="tnum text-sm text-ink-400">
                      余额 {balanceOf(pet, earned)} 分
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold">还没有宠物</p>
                  <p className="text-sm text-ink-400">
                    挑一只养起来，赢一场得 {WIN_POINTS} 分换装备
                  </p>
                </>
              )}
            </div>
            <span className="shrink-0 text-ink-400">›</span>
          </div>
        </Card>

        {stats.games === 0 ? (
          <EmptyState icon="🏸" title="还没有比赛记录" hint="打完一场就会出现在这里" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="总场数" value={String(stats.games)} hint={`${stats.wins}胜 ${stats.losses}负`} />
              <Stat label="胜率" value={percent(stats.winRate)} />
              <Stat
                label="净分差"
                value={signed(stats.diff)}
                hint={`得 ${stats.pointsFor} · 失 ${stats.pointsAgainst}`}
              />
              <Stat label="最长连胜" value={`${best} 场`} />
            </div>

            <SectionTitle>搭档与对手</SectionTitle>
            <div className="space-y-2">
              <Card>
                <p className="text-xs text-ink-400">最佳搭档</p>
                {partner ? (
                  <>
                    <p className="mt-1 text-lg font-semibold">
                      {names.get(partner.partnerId)?.name ?? '已删除的球员'}
                    </p>
                    <p className="tnum text-sm text-ink-400">
                      同队 {partner.games} 场，赢 {partner.wins} 场（
                      {percent(partner.winRate)}）
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-ink-400">
                    还没有和同一个人搭档满 3 场
                  </p>
                )}
              </Card>

              <Card>
                <p className="text-xs text-ink-400">苦主</p>
                {foe ? (
                  <>
                    <p className="mt-1 text-lg font-semibold">
                      {names.get(foe.opponentId)?.name ?? '已删除的球员'}
                    </p>
                    <p className="tnum text-sm text-ink-400">
                      交手 {foe.games} 场，输了 {foe.losses} 场
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-ink-400">还没输过球，暂无苦主</p>
                )}
              </Card>
            </div>

            <SectionTitle>最近比赛</SectionTitle>
            <div className="space-y-2">
              {chronological(mine)
                .reverse()
                .slice(0, 20)
                .map((m) => {
                  const side = sideOf(m, playerId)!
                  const won = matchWinnerBySets(m) === side
                  const mates = (side === 'A' ? m.teamA : m.teamB).filter(
                    (id) => id !== playerId,
                  )
                  const foes = side === 'A' ? m.teamB : m.teamA
                  return (
                    <Card key={m.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm">
                            {mates.length > 0 && (
                              <span className="text-ink-400">
                                搭 {mates.map((id) => names.get(id)?.name).join('/')}{' '}
                              </span>
                            )}
                            <span className="text-ink-400">对 </span>
                            <span>{foes.map((id) => names.get(id)?.name).join('/')}</span>
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-400">
                            {venueOf(m.sessionId)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span
                            className={cx(
                              'text-sm font-semibold',
                              won ? 'text-lime-glow' : 'text-ink-400',
                            )}
                          >
                            {won ? '胜' : '负'}
                          </span>
                          <p className="tnum text-xs text-ink-400">
                            {side === 'A'
                              ? scoreLine(m.games)
                              : scoreLine(
                                  m.games.map((g) => ({ ...g, a: g.b, b: g.a })),
                                )}
                          </p>
                        </div>
                      </div>
                    </Card>
                  )
                })}
            </div>
          </>
        )}

        <button
          onClick={() => push({ name: 'leaderboard' })}
          className="w-full py-4 text-center text-sm text-ink-400 underline decoration-ink-700 underline-offset-4"
        >
          看累计排行榜
        </button>
      </Body>
    </Screen>
  )
}
