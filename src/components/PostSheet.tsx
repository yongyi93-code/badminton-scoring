import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, Sheet, cx, inputClass } from '@/components/ui'
import { checkFile } from '@/lib/photo'
import { BODY_MAX, MAX_PHOTOS, checkDraft, createPost, gridCols } from '@/lib/moments'

/* ------------------------------------------------------------------ *
 * 发一条动态
 *
 * 一段字、几张图，就这两样。没有定位、没有话题、没有「谁可以看」——
 * 最后一样不是漏了：这一版只有好友看得到，而一个只有一个选项的
 * 下拉框，比没有下拉框更让人以为自己漏看了什么。
 * （公开那一档要等封号做完，见 supabase/024-moments.sql 开头。）
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
    const r = await createPost({ body, files: pics.map((p) => p.file) })
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
            {busy ? t('正在发…', 'Posting…') : t('发出去', 'Post')}
          </Button>
        </div>

        <p className="text-ink-500 text-caption">
          {t(
            '只有好友看得到。照片会在你手机上先压小再上传 —— 顺带把里面的拍摄地点信息一起去掉。发出去之后改不了，只能删了重发。',
            'Only your friends can see this. Photos are shrunk on your phone before upload, which also strips the location data your camera embeds. Posts cannot be edited — delete and repost instead.',
          )}
        </p>
      </div>
    </Sheet>
  )
}
