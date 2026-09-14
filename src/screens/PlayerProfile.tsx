import { useT } from '@/lib/i18n'
import { useMemo } from 'react'
import { avatarOf, playerMap, useApp } from '@/store/useApp'
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
import { Avatar, GenderTag } from '@/components/PlayerBits'
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
import { AvatarView } from '@/components/Avatar'
import { stageOf } from '@/lib/avatarArt'
import { RankChip } from '@/components/RankMedal'
import { MmrTrend } from '@/components/MmrTrend'
import { balanceOf, mmrTimeline, progressOf, WIN_COINS } from '@/lib/avatar'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="tnum mt-0.5 text-xl font-bold">{value}</p>
      {hint && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  )
}

/** 抬头里那三个大数。和下面那组 Stat 不一样：那组是卡片，这组是裸的 */
function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="tnum text-brand-600 text-h2">{value}</p>
      <p className="text-ink-500 mt-0.5 text-caption">{label}</p>
    </div>
  )
}

export function PlayerProfile({ playerId }: { playerId: string }) {
  const t = useT()
  const { players, sessions, matches, avatars } = useApp()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)

  const avatar = avatarOf(avatars, playerId)
  const avatarProgress = useMemo(
    () => progressOf(playerId, matches),
    [playerId, matches],
  )
  const level = avatarProgress.level

  const names = useMemo(() => playerMap(players), [players])
  const player = names.get(playerId)

  const mine = useMemo(
    () => decidedMatches(matches).filter((m) => sideOf(m, playerId) !== null),
    [matches, playerId],
  )
  const stats = useMemo(() => computeStats(matches, [playerId])[0], [matches, playerId])
  const timeline = useMemo(() => mmrTimeline(matches, playerId), [matches, playerId])
  const partner = useMemo(() => bestPartner(playerId, matches), [matches, playerId])
  const foe = useMemo(() => nemesis(playerId, matches), [matches, playerId])
  const best = useMemo(() => longestWinStreak(playerId, matches), [matches, playerId])

  const venueOf = (sessionId: string) => {
    const s = sessions.find((x) => x.id === sessionId)
    return s ? `${s.venue || t('球局', 'Session')} · ${formatDate(s.date)}` : ''
  }

  if (!player) {
    return (
      <Screen>
        <TopBar title={t('球员不存在', 'Player not found')} onBack={back} />
        <Body>
          <EmptyState title={t('找不到这个球员', 'No such player')} />
        </Body>
      </Screen>
    )
  }

  const streak = streakLabel(stats.streak)

  return (
    <Screen>
      <TopBar title={player.name} onBack={back} />
      <Body>
        {/*
          抬头这一块：人在右边，名字和段位在左边。
          放立绘而不是那个字母圆圈，是因为这一屏是「这个人是谁」——
          他自己攒出来的那一身行头就是答案的一半，缩成 40px 的圆圈就没了。
          没有角色的人退回字母圆圈，不留一个空框。
        */}
        <Card className="bg-brand-50 border-brand-500/30 relative overflow-hidden">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-h2">{player.name}</h2>
                <GenderTag gender={player.gender} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <RankChip level={level} />
                <span className="tnum text-ink-500 text-caption">
                  MMR {avatarProgress.mmr}
                </span>
              </div>
              {streak && (
                <div className="mt-2">
                  <Pill tone={stats.streak > 0 ? 'success' : 'danger'}>{streak}</Pill>
                </div>
              )}
            </div>
            <span className="size-24 shrink-0">
              {avatar ? (
                <AvatarView
                  sex={avatar.sex}
                  skin={avatar.skin}
                  equipped={avatar.equipped}
                  stage={stageOf(level)}
                  className="h-full w-full"
                  title={player.name}
                />
              ) : (
                <Avatar name={player.name} avatar={avatar} size="lg" className="m-auto" />
              )}
            </span>
          </div>

          {/*
            三个数直接摆在抬头里，不另起一张卡。
            「打了多少、赢了多少、几成」是看一个人时最先想知道的三件事，
            让它们和名字待在一起，比往下翻一屏再遇到强得多。
          */}
          <div className="border-brand-500/20 mt-4 grid grid-cols-3 border-t pt-3">
            <HeroStat value={String(stats.games)} label={t('比赛', 'Matches')} />
            <HeroStat value={String(stats.wins)} label={t('胜场', 'Wins')} />
            <HeroStat value={percent(stats.winRate)} label={t('胜率', 'Win rate')} />
          </div>
        </Card>

        {/* MMR 走势：段位是个结果，这条线才看得出是在往上还是往下 */}
        <Card>
          <p className="text-ink-500 mb-2 text-label">{t('MMR 走势', 'MMR trend')}</p>
          <MmrTrend points={timeline} />
        </Card>

        {/* 角色入口：养成的东西要一眼看得见，才有人想去赢球赚金币 */}
        <Card onClick={() => push({ name: 'avatar', playerId })}>
          <div className="flex items-center gap-4">
            <span className="size-16 shrink-0 overflow-hidden rounded-2xl bg-fill">
              {avatar ? (
                <AvatarView
                  sex={avatar.sex}
                  skin={avatar.skin}
                  equipped={avatar.equipped}
                  stage={stageOf(level)}
                  className="h-full w-full"
                  title={player.name}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-2xl">
                  👤
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              {avatar ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <RankChip level={level} />
                  <span className="tnum text-sm text-ink-500">
                    MMR {avatarProgress.mmr} · {t('金币', 'Coins')}{' '}
                    {balanceOf(avatar, avatarProgress.coins)}
                  </span>
                </div>
              ) : (
                <>
                  <p className="text-lg font-semibold">{t('还没有角色', 'No character yet')}</p>
                  <p className="text-sm text-ink-500">
                    {t(
                    `选个角色，赢一场得 ${WIN_COINS} 金币买装备`,
                    `Pick a character — every win earns ${WIN_COINS} coins for gear`,
                  )}
                  </p>
                </>
              )}
            </div>
            <span className="shrink-0 text-ink-500">›</span>
          </div>
        </Card>

        {stats.games === 0 ? (
          <EmptyState
            icon="🏸"
            title={t('还没有比赛记录', 'No matches yet')}
            hint={t('打完一场就会出现在这里', 'Play one and it shows up here')}
          />
        ) : (
          <>
            {/*
              总场数和胜率已经在抬头里了，这里不再重复 ——
              同一个数字在一屏里出现两次，人会以为它们是两件事。
            */}
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label={t('净分差', 'Point diff')}
                value={signed(stats.diff)}
                hint={t(`得 ${stats.pointsFor} · 失 ${stats.pointsAgainst}`, `for ${stats.pointsFor} · against ${stats.pointsAgainst}`)}
              />
              <Stat label={t('最长连胜', 'Best streak')} value={t(`${best} 场`, `${best} wins`)} />
            </div>

            <SectionTitle>{t('搭档与对手', 'Partners and rivals')}</SectionTitle>
            <div className="space-y-2">
              <Card>
                <p className="text-xs text-ink-500">{t('最佳搭档', 'Best partner')}</p>
                {partner ? (
                  <>
                    <p className="mt-1 text-lg font-semibold">
                      {names.get(partner.partnerId)?.name ?? t('已删除的球员', 'Deleted player')}
                    </p>
                    <p className="tnum text-sm text-ink-500">
                      {t(
                  `同队 ${partner.games} 场，赢 ${partner.wins} 场（`,
                  `${partner.games} together, ${partner.wins} won (`,
                )}
                      {percent(partner.winRate)}）
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-ink-500">
                    {t('还没有和同一个人搭档满 3 场', 'No partner has reached 3 matches with you yet')}
                  </p>
                )}
              </Card>

              <Card>
                <p className="text-xs text-ink-500">{t('苦主', 'Nemesis')}</p>
                {foe ? (
                  <>
                    <p className="mt-1 text-lg font-semibold">
                      {names.get(foe.opponentId)?.name ?? t('已删除的球员', 'Deleted player')}
                    </p>
                    <p className="tnum text-sm text-ink-500">
                      {t(
                  `交手 ${foe.games} 场，输了 ${foe.losses} 场`,
                  `${foe.games} meetings, ${foe.losses} lost`,
                )}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-ink-500">{t('还没输过球，暂无苦主', 'Unbeaten so far — no nemesis')}</p>
                )}
              </Card>
            </div>

            <SectionTitle>{t('最近比赛', 'Recent matches')}</SectionTitle>
            <div className="space-y-2">
              {chronological(mine)
                .reverse()
                .slice(0, 20)
                .map((m) => {
                  const side = sideOf(m, playerId)!
                  const won = matchWinnerBySets(m) === side
                  /*
                    两边都完整列出来，包括我自己 —— 原来写成
                    「搭 X 对 Y/Z」，一行读下来要自己在脑子里拆成两队。
                    左右两个框摆开，谁跟谁一队一眼就看到，赢的那边高亮。
                  */
                  const ours = side === 'A' ? m.teamA : m.teamB
                  const foes = side === 'A' ? m.teamB : m.teamA
                  const teamBox = (ids: string[], isWinner: boolean) => (
                    <div
                      className={cx(
                        'min-w-0 flex-1 rounded-lg border px-2 py-1.5',
                        isWinner
                          ? 'border-brand-500 bg-brand-100'
                          : 'border-line bg-fill/50',
                      )}
                    >
                      {ids.map((id) => (
                        <p
                          key={id}
                          className={cx(
                            'truncate text-sm leading-snug',
                            id === playerId ? 'font-semibold' : 'text-ink-700',
                          )}
                        >
                          {names.get(id)?.name ?? t('已删除', 'Deleted')}
                        </p>
                      ))}
                    </div>
                  )
                  return (
                    <Card key={m.id}>
                      <div className="flex items-center gap-2">
                        {teamBox(ours, won)}
                        <span className="shrink-0 text-caption font-semibold text-ink-500">
                          {t('对', 'VS')}
                        </span>
                        {teamBox(foes, !won)}
                        <div className="w-12 shrink-0 text-right">
                          <span
                            className={cx(
                              'text-sm font-semibold',
                              won ? 'text-brand-600' : 'text-ink-500',
                            )}
                          >
                            {won ? t('胜', 'W') : t('负', 'L')}
                          </span>
                          <p className="tnum text-xs text-ink-500">
                            {side === 'A'
                              ? scoreLine(m.games)
                              : scoreLine(
                                  m.games.map((g) => ({ ...g, a: g.b, b: g.a })),
                                )}
                          </p>
                        </div>
                      </div>
                      <p className="mt-1.5 truncate text-center text-xs text-ink-500">
                        {venueOf(m.sessionId)}
                      </p>
                    </Card>
                  )
                })}
            </div>
          </>
        )}

      </Body>
    </Screen>
  )
}
