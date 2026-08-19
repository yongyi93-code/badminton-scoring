import type { Player, PlayerStats } from '@/types'
import { Avatar } from './PlayerBits'
import { Pill, cx } from './ui'
import { percent, signed, streakLabel } from '@/lib/format'
import { RankMedal } from './RankMedal'
import type { LevelInfo } from '@/lib/pet'

const medal = (rank: number) =>
  rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null

export function RankRow({
  rank,
  stats,
  player,
  level,
  onClick,
  highlight,
}: {
  rank: number
  stats: PlayerStats
  player: Player | undefined
  /** 段位。缺省就不显示这一列，今晚排名之类的地方可以不传 */
  level?: LevelInfo
  onClick?: () => void
  highlight?: boolean
}) {
  const streak = streakLabel(stats.streak)
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
        highlight
          ? 'border-lime-glow/50 bg-lime-glow/10'
          : 'border-ink-700/70 bg-ink-850 active:bg-ink-800',
        !stats.qualified && 'opacity-70',
      )}
    >
      <span className="tnum w-7 shrink-0 text-center text-sm font-semibold text-ink-400">
        {rank === 0 ? '–' : (medal(rank) ?? rank)}
      </span>
      <Avatar name={player?.name ?? '?'} />
      {/* 段位单独占一列固定宽度，一排下来才对得齐、好互相比 */}
      {level && (
        <span className="flex w-7 shrink-0 flex-col items-center">
          <RankMedal level={level} className="size-7" compact />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{player?.name ?? '已删除的球员'}</span>
          {streak && (
            <Pill tone={stats.streak > 0 ? 'lime' : 'neutral'}>{streak}</Pill>
          )}
        </span>
        {level && (
          <span
            className="block text-xs font-semibold"
            style={{ color: level.tier.color }}
          >
            {level.display}
            {level.star !== null && ` ${level.star}★`}
          </span>
        )}
        <span className="tnum mt-0.5 block text-xs text-ink-400">
          {stats.wins}胜{stats.losses}负 · 净分 {signed(stats.diff)}
          {!stats.qualified && ' · 场次不足'}
        </span>
      </span>
      <span className="tnum shrink-0 text-right">
        <span className="block text-lg font-bold">{percent(stats.winRate)}</span>
        <span className="block text-xs text-ink-400">{stats.games} 场</span>
      </span>
    </button>
  )
}

export function RankTable({
  ranked,
  playersById,
  levelsById,
  onPick,
  minGames,
}: {
  ranked: PlayerStats[]
  playersById: Map<string, Player>
  /** 每个球员的段位，不传就不显示段位列 */
  levelsById?: Map<string, LevelInfo>
  onPick?: (playerId: string) => void
  minGames: number
}) {
  const qualified = ranked.filter((r) => r.qualified)
  const rest = ranked.filter((r) => !r.qualified)

  return (
    <div className="space-y-2">
      {qualified.map((s, i) => (
        <RankRow
          key={s.playerId}
          rank={i + 1}
          stats={s}
          player={playersById.get(s.playerId)}
          level={levelsById?.get(s.playerId)}
          onClick={onPick ? () => onPick(s.playerId) : undefined}
          highlight={i === 0}
        />
      ))}

      {rest.length > 0 && (
        <>
          <p className="pt-2 text-xs text-ink-400">
            以下球员不足 {minGames} 场，不参与排名
          </p>
          {rest.map((s) => (
            <RankRow
              key={s.playerId}
              rank={0}
              stats={s}
              player={playersById.get(s.playerId)}
          level={levelsById?.get(s.playerId)}
              onClick={onPick ? () => onPick(s.playerId) : undefined}
            />
          ))}
        </>
      )}
    </div>
  )
}
