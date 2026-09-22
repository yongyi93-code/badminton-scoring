import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, Sheet, cx, inputClass } from '@/components/ui'
import { MAX_VIDEOS, MEDIA_ACCEPT, checkMedia, isVideoType } from '@/lib/media'
import {
  BODY_MAX,
  MAX_PHOTOS,
  checkDraft,
  composerSummary,
  createPost,
  defaultVisibility,
  gridCols,
  type Visibility,
} from '@/lib/moments'

/* ------------------------------------------------------------------ *
 * 发一条动态
 *
 * 一段字、几张图、谁看得到。没有定位、没有话题。
 *
 * 「谁看得到」这一档在 026 才开（024 里故意留着不做，等封号）。
 * 默认永远是「只有好友」—— 公开是一个要**特意去点**的选择，
 * 不是一个忘了改就生效的默认值。
 *
 * -------------------------------------------------------------------
 * 两组设置收起来（2026-09-21）
 *
 * 原来一打开就是两道选择题 —— 「谁看得到」两个按钮、「留多久」两个
 * 按钮，加上两段说明，正文框被挤到最上面一小条。从那一排圈圈的
 * 「＋」进来的人想做的是**发一条会消失的**，而这件事在他点那个
 * 「＋」的时候就已经说过了，进来再问一遍是在问一个已经答过的问题。
 *
 * 现在：默认那一档（只有好友 · 24 小时）直接可以发，两组设置收在
 * 一行摘要后面，要改才点开。
 *
 * **收起来不等于藏起来**，这是这一版唯一要小心的地方：这两件事发出去
 * 之后都改不了，所以当前是哪一档必须一直看得见 —— 那一行摘要
 * （composerSummary）和按钮上那句话就是为此留的，不是装饰。
 * 「公开」那段警告也还在原处：它只可能在人**刚点下公开**的那一下
 * 出现，而那正是它该出现的时候。
 * ------------------------------------------------------------------ */

type Picked = { file: File; url: string }

export function PostSheet({
  open,
  onClose,
  onDone,
  story: storyDefault = false,
  initialFiles,
}: {
  open: boolean
  onClose: () => void
  /** 发出去之后让外面那一屏重新刷 */
  onDone: () => void
  /**
   * 打开的时候就是「24 小时后消失」那一档（028）。
   *
   * 从顶上那一排圈圈的「＋」进来时是真：人点的是 Story 那个入口，
   * 再让他自己去勾一下开关，等于那个入口没意思。
   */
  story?: boolean
  /**
   * 打开之前就已经选好的照片。
   *
   * 给那一排圈圈的「＋」用：它在**点下去那一刻**就把相册开起来了
   * （见 StoryStrip），选完照片才轮到这张纸。所以照片是跟着
   * 「打开」一起到的，不是进来之后再挑的。
   *
   * 为什么不由这张纸自己去开相册：Safari 只认**用户手势那一下**，
   * 等弹层开了再用 effect 去 click 那个 input 会被静悄悄挡掉 ——
   * 而「点了没反应」是最难查的一类。
   */
  initialFiles?: File[]
}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [body, setBody] = useState('')
  const [pics, setPics] = useState<Picked[]>([])
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility)
  const [story, setStory] = useState(storyDefault)
  /** 两组设置摊开了没有。每次打开都从收起来开始 */
  const [settings, setSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * 预览用的那些 blob: 地址是**手动申请的内存**，不撤掉就一直占着。
   * 选了又删、删了又选几轮之后，那是几十兆的照片留在内存里。
   */
  useEffect(() => {
    return () => {
      for (const p of pics) URL.revokeObjectURL(p.url)
    }
  }, [pics])

  /* 关掉就清空：下次打开不该还留着上次没发出去的半条 */
  useEffect(() => {
    if (open) return
    setBody('')
    setPics((old) => {
      for (const p of old) URL.revokeObjectURL(p.url)
      return []
    })
    /* 每次都退回「只有好友」—— 上一条选了公开不该把下一条也带成公开 */
    setVisibility(defaultVisibility)
    /* 设置也收回去：上一条特意点开过，不代表下一条也要先看两道选择题 */
    setSettings(false)
    setError(null)
  }, [open])

  /*
   * 打开的那一下决定这是「动态」还是「Story」。
   *
   * 放在打开时而不是关闭时：从「＋」进来的那一次，外面是**同时**
   * 把「开」和「是 Story」两件事设过来的 —— 只在关闭时读 storyDefault
   * 的话，读到的永远是上一次那个值，于是从 Story 入口进来却发成了动态。
   */
  useEffect(() => {
    if (open) setStory(storyDefault)
  }, [open, storyDefault])

  const add = (files: File[]) => {
    const room = MAX_PHOTOS - pics.length
    if (room <= 0) {
      setError(t(`最多 ${MAX_PHOTOS} 张`, `${MAX_PHOTOS} photos max`))
      return
    }
    const taking = files.slice(0, room)
    /* 挑完立刻判一次，别等压了几秒才说不行 —— 和头像那边同一条 */
    for (const f of taking) {
      const bad = checkMedia(f)
      if (bad) {
        setError(bad)
        return
      }
    }
    /*
     * 视频只放得下一段（理由是流量，见 lib/media.ts）。在这儿就挡住，
     * 别等传完两段几十兆才在 createPost 里被拒。
     */
    const videos = [...pics.map((p) => p.file), ...taking].filter((f) => isVideoType(f.type))
    if (videos.length > MAX_VIDEOS) {
      setError(t('一条里只能放一段视频', 'Only one video per post'))
      return
    }
    setError(null)
    setPics((old) => [...old, ...taking.map((f) => ({ file: f, url: URL.createObjectURL(f) }))])
  }

  /*
   * 外面选好的那几张，放进来。
   *
   * 走的是上面那个 add，不是直接 setPics —— 张数上限、格式、大小
   * 那几道判断只有一份，外面进来的不该有第二条规矩。
   *
   * 认的是**这个数组换了没有**：外面每挑一次给一个新数组，所以
   * 同一批不会被加两遍，而挑两次会各加一次。
   *
   * StrictMode 会不会把它加两遍？不会 —— 真浏览器里开着 StrictMode
   * 量过，一张就是一张。StrictMode 只在**挂载**那一次重跑 effect，
   * 而这张纸是一直挂着的（关着的时候 Sheet 自己返回 null），
   * 挂载那一刻 initialFiles 还是空的，被上面那句挡掉了。
   */
  useEffect(() => {
    if (!open || !initialFiles?.length) return
    add(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles])

  const drop = (i: number) => {
    setPics((old) => {
      URL.revokeObjectURL(old[i].url)
      return old.filter((_, k) => k !== i)
    })
  }

  const send = async () => {
    const bad = checkDraft({
      body,
      count: pics.length,
      videos: pics.filter((p) => isVideoType(p.file.type)).length,
    })
    if (bad) {
      setError(bad)
      return
    }
    setBusy(true)
    setError(null)
    const r = await createPost({ body, files: pics.map((p) => p.file), visibility, story })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onDone()
    onClose()
  }

  const left = BODY_MAX - body.trim().length
  const empty = !body.trim() && pics.length === 0

  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={story ? t('发一条会消失的', 'New story') : t('发动态', 'New post')}
    >
      <div className="space-y-4">
        {pics.length > 0 && (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${gridCols(pics.length)}, minmax(0, 1fr))` }}
          >
            {pics.map((p, i) => (
              <div key={p.url} className="relative">
                {/*
                  视频用 <video> 画第一帧，不是一个灰块加个播放图标：
                  人要看得出自己刚拍的是哪一段。muted + playsInline 是
                  iOS 上能显示出画面的最低条件，少一个就是一片黑。
                */}
                {isVideoType(p.file.type) ? (
                  <video
                    src={p.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="bg-fill aspect-square w-full rounded-lg object-cover"
                  />
                ) : (
                  <img
                    src={p.url}
                    alt=""
                    className="bg-fill aspect-square w-full rounded-lg object-cover"
                  />
                )}
                <button
                  onClick={() => drop(i)}
                  disabled={busy}
                  aria-label={t('去掉这张', 'Remove')}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/*
          文字在照片下面。

          点「＋」直接开相册之后，走到这张纸的时候照片已经在手上了 ——
          它才是这一条的内容，那一段字是配的。把空文本框摆在照片上面
          会让人以为「还得先写点什么」。
        */}
        <textarea
          className={cx(inputClass, 'min-h-28 resize-none')}
          value={body}
          disabled={busy}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('今晚打得怎么样？', 'How did it go tonight?')}
          aria-label={t('说点什么', 'Say something')}
        />
        {/* 字数只在快满的时候出现 —— 平时它是噪音 */}
        {left < 100 && (
          <p className={cx('text-right text-caption', left < 0 ? 'text-danger-600' : 'text-ink-500')}>
            {left}
          </p>
        )}

        {/*
          这一个**不带 capture**：它是「从相册里挑」那条路。
          那一排圈圈的「＋」才是相机（见 StoryStrip），两个入口各管一头。
        */}
        <input
          ref={input}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            /*
             * 先把 FileList 摊成数组，**再**清空 value。
             *
             * 顺序反过来一张图都进不来，而且一声不响：input.files 是一个
             * **活的**引用，清掉 value 的同时它就空了 —— 手里拿着的那个
             * 列表长度变成 0。头像那边是 files?.[0]，当场把 File 取出来了，
             * 所以没踩到；这里选的是多张，留着列表就中招。
             * （在真浏览器里看出来的：选完四张，什么都没出现。）
             *
             * 清 value 本身不能省：不清的话，选同一批照片第二次不触发 change。
             */
            const picked = e.target.files ? [...e.target.files] : []
            e.target.value = ''
            if (picked.length) add(picked)
          }}
        />

        {error && (
          <div className="border-danger-600/30 bg-danger-50 rounded-card border p-3.5">
            <p className="text-ink-700 text-caption">{error}</p>
          </div>
        )}

        {/* ---------------------------------------------------------- *
          两组设置的入口，兼它们收起来之后唯一还看得见的地方。

          做成一整行可点，不是一个小小的齿轮：这一行左边那句话本身
          就是信息（「只有好友 · 24 小时后消失」），而人想改的时候
          最先去点的就是它。
        * ---------------------------------------------------------- */}
        <button
          onClick={() => setSettings((s) => !s)}
          disabled={busy}
          aria-expanded={settings}
          className="border-line bg-fill flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left"
        >
          <span className="text-ink-500 min-w-0 flex-1 truncate text-caption">
            {composerSummary(visibility, story)}
          </span>
          <span className="shrink-0 text-caption font-medium">
            {settings ? t('收起', 'Hide') : t('设置', 'Settings')}
          </span>
          <svg
            viewBox="0 0 24 24"
            className={cx('size-4 shrink-0 transition-transform', settings && 'rotate-180')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {settings && (
          <div className="space-y-4">
            {/* ---------------------------------------------------------- *
              谁看得到。

              两个按钮，不是一个开关 —— 开关要人先读懂「开」是哪一边，
              而这件事读错的代价是把一条私事发给了全世界。
            * ---------------------------------------------------------- */}
            <div>
              <p className="text-label font-medium">{t('谁看得到', 'Who can see this')}</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {(
                  [
                    {
                      v: 'friends' as Visibility,
                      title: t('只有好友', 'Friends only'),
                      hint: t('和以前一样', 'Same as before'),
                    },
                    {
                      v: 'public' as Visibility,
                      title: t('公开', 'Public'),
                      hint: t('陌生人点进你主页也看得到', 'Anyone who opens your profile'),
                    },
                  ]
                ).map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setVisibility(o.v)}
                    disabled={busy}
                    className={cx(
                      'rounded-lg border px-3 py-2 text-left',
                      visibility === o.v ? 'border-brand-500 bg-brand-100' : 'border-line bg-surface',
                    )}
                  >
                    <span className="block text-caption font-medium">{o.title}</span>
                    <span className="text-ink-500 block text-caption">{o.hint}</span>
                  </button>
                ))}
              </div>
              {/*
                公开的代价要在**按下之前**说，而且要说全。
            
                第二句是很多人想不到的：公开一条动态，等于同时把自己的
                名字和头像对所有登录的人打开 —— 不然那条动态上没有作者，
                而一条没有作者的动态没法看。这是 026 里那条 profiles 策略
                的直接后果，不是可选项。
              */}
              {visibility === 'public' && (
                <div className="border-warning-600/30 bg-warning-50 mt-2 rounded-card border p-3">
                  <p className="text-ink-700 text-caption">
                    {t(
                      '公开之后，任何登录的人点进你的个人主页都看得到这一条 —— 包括还没加你好友的人。',
                      'Anyone signed in who opens your profile will see this one — including people who are not your friends.',
                    )}
                  </p>
                  <p className="text-ink-700 mt-1.5 text-caption">
                    {t(
                      '而且你的名字和头像也会跟着对所有人可见 —— 一条动态总要看得出是谁发的。',
                      'Your name and photo become visible to everyone too — a post has to show who wrote it.',
                    )}
                  </p>
                  <p className="text-ink-700 mt-1.5 text-caption">
                    {t(
                      '拉黑过的人还是看不到。发出去之后改不了，只能删。',
                      'People you blocked still cannot see it. This cannot be changed later — only deleted.',
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* ---------------------------------------------------------- *
              留多久（028）。

              和上面「谁看得到」同一种摆法，理由也同一条：这是一个**读错
              了会后悔**的选择。一条本想留着的动态第二天没了，和一条本想
              第二天就没的动态永远留着 —— 两个方向都难受，而开关要人先
              猜「开」是哪一边。

              默认永远是「一直在」：会消失是一个要特意去点的选择。
            * ---------------------------------------------------------- */}
            <div>
              <p className="text-label font-medium">{t('留多久', 'How long it stays')}</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {(
                  [
                    {
                      v: false,
                      title: t('一直在', 'Keep it'),
                      hint: t('普通动态', 'A normal post'),
                    },
                    {
                      v: true,
                      title: t('24 小时后消失', 'Gone in 24h'),
                      hint: t('摆在朋友圈最上面那一排', 'Shows in the ring row on top'),
                    },
                  ] as const
                ).map((o) => (
                  <button
                    key={String(o.v)}
                    onClick={() => setStory(o.v)}
                    disabled={busy}
                    className={cx(
                      'rounded-lg border px-3 py-2 text-left',
                      story === o.v ? 'border-brand-500 bg-brand-100' : 'border-line bg-surface',
                    )}
                  >
                    <span className="block text-caption font-medium">{o.title}</span>
                    <span className="text-ink-500 block text-caption">{o.hint}</span>
                  </button>
                ))}
              </div>
              {/*
                「消失」这两个字要兑现，所以这里把它到底消失到什么程度说清楚：
                时间到了连你自己都看不到（028 那条策略里写死的），照片也是真删。
                说成「别人看不到了」是在留后路，而人是按字面意思信的。
              */}
              {story && (
                <div className="border-line bg-fill mt-2 rounded-card border p-3">
                  <p className="text-ink-700 text-caption">
                    {t(
                      '24 小时之后这一条会真的没掉 —— 连你自己也看不到，照片也会从云端删掉。',
                      'After 24 hours this is really gone — you will not see it either, and the photos are deleted from the cloud.',
                    )}
                  </p>
                  <p className="text-ink-700 mt-1.5 text-caption">
                    {t(
                      '看过的人截过图的话，那张图还在他手机上 —— 这一点谁也管不了。',
                      'If someone screenshotted it, that copy is on their phone — nothing can undo that.',
                    )}
                  </p>
                </div>
              )}
            </div>

            {/*
              这段小字跟着设置一起收。

              它说的是三件「发出去之后才发现就晚了」的事（照片会被压小、
              定位信息会去掉、发完改不了），但都不是**按下去之前非看不可**
              的 —— 真要紧的那一件（这一条会不会消失、谁看得到）写在上面
              那一行摘要和按钮上。摆在外面的话，每次发一条都要先跨过一段
              没人再读第二遍的字。
            */}
            <p className="text-ink-500 text-caption">
              {t(
                '照片会在你手机上先压小再上传 —— 顺带把里面的拍摄地点信息一起去掉。发出去之后改不了（包括「谁看得到」和「留多久」），只能删了重发。',
                'Photos are shrunk on your phone before upload, which also strips the location data your camera embeds. Nothing can be edited afterwards — including who can see it and how long it stays. Delete and repost instead.',
              )}
            </p>
            {/*
              视频这条要单独说，因为它和照片那条**不一样**：视频是原样
              传上去的，没压过。所以一条里只放得下一段，而且太长了会被
              拦住 —— 与其让人拍完三十秒才被拒，不如先说。
            */}
            <p className="text-ink-500 text-caption">
              {t(
                '视频不压，原样上传 —— 所以一条里只能放一段，而且要小于 20MB（大概十几秒）。拍长了会发不出去。',
                'Videos are uploaded as-is, not compressed — one per post, under 20MB (roughly 15 seconds). Longer clips will be rejected.',
              )}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Button
            block
            disabled={busy || pics.length >= MAX_PHOTOS}
            onClick={() => input.current?.click()}
          >
            {pics.length === 0
              ? t('加照片或视频', 'Add photos or video')
              : t(`再加（${pics.length}/${MAX_PHOTOS}）`, `Add more (${pics.length}/${MAX_PHOTOS})`)}
          </Button>
          <Button block variant="primary" disabled={busy || empty} onClick={() => void send()}>
            {busy
              ? t('正在发…', 'Posting…')
              : story
                ? /* 会消失这件事写在按钮上 —— 那是按下去之前最后一次机会 */
                  visibility === 'public'
                  ? t('公开发出去（24 小时）', 'Post publicly (24h)')
                  : t('发给好友（24 小时）', 'Post to friends (24h)')
                : visibility === 'public'
                  ? t('公开发出去', 'Post publicly')
                  : t('发给好友', 'Post to friends')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
