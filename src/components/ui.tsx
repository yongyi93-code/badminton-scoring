import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect } from 'react'

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')

/* ------------------------------------------------------------------ *
 * 按钮
 * ------------------------------------------------------------------ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
}

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-lime-glow text-ink-950 font-semibold active:brightness-90 disabled:bg-ink-700 disabled:text-ink-400',
  ghost:
    'border border-ink-700 text-ink-100 active:bg-ink-800 disabled:text-ink-400 disabled:border-ink-800',
  soft: 'bg-ink-800 text-ink-100 active:bg-ink-700 disabled:text-ink-400',
  danger: 'bg-red-500/15 text-red-300 border border-red-500/30 active:bg-red-500/25',
}

const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg',
  md: 'h-12 px-4 text-[15px] rounded-xl',
  lg: 'h-14 px-5 text-base rounded-2xl',
}

export function Button({
  variant = 'soft',
  size = 'md',
  block,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 transition-[filter,background-color] disabled:opacity-70',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
    />
  )
}

/* ------------------------------------------------------------------ *
 * 容器
 * ------------------------------------------------------------------ */

export function Card({
  className,
  children,
  onClick,
}: {
  className?: string
  children: ReactNode
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'rounded-card border border-ink-700/70 bg-ink-850 p-4',
        onClick && 'w-full text-left active:bg-ink-800',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: ReactNode
}) {
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-ink-800 bg-ink-900/95 px-4 pb-3 backdrop-blur">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="返回"
            className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-300 active:bg-ink-800"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {subtitle && (
            <p className="truncate text-xs text-ink-400">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
    </header>
  )
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-dvh w-full max-w-2xl">{children}</div>
}

export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('safe-bottom space-y-4 px-4 pt-4', className)}>{children}</div>
  )
}

export function SectionTitle({
  children,
  right,
}: {
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-xs font-semibold tracking-[0.14em] text-ink-400 uppercase">
        {children}
      </h2>
      {right}
    </div>
  )
}

export function EmptyState({
  icon = '🏸',
  title,
  hint,
}: {
  icon?: string
  title: string
  hint?: string
}) {
  return (
    <div className="rounded-card border border-dashed border-ink-700 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mt-3 font-medium text-ink-100">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-400">{hint}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 表单
 * ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-ink-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'h-12 w-full rounded-xl border border-ink-700 bg-ink-800 px-3.5 text-[15px] text-ink-100 placeholder:text-ink-400 focus:border-lime-glow focus:outline-none'

export function Stepper({
  value,
  onChange,
  onDelta,
  min = 0,
  max = 99,
  step = 1,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  /**
   * 只给增量而不给结果值。用于数字存在 store 里的场景 ——
   * 调用方可以基于最新值加减，不受渲染时机影响。
   */
  onDelta?: (delta: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const bump = (delta: number) =>
    onDelta ? onDelta(delta) : onChange(clamp(value + delta))
  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="md"
        className="w-11 shrink-0 px-0"
        onClick={() => bump(-step)}
        aria-label="减少"
      >
        <span className="text-xl leading-none">−</span>
      </Button>
      <div className="tnum h-12 min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-800 text-center text-lg leading-[3rem] font-semibold">
        {value}
        {suffix && <span className="ml-1 text-sm text-ink-400">{suffix}</span>}
      </div>
      <Button
        size="md"
        className="w-11 shrink-0 px-0"
        onClick={() => bump(step)}
        aria-label="增加"
      >
        <span className="text-xl leading-none">+</span>
      </Button>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-10 flex-1 rounded-lg text-sm font-medium transition-colors',
            value === o.value
              ? 'bg-lime-glow text-ink-950'
              : 'text-ink-300 active:bg-ink-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-1 text-left"
    >
      <span className="text-[15px] text-ink-100">{label}</span>
      <span
        className={cx(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors',
          checked ? 'bg-lime-glow' : 'bg-ink-700',
        )}
      >
        <span
          className={cx(
            'absolute top-1 size-5 rounded-full bg-white transition-[left]',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * 弹层
 * ------------------------------------------------------------------ */

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="safe-bottom relative w-full max-w-md rounded-t-3xl border border-ink-700 bg-ink-850 p-5 sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 flex size-9 items-center justify-center rounded-lg text-ink-400 active:bg-ink-800"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'lime' | 'teamA' | 'teamB' | 'warn'
  className?: string
}) {
  const tones = {
    neutral: 'bg-ink-800 text-ink-300',
    lime: 'bg-lime-glow/15 text-lime-glow',
    teamA: 'bg-teamA/15 text-teamA',
    teamB: 'bg-teamB/15 text-teamB',
    warn: 'bg-amber-400/15 text-amber-300',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
