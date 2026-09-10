import { useMemo, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { playerMap, useApp } from '@/store/useApp'
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
 * 「管理员发的」今天还没有入口 —— 管理员角色本身还没做。数据结构先留着：
 * 没有球局 id 的公告记录会排在自动那几条前面。这个 App 早期球员发给全群的
 * 那些消息也没有球局 id，于是正好落在这儿，位置和当初一样。
 *
 * 做成横划而不是竖着堆：升段、连胜这些一天能攒出四五条，
 * 竖着堆会把下面「有什么球局可以打」整个顶出屏幕，而后者才是这一屏的正事。
 * ------------------------------------------------------------------ */

function timeAgo(ts: number, t: ReturnType<typeof useT>): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return t('刚刚', 'just now')
  if (mins < 60) return t(`${mins} 分钟前`, `${mins}m ago`)
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t(`${hours} 小时前`, `${hours}h ago`)
  const days = Math.floor(hours / 24)
  return t(`${days} 天前`, `${days}d ago`)
}

/** 一条公告：要么是人写的（管理员），要么是算出来的（快讯） */
type Notice = {
  key: string
  icon: string
  text: string
  /** 人写的才有署名和时间 */
  by?: string
  at?: number
  onOpen?: () => void
}

export function NoticeBoard({
  feed,
  onOpen,
}: {
  feed: FeedItem[]
  onOpen: (item: FeedItem) => void
}) {
  const t = useT()
  const { players, announcements } = useApp()

  /** 划到第几条了 —— 只用来点亮下面那排小点 */
  const [at, setAt] = useState(0)
  const strip = useRef<HTMLDivElement>(null)

  const names = useMemo(() => playerMap(players), [players])

  const notices = useMemo<Notice[]>(() => {
    /*
     * 人写的排在算出来的前面。
     * 「这周五改去力天」是要去做的事，「阿明升段了」是好玩的事 ——
     * 前者错过了有后果，后者错过了没有。
     */
    const written = announcements
      .filter((a) => !a.sessionId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map<Notice>((a) => ({
        key: a.id,
        icon: '📢',
        text: a.text,
        by: names.get(a.authorId)?.name ?? t('已退出的球友', 'A former member'),
        at: a.createdAt,
      }))

    const auto = feed.map<Notice>((f) => ({
      key: f.id,
      icon: f.icon,
      text: f.text,
      onOpen: f.link ? () => onOpen(f) : undefined,
    }))

    return [...written, ...auto]
  }, [announcements, feed, names, t, onOpen])

  /** 划到哪儿了：拿滚动位置除以一屏宽度，四舍五入 */
  const onScroll = () => {
    const el = strip.current
    if (!el) return
    setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
  }

  if (notices.length === 0) return null

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
        {notices.map((n) => (
          <div key={n.key} className="w-full shrink-0 snap-center pr-3 last:pr-0">
            <Card
              className="border-brand-500/25 bg-brand-50"
              onClick={n.onOpen}
            >
              <div className="flex items-start gap-2 text-left">
                <span className="shrink-0 text-title leading-none">{n.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-label break-words whitespace-pre-wrap">{n.text}</p>
                  {n.by && n.at !== undefined && (
                    <p className="text-ink-500 mt-1 text-caption">
                      {n.by} · {timeAgo(n.at, t)}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </div>
        ))}
      </div>

      {/* 小点只在有两条以上时才有意义 —— 一条的时候它只是个装饰 */}
      {notices.length > 1 && (
        <div className="flex justify-center gap-1.5">
          {notices.map((n, i) => (
            <span
              key={n.key}
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
