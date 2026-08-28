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
  Sheet,
  TopBar,
  cx,
} from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import { RankTable } from '@/components/RankTable'
import {
  computeStats,
  matchesInPeriod,
  PERIOD_LABELS,
  rankPlayers,
  type Period,
} from '@/lib/ranking'
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

/**
 * 排序口径。
 *
 * 规格 §G 写的是「默认按 MMR」，这里默认仍然是胜率 —— 因为
 * 「场馆之王」「今晚 MVP」和首页快讯全都走同一个 rankPlayers，
 * 只改这一屏的默认值，App 里就会同时存在两个「第一名」。
 * MMR 作为可选口径给出来，真要整体改口径是另一件事，得一起改。
 */
type SortBy = 'winRate' | 'mmr' | 'games'

const SORT_LABELS: Record<SortBy, string> = {
  winRate: '胜率',
  mmr: 'MMR',
  games: '场次',
}

export function Leaderboard({ sessionId }: { sessionId?: string }) {
  const { players, sessions, matches, avatars, meId } = useApp()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const [scope, setScope] = useState<Scope>(sessionId ? 'session' : 'all')
  const [venue, setVenue] = useState<VenueFilter>(null)
  const [period, setPeriod] = useState<Period>('all')
  const [sortBy, setSortBy] = useState<SortBy>('winRate')
  const [picker, setPicker] = useState<'venue' | 'period' | 'sort' | null>(null)

  const session = sessions.find((s) => s.id === sessionId)
  const names = useMemo(() => playerMap(players), [players])
  const venues = useMemo(
    () => venueSummaries(sessions, matches),
    [sessions, matches],
  )

  /**
   * 段位一律按「所有比赛」算，不跟着场馆和周期筛选走。
   * 段位是这个人的整体水平，换个范围看名次会变、但段位不该变，
   * 否则同一个人在两个榜上显示两个段位，谁也说不清哪个才算数。
   */
  const progressById = useMemo(() => progressByPlayer(matches), [matches])

  const ranked = useMemo(() => {
    const base = (() => {
      if (scope === 'session' && session) {
        const ms = sessionMatches(matches, session.id)
        return rankPlayers(computeStats(ms, session.playerIds))
      }
      const inPeriod = matchesInPeriod(sessions, matches, period)
      if (venue !== null) {
        // 分场馆：只算这个场馆打过的比赛和在这里打过球的人
        const ms = matchesAtVenue(sessions, inPeriod, venue)
        return rankPlayers(
          computeStats(ms, playerIdsAtVenue(sessions, inPeriod, venue)),
        )
      }
      // 全部场馆累计，把所有出现过的球员都算进来，包含已移出球员库的人
      const everyone = Array.from(
        new Set([
          ...players.map((p) => p.id),
          ...inPeriod.flatMap((m) => [...m.teamA, ...m.teamB]),
        ]),
      )
      return rankPlayers(computeStats(inPeriod, everyone))
    })()

    if (sortBy === 'winRate') return base
    // 只重排上榜的那批，场次不足的仍然沉在后面
    const ok = base.filter((r) => r.qualified)
    const no = base.filter((r) => !r.qualified)
    const key = (s: (typeof base)[number]) =>
      sortBy === 'mmr' ? (progressById.get(s.playerId)?.mmr ?? 0) : s.games
    return [...ok.sort((a, b) => key(b) - key(a) || b.winRate - a.winRate), ...no]
  }, [scope, session, venue, period, sortBy, sessions, matches, players, progressById])

  /* 我在第几 —— 规格 §G 要的那条固定信息条 */
  const myRank = useMemo(() => {
    if (!meId) return null
    const ok = ranked.filter((r) => r.qualified)
    const i = ok.findIndex((r) => r.playerId === meId)
    if (i < 0) return null
    return { place: i + 1, stats: ok[i], ahead: i > 0 ? ok[i - 1] : null }
  }, [ranked, meId])

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
  const podium = ranked.filter((r) => r.qualified).slice(0, 3)

  return (
    <Screen>
      <TopBar
        title="排行榜"
        subtitle={
          scope === 'session' && session
            ? `${venueLabel(session.venue)} · ${formatDate(session.date)}`
            : venue !== null
              ? `${current?.label ?? venueLabel(venue)} · ${PERIOD_LABELS[period]}`
              : `所有球馆 · ${PERIOD_LABELS[period]}`
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

        {/*
          规格 §G：筛选收成几个可点的 Chip，不再在榜单上面先讲一段
          「按球馆分开算」。真想知道口径的人会往下翻到说明那一段。
        */}
        {scope === 'all' && (
          <div className="flex flex-wrap gap-2">
            {showVenueRow && (
              <FilterChip
                label={venue === null ? '全部场馆' : (current?.label ?? venueLabel(venue))}
                active={venue !== null}
                onClick={() => setPicker('venue')}
              />
            )}
            <FilterChip
              label={PERIOD_LABELS[period]}
              active={period !== 'all'}
              onClick={() => setPicker('period')}
            />
            <FilterChip
              label={`按${SORT_LABELS[sortBy]}排`}
              active={sortBy !== 'winRate'}
              onClick={() => setPicker('sort')}
            />
          </div>
        )}

        {/* 前三名的领奖台。高度压在 210 以内，不能把榜单挤到第二屏 */}
        {podium.length >= 3 && (
          <div className="border-line bg-surface shadow-card rounded-card flex items-end gap-2 border p-4">
            {[podium[1], podium[0], podium[2]].map((s, i) => {
              const place = [2, 1, 3][i]
              const p = names.get(s.playerId)
              return (
                <button
                  key={s.playerId}
                  onClick={() => push({ name: 'profile', playerId: s.playerId })}
                  className="min-w-0 flex-1 text-center"
                >
                  <span className={place === 1 ? 'block text-2xl' : 'block text-lg'}>
                    {place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}
                  </span>
                  <span className="mt-1 flex justify-center">
                    <Avatar
                      name={p?.name ?? '?'}
                      avatar={avatarsById.get(s.playerId)}
                      size={place === 1 ? 'lg' : undefined}
                    />
                  </span>
                  <span className="mt-1.5 block truncate text-label font-semibold">
                    {p?.name ?? '已删除'}
                  </span>
                  <span className="tnum text-ink-500 block text-caption">
                    MMR {progressById.get(s.playerId)?.mmr ?? 0}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* 我在第几，以及离前面一名还差多少 */}
        {myRank && (
          <div className="border-brand-500/40 bg-brand-50 rounded-card border px-4 py-3">
            <p className="text-label">
              你是第 <span className="tnum font-bold">{myRank.place}</span> 名 ·{' '}
              <span className="tnum">
                MMR {progressById.get(myRank.stats.playerId)?.mmr ?? 0}
              </span>
              {myRank.ahead && (
                <>
                  {' · '}
                  {/* 差距要按当前排序口径说，否则按 MMR 排却告诉你差几个胜率，对不上 */}
                  距第 {myRank.place - 1} 名还差{' '}
                  <span className="tnum">
                    {sortBy === 'mmr'
                      ? `${(progressById.get(myRank.ahead.playerId)?.mmr ?? 0) - (progressById.get(myRank.stats.playerId)?.mmr ?? 0)} MMR`
                      : sortBy === 'games'
                        ? `${myRank.ahead.games - myRank.stats.games} 场`
                        : `${percent(myRank.ahead.winRate - myRank.stats.winRate)} 胜率`}
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        {/* 谁是这个场的第一 —— 挑战者一眼就知道该找谁 */}
        {scope === 'all' && venue !== null && champion && (
          <Card className="border-brand-500/40 bg-brand-50">
            <div className="flex items-center gap-4">
              <span className="text-3xl">👑</span>
              <div className="min-w-0 flex-1">
                <Pill tone="brand">{(current?.label ?? venueLabel(venue))}之王</Pill>
                <p className="mt-1.5 truncate text-xl font-bold">
                  {names.get(champion.playerId)?.name ?? '已删除的球员'}
                </p>
                <p className="tnum text-sm text-ink-500">
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
          <p className="text-xs text-ink-500">
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
            <p className="pt-2 pb-4 text-xs leading-relaxed text-ink-500">
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

      <Sheet open={picker === 'venue'} onClose={() => setPicker(null)} title="看哪个球馆">
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          <PickRow
            label="全部场馆"
            active={venue === null}
            onClick={() => {
              setVenue(null)
              setPicker(null)
            }}
          />
          {venues.map((v) => (
            <PickRow
              key={v.key || '__unnamed__'}
              label={v.label}
              meta={`${v.matchCount} 场 · ${v.playerCount} 人`}
              active={venue === v.key}
              onClick={() => {
                setVenue(v.key)
                setPicker(null)
              }}
            />
          ))}
        </div>
      </Sheet>

      <Sheet open={picker === 'period'} onClose={() => setPicker(null)} title="看哪一段时间">
        <div className="space-y-2">
          {(['all', 'quarter', 'month'] as Period[]).map((p) => (
            <PickRow
              key={p}
              label={PERIOD_LABELS[p]}
              active={period === p}
              onClick={() => {
                setPeriod(p)
                setPicker(null)
              }}
            />
          ))}
        </div>
      </Sheet>

      <Sheet open={picker === 'sort'} onClose={() => setPicker(null)} title="按什么排">
        <div className="space-y-2">
          <PickRow
            label="胜率"
            meta="同胜率看净分差，再看场数"
            active={sortBy === 'winRate'}
            onClick={() => {
              setSortBy('winRate')
              setPicker(null)
            }}
          />
          <PickRow
            label="MMR"
            meta="整体水平，不随场馆和周期变"
            active={sortBy === 'mmr'}
            onClick={() => {
              setSortBy('mmr')
              setPicker(null)
            }}
          />
          <PickRow
            label="场次"
            meta="谁来得最勤"
            active={sortBy === 'games'}
            onClick={() => {
              setSortBy('games')
              setPicker(null)
            }}
          />
        </div>
      </Sheet>
    </Screen>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-label whitespace-nowrap transition-colors',
        active
          ? 'border-brand-600 bg-brand-100 text-brand-600'
          : 'border-line bg-surface text-ink-700 active:bg-fill',
      )}
    >
      {label}
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  )
}

function PickRow({
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
        'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left',
        active
          ? 'border-brand-500 bg-brand-100'
          : 'border-line bg-surface active:bg-fill',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {meta && <span className="text-ink-500 mt-0.5 block text-caption">{meta}</span>}
      </span>
      {active && <Pill tone="brand">当前</Pill>}
    </button>
  )
}
