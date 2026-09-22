import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { cx } from '@/components/ui'
import {
  AUDIO_BPS,
  HOLD_MS,
  MAX_RECORD_MS,
  VIDEO_BPS,
  gesture,
  pickMimeType,
} from '@/lib/camera'
import { mediaExt } from '@/lib/media'

/* ------------------------------------------------------------------ *
 * 相机
 *
 * 全屏取景器：轻点拍照，按住录像（最长 15 秒），左下角回相册。
 *
 * -------------------------------------------------------------------
 * 为什么不用系统那个
 *
 * `<input type="file" capture>` 在 iOS 上直接开取景器，可是在
 * **Android Chrome 上只有 accept 是单一一类时才认**。我们 accept 里
 * 图片和视频都要，于是 Chrome 当没看见，退回相册 —— 用户报的就是这个
 * （「点加后直接出album，没有跳出camera」）。
 *
 * accept 二选一的话，要么拍不了照、要么录不了像。所以只剩这条路。
 *
 * -------------------------------------------------------------------
 * 自己录还顺手把「太大了」这件事消掉了
 *
 * 系统相机录出来多大就是多大，只能等人拍完再说「超了 20MB」——
 * 最难受的一种拒绝。自己录就能先把码率定死：算下来满 15 秒也就 4.9 MB
 * （见 lib/camera.ts），永远撞不到上限。
 *
 * -------------------------------------------------------------------
 * 开不起来的时候退回系统那条路，不是报错了事
 *
 * 不给权限、设备没有摄像头、浏览器太老 —— 这三种都会走到 onFallback，
 * 由外面去开那个不带 capture 的 input。相机是更好的那条路，不是
 * 唯一那条路，挂了不该让人一条 Story 都发不了。
 * ------------------------------------------------------------------ */

export function Camera({
  open,
  onClose,
  onShot,
  onAlbum,
}: {
  open: boolean
  onClose: () => void
  /** 拍好了（一张照片或者一段视频） */
  onShot: (file: File) => void
  /** 改从相册选。相机开不起来的时候也走这里 */
  onAlbum: () => void
}) {
  const t = useT()
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const pressedAt = useRef(0)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [ready, setReady] = useState(false)
  const [taping, setTaping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* 把摄像头关掉。**每一条退出的路都要走到它** —— 不关的话那颗
     指示灯一直亮着，而人会以为这个 App 在偷拍 */
  const stop = useCallback(() => {
    recorder.current?.state === 'recording' && recorder.current.stop()
    recorder.current = null
    stream.current?.getTracks().forEach((k) => k.stop())
    stream.current = null
    setReady(false)
    setTaping(false)
  }, [])

  useEffect(() => {
    if (!open) {
      stop()
      return
    }
    let dead = false

    const start = async () => {
      const md = navigator.mediaDevices
      if (!md?.getUserMedia || typeof MediaRecorder === 'undefined') {
        onAlbum()
        return
      }
      const want = { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } }
      let s: MediaStream
      try {
        /*
         * 声音和画面一起要。失败了再只要画面 —— 有些设备没有麦克风，
         * 或者麦克风被别的 App 占着，而那时候**录一段没声音的**总比
         * 什么都录不了强。
         */
        s = await md.getUserMedia({ ...want, audio: true })
      } catch {
        try {
          s = await md.getUserMedia(want)
        } catch {
          if (!dead) {
            setError(
              t(
                '打不开相机 —— 多半是没给权限。改从相册选吧。',
                'Cannot open the camera — permission is probably off. Pick from the album instead.',
              ),
            )
          }
          return
        }
      }
      if (dead) {
        s.getTracks().forEach((k) => k.stop())
        return
      }
      stream.current = s
      if (video.current) {
        video.current.srcObject = s
        void video.current.play().catch(() => {})
      }
      setReady(true)
    }

    void start()
    return () => {
      dead = true
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facing])

  /* ---------------------------------------------------------------- *
   * 拍一张
   * ---------------------------------------------------------------- */
  const snap = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return
    /*
     * 画的是**没镜像的**那一面，虽然预览是镜像的。
     *
     * 和手机自带相机一个做法：照着镜子摆姿势，存下来是别人看你的样子。
     * 两边都镜像的话，照片里的字全是反的。
     */
    ctx.drawImage(v, 0, 0)
    c.toBlob(
      (b) => {
        if (!b) return
        onShot(new File([b], 'shot.jpg', { type: 'image/jpeg' }))
      },
      'image/jpeg',
      /* 0.92：这一张接下来还要过一遍压缩（createPost 里压到长边 1080），
         所以这儿不用省，省了是白白先糊一次 */
      0.92,
    )
  }

  /* ---------------------------------------------------------------- *
   * 录一段
   * ---------------------------------------------------------------- */
  const startTape = () => {
    const s = stream.current
    if (!s) return
    const type = pickMimeType((x) => MediaRecorder.isTypeSupported(x))
    if (!type) {
      setError(t('这台设备录不了视频，只能拍照', 'This device cannot record video — photos only'))
      return
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(s, {
      mimeType: type,
      /* 码率写死，所以录出来多大是**算得出来**的（见 lib/camera.ts） */
      videoBitsPerSecond: VIDEO_BPS,
      audioBitsPerSecond: AUDIO_BPS,
    })
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      setTaping(false)
      const blob = new Blob(chunks, { type })
      /* 一帧都没录到就当没发生 —— 手抖一下点出来的空文件发出去是一条坏 Story */
      if (blob.size === 0) return
      onShot(new File([blob], `clip.${mediaExt(type)}`, { type }))
    }
    recorder.current = rec
    rec.start()
    setTaping(true)
    /* 到点自己停。Story 本来也没人看完十五秒 */
    setTimeout(() => {
      if (recorder.current?.state === 'recording') recorder.current.stop()
    }, MAX_RECORD_MS)
  }

  const endTape = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  /* ---------------------------------------------------------------- *
   * 那一下：轻点 = 拍照，按住 = 录像
   *
   * 按下去先起一个 250ms 的表；表响了就开录，松手之前松了就是拍照。
   * 不能等松手才判断 —— 那样「按住」这件事在按住的时候没有任何反馈，
   * 人会以为没按到。
   * ---------------------------------------------------------------- */
  const down = () => {
    if (!ready) return
    pressedAt.current = Date.now()
    holdTimer.current = setTimeout(startTape, HOLD_MS)
  }

  const up = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    if (!ready) return
    if (gesture(Date.now() - pressedAt.current) === 'photo') snap()
    else endTape()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* 取景器 */}
      <div className="relative min-h-0 flex-1">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          className={cx(
            'size-full object-cover',
            /* 自拍要镜像，不然人抬左手屏幕上动的是右手，谁都摆不好姿势 */
            facing === 'user' && 'scale-x-[-1]',
          )}
        />

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8">
            <p className="text-center text-label text-white">{error}</p>
            <button
              onClick={onAlbum}
              className="bg-canvas text-ink-700 rounded-btn px-5 py-2.5 text-label font-medium"
            >
              {t('从相册选', 'Pick from album')}
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          aria-label={t('关掉', 'Close')}
          className="safe-top absolute left-2 top-2 flex size-10 items-center justify-center text-white"
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>

        {/* 录着的时候顶上有一条在走的红杠，看得出还剩多少 */}
        {taping && (
          <div className="absolute inset-x-0 top-0 h-1 bg-white/20">
            <div
              className="bg-danger-600 h-full"
              style={{ animation: `rally-story ${MAX_RECORD_MS}ms linear forwards` }}
            />
          </div>
        )}
      </div>

      {/* 底下那一排 */}
      <div className="safe-bottom flex items-center justify-between px-8 pb-6 pt-5">
        <button onClick={onAlbum} className="w-16 text-left text-caption text-white/80">
          {t('相册', 'Album')}
        </button>

        {/*
          快门。轻点拍照、按住录像 —— 那句话写在按钮底下，因为
          「按住」这件事没有任何视觉线索，不说没人会去试。

          用 pointer 事件而不是 click：click 只在松手时来一次，
          按住那一刻什么都拿不到。touch-none 挡住长按选中和滚动。
        */}
        <div className="flex flex-col items-center gap-2">
          <button
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            disabled={!ready}
            aria-label={t('拍照，按住录像', 'Tap for photo, hold for video')}
            className={cx(
              'flex size-[74px] touch-none items-center justify-center rounded-full border-4 transition-colors',
              taping ? 'border-danger-600' : 'border-white',
              !ready && 'opacity-40',
            )}
          >
            <span
              className={cx(
                'block rounded-full transition-all',
                taping ? 'bg-danger-600 size-7 rounded-lg' : 'size-[58px] bg-white',
              )}
            />
          </button>
          <span className="text-caption text-white/60">
            {taping ? t('松手结束', 'Release to stop') : t('轻点拍照 · 按住录像', 'Tap · hold to record')}
          </span>
        </div>

        <button
          onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
          aria-label={t('前后摄像头', 'Flip camera')}
          className="flex w-16 justify-end text-white/80"
        >
          {/* 转一圈的两支箭头 —— 「翻过来」这件事画成相机反而看不懂 */}
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              d="M4 9a8 8 0 0113.5-3.5L20 8M20 15a8 8 0 01-13.5 3.5L4 16"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M20 4v4h-4M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
