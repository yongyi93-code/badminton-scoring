import { useT } from '@/lib/i18n'
import type { ReactNode } from 'react'
import { useNav, useRoute, TAB_ROUTES, type TabName } from '@/store/useNav'
import { cx } from '@/components/ui'
import { activeSessionOf, useApp } from '@/store/useApp'

/*
 * 底部主导航。规格里写的是「底部四项」，但后面列了五项 ——
 * 首页 / 球局 / + 开球 / 排名 / 我的。按五项做：中间那个不是 tab，
 * 它不代表一个可以停留的地方，而是直接开一条新球局的流程，
 * 所以做成凸起的主操作，也不参与选中态。
 */

type Item = { tab: TabName; label: [string, string]; icon: ReactNode }

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
  /*
    领奖台：三根高低不一的柱子，中间最高。
    原来是个指南针（那时候这一栏叫「发现」）—— 改叫排名之后，
    指南针指的是「到处逛逛」，和这一屏里的两份榜对不上。
  */
  discover: (
    <>
      <path d="M9 8.5h6v11H9z" {...stroke} />
      <path d="M3.5 13h5.5v6.5H3.5z" {...stroke} />
      <path d="M15 11h5.5v8.5H15z" {...stroke} />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8" r="3.75" {...stroke} />
      <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" {...stroke} />
    </>
  ),
}

const LABELS: Record<TabName, [string, string]> = {
  home: ['首页', 'Home'],
  sessions: ['球局', 'Sessions'],
  discover: ['排名', 'Rankings'],
  me: ['我的', 'Me'],
}

const ITEMS: Item[] = TAB_ROUTES.map((tab) => ({
  tab,
  label: LABELS[tab],
  icon: ICONS[tab],
}))

export function TabBar() {
  const t = useT()
  const route = useRoute()
  /** 我现在在哪一场里。在的话，中间那个按钮改成「回去那一场」 */
  const inSession = useApp((s) => activeSessionOf(s.sessions, s.meId))
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
          {t(...item.label)}
        </span>
      </button>
    )
  }

  return (
    <nav
      aria-label={t('主导航', 'Main navigation')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex h-[72px] w-full max-w-2xl items-stretch px-2">
        {left.map(cell)}

        {/*
          开球：不参与选中态。

          已经在一场进行中的球局里的时候，这个按钮改成「回到那一场」——
          一个人同一时间只能在一场里，点了也开不了新的（store 那层拦着）。
          与其让他填完四步再被拒，不如直接把他送回他该在的地方。
        */}
        <div className="flex w-[76px] shrink-0 items-center justify-center">
          <button
            onClick={() =>
              inSession
                ? push({ name: 'board', sessionId: inSession.id })
                : push({ name: 'setup' })
            }
            aria-label={
              inSession ? t('回到球局', 'Back to your session') : t('开新球局', 'New session')
            }
            className="bg-brand-solid text-on-brand shadow-pop active:bg-brand-solid-press -mt-6 flex size-14 items-center justify-center rounded-full"
          >
            <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
              {inSession ? (
                // 羽球：已经在打了，回去那一场
                <path d="M9 15l6-6M7.5 16.5a2.1 2.1 0 1 0 0-.1M13 5l6 6-4 3-5-5 3-4Z" {...stroke} />
              ) : (
                <path d="M12 5v14M5 12h14" {...stroke} />
              )}
            </svg>
          </button>
        </div>

        {right.map(cell)}
      </div>
    </nav>
  )
}
