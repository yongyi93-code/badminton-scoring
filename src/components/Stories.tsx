import { useEffect, useRef, useState } from 'react'
import { lang, useT } from '@/lib/i18n'
import { cx } from '@/components/ui'
import { PhotoAvatar } from '@/components/Photo'
import { relativeTime } from '@/lib/format'
import { STORY_MS, type FeedItem } from '@/lib/moments'
import { isVideo } from '@/lib/media'
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
  now = Date.now(),
): Teller[] {
  const by = new Map<string, FeedItem[]>()
  /*
   * 过期的在这儿再筛一次。
   *
   * 拉数据那一层已经筛过了（lib/moments.ts），这一道管的是**另一种
   * 情形**：App 一直开着，而那条 Story 在这中间到点了。不筛的话那个
   * 圈圈会一直挂着，点开是一条「还有 0 分钟」的东西。
   *
   * 这不是「判两遍」—— 一次是问服务端要什么，一次是这一刻该画什么。
   */
  for (const r of rows) {
    if (r.expires_at && Date.parse(r.expires_at) <= now) continue
    by.set(r.author, [...(by.get(r.author) ?? []), r])
  }

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

/**
 * 「发一条」的入口摆在哪。
 *
 *   tile   单独占一格（那个虚线的「＋」）—— 自己还没发过的时候
 *   badge  挂在自己那个圈的右下角 —— 已经发过了，圈已经占着第一格
 *   none   发不了（没登录、被禁言）
 *
 * -------------------------------------------------------------------
 * 这个函数是为了一个线上 bug 才单拎出来的（2026-09-21）
 *
 * 原来那一句是 `canPost && !mineFirst` —— 自己发过一条之后，自己那个
 * 圈排到第一位，于是「＋」整个消失，**第二条永远发不出去**。
 *
 * 当时那句注释写着「自己那一格同时是发一条的入口」。那是意图，
 * 不是事实：点自己那个圈调的是 onOpen，打开的是全屏播放。
 * 一句描述意图的注释，读起来和描述行为的一模一样 —— 而它掩护了
 * 这个 bug 一整版。
 *
 * 所以现在它是一个有名字、有返回值、能被测试钉住的东西，
 * 不是藏在 JSX 里的一个 `&&`。
 */
export function addEntry(
  rows: Teller[],
  meUid: string | null,
  canPost: boolean,
): 'tile' | 'badge' | 'none' {
  if (!canPost) return 'none'
  return rows.some((r) => r.uid === meUid) ? 'badge' : 'tile'
}

export function StoryRow({
  tellers: rows,
  meUid,
  canPost,
  seenUids,
  onOpen,
  onNew,
}: {
  tellers: Teller[]
  meUid: string | null
  /** 被禁言的人不给「发一条」那一格 */
  canPost: boolean
  /**
   * 这几个人的那几条**都看过了**。
   *
   * 看过的圈是灰的，没看过的是绿的 —— 和 Instagram 一样，也是唯一
   * 说得通的：那一圈绿边说的是「这里有你还没看过的东西」，
   * 一直亮着的话它什么都不说了。
   *
   * 传进来而不是在这儿读：这个组件只管画，看过没看过归外面管
   * （store/useSeen）。这样它也测得动。
   */
  seenUids?: Set<string>
  onOpen: (i: number) => void
  onNew: () => void
}) {
  const t = useT()
  const entry = addEntry(rows, meUid, canPost)
  if (rows.length === 0 && entry === 'none') return null

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <div className="flex gap-3 pb-1">
        {/* 自己还没发过的时候，第一格是「发一条」 */}
        {entry === 'tile' && (
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
        {rows.map((r, i) => {
          const isMe = r.uid === meUid
          const seen = seenUids?.has(r.uid) ?? false
          return (
            /*
              外面这一层是 div 不是 button：自己那一格上要再挂一个
              「＋」小按钮，而按钮里套按钮在 HTML 里是非法的 ——
              浏览器会把它拆开，点哪个都说不准。
            */
            <div key={r.uid} className="relative w-[72px] shrink-0">
              <button onClick={() => onOpen(i)} className="w-full text-center">
                {/*
                  那一圈边是这一排唯一的信息：它说「这里有你**还没看过**的
                  东西」。所以没看过的时候要粗、要是品牌色。

                  看完了变灰，不是整圈拿掉：拿掉的话那一格会缩一圈，
                  整排跟着抖一下 —— 而那一下抖动发生在人刚看完退出来的
                  时候，看着像出了什么错。灰边占一样的地方，只是不再喊人。
                */}
                <span
                  className={cx(
                    'inline-flex rounded-full border-2 p-0.5',
                    seen ? 'border-line' : 'border-brand-500',
                  )}
                >
                  <PhotoAvatar url={r.photo} name={r.name} avatar={r.avatar} size="lg" />
                </span>
                <span className="mt-1 block truncate text-caption">
                  {isMe ? t('我', 'You') : r.name}
                </span>
              </button>

              {/*
                自己已经发过了，「＋」就挂在自己那个圈的右下角。

                和 Instagram 一个摆法，而且是唯一说得通的摆法：
                点圈 = 看自己发的，点角上那个 = 再发一条。
                两件事都要有入口，而这一排只放得下一格。
              */}
              {isMe && entry === 'badge' && (
                <button
                  onClick={onNew}
                  aria-label={t('再发一条', 'Add another')}
                  className="bg-brand-600 text-canvas border-canvas absolute right-0 top-[48px] flex size-6 items-center justify-center rounded-full border-2 text-sm leading-none"
                >
                  +
                </button>
              )}
            </div>
          )
        })}
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
  onSeen,
}: {
  tellers: Teller[]
  /** 从第几个人开始。点哪个圈就是哪个 */
  start: number
  meUid: string | null
  onClose: () => void
  onDelete: (item: FeedItem) => void
  /** 这一条露过脸了。那一排圈圈靠它变灰 */
  onSeen?: (id: string) => void
}) {
  const t = useT()
  const [person, setPerson] = useState(start)
  const [idx, setIdx] = useState(0)
  /* 进度条重放用的。换一条就换一个 key，CSS 动画才会从头跑 */
  const tick = useRef(0)
  /*
   * 这一条如果是视频，它有多长（毫秒）。还没读到就是 null。
   *
   * 视频不能按五秒切：一段十五秒的片子放到第五秒被掐掉，人会以为
   * App 坏了。所以这一条在读到时长之前**不计时**，读到了就照它走。
   */
  const [clipMs, setClipMs] = useState<number | null>(null)

  const teller = rows[person]
  const item = teller?.items[idx]
  const url = item?.urls[0]
  const playing = url ? isVideo(url) : false

  /* 换一条就把上一条的时长忘掉，不然图片会继承视频的长度 */
  useEffect(() => {
    setClipMs(null)
  }, [person, idx])

  /*
   * 看到哪条就记哪条 —— 那一排圈圈靠它变灰。
   *
   * 记在「显示出来」这一刻，不是「看完」那一刻：跳着翻过去的也算看过，
   * 和 Instagram 一样。等看完才记的话，手快连点几下翻过去的那几条
   * 会一直留着，于是圈永远灭不掉。
   *
   * 跟的是 item?.id 而不是 item：每渲染一次那个对象都是新的，
   * 跟对象的话这个 effect 每次都跑，而 mark 里那句「记过就不记」
   * 才是最后拦住死循环的那一道。
   */
  useEffect(() => {
    if (item) onSeen?.(item.id)
  }, [item?.id, onSeen])

  /*
   * 视频十秒还没报出时长就别等了，按五秒走。
   *
   * 正常情况下 loadedmetadata 或者 error 总有一个会来。**但网卡在中间
   * 的时候两个都不来** —— 那时候没有计时器、没有 ended，这一条会永远
   * 停在那儿。人还能点右边翻页（那两块透明的按钮在最上层），但一个
   * 一动不动的黑屏看起来就是坏了。
   */
  useEffect(() => {
    if (!playing || clipMs !== null) return
    const id = setTimeout(() => setClipMs(STEP_MS), 10000)
    return () => clearTimeout(id)
  }, [playing, clipMs, person, idx])

  /*
   * 自己往下走。
   *
   * 照片五秒 —— 短了看不完一句话，长了让人觉得卡住了。
   * 视频按它自己的长度走（上面那段）。
   * 每换一条重置一次计时，包括手动点下一条的时候。
   */
  const stepMs = playing ? clipMs : STEP_MS
  useEffect(() => {
    if (!item || stepMs === null) return
    const id = setTimeout(() => next(), stepMs)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, idx, stepMs])

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
                  ? /*
                     * 进度条跟着这一条真正的长度跑。视频在读到时长之前
                     * 停在 0 —— 让它先按五秒跑再跳一下，比不动还难看。
                     */
                    stepMs === null
                    ? { width: 0 }
                    : { animation: `rally-story ${stepMs}ms linear forwards` }
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
          {url && playing ? (
            /*
              视频：自己播，播完自己翻页。

              playsInline 不能少 —— 没有它 iPhone 会把视频抢去全屏播，
              而那一层盖住了进度条、关掉按钮和「删掉」，退出来就是退出
              整个播放器。

              autoPlay 在手机上只有静音时一定成功。这里不写 muted，
              而是在 onPlay 失败时退回静音（下面那段）：能出声就出声，
              出不了声也别停在第一帧不动。
            */
            <video
              key={url}
              src={url}
              autoPlay
              playsInline
              controls={false}
              className="max-h-full max-w-full rounded-card object-contain"
              onLoadedMetadata={(e) => {
                const secs = e.currentTarget.duration
                /* 时长可能是 NaN 或者 Infinity（某些流式 mp4），那就退回五秒 */
                setClipMs(Number.isFinite(secs) && secs > 0 ? secs * 1000 : STEP_MS)
                const p = e.currentTarget.play()
                /*
                 * 带声音播不了就静音再试一次。不管的话 promise 被拒，
                 * 画面停在第一帧 —— 看起来和「这条坏了」一模一样。
                 */
                void p?.catch(() => {
                  e.currentTarget.muted = true
                  void e.currentTarget.play().catch(() => {})
                })
              }}
              /* 播完立刻翻页，不等计时器 —— 那两个数差几十毫秒 */
              onEnded={() => next()}
              /*
               * 放不出来（格式不认、文件没了）就当它是一条空的，往下走。
               * 不管的话这一条会永远停在那儿：没有计时器，也没有 ended。
               */
              onError={() => setClipMs(STEP_MS)}
            />
          ) : url ? (
            <img
              src={url}
              alt=""
              className="max-h-full max-w-full rounded-card object-contain"
            />
          ) : item.body ? (
            <p className="whitespace-pre-wrap break-words px-6 text-center text-h2 text-white">
              {item.body}
            </p>
          ) : (
            /*
             * 既没图也没字 —— 正常发不出这样一条（发的时候两样至少有
             * 一样）。走到这儿只有一种可能：照片已经不在桶里了，签不出
             * 地址。说一句，总比给人看一片黑好 —— 一片黑什么都不说，
             * 而人会以为是 App 坏了。
             */
            <p className="px-6 text-center text-label text-white/60">
              {t('这条看不了了 —— 照片已经不在了。', 'This one cannot be shown — the photo is gone.')}
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
