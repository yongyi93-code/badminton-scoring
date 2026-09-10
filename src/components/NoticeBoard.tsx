import { useRef, useState } from 'react'
import { Card, cx } from '@/components/ui'
import type { FeedItem } from '@/lib/feed'

/* ------------------------------------------------------------------ *
 * 公告 —— 首页最上面那一排，横着划
 *
 * 这里的东西不是球员发的，是自己冒出来的：谁升段了、谁在连胜、
 * 哪个馆现在谁是第一、上一局打了几场。全部从比赛记录现算（见 lib/feed），
 * 所以删掉一场比赛，公告跟着变，不会留下对不上的旧账。
 *
 * 和球局看板里那块（Announcements）是两件不同的事，别混：
 *   这里  自动算出来的 + 以后管理员发的，所有人在首页看得见，球员发不了
 *   那里  球员自己发的，带球局 id，只有那一局的人看得见
 *
 * 「管理员发的」今天一条都不显示，也没有入口 —— 管理员角色本身还没做。
 * 数据结构（不带球局 id 的公告记录）先留着，等那一步再接上来。
 * 现在不显示是有意的：唯一存在的那种记录是这个 App 早期球员发给全群的
 * 旧消息，而球员早就发不了了，把它们挂在首页只是在展示一批没人能维护的
 * 陈年通知。
 *
 * 也没有「过几天自动消失」这回事 —— 下面播的东西全部从比赛记录现算，
 * 而且只算最近三天的（见 lib/feed 的 FRESH_MS）。没打球，首页就是空的。
 * 空着不是毛病：没有新闻就是没有新闻。
 *
 * 做成横划而不是竖着堆：升段、连胜这些一天能攒出四五条，
 * 竖着堆会把下面「有什么球局可以打」整个顶出屏幕，而后者才是这一屏的正事。
 * ------------------------------------------------------------------ */

export function NoticeBoard({
  feed,
  onOpen,
}: {
  feed: FeedItem[]
  onOpen: (item: FeedItem) => void
}) {
  /** 划到第几条了 —— 只用来点亮下面那排小点 */
  const [at, setAt] = useState(0)
  const strip = useRef<HTMLDivElement>(null)

  /** 划到哪儿了：拿滚动位置除以一屏宽度，四舍五入 */
  const onScroll = () => {
    const el = strip.current
    if (!el) return
    setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
  }

  if (feed.length === 0) return null

  return (
    <div className="space-y-2">
      {/*
        横向滑动 + snap：一次停在一条上，不会停在两条中间。
        scrollbar 藏掉 —— 下面那排小点已经说明了「还有」。
      */}
      <div
        ref={strip}
        onScroll={onScroll}
        className="no-scrollbar -mx-5 flex snap-x snap-mandatory overflow-x-auto scroll-smooth px-5"
      >
        {feed.map((f) => (
          <div key={f.id} className="w-full shrink-0 snap-center pr-3 last:pr-0">
            <Card
              className="border-brand-500/25 bg-brand-50"
              onClick={f.link ? () => onOpen(f) : undefined}
            >
              <div className="flex items-start gap-2 text-left">
                <span className="shrink-0 text-title leading-none">{f.icon}</span>
                <p className="min-w-0 flex-1 text-label break-words">{f.text}</p>
              </div>
            </Card>
          </div>
        ))}
      </div>

      {/* 小点只在有两条以上时才有意义 —— 一条的时候它只是个装饰 */}
      {feed.length > 1 && (
        <div className="flex justify-center gap-1.5">
          {feed.map((f, i) => (
            <span
              key={f.id}
              className={cx(
                'h-1.5 rounded-full transition-all',
                i === at ? 'bg-brand-500 w-4' : 'bg-ink-300 w-1.5',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
