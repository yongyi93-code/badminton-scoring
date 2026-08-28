import { useEffect, useState } from 'react'
import type { FeedItem } from '@/lib/feed'
import { cx } from '@/components/ui'

/* ------------------------------------------------------------------ *
 * 首页快讯条
 *
 * 竖着轮播，不是横向跑马灯 —— 中文横着滚要么太快看不完，
 * 要么慢到读一条要等半天，手机上尤其难受。
 * 一次只显示一条，几秒换一条，读完整句再翻页。
 * ------------------------------------------------------------------ */

/** 每条停留多久 */
const DWELL_MS = 4200
/** 切换动画时长，和下面的 transition 对齐 */
const SLIDE_MS = 420

export function Ticker({
  items,
  onPick,
}: {
  items: FeedItem[]
  onPick?: (item: FeedItem) => void
}) {
  const [at, setAt] = useState(0)
  const [leaving, setLeaving] = useState(false)

  /*
   * 消息条数会变（打完一局就变），下标可能越界。
   * 越界时归零，而不是让 items[at] 变成 undefined。
   */
  const safeAt = items.length > 0 ? at % items.length : 0
  const item = items[safeAt]

  useEffect(() => {
    if (items.length <= 1) return
    const t = window.setInterval(() => {
      setLeaving(true)
      window.setTimeout(() => {
        setAt((i) => (i + 1) % items.length)
        setLeaving(false)
      }, SLIDE_MS)
    }, DWELL_MS)
    return () => window.clearInterval(t)
  }, [items.length])

  if (!item) return null

  return (
    <button
      onClick={() => onPick?.(item)}
      className="flex w-full items-center gap-2.5 overflow-hidden rounded-xl border border-line bg-surface px-3 py-2.5 text-left active:bg-fill"
    >
      <span className="shrink-0 text-base">{item.icon}</span>
      <span
        key={item.id}
        className={cx(
          'min-w-0 flex-1 truncate text-sm text-ink-700 transition-all duration-[420ms]',
          leaving ? '-translate-y-2 opacity-0' : 'translate-y-0 opacity-100',
        )}
      >
        {item.text}
      </span>
      {items.length > 1 && (
        <span className="tnum shrink-0 text-xs text-ink-500">
          {safeAt + 1}/{items.length}
        </span>
      )}
    </button>
  )
}
