import { PET_LEVELS, STARS_PER_TIER, type LevelInfo } from '@/lib/pet'

/* ------------------------------------------------------------------ *
 * 段位徽章
 *
 * 八段各自一个颜色，形状随段位往上逐步加东西：
 * 底盘 → 尖角 → 翅膀 → 顶冠，越高越复杂，扫一眼就分得出大小。
 * 徽章下面挂 5 颗星表示段位内进度，最高段不挂星（直接看分数）。
 *
 * 完全是自己画的几何造型，没有照搬任何游戏的美术素材。
 * ------------------------------------------------------------------ */

const shade = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => mix(c).toString(16).padStart(2, '0'))
    .join('')}`
}

function Star({ x, y, r, on, color }: { x: number; y: number; r: number; on: boolean; color: string }) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const rad = (Math.PI / 5) * i - Math.PI / 2
    const len = i % 2 === 0 ? r : r * 0.45
    return `${(x + Math.cos(rad) * len).toFixed(2)},${(y + Math.sin(rad) * len).toFixed(2)}`
  }).join(' ')
  return (
    <polygon
      points={pts}
      fill={on ? color : '#2a3040'}
      stroke={on ? shade(color, -0.35) : '#39415400'}
      strokeWidth="0.8"
    />
  )
}

export function RankMedal({
  level,
  className,
}: {
  level: LevelInfo
  className?: string
}) {
  const { index, tier, star } = level
  const base = tier.color
  const dark = shade(base, -0.4)
  const light = shade(base, 0.35)

  // 段位越高，加的装饰越多
  const hasWings = index >= 3
  const hasSpikes = index >= 1
  const hasCrest = index >= 5
  const isTop = index === PET_LEVELS.length - 1

  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={`${tier.name} ${tier.label}`}>
      <title>
        {tier.name} {tier.label}
        {star !== null ? ` ${star} 星` : ''}
      </title>

      {hasWings && (
        <>
          <path d="M28 44 q-20 -6 -25 6 q13 3 16 9 q-12 0 -16 7 q16 4 25 -4 Z" fill={light} opacity="0.9" />
          <path d="M72 44 q20 -6 25 6 q-13 3 -16 9 q12 0 16 7 q-16 4 -25 -4 Z" fill={light} opacity="0.9" />
        </>
      )}

      {hasSpikes && (
        <>
          <path d="M50 6 L58 22 L42 22 Z" fill={dark} />
          <path d="M22 30 L34 40 L24 46 Z" fill={dark} />
          <path d="M78 30 L66 40 L76 46 Z" fill={dark} />
        </>
      )}

      {hasCrest && (
        <>
          <circle cx="50" cy="14" r="6.5" fill={light} />
          <circle cx="50" cy="14" r="3" fill={dark} />
        </>
      )}

      {/* 底盘：一块盾牌 */}
      <path
        d="M50 18 L76 28 L76 54 Q76 74 50 86 Q24 74 24 54 L24 28 Z"
        fill={dark}
      />
      <path
        d="M50 24 L70 31.5 L70 54 Q70 70 50 79.5 Q30 70 30 54 L30 31.5 Z"
        fill={base}
      />

      {/* 中央菱形，顶段换成爆裂星芒 */}
      {isTop ? (
        <>
          <path
            d="M50 32 L55 48 L70 52 L55 56 L50 72 L45 56 L30 52 L45 48 Z"
            fill={light}
          />
          <circle cx="50" cy="52" r="5" fill="#fff" opacity="0.9" />
        </>
      ) : (
        <>
          <path d="M50 34 L64 52 L50 70 L36 52 Z" fill={dark} opacity="0.55" />
          <path d="M50 40 L58.5 52 L50 64 L41.5 52 Z" fill={light} />
        </>
      )}

      {/* 段位内进度：五颗星 */}
      {star !== null && (
        <g>
          {Array.from({ length: STARS_PER_TIER }, (_, i) => (
            <Star
              key={i}
              x={26 + i * 12}
              y={93}
              r={5}
              on={i < star}
              color={light}
            />
          ))}
        </g>
      )}
    </svg>
  )
}

/** 名字旁边的小徽章 + 段位名，列表里用 */
export function RankChip({ level }: { level: LevelInfo }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
      style={{
        borderColor: `${level.tier.color}66`,
        backgroundColor: `${level.tier.color}1a`,
        color: level.tier.color,
      }}
    >
      <RankMedal level={level} className="size-4" />
      {level.tier.name}
      {level.star !== null && <span className="opacity-70">{level.star}★</span>}
    </span>
  )
}
