import type { ReactNode } from 'react'
import { useNav, useRoute, TAB_ROUTES, type TabName } from '@/store/useNav'
import { cx } from '@/components/ui'

/*
 * 底部主导航。规格里写的是「底部四项」，但后面列了五项 ——
 * 首页 / 球局 / + 开球 / 发现 / 我的。按五项做：中间那个不是 tab，
 * 它不代表一个可以停留的地方，而是直接开一条新球局的流程，
 * 所以做成凸起的主操作，也不参与选中态。
 */

type Item = { tab: TabName; label: string; icon: ReactNode }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** 2px 圆角线性图标。规格第 2 节：不用 emoji 当图形语言 */
const ICONS: Record<TabName, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" {...stroke} />
      <path d="M5.5 9.5V20h13V9.5" {...stroke} />
    </>
  ),
  sessions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" {...stroke} />
      <path d="M12 5v14M3 12h18" {...stroke} />
    </>
  ),
  discover: (
    <>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="m15 9-2.2 4.8L8 16l2.2-4.8L15 9Z" {...stroke} />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8" r="3.75" {...stroke} />
      <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" {...stroke} />
    </>
  ),
}

const LABELS: Record<TabName, string> = {
  home: '首页',
  sessions: '球局',
  discover: '发现',
  me: '我的',
}

const ITEMS: Item[] = TAB_ROUTES.map((tab) => ({
  tab,
  label: LABELS[tab],
  icon: ICONS[tab],
}))

export function TabBar() {
  const route = useRoute()
  const switchTab = useNav((s) => s.switchTab)
  const push = useNav((s) => s.push)

  const [left, right] = [ITEMS.slice(0, 2), ITEMS.slice(2)]

  const cell = (item: Item) => {
    const on = route.name === item.tab
    return (
      <button
        key={item.tab}
        onClick={() => switchTab(item.tab)}
        aria-current={on ? 'page' : undefined}
        className={cx(
          'flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1',
          on ? 'text-brand-600' : 'text-ink-500',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
          {item.icon}
        </svg>
        <span className={cx('text-caption', on && 'font-semibold')}>
          {item.label}
        </span>
      </button>
    )
  }

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex h-[72px] w-full max-w-2xl items-stretch px-2">
        {left.map(cell)}

        {/* 开球：不参与选中态，任何时候点都是开一局新的 */}
        <div className="flex w-[76px] shrink-0 items-center justify-center">
          <button
            onClick={() => push({ name: 'setup' })}
            aria-label="开新球局"
            className="bg-brand-solid text-on-brand shadow-pop active:bg-brand-solid-press -mt-6 flex size-14 items-center justify-center rounded-full"
          >
            <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
              <path d="M12 5v14M5 12h14" {...stroke} />
            </svg>
          </button>
        </div>

        {right.map(cell)}
      </div>
    </nav>
  )
}
