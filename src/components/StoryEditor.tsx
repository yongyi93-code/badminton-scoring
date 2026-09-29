import { useEffect, useRef, useState } from 'react'
import { useT, pick } from '@/lib/i18n'
import { Button, cx } from '@/components/ui'
import {
  FILTERS,
  TEXT_COLORS,
  TEXT_SIZES,
  edited,
  filterCss,
  hasText,
  layout,
  newTextLayer,
  toFraction,
  type TextLayer,
  type TextSize,
} from '@/lib/storyEdit'

/* ------------------------------------------------------------------ *
 * 拍完之后那一屏：调个色、写句话
 *
 * -------------------------------------------------------------------
 * 只管照片，视频原样过去
 *
 * 照片能改是因为画布上重画一遍就完事了。视频不行 —— 要把滤镜和文字
 * **烧进**视频里得整段重新编码（WebCodecs 或者 ffmpeg.wasm），
 * 一段 15 秒的片子要在手机上转十几二十秒，而且 iOS 上那套接口还缺。
 *
 * 另一条路是「只存一个滤镜名字，播的时候再套上去」，但那样发出去的
 * 就不是人看到的那个东西 —— 存下来的还是原片。与其做一个看起来能用、
 * 实际没烧进去的东西，不如现在就说清楚：视频这一版直接过。
 *
 * -------------------------------------------------------------------
 * 预览和成图走同一套数
 *
 * 位置和字号都是比例（见 lib/storyEdit），预览用它算 CSS，导出用它
 * 算画布坐标 —— 同一个 layout() 函数。两边各写一遍才是这种功能
 * 最常见的错法：屏幕上贴着右下角，发出去飘到中间。
 * ------------------------------------------------------------------ */

type Props = {
  /** 拍到或选到的那一个文件。null = 这一屏不出现 */
  file: File | null
  onCancel: () => void
  /** 改完了。没动过的话递回来的就是原来那个 File */
  onDone: (file: File) => void
}

export function StoryEditor({ file, onCancel, onDone }: Props) {
  const t = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [filterId, setFilterId] = useState('none')
  const [layer, setLayer] = useState<TextLayer | null>(null)
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  /*
   * 量一下预览框有多大。
   *
   * 屏幕上那行字的字号必须用**和导出时同一个 layout()** 算出来，
   * 所以得先知道这个框多宽。本来写的是 CSS 的 cqw，但那要靠
   * container-type，而一个元素不能拿自己当容器 —— 那样算出来的
   * 是另一个尺寸，预览和成图当场就对不上了。
   */
  const [box, setBox] = useState({ w: 0, h: 0 })

  const isVideo = !!file && file.type.startsWith('video/')

  /*
   * objectURL 用完必须撤，不撤就是一张整图留在内存里 ——
   * 连拍十几张之后 iOS 会直接把这一页踢掉。
   */
  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(file)
    setUrl(u)
    setFilterId('none')
    setLayer(null)
    setErr(null)
    return () => URL.revokeObjectURL(u)
  }, [file])

  /* 框的大小会变（转屏、键盘弹出），所以一直盯着 */
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [url])

  if (!file || !url) return null

  const css = filterCss(filterId)

  /* 手指按在字上拖：算出它落在预览框的百分之几 */
  const drag = (e: React.PointerEvent) => {
    if (!layer || !stage.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const box = stage.current?.getBoundingClientRect()
      if (!box) return
      setLayer((old) =>
        old
          ? {
              ...old,
              x: toFraction(ev.clientX - box.left, box.width),
              y: toFraction(ev.clientY - box.top, box.height),
            }
          : old,
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  async function finish() {
    if (!file) return
    /* 一处没动就把原文件原样递回去，别再编码一遍把照片弄糊 */
    if (isVideo || !edited(filterId, layer)) {
      onDone(file)
      return
    }
    setBusy(true)
    try {
      onDone(await bake(file, filterId, layer))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-court fixed inset-0 z-50 flex flex-col">
      {/* 画面。黑底上留白，横图竖图都整张看得见 */}
      <div className="relative min-h-0 flex-1 bg-black">
        <div ref={stage} className="absolute inset-0 overflow-hidden">
          {isVideo ? (
            <video
              src={url}
              className="h-full w-full object-contain"
              playsInline
              muted
              loop
              autoPlay
            />
          ) : (
            <img
              src={url}
              alt=""
              className="h-full w-full object-contain"
              style={{ filter: css || undefined }}
            />
          )}

          {/*
            屏幕上这行字用的是同一套比例：left/top 是百分比，
            字号按预览框的宽度算 —— 和导出时 layout() 算的是同一个数。
          */}
          {hasText(layer) && (
            <div
              onPointerDown={drag}
              className="absolute touch-none px-2 text-center font-semibold select-none"
              style={{
                left: `${layer.x * 100}%`,
                top: `${layer.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                /* 和导出时同一个函数、同一套比例 —— 所见即所得就靠这一行 */
                fontSize: `${layout(layer, box.w, box.h).fontPx}px`,
                lineHeight: 1.25,
                color: layer.color,
                textShadow: '0 2px 10px rgb(0 0 0 / 0.45)',
                maxWidth: '92%',
                whiteSpace: 'pre-wrap',
              }}
            >
              {layer.text}
            </div>
          )}
        </div>

        <button
          onClick={onCancel}
          aria-label={t('返回', 'Back')}
          className="absolute top-3 left-3 flex size-10 items-center justify-center rounded-full bg-black/45 text-white"
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 18 9 12l6-6" />
          </svg>
        </button>

        {!isVideo && (
          <button
            onClick={() => {
              setLayer((old) => old ?? newTextLayer(''))
              setTyping(true)
            }}
            className="absolute top-3 right-3 rounded-full bg-black/45 px-3.5 py-2 text-caption font-semibold text-white"
          >
            {hasText(layer) ? t('改文字', 'Edit text') : t('加文字', 'Add text')}
          </button>
        )}
      </div>

      {/* ---------------------------------------------------------- *
        底下那条。视频这一版没有滤镜可选，所以干脆说一句，
        而不是摆一排点了没反应的按钮。
      * ---------------------------------------------------------- */}
      <div className="safe-bottom bg-court px-3 pt-3">
        {isVideo ? (
          <p className="pb-3 text-center text-caption text-white/70">
            {t(
              '视频这一版还不能加滤镜和文字 —— 要把效果烧进视频得整段重编码，手机上太慢。照片可以。',
              'Effects are photo-only for now — burning them into a video means re-encoding the whole clip, which is too slow on a phone.',
            )}
          </p>
        ) : (
          <>
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-3">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterId(f.id)}
                  className="w-16 shrink-0"
                >
                  <span
                    className={cx(
                      'block h-16 w-16 overflow-hidden rounded-xl border-2',
                      filterId === f.id ? 'border-accent' : 'border-white/20',
                    )}
                  >
                    {/* 每一格就是这张图本人套上那个滤镜 —— 比色卡直观得多 */}
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                      style={{ filter: f.css || undefined }}
                    />
                  </span>
                  <span
                    className={cx(
                      'mt-1 block text-center text-caption',
                      filterId === f.id ? 'text-accent' : 'text-white/70',
                    )}
                  >
                    {t(f.zh, f.en)}
                  </span>
                </button>
              ))}
            </div>

            {hasText(layer) && (
              <div className="flex items-center gap-2 pb-3">
                <div className="flex gap-1.5">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setLayer((old) => (old ? { ...old, color: c } : old))}
                      aria-label={c}
                      className={cx(
                        'size-7 rounded-full border-2',
                        layer.color === c ? 'border-accent' : 'border-white/30',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="ml-auto flex gap-1">
                  {(Object.keys(TEXT_SIZES) as TextSize[]).map((k) => (
                    <button
                      key={k}
                      onClick={() =>
                        setLayer((old) => (old ? { ...old, size: TEXT_SIZES[k] } : old))
                      }
                      className={cx(
                        'rounded-lg px-2.5 py-1 text-caption',
                        layer.size === TEXT_SIZES[k]
                          ? 'bg-accent text-on-accent font-semibold'
                          : 'bg-white/15 text-white',
                      )}
                    >
                      {k === 'sm' ? t('小', 'S') : k === 'md' ? t('中', 'M') : t('大', 'L')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {err && <p className="pb-2 text-center text-caption text-white">{err}</p>}

        {/* ---------------------------------------------------------- *
          这两个按钮不能用 Button 的 primary/soft。

          primary 是 brand-solid，而 brand-solid 和这条底色 court
          **是同一个深绿** —— 主按钮会整个隐进背景里，实测就是这样。
          深绿底上那个「现在就点这里」正是柠檬绿存在的理由（见
          index.css 里 accent 那段：一屏最多一枚），这里就是那一枚。
        * ---------------------------------------------------------- */}
        <div className="flex gap-2 pb-3">
          <button
            onClick={onCancel}
            className="h-12 flex-1 rounded-btn bg-white/15 text-body text-white active:bg-white/25"
          >
            {t('重拍', 'Retake')}
          </button>
          <button
            disabled={busy}
            onClick={() => void finish()}
            className="bg-accent text-on-accent active:bg-accent-press h-12 flex-1 rounded-btn text-body font-semibold disabled:opacity-60"
          >
            {busy ? t('处理中…', 'Working…') : t('下一步', 'Next')}
          </button>
        </div>
      </div>

      {/*
        打字用系统输入框，不在图上直接编辑。

        在图上直接敲字的话，手机键盘一弹出来就把图顶走一半，人看不到
        自己写的落在哪 —— 而落在哪正是这一步唯一要决定的事。
        先把字打完，回到图上再拖。
      */}
      {typing && (
        <div className="fixed inset-0 z-10 flex items-end bg-black/70 p-4">
          <div className="bg-surface w-full rounded-2xl p-4">
            <textarea
              autoFocus
              rows={2}
              value={layer?.text ?? ''}
              onChange={(e) =>
                setLayer((old) => ({ ...(old ?? newTextLayer()), text: e.target.value }))
              }
              placeholder={t('写点什么…', 'Say something…')}
              className="border-line bg-fill text-ink-900 placeholder:text-ink-500 focus:border-brand-600 w-full resize-none rounded-xl border px-3.5 py-2.5 text-[15px] focus:outline-none"
            />
            <div className="mt-3 flex gap-2">
              <Button
                block
                variant="soft"
                onClick={() => {
                  setLayer(null)
                  setTyping(false)
                }}
              >
                {t('删掉这行字', 'Remove')}
              </Button>
              <Button block variant="primary" onClick={() => setTyping(false)}>
                {t('好了', 'Done')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 把滤镜和文字画进图里
 *
 * 按**原图尺寸**画，不按屏幕尺寸 —— 照着预览框那 360 宽画出来，
 * 发出去就是一张糊的。位置和字号靠 layout() 换算回原图坐标。
 * ------------------------------------------------------------------ */
async function bake(file: File, filterId: string, layer: TextLayer | null): Promise<File> {
  const bitmap = await decode(file)
  try {
    const canvas = document.createElement('canvas')
    /* <img> 的 width/height 会被 CSS 影响，naturalWidth 才是原图尺寸 */
    canvas.width = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width
    canvas.height = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(pick('这台设备画不了图', 'This device cannot draw images'))

    const css = filterCss(filterId)
    if (css) ctx.filter = css
    ctx.drawImage(bitmap, 0, 0)
    /* 滤镜只作用在照片上，文字不跟着一起变灰变旧 */
    ctx.filter = 'none'

    if (hasText(layer)) {
      const { x, y, fontPx } = layout(layer, canvas.width, canvas.height)
      ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, 'PingFang SC', 'Noto Sans SC', sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      /*
       * 字底下垫一层阴影。
       * 白字压在浅色的天空或者球馆灯光上是看不见的 ——
       * 而人在预览里看得见（那边有 text-shadow），发出去却没有，
       * 正是「所见非所得」的一种。
       */
      ctx.shadowColor = 'rgb(0 0 0 / 0.5)'
      ctx.shadowBlur = Math.round(fontPx * 0.35)
      ctx.shadowOffsetY = Math.round(fontPx * 0.06)
      ctx.fillStyle = layer.color
      /* 手动断行：canvas 不会自己换行，长句子会直接冲出画面两边 */
      const lines = wrap(ctx, layer.text, canvas.width * 0.92)
      const lineH = fontPx * 1.25
      const top = y - ((lines.length - 1) * lineH) / 2
      lines.forEach((ln, i) => ctx.fillText(ln, x, top + i * lineH))
    }

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', 0.9),
    )
    if (!blob) throw new Error(pick('这台设备导不出图', 'This device cannot export the image'))
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } finally {
    /* <img> 那条路没有 close()，只有 ImageBitmap 有 */
    if ('close' in bitmap) bitmap.close()
  }
}

/**
 * 解出这张图，三条路依次试。
 *
 * 1. `imageOrientation: 'from-image'` —— 相册里的照片常带 EXIF 方向，
 *    不认它的话竖着拍的会横躺过来，而人在预览里看到的是正的
 *    （<img> 一直都认 EXIF）。所以这是首选。
 *
 * 2. 不带那个选项再来一次 —— **Safari 认 createImageBitmap，
 *    但那个选项袋是后来才支持的**。老一点的 iOS 上第一条会直接抛，
 *    而抛出来的样子是「点了下一步，蹦一行红字」，人看到的就是
 *    「这个编辑器用不了」。这一步宁可方向可能不对，也要出得了图。
 *
 * 3. 连 createImageBitmap 都没有，就走 <img> + objectURL 那条老路。
 *
 * 一条也走不通才算真的失败。这一段是照着「我没法在 iOS 上验」
 * 写的：验不了的地方就别只留一条路。
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      try {
        return await createImageBitmap(file)
      } catch {
        /* 掉到下面那条 */
      }
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = () => rej(new Error(pick('这张图打不开', 'Could not open this image')))
      img.src = url
    })
  } finally {
    /*
     * 撤得掉是因为 <img> 已经 onload 了 —— 画到画布上不再需要这个地址。
     * 不撤的话每改一张图就在内存里留一整张。
     */
    URL.revokeObjectURL(url)
  }
}

/**
 * 断行。
 *
 * 先按人自己敲的换行分段，每段再按宽度断 —— 中文一个字一个字试，
 * 英文按词试，不然一个长单词会被从中间劈开。
 */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    /* 把连续的拉丁字母当一个整体，其余一个字符一个单位 */
    for (const piece of para.match(/[A-Za-z0-9'’-]+\s*|\s+|[^\s]/g) ?? []) {
      const next = line + piece
      if (line && ctx.measureText(next.trimEnd()).width > max) {
        out.push(line.trimEnd())
        line = piece.trimStart()
      } else {
        line = next
      }
    }
    out.push(line.trimEnd())
  }
  /* 空行只有在整段都是空的时候才留一个，否则会在图上撑出一片空白 */
  return out.length === 1 ? out : out.filter((l) => l.length > 0)
}
