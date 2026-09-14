import { useT } from '@/lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { Button, cx } from '@/components/ui'
import {
  MAX_VOICE_MS,
  startRecording,
  voiceLength,
  voiceUrl,
  type Recorder,
  type Recording,
} from '@/lib/voice'

/* ------------------------------------------------------------------ *
 * 语音消息的两块界面
 *
 *   VoiceRecorder  按下去开始录，录完再决定发不发
 *   VoiceBubble    对话里那个能点开听的气泡
 *
 * 录音这件事没有做成「按住说话」。
 *
 * 那是微信的做法，大家也熟，但在网页里它很脆：手指一滑就变成
 * 滚动，pointer 事件被抢走，录音停在半截没人知道。而这一屏是
 * 在球馆里单手用的 —— 滑一下是常态。
 *
 * 所以改成「点一下开始、再决定发不发」：多一次点击，换来的是
 * 每一次都录得完整，而且发出去之前还能反悔。
 * ------------------------------------------------------------------ */

export function VoiceRecorder({
  onSend,
  onError,
  onRecordingChange,
  busy,
}: {
  onSend: (rec: Recording) => void
  onError: (message: string) => void
  /**
   * 录音这件事要占掉整行，而输入框和发送键是外面那一层画的 ——
   * 所以得让外面知道现在在不在录。
   *
   * 第一版只在这个组件里写了 w-full 就算数了，结果它和输入框
   * 并排挤在一行里，「录音中」被压成一个「录」字。w-full 是
   * 「占满我被分到的地方」，不是「占满这一行」。
   */
  onRecordingChange: (on: boolean) => void
  busy: boolean
}) {
  const t = useT()
  const [ms, setMs] = useState(0)
  const recorder = useRef<Recorder | null>(null)
  const [recording, setRecordingRaw] = useState(false)

  const setRecording = (on: boolean) => {
    setRecordingRaw(on)
    onRecordingChange(on)
  }

  /* 离开这一屏的时候一定要把麦克风关掉，不然状态栏那个红点一直亮着 */
  useEffect(() => () => recorder.current?.cancel(), [])

  const finish = async () => {
    const r = recorder.current
    recorder.current = null
    setRecording(false)
    if (!r) return
    const rec = await r.stop()
    setMs(0)
    if (!rec) {
      onError(t('太短了，没录到东西', 'Too short — nothing recorded'))
      return
    }
    onSend(rec)
  }

  const begin = async () => {
    const r = await startRecording(setMs, () => {
      /* 到一分钟自动停并直接发。停了不发的话，人还在对着手机说话 */
      void finish()
    })
    if (!r.ok) {
      onError(r.error)
      return
    }
    recorder.current = r.recorder
    setRecording(true)
    setMs(0)
  }

  if (!recording) {
    return (
      <button
        onClick={() => void begin()}
        disabled={busy}
        aria-label={t('录一段语音', 'Record a voice message')}
        className="border-line bg-surface text-brand-600 active:bg-fill disabled:text-ink-300 flex size-12 shrink-0 items-center justify-center rounded-xl border"
      >
        <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
          <rect x="9" y="2.5" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    )
  }

  const left = Math.max(0, MAX_VOICE_MS - ms)

  return (
    <div className="border-brand-500 bg-brand-100 flex w-full items-center gap-3 rounded-xl border px-3 py-2">
      {/* 一个跟着录音跳的红点。没有它的话人不知道到底在不在录 */}
      <span className="bg-danger-solid size-2.5 shrink-0 animate-pulse rounded-full" />
      <span className="tnum text-brand-600 shrink-0 text-title">{voiceLength(ms)}</span>
      <span className="text-ink-500 min-w-0 flex-1 truncate text-caption">
        {left < 10_000
          ? t(`还剩 ${Math.ceil(left / 1000)} 秒`, `${Math.ceil(left / 1000)}s left`)
          : t('录音中', 'Recording')}
      </span>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => {
          recorder.current?.cancel()
          recorder.current = null
          setRecording(false)
          setMs(0)
        }}
      >
        {t('取消', 'Cancel')}
      </Button>
      <Button size="sm" variant="primary" className="shrink-0" onClick={() => void finish()}>
        {t('发送', 'Send')}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 听
 * ------------------------------------------------------------------ */

export function VoiceBubble({
  path,
  durationMs,
  mine,
}: {
  path: string
  durationMs: number
  mine: boolean
}) {
  const t = useT()
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    return () => {
      audio.current?.pause()
      audio.current = null
    }
  }, [])

  const toggle = async () => {
    if (playing) {
      audio.current?.pause()
      setPlaying(false)
      return
    }
    /*
     * 链接是按下播放才签的，不是一进对话就把满屏的录音都签一遍 ——
     * 签一条要跑一趟服务器，而一屏里真正会被听的通常只有一两条。
     * 签过的留着，重听不用再跑一趟。
     */
    if (!audio.current) {
      setLoading(true)
      const url = await voiceUrl(path)
      setLoading(false)
      if (!url) {
        setBroken(true)
        return
      }
      const el = new Audio(url)
      el.onended = () => setPlaying(false)
      el.onerror = () => {
        setBroken(true)
        setPlaying(false)
      }
      audio.current = el
    }
    try {
      await audio.current.play()
      setPlaying(true)
    } catch {
      setBroken(true)
    }
  }

  /*
   * 宽度跟着时长走，但压在一个范围里：一秒的和一分钟的看起来
   * 该不一样长，而一分钟的也不该横穿整屏。
   *
   * 下限是量出来的，不是拍的：播放键 28 + 两道间距 20 + 八根竖条
   * 45 + 时长那几个字 30 + 左右内边距 28 ≈ 151。比这窄，竖条就
   * 压到时长上面去了 —— 第一版写的 96，短的那几条正是这样。
   */
  const width = Math.min(215, 155 + Math.round((durationMs / 1000) * 1.3))

  return (
    <button
      onClick={() => void toggle()}
      disabled={broken}
      style={{ width }}
      className={cx(
        'flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left',
        mine
          ? 'bg-brand-solid text-on-brand rounded-br-md'
          : 'bg-surface border-line text-ink-900 rounded-bl-md border',
      )}
    >
      <span
        className={cx(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          mine ? 'bg-on-brand/20' : 'bg-brand-100 text-brand-600',
        )}
      >
        {loading ? (
          <span className="text-caption">…</span>
        ) : playing ? (
          <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
            <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
            <path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" />
          </svg>
        )}
      </span>

      {/* 几根高低不一的竖条。它不是真的波形，只是让这个气泡一眼认得出是语音 */}
      <span className="flex min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
        {[7, 12, 9, 16, 11, 6, 13, 8].map((h, i) => (
          <span
            key={i}
            style={{ height: h }}
            className={cx(
              'w-[3px] shrink-0 rounded-full',
              mine ? 'bg-on-brand/55' : 'bg-brand-500/45',
            )}
          />
        ))}
      </span>

      <span className="tnum shrink-0 text-caption">
        {broken ? t('放不了', 'Unavailable') : voiceLength(durationMs)}
      </span>
    </button>
  )
}
