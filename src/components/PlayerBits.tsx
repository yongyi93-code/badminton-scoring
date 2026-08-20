import type { ReactNode } from 'react'
import type { Gender, Level, Player } from '@/types'
import type { AvatarProfile, LevelInfo } from '@/lib/avatar'
import { AvatarFace } from './Avatar'
import { RankChip } from './RankMedal'
import { cx } from './ui'

const isCJK = (s: string) => /[㐀-鿿]/.test(s)

/** 头像里显示的字：中文名取名字部分，英文名取首字母 */
function initials(name: string): string {
  const n = name.trim()
  if (!n) return '?'
  if (isCJK(n)) return n.length >= 3 ? n.slice(1, 3) : n
  return n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** 由名字稳定推出一个色相，让同一个人每次颜色都一样 */
function hueOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/**
 * 头像。建了角色就画角色，没建才退回名字首字的色块。
 *
 * 做成同一个组件而不是两个，是因为头像出现在十来处（排行榜、场地看板、
 * 等待队列、散场结算……）—— 分成两个的话每处都要自己判断该用哪个，
 * 迟早漏掉几处，就会出现「排行榜有角色、看板还是字母」这种不一致。
 *
 * 角色的取景往上偏：100×100 的立绘缩成一个小圆圈时，
 * 整个人只有几像素高，看不清是谁；裁到头和肩才认得出来。
 */
export function Avatar({
  name,
  avatar,
  size = 'md',
  className,
}: {
  name: string
  avatar?: AvatarProfile
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    sm: 'size-7 text-[11px]',
    md: 'size-10 text-sm',
    lg: 'size-16 text-xl',
  }

  if (avatar) {
    return (
      <span
        className={cx(
          'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-800',
          sizes[size],
          className,
        )}
      >
        <AvatarFace
          sex={avatar.sex}
          skin={avatar.skin}
          equipped={avatar.equipped}
          className="h-full w-full"
          title={name}
        />
      </span>
    )
  }

  const hue = hueOf(name)
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        sizes[size],
        className,
      )}
      style={{
        backgroundColor: `oklch(0.42 0.09 ${hue})`,
        color: `oklch(0.94 0.06 ${hue})`,
      }}
    >
      {initials(name)}
    </span>
  )
}

export function LevelDots({ level }: { level: Level }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`水平 ${level} 星`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cx(
            'size-1.5 rounded-full',
            i <= level ? 'bg-lime-glow' : 'bg-ink-700',
          )}
        />
      ))}
    </span>
  )
}

export function GenderTag({ gender }: { gender: Gender }) {
  if (gender === '-') return null
  return (
    <span
      className={cx(
        'text-xs font-medium',
        gender === 'M' ? 'text-sky-400' : 'text-pink-400',
      )}
    >
      {gender === 'M' ? '男' : '女'}
    </span>
  )
}

/**
 * 球员行。`right` 放在主按钮外面，这样右侧可以再放一个独立按钮
 * （HTML 不允许按钮套按钮）。
 */
export function PlayerRow({
  player,
  right,
  onClick,
  selected,
  meta,
  level,
  avatar,
}: {
  player: Player
  /** 角色，用来当头像 */
  avatar?: AvatarProfile
  right?: ReactNode
  onClick?: () => void
  selected?: boolean
  meta?: ReactNode
  /** 段位，不传就只显示 meta —— 取代了原来那排水平星星 */
  level?: LevelInfo
}) {
  const inner = (
    <>
      <Avatar name={player.name} avatar={avatar} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{player.name}</span>
          <GenderTag gender={player.gender} />
        </span>
        <span className="mt-1 flex items-center gap-2">
          {level && <RankChip level={level} />}
          {meta && <span className="text-xs text-ink-400">{meta}</span>}
        </span>
      </span>
    </>
  )

  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-xl border pr-2 transition-colors',
        selected
          ? 'border-lime-glow/60 bg-lime-glow/10'
          : 'border-ink-700/70 bg-ink-850',
      )}
    >
      {onClick ? (
        <button
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-l-xl px-3 py-2.5 text-left active:bg-ink-800/60"
        >
          {inner}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
          {inner}
        </div>
      )}
      {right}
    </div>
  )
}

/** 一队的名字，例如「阿明 / 小美」 */
export function TeamNames({
  ids,
  names,
  className,
}: {
  ids: string[]
  names: Map<string, string>
  className?: string
}) {
  return (
    <span className={cx('truncate', className)}>
      {ids.map((id) => names.get(id) ?? '?').join(' / ')}
    </span>
  )
}
