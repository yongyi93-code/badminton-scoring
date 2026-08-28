import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect } from 'react'

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')

/* ------------------------------------------------------------------ *
 * 按钮
 * ------------------------------------------------------------------ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * primary   主操作，一屏只该有一个
   * ghost     次要确认（白底 + 主色描边）
   * soft      中性操作，不抢主操作的视线
   * tertiary  「查看全部 / 编辑」这类文字入口
   * danger    删除、结束的最终确认
   * dangerSoft 危险但还没到最终确认那一步的行内操作
   */
  variant?: 'primary' | 'ghost' | 'soft' | 'tertiary' | 'danger' | 'dangerSoft'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
}

/* 禁用态不靠透明度糊过去 —— 文字仍然读得出来，只是明显不可点 */
const OFF = 'disabled:bg-fill-strong disabled:text-ink-300 disabled:border-transparent'

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: `bg-brand-solid text-on-brand font-semibold active:bg-brand-solid-press ${OFF}`,
  ghost: `border border-brand-600 bg-surface text-brand-600 font-medium active:bg-brand-50 ${OFF}`,
  soft: `bg-fill text-ink-900 active:bg-fill-strong ${OFF}`,
  tertiary: 'bg-transparent text-brand-600 font-medium active:bg-brand-50 disabled:text-ink-300',
  danger: `bg-danger-solid text-on-danger font-semibold active:brightness-90 ${OFF}`,
  dangerSoft: `bg-danger-50 text-danger-600 border border-danger-600/30 active:brightness-95 ${OFF}`,
}

/* 最小触达区 44 —— sm 也要够手指点 */
const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-11 px-3 text-label rounded-lg',
  md: 'h-12 px-4 text-body rounded-btn',
  lg: 'h-[52px] px-5 text-title rounded-btn',
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
        'inline-flex items-center justify-center gap-2 transition-[filter,background-color]',
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
        // 1px 细线 + 一层很淡的阴影。规格里说这两样不能同时重，所以线不加粗、影不加深
        'rounded-card border border-line bg-surface p-4 shadow-card',
        onClick && 'w-full text-left active:bg-fill',
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
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-surface/95 px-4 pb-3 backdrop-blur">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="返回"
            className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-700 active:bg-fill"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {subtitle && (
            <p className="truncate text-xs text-ink-500">{subtitle}</p>
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
      <h2 className="text-xs font-semibold tracking-[0.14em] text-ink-500 uppercase">
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
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mt-3 font-medium text-ink-900">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-500">{hint}</p>}
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
      <span className="mb-1.5 block text-sm text-ink-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'h-12 w-full rounded-xl border border-line bg-fill px-3.5 text-[15px] text-ink-900 placeholder:text-ink-500 focus:border-brand-600 focus:outline-none'

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
      <div className="tnum h-12 min-w-0 flex-1 rounded-xl border border-line bg-fill text-center text-lg leading-[3rem] font-semibold">
        {value}
        {suffix && <span className="ml-1 text-sm text-ink-500">{suffix}</span>}
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
    /* 轨道是浅灰、选中项是白卡 —— 不再整块填主色，那样一屏会有好几团青色在抢焦点 */
    <div className="flex gap-1 rounded-btn bg-fill p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-10 flex-1 rounded-lg text-label transition-colors',
            value === o.value
              ? 'bg-surface font-semibold text-ink-900 shadow-card'
              : 'text-ink-500 active:bg-fill-strong',
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
      <span className="text-[15px] text-ink-900">{label}</span>
      <span
        className={cx(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-ink-300',
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
        className="absolute inset-0 bg-scrim backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="safe-bottom shadow-pop relative w-full max-w-md rounded-t-3xl border border-line bg-surface p-5 sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 flex size-9 items-center justify-center rounded-lg text-ink-500 active:bg-fill"
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
  tone?: 'neutral' | 'brand' | 'teamA' | 'teamB' | 'warn' | 'success' | 'danger'
  className?: string
}) {
  /* 每个色都配文案，不靠颜色单独传达含义 —— 色盲和强光下都得读得出来 */
  const tones = {
    neutral: 'bg-fill text-ink-700',
    brand: 'bg-brand-100 text-brand-600',
    teamA: 'bg-team-a/15 text-team-a',
    teamB: 'bg-team-b/15 text-team-b',
    warn: 'bg-warning-50 text-warning-600',
    success: 'bg-success-50 text-success-600',
    danger: 'bg-danger-50 text-danger-600',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
