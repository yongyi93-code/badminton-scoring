import type { Player, PlayerStats } from '@/types'
import { Avatar, TitleTag } from './PlayerBits'
import { Pill, cx } from './ui'
import { percent, signed, streakLabel } from '@/lib/format'
import { RankMedal } from './RankMedal'
import type { AvatarProfile, LevelInfo, Progress } from '@/lib/avatar'

const medal = (rank: number) =>
  rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null

export function RankRow({
  rank,
  stats,
  player,
  level,
  mmr,
  avatar,
  onClick,
  highlight,
}: {
  rank: number
  stats: PlayerStats
  player: Player | undefined
  /** 建过角色就用角色当头像，没建才退回字母色块 */
  avatar?: AvatarProfile
  /** 段位。缺省就不显示这一列，今晚排名之类的地方可以不传 */
  level?: LevelInfo
  /** MMR 数值，跟在段位名后面 —— 打 Dota 的人比的就是这个数 */
  mmr?: number
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
          ? 'border-brand-500 bg-brand-100'
          : 'border-line bg-surface active:bg-fill',
        !stats.qualified && 'opacity-70',
      )}
    >
      <span className="tnum w-7 shrink-0 text-center text-sm font-semibold text-ink-500">
        {rank === 0 ? '–' : (medal(rank) ?? rank)}
      </span>
      <Avatar name={player?.name ?? '?'} avatar={avatar} />
      {/* 段位单独占一列固定宽度，一排下来才对得齐、好互相比 */}
      {level && (
        <span className="flex w-7 shrink-0 flex-col items-center">
          <RankMedal level={level} className="size-7" compact />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{player?.name ?? '已删除的球员'}</span>
          <TitleTag avatar={avatar} />
          {streak && (
            <Pill tone={stats.streak > 0 ? 'success' : 'danger'}>{streak}</Pill>
          )}
        </span>
        {level && (
          <span className="flex items-baseline gap-1.5 text-xs">
            <span className="font-semibold" style={{ color: level.tier.color }}>
              {level.display}
              {level.star !== null && ` ${level.star}★`}
            </span>
            {mmr !== undefined && (
              <span className="tnum text-ink-500">MMR {mmr}</span>
            )}
          </span>
        )}
        <span className="tnum mt-0.5 block text-xs text-ink-500">
          {stats.wins}胜{stats.losses}负 · 净分 {signed(stats.diff)}
          {!stats.qualified && ' · 场次不足'}
        </span>
      </span>
      <span className="tnum shrink-0 text-right">
        <span className="block text-lg font-bold">{percent(stats.winRate)}</span>
        <span className="block text-xs text-ink-500">{stats.games} 场</span>
      </span>
    </button>
  )
}

export function RankTable({
  ranked,
  playersById,
  progressById,
  avatarsById,
  onPick,
  minGames,
}: {
  ranked: PlayerStats[]
  playersById: Map<string, Player>
  /** 每个球员的角色，用来当头像 */
  avatarsById?: Map<string, AvatarProfile>
  /** 每个球员的段位与 MMR，不传就不显示段位列 */
  progressById?: Map<string, Progress>
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
          level={progressById?.get(s.playerId)?.level}
          mmr={progressById?.get(s.playerId)?.mmr}
          avatar={avatarsById?.get(s.playerId)}
          onClick={onPick ? () => onPick(s.playerId) : undefined}
          highlight={i === 0}
        />
      ))}

      {rest.length > 0 && (
        <>
          <p className="pt-2 text-xs text-ink-500">
            以下球员不足 {minGames} 场，不参与排名
          </p>
          {rest.map((s) => (
            <RankRow
              key={s.playerId}
              rank={0}
              stats={s}
              player={playersById.get(s.playerId)}
          level={progressById?.get(s.playerId)?.level}
          mmr={progressById?.get(s.playerId)?.mmr}
          avatar={avatarsById?.get(s.playerId)}
              onClick={onPick ? () => onPick(s.playerId) : undefined}
            />
          ))}
        </>
      )}
    </div>
  )
}
