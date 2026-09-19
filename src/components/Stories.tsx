import { useEffect, useRef, useState } from 'react'
import { lang, useT } from '@/lib/i18n'
import { cx } from '@/components/ui'
import { PhotoAvatar } from '@/components/Photo'
import { relativeTime } from '@/lib/format'
import { STORY_MS, type FeedItem } from '@/lib/moments'
import type { AvatarProfile } from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * Story：顶上那一排圈圈，和点开之后的全屏
 *
 * 「Story」在数据库里不是另一张表，就是 posts 上一个 expires_at
 * （见 supabase/028-stories.sql）。但在**界面上**它必须是另一个东西：
 *
 *   时间线   往下翻，一条一条读
 *   Story    横着一排，点开全屏，看完自己往下走
 *
 * 混在一起的话两边都不像 —— 一条「明天就没了」的动态夹在永久的中间，
 * 人不会注意到它会消失，而那正是它唯一的特点。
 *
 * -------------------------------------------------------------------
 * 一个人一个圈，不是一条一个圈
 *
 * 一个人一晚上发五条，排五个圈的话那一排就只剩他了。所以按人合并，
 * 点开之后在他那几条之间走。
 * ------------------------------------------------------------------ */

export type Teller = {
  uid: string
  name: string
  photo?: string | null
  avatar?: AvatarProfile
  items: FeedItem[]
}

/**
 * 把一堆 Story 按人分堆。
 *
 * 顺序：**自己排最前**，其余按最新那条的时间倒着排。
 * 自己排最前不是自恋 —— 那一格同时是「发一条」的入口，
 * 而入口跑到第六个圈的位置上就没人找得到了。
 */
export function tellers(
  rows: FeedItem[],
  meUid: string | null,
  who: (uid: string) => { name: string; photo?: string | null; avatar?: AvatarProfile },
): Teller[] {
  const by = new Map<string, FeedItem[]>()
  for (const r of rows) by.set(r.author, [...(by.get(r.author) ?? []), r])

  const out: Teller[] = [...by.entries()].map(([uid, items]) => ({
    uid,
    ...who(uid),
    /* 一个人自己那几条顺着看：先发的先看，和对话一个道理 */
    items: [...items].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
  }))

  return out.sort((a, b) => {
    if ((a.uid === meUid) !== (b.uid === meUid)) return a.uid === meUid ? -1 : 1
    return newest(b) - newest(a)
  })
}

const newest = (t: Teller) =>
  Math.max(...t.items.map((i) => Date.parse(i.created_at)), 0)

/** 还剩多久没。给的是「大概还有几小时」，不是秒表 */
export function leftLine(item: FeedItem, zh: boolean, now = Date.now()): string {
  const end = item.expires_at ? Date.parse(item.expires_at) : Date.parse(item.created_at) + STORY_MS
  const mins = Math.max(0, Math.round((end - now) / 60000))
  if (mins < 60) return zh ? `还有 ${mins} 分钟` : `${mins} min left`
  return zh ? `还有 ${Math.round(mins / 60)} 小时` : `${Math.round(mins / 60)}h left`
}

/* ------------------------------------------------------------------ *
 * 那一排圈圈
 * ------------------------------------------------------------------ */

export function StoryRow({
  tellers: rows,
  meUid,
  canPost,
  onOpen,
  onNew,
}: {
  tellers: Teller[]
  meUid: string | null
  /** 被禁言的人不给「发一条」那一格 */
  canPost: boolean
  onOpen: (i: number) => void
  onNew: () => void
}) {
  const t = useT()
  const mineFirst = rows[0]?.uid === meUid
  if (rows.length === 0 && !canPost) return null

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <div className="flex gap-3 pb-1">
        {/* 自己还没发的时候，第一格是「发一条」 */}
        {canPost && !mineFirst && (
          <button onClick={onNew} className="w-[72px] shrink-0 text-center">
            {/*
              72 = 头像 64 + 那一圈边 2 + 边跟头像之间的 2，两边各一份。
              格子按这个数给，不然圈会被裁掉一条边 —— 而那条边正是
              这一排唯一的信息。
            */}
            <span className="border-line text-ink-500 flex size-[72px] items-center justify-center rounded-full border-2 border-dashed text-2xl">
              +
            </span>
            <span className="text-ink-500 mt-1 block truncate text-caption">
              {t('发一条', 'Add')}
            </span>
          </button>
        )}
        {rows.map((r, i) => (
          <button key={r.uid} onClick={() => onOpen(i)} className="w-[72px] shrink-0 text-center">
            {/*
              那一圈绿边是这一排唯一的信息：它说「这里有还没消失的东西」。
              所以边要粗、要是品牌色，而不是一条淡淡的灰线。
            */}
            <span className="border-brand-500 inline-flex rounded-full border-2 p-0.5">
              <PhotoAvatar url={r.photo} name={r.name} avatar={r.avatar} size="lg" />
            </span>
            <span className="mt-1 block truncate text-caption">
              {r.uid === meUid ? t('我', 'You') : r.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 点开之后的全屏
 * ------------------------------------------------------------------ */

const STEP_MS = 5000

export function StoryViewer({
  tellers: rows,
  start,
  meUid,
  onClose,
  onDelete,
}: {
  tellers: Teller[]
  /** 从第几个人开始。点哪个圈就是哪个 */
  start: number
  meUid: string | null
  onClose: () => void
  onDelete: (item: FeedItem) => void
}) {
  const t = useT()
  const [person, setPerson] = useState(start)
  const [idx, setIdx] = useState(0)
  /* 进度条重放用的。换一条就换一个 key，CSS 动画才会从头跑 */
  const tick = useRef(0)

  const teller = rows[person]
  const item = teller?.items[idx]

  /*
   * 自己往下走。
   *
   * 一条五秒 —— 短了看不完一句话，长了让人觉得卡住了。
   * 每换一条重置一次计时，包括手动点下一条的时候。
   */
  useEffect(() => {
    if (!item) return
    const id = setTimeout(() => next(), STEP_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, idx])

  /*
   * 手上这一条没了就自己退出来。
   *
   * 删掉自己最后一条 Story 的时候会发生：外面把它从列表里拿掉，
   * 这里第 person 个人（或者第 idx 条）就不存在了。只 return null
   * 的话人看到的是一片空白，而那一屏上连个关掉的按钮都没有。
   */
  const missing = !teller || !item
  useEffect(() => {
    if (missing) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing])

  if (!teller || !item) return null

  const next = () => {
    tick.current += 1
    if (idx + 1 < teller.items.length) return setIdx(idx + 1)
    if (person + 1 < rows.length) {
      setPerson(person + 1)
      return setIdx(0)
    }
    /* 全看完了就退出来 —— 停在最后一张不动，人会以为卡住了 */
    onClose()
  }

  const prev = () => {
    tick.current += 1
    if (idx > 0) return setIdx(idx - 1)
    if (person > 0) {
      const p = rows[person - 1]
      setPerson(person - 1)
      return setIdx(Math.max(0, p.items.length - 1))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* 进度条：一条一格，看到哪一格就填到哪一格 */}
      <div className="safe-top flex gap-1 px-3 pt-2">
        {teller.items.map((it, i) => (
          <span key={it.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <span
              className={cx('block h-full bg-white', i < idx && 'w-full')}
              style={
                i === idx
                  ? { animation: `rally-story ${STEP_MS}ms linear forwards` }
                  : i > idx
                    ? { width: 0 }
                    : undefined
              }
              key={`${it.id}-${tick.current}`}
            />
          </span>
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <PhotoAvatar url={teller.photo} name={teller.name} avatar={teller.avatar} size="sm" />
        <span className="min-w-0 flex-1 truncate text-label font-medium">
          {teller.uid === meUid ? t('我', 'You') : teller.name}
        </span>
        <span className="shrink-0 text-caption text-white/60">
          {relativeTime(Date.parse(item.created_at))}
        </span>
        <button
          onClick={onClose}
          aria-label={t('关掉', 'Close')}
          className="-mr-1 flex size-9 shrink-0 items-center justify-center"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/*
        中间那一块：左边三分之一往回，右边三分之二往前。
        和所有人都用过的那个手势一样 —— 不发明新的。
      */}
      <div className="relative min-h-0 flex-1">
        <div className="flex h-full items-center justify-center px-4">
          {item.urls.length > 0 ? (
            <img
              src={item.urls[0]}
              alt=""
              className="max-h-full max-w-full rounded-card object-contain"
            />
          ) : (
            <p className="whitespace-pre-wrap break-words px-6 text-center text-h2 text-white">
              {item.body}
            </p>
          )}
        </div>
        <button
          onClick={prev}
          aria-label={t('上一条', 'Previous')}
          className="absolute inset-y-0 left-0 w-1/3"
        />
        <button
          onClick={next}
          aria-label={t('下一条', 'Next')}
          className="absolute inset-y-0 right-0 w-2/3"
        />
      </div>

      <div className="safe-bottom px-4 pb-4 pt-2 text-white">
        {/* 有图又有字的时候，字压在底下 —— 图才是主角 */}
        {item.urls.length > 0 && item.body && (
          <p className="mb-2 whitespace-pre-wrap break-words text-label">{item.body}</p>
        )}
        <div className="flex items-center gap-4 text-caption text-white/60">
          <span>{leftLine(item, lang() === 'zh')}</span>
          {item.author === meUid && (
            <button onClick={() => onDelete(item)} className="ml-auto active:text-danger-600">
              {t('删掉', 'Delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
