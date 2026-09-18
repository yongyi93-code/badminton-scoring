import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, Sheet, cx, inputClass } from '@/components/ui'
import { checkFile } from '@/lib/photo'
import {
  BODY_MAX,
  MAX_PHOTOS,
  checkDraft,
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
 * ------------------------------------------------------------------ */

type Picked = { file: File; url: string }

export function PostSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  /** 发出去之后让外面那一屏重新刷 */
  onDone: () => void
}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [body, setBody] = useState('')
  const [pics, setPics] = useState<Picked[]>([])
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility)
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
    setError(null)
  }, [open])

  const add = (files: File[]) => {
    const room = MAX_PHOTOS - pics.length
    if (room <= 0) {
      setError(t(`最多 ${MAX_PHOTOS} 张`, `${MAX_PHOTOS} photos max`))
      return
    }
    const taking = files.slice(0, room)
    /* 挑完立刻判一次，别等压了几秒才说不行 —— 和头像那边同一条 */
    for (const f of taking) {
      const bad = checkFile(f)
      if (bad) {
        setError(bad)
        return
      }
    }
    setError(null)
    setPics((old) => [...old, ...taking.map((f) => ({ file: f, url: URL.createObjectURL(f) }))])
  }

  const drop = (i: number) => {
    setPics((old) => {
      URL.revokeObjectURL(old[i].url)
      return old.filter((_, k) => k !== i)
    })
  }

  const send = async () => {
    const bad = checkDraft({ body, count: pics.length })
    if (bad) {
      setError(bad)
      return
    }
    setBusy(true)
    setError(null)
    const r = await createPost({ body, files: pics.map((p) => p.file), visibility })
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
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={t('发动态', 'New post')}>
      <div className="space-y-4">
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

        {pics.length > 0 && (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${gridCols(pics.length)}, minmax(0, 1fr))` }}
          >
            {pics.map((p, i) => (
              <div key={p.url} className="relative">
                <img
                  src={p.url}
                  alt=""
                  className="bg-fill aspect-square w-full rounded-lg object-cover"
                />
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

        <input
          ref={input}
          type="file"
          accept="image/*"
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

        <div className="space-y-2">
          <Button
            block
            disabled={busy || pics.length >= MAX_PHOTOS}
            onClick={() => input.current?.click()}
          >
            {pics.length === 0
              ? t('加照片', 'Add photos')
              : t(`再加（${pics.length}/${MAX_PHOTOS}）`, `Add more (${pics.length}/${MAX_PHOTOS})`)}
          </Button>
          <Button block variant="primary" disabled={busy || empty} onClick={() => void send()}>
            {busy
            ? t('正在发…', 'Posting…')
            : visibility === 'public'
              ? t('公开发出去', 'Post publicly')
              : t('发给好友', 'Post to friends')}
          </Button>
        </div>

        <p className="text-ink-500 text-caption">
          {t(
            '照片会在你手机上先压小再上传 —— 顺带把里面的拍摄地点信息一起去掉。发出去之后改不了（包括「谁看得到」），只能删了重发。',
            'Photos are shrunk on your phone before upload, which also strips the location data your camera embeds. Nothing can be edited afterwards — including who can see it. Delete and repost instead.',
          )}
        </p>
      </div>
    </Sheet>
  )
}
