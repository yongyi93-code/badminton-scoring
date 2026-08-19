import type { ReactNode } from 'react'
import { itemById, type PetKind, type PetProfile, type PetSlot } from '@/lib/pet'

/* ------------------------------------------------------------------ *
 * 宠物形象
 *
 * 全部用 SVG 手绘，装在 100×100 的 viewBox 里，放大缩小都不糊，
 * 也不用打包任何图片资源 —— 离线可用是这个 App 的底线。
 *
 * 分层顺序：背景 → 身体 → 脖子 → 眼部 → 头顶 → 手持。
 * 每种宠物给出各槽位的锚点，装备只画一份、按锚点变换过去，
 * 这样加一件新装备不用为狗猫鱼各画一遍。
 * ------------------------------------------------------------------ */

type Palette = { base: string; dark: string; light: string }

const PALETTES: Record<PetKind, Palette> = {
  dog: { base: '#c98b4b', dark: '#a86d33', light: '#f3ddc0' },
  cat: { base: '#9ba6b8', dark: '#7a8698', light: '#e8edf3' },
  fish: { base: '#f4794f', dark: '#d55b34', light: '#ffd9c9' },
}

const INK = '#2b2f3a'

/** 一个槽位的落点：位置、缩放、旋转 */
type Anchor = { x: number; y: number; s?: number; r?: number }

/**
 * 锚点含义：
 *   hat  头顶最高点，帽子从这里往上长、头带往下压
 *   face 两眼中点
 *   neck 头和身体的交界
 *   item 手持物件的中心
 */
const ANCHORS: Record<PetKind, Record<Exclude<PetSlot, 'background'>, Anchor>> = {
  dog: {
    hat: { x: 50, y: 25 },
    face: { x: 50, y: 41 },
    neck: { x: 50, y: 76 },
    item: { x: 80, y: 79 },
  },
  cat: {
    hat: { x: 50, y: 25 },
    face: { x: 50, y: 46 },
    neck: { x: 50, y: 76 },
    item: { x: 80, y: 79 },
  },
  fish: {
    hat: { x: 31, y: 30, s: 0.82, r: -12 },
    face: { x: 27, y: 45, s: 0.55 },
    neck: { x: 36, y: 64, s: 0.78, r: -8 },
    item: { x: 82, y: 82, s: 0.95 },
  },
}

const stroke = (color = INK, width = 1.6) => ({
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
})

/* ------------------------------------------------------------------ *
 * 三种宠物
 * ------------------------------------------------------------------ */

function Eye({ x, y, rx, ry }: { x: number; y: number; rx: number; ry: number }) {
  return (
    <>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={INK} />
      <circle cx={x + rx * 0.32} cy={y - ry * 0.38} r={rx * 0.34} fill="#fff" />
    </>
  )
}

function Dog({ p }: { p: Palette }) {
  return (
    <>
      <ellipse cx="50" cy="90" rx="21" ry="15" fill={p.dark} />
      <ellipse cx="23" cy="48" rx="9" ry="17" transform="rotate(-14 23 48)" fill={p.dark} />
      <ellipse cx="77" cy="48" rx="9" ry="17" transform="rotate(14 77 48)" fill={p.dark} />
      <ellipse cx="50" cy="48" rx="28" ry="25" fill={p.base} />
      <ellipse cx="50" cy="60" rx="15" ry="11" fill={p.light} />
      <ellipse cx="50" cy="54" rx="5" ry="3.8" fill={INK} />
      <path d="M50 58 v3.5" {...stroke()} />
      <path d="M50 61.5 q-5 4 -9 0.5" {...stroke()} />
      <path d="M50 61.5 q5 4 9 0.5" {...stroke()} />
      <Eye x={39} y={41} rx={4.6} ry={4.6} />
      <Eye x={61} y={41} rx={4.6} ry={4.6} />
    </>
  )
}

function Cat({ p }: { p: Palette }) {
  return (
    <>
      <ellipse cx="50" cy="90" rx="20" ry="14" fill={p.dark} />
      <path d="M27 33 L30 11 L48 25 Z" fill={p.base} />
      <path d="M73 33 L70 11 L52 25 Z" fill={p.base} />
      <path d="M32 30 L34 18 L43 25 Z" fill="#f2b8c6" />
      <path d="M68 30 L66 18 L57 25 Z" fill="#f2b8c6" />
      <ellipse cx="50" cy="50" rx="27" ry="24" fill={p.base} />
      <Eye x={39} y={46} rx={5.2} ry={6.2} />
      <Eye x={61} y={46} rx={5.2} ry={6.2} />
      <path d="M46.5 56.5 L53.5 56.5 L50 60 Z" fill="#f2919f" />
      <path d="M50 60 v2" {...stroke()} />
      <path d="M50 62 q-5 4.5 -9 1" {...stroke()} />
      <path d="M50 62 q5 4.5 9 1" {...stroke()} />
      <path d="M32 55 L17 51" {...stroke(p.dark, 1.4)} />
      <path d="M32 59 L17 60" {...stroke(p.dark, 1.4)} />
      <path d="M68 55 L83 51" {...stroke(p.dark, 1.4)} />
      <path d="M68 59 L83 60" {...stroke(p.dark, 1.4)} />
    </>
  )
}

function Fish({ p }: { p: Palette }) {
  return (
    <>
      <path d="M72 50 L96 32 L91 50 L96 68 Z" fill={p.dark} />
      <path d="M43 29 q9 -14 19 -2 Z" fill={p.dark} />
      <path d="M43 71 q9 14 19 2 Z" fill={p.dark} />
      <ellipse cx="47" cy="50" rx="31" ry="23" fill={p.base} />
      <ellipse cx="46" cy="60" rx="9" ry="6" transform="rotate(22 46 60)" fill={p.dark} />
      <path d="M32 34 q-6 16 0 32" {...stroke(p.dark, 2)} />
      <circle cx="27" cy="45" r="6.6" fill="#fff" />
      <circle cx="25.8" cy="45" r="3.4" fill={INK} />
      <path d="M17 54 q4.5 3.5 9 1" {...stroke(INK, 1.8)} />
      <circle cx="12" cy="28" r="3.2" fill="#fff" opacity="0.45" />
      <circle cx="19" cy="19" r="2.1" fill="#fff" opacity="0.35" />
    </>
  )
}

const BODIES: Record<PetKind, (props: { p: Palette }) => ReactNode> = {
  dog: Dog,
  cat: Cat,
  fish: Fish,
}

/* ------------------------------------------------------------------ *
 * 装备
 *
 * 都画在以锚点为原点的局部坐标里：
 *   头顶：原点是头顶，往上是负 y
 *   眼部：原点是两眼中点，镜片在 x = ±11
 *   脖子：原点是脖子中心
 *   手持：原点是物件中心
 * ------------------------------------------------------------------ */

const GEAR: Record<string, ReactNode> = {
  headband: (
    <>
      <rect x="-22" y="2" width="44" height="9" rx="4.5" fill="#ef4444" />
      <rect x="-22" y="5.5" width="44" height="2.5" fill="#fca5a5" />
      {/* 右侧打个结，两条带子垂下来 */}
      <circle cx="21" cy="6.5" r="3.4" fill="#dc2626" />
      <path d="M22 4 l10 -3 l-2 6 Z" fill="#dc2626" />
      <path d="M22 9 l11 4 l-1 -6 Z" fill="#dc2626" />
    </>
  ),
  cap: (
    <>
      <path d="M-18 1 q0 -19 18 -19 q18 0 18 19 Z" fill="#3b82f6" />
      <path d="M-18 -1 q-15 1 -18 7 q11 3 18 -2 Z" fill="#2563eb" />
      <rect x="-18" y="-2" width="36" height="5" rx="2.5" fill="#1d4ed8" />
      <circle cx="0" cy="-18" r="2.8" fill="#93c5fd" />
    </>
  ),
  laurel: (
    <>
      <path d="M-19 6 q-4 -16 6 -23" {...stroke('#4ade80', 2.6)} />
      <path d="M19 6 q4 -16 -6 -23" {...stroke('#4ade80', 2.6)} />
      {[0, 1, 2, 3].map((i) => (
        <ellipse
          key={`l${i}`}
          cx={-18 + i * 2.2}
          cy={2 - i * 6}
          rx="4.2"
          ry="2.6"
          transform={`rotate(${-50 + i * 12} ${-18 + i * 2.2} ${2 - i * 6})`}
          fill="#22c55e"
        />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <ellipse
          key={`r${i}`}
          cx={18 - i * 2.2}
          cy={2 - i * 6}
          rx="4.2"
          ry="2.6"
          transform={`rotate(${50 - i * 12} ${18 - i * 2.2} ${2 - i * 6})`}
          fill="#22c55e"
        />
      ))}
    </>
  ),
  crown: (
    <>
      <path d="M-17 2 L-17 -12 L-8 -4 L0 -16 L8 -4 L17 -12 L17 2 Z" fill="#f2c14e" />
      <rect x="-17" y="0" width="34" height="5" rx="2" fill="#e0a92e" />
      <circle cx="0" cy="-16" r="3" fill="#fb7185" />
      <circle cx="-17" cy="-12" r="2.4" fill="#7fd4c1" />
      <circle cx="17" cy="-12" r="2.4" fill="#7fd4c1" />
    </>
  ),
  goggles: (
    <>
      <path d="M-19 0 h-8 M19 0 h8" {...stroke('#0ea5e9', 3)} />
      <path d="M-4 0 h8" {...stroke('#0ea5e9', 3)} />
      <circle cx="-11" cy="0" r="8.5" fill="#bae6fd" opacity="0.75" />
      <circle cx="11" cy="0" r="8.5" fill="#bae6fd" opacity="0.75" />
      <circle cx="-11" cy="0" r="8.5" {...stroke('#0ea5e9', 2.4)} />
      <circle cx="11" cy="0" r="8.5" {...stroke('#0ea5e9', 2.4)} />
    </>
  ),
  shades: (
    <>
      <path d="M-19 -3 h-8 M19 -3 h8" {...stroke(INK, 3)} />
      <path d="M-4 -2 q4 -3 8 0" {...stroke(INK, 3)} />
      <path d="M-20 -6 h17 q1 11 -8.5 11 q-8.5 0 -8.5 -11 Z" fill={INK} />
      <path d="M20 -6 h-17 q-1 11 8.5 11 q8.5 0 8.5 -11 Z" fill={INK} />
      <path d="M-17 -3 q2 5 5 6" {...stroke('#94a3b8', 1.6)} />
    </>
  ),
  bowtie: (
    <>
      <path d="M-2 0 L-14 -7 L-14 7 Z" fill="#ef4444" />
      <path d="M2 0 L14 -7 L14 7 Z" fill="#ef4444" />
      <circle cx="0" cy="0" r="3.4" fill="#b91c1c" />
    </>
  ),
  scarf: (
    <>
      <path d="M-16 -3 q16 9 32 0 l0 7 q-16 8 -32 0 Z" fill="#f59e0b" />
      <path d="M8 3 l7 15 l-8 2 l-4 -14 Z" fill="#d97706" />
    </>
  ),
  medal: (
    <>
      <path d="M-8 -8 L0 6 L-3 8 L-12 -6 Z" fill="#60a5fa" />
      <path d="M8 -8 L0 6 L3 8 L12 -6 Z" fill="#60a5fa" />
      <circle cx="0" cy="12" r="7.5" fill="#f2c14e" />
      <circle cx="0" cy="12" r="4.6" fill="#e0a92e" />
      <path d="M0 8.6 l1.1 2.3 l2.5 0.3 l-1.9 1.8 l0.5 2.5 l-2.2 -1.2 l-2.2 1.2 l0.5 -2.5 l-1.9 -1.8 l2.5 -0.3 Z" fill="#fff8e1" />
    </>
  ),
  shuttle: (
    <>
      <path d="M0 4 L-9 -12 L9 -12 Z" fill="#f8fafc" opacity="0.95" />
      <path d="M0 4 L-9 -12 M0 4 L-3 -12 M0 4 L3 -12 M0 4 L9 -12" {...stroke('#cbd5e1', 1.2)} />
      <ellipse cx="0" cy="6" rx="5" ry="4.2" fill="#e2e8f0" />
      <path d="M-5 6 h10" {...stroke('#94a3b8', 1.2)} />
    </>
  ),
  racket: (
    <>
      <ellipse cx="0" cy="-5" rx="9" ry="11.5" fill="#dbeafe" opacity="0.6" />
      <ellipse cx="0" cy="-5" rx="9" ry="11.5" {...stroke('#1d4ed8', 2.4)} />
      <path d="M-6 -12 v14 M0 -15 v17 M6 -12 v14" {...stroke('#93c5fd', 1)} />
      <path d="M-7 -1 h14 M-8 -6 h16 M-7 -11 h14" {...stroke('#93c5fd', 1)} />
      <path d="M0 6.5 v10" {...stroke('#1d4ed8', 3)} />
      <path d="M0 12 v5" {...stroke('#f59e0b', 4)} />
    </>
  ),
  trophy: (
    <>
      <path d="M-8 -12 h16 v7 q0 9 -8 9 q-8 0 -8 -9 Z" fill="#f2c14e" />
      <path d="M-8 -9 q-6 0 -6 4 q0 4 6 4" {...stroke('#e0a92e', 2.2)} />
      <path d="M8 -9 q6 0 6 4 q0 4 -6 4" {...stroke('#e0a92e', 2.2)} />
      <path d="M0 4 v5" {...stroke('#e0a92e', 3)} />
      <rect x="-7" y="9" width="14" height="4" rx="1.5" fill="#c98b4b" />
      <path d="M0 -9 l1.3 2.7 l3 0.4 l-2.2 2.1 l0.6 3 l-2.7 -1.4 l-2.7 1.4 l0.6 -3 l-2.2 -2.1 l3 -0.4 Z" fill="#fff8e1" />
    </>
  ),
}

/** 背景铺满整块画布，所以单独一份，不走锚点 */
const BACKDROPS: Record<string, ReactNode> = {
  court: (
    <>
      <rect x="0" y="0" width="100" height="100" fill="#2f6b4f" />
      <rect x="8" y="14" width="84" height="72" {...stroke('#e6f2ea', 1.6)} />
      <path d="M8 50 h84" {...stroke('#e6f2ea', 1.6)} />
      <path d="M50 14 v72" {...stroke('#e6f2ea', 1.2)} />
      <path d="M22 14 v72 M78 14 v72" {...stroke('#e6f2ea', 1.2)} />
    </>
  ),
  podium: (
    <>
      <rect x="0" y="0" width="100" height="100" fill="#1b2436" />
      {/* 头顶打一束追光，别用整块圆片，缩成小图标时会糊成一坨 */}
      <path d="M50 0 L86 70 L14 70 Z" fill="#f2c14e" opacity="0.12" />
      <rect x="30" y="70" width="40" height="30" fill="#f2c14e" />
      <rect x="4" y="80" width="26" height="20" fill="#c9d1d9" />
      <rect x="70" y="84" width="26" height="16" fill="#b08d57" />
      <text x="50" y="90" textAnchor="middle" fontSize="13" fontWeight="700" fill="#7a5a12">
        1
      </text>
    </>
  ),
  galaxy: (
    <>
      <rect x="0" y="0" width="100" height="100" fill="#151a2e" />
      <circle cx="72" cy="26" r="26" fill="#7c3aed" opacity="0.28" />
      <circle cx="26" cy="72" r="22" fill="#0ea5e9" opacity="0.22" />
      {[
        [12, 16, 1.5], [30, 9, 1], [58, 14, 1.2], [86, 44, 1.4], [92, 12, 1],
        [18, 44, 1], [8, 62, 1.3], [44, 30, 0.9], [68, 62, 1.1], [88, 78, 1.3],
        [36, 88, 1], [58, 78, 0.9],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity="0.85" />
      ))}
    </>
  ),
}

/* ------------------------------------------------------------------ *
 * 组装
 * ------------------------------------------------------------------ */

function Slot({ anchor, children }: { anchor: Anchor; children: ReactNode }) {
  const parts = [`translate(${anchor.x} ${anchor.y})`]
  if (anchor.r) parts.push(`rotate(${anchor.r})`)
  if (anchor.s && anchor.s !== 1) parts.push(`scale(${anchor.s})`)
  return <g transform={parts.join(' ')}>{children}</g>
}

export function PetView({
  kind,
  equipped = {},
  className,
  title,
}: {
  kind: PetKind
  equipped?: Partial<Record<PetSlot, string>>
  className?: string
  title?: string
}) {
  const palette = PALETTES[kind]
  const anchors = ANCHORS[kind]
  const Body = BODIES[kind]
  const backdrop = equipped.background ? BACKDROPS[equipped.background] : null

  const wear = (slot: Exclude<PetSlot, 'background'>) => {
    const id = equipped[slot]
    const gear = id ? GEAR[id] : null
    if (!gear) return null
    return <Slot anchor={anchors[slot]}>{gear}</Slot>
  }

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={title ?? '宠物'}
    >
      {title && <title>{title}</title>}
      {backdrop ?? <rect x="0" y="0" width="100" height="100" fill="transparent" />}
      <Body p={palette} />
      {wear('neck')}
      {wear('face')}
      {wear('hat')}
      {wear('item')}
    </svg>
  )
}

/** 商店/装扮列表里的小图标：只画这一件装备，不画宠物 */
export function GearIcon({ itemId, className }: { itemId: string; className?: string }) {
  const item = itemById(itemId)
  if (!item) return null

  if (item.slot === 'background') {
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        {BACKDROPS[itemId]}
      </svg>
    )
  }

  // 各槽位的装备原本按「戴在宠物身上」的坐标画，单独展示时要挪回画面中心
  const centers: Record<Exclude<PetSlot, 'background'>, string> = {
    hat: 'translate(50 60) scale(1.7)',
    face: 'translate(50 52) scale(1.5)',
    neck: 'translate(50 44) scale(1.9)',
    item: 'translate(50 50) scale(2.4)',
  }

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <g transform={centers[item.slot]}>{GEAR[itemId]}</g>
    </svg>
  )
}

/** 名字旁边的小宠物头像 */
export function PetBadge({
  pet,
  size = 28,
}: {
  pet: PetProfile
  size?: number
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-800"
      style={{ width: size, height: size }}
    >
      <PetView kind={pet.kind} equipped={pet.equipped} className="h-full w-full" />
    </span>
  )
}
