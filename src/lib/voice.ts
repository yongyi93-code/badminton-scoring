import { supabase } from '@/lib/supabase'
import { pick } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 语音消息 —— 录、传、放
 *
 * 三件事各自都有一个能把人挡住的地方，所以都写在这里，界面那边
 * 只管按钮和进度：
 *
 *   录  不同浏览器录出来的格式不一样。Chrome / Android 是 webm+opus，
 *       iOS Safari 只给 mp4。写死一种格式的话，有一半的人按下去
 *       什么都不会发生 —— 而且不会报错，MediaRecorder 只是安静地
 *       不工作。所以问一遍它支持什么。
 *
 *   传  桶是私有的，路径定成 <我>/<他>/<随机名>.<后缀>。
 *       这个形状不是随便定的：Storage 的策略直接读这两段判断
 *       「谁能听」（见 010 那段 SQL）。改这里就得改那里。
 *
 *   放  私有桶没有公开地址，每次要签一条临时链接。签是要跑一趟
 *       服务器的，所以只在真的按下播放时才签，不是一进对话就把
 *       满屏的录音都签一遍。
 * ------------------------------------------------------------------ */

/** 一段录音最长多久。到点自动停 —— 语音消息不是播客 */
export const MAX_VOICE_MS = 60_000

/** 短于这个就当是误触，不发。和数据库那条约束的下限是同一个数 */
export const MIN_VOICE_MS = 500

/**
 * 这个浏览器录不录得了。
 *
 * 三样缺一不可，而且要在按钮画出来之前就知道 —— 画一个按下去
 * 没反应的麦克风，比不画那个麦克风糟得多。
 */
export function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

/**
 * 挑一个这台设备录得出、而且桶收得下的格式。
 *
 * 返回的 mime 带 codecs 参数（给 MediaRecorder），type 不带
 * （给上传）—— 桶的 allowed_mime_types 比对的是不带参数的那个，
 * 带着 ;codecs=opus 传上去会被拒，而那个错长得像「权限不对」。
 */
function pickFormat(): { mime: string; type: string; ext: string } | null {
  const options = [
    { mime: 'audio/webm;codecs=opus', type: 'audio/webm', ext: 'webm' },
    { mime: 'audio/webm', type: 'audio/webm', ext: 'webm' },
    { mime: 'audio/ogg;codecs=opus', type: 'audio/ogg', ext: 'ogg' },
    // iOS Safari 只有这一个
    { mime: 'audio/mp4', type: 'audio/mp4', ext: 'm4a' },
    { mime: 'audio/aac', type: 'audio/aac', ext: 'aac' },
  ]
  for (const o of options) {
    if (MediaRecorder.isTypeSupported(o.mime)) return o
  }
  return null
}

export type Recording = {
  blob: Blob
  type: string
  ext: string
  durationMs: number
}

export type Recorder = {
  /** 停下来并交出录到的东西。太短就返回 null */
  stop: () => Promise<Recording | null>
  /** 不要了。麦克风也一起关掉 */
  cancel: () => void
}

export type RecordResult =
  | { ok: true; recorder: Recorder }
  | { ok: false; error: string }

/**
 * 开录。
 *
 * onTick 每 100ms 报一次已经录了多久 —— 界面上那个秒数要走起来，
 * 不然人不知道它到底在不在录。
 * 到了 MAX_VOICE_MS 自己停，并且通过 onAuto 告诉界面。
 */
export async function startRecording(
  onTick: (ms: number) => void,
  onAuto: () => void,
): Promise<RecordResult> {
  if (!canRecord()) {
    return {
      ok: false,
      error: pick(
        '这个浏览器录不了音。装到手机主屏幕上再试，或者换 Chrome / Safari。',
        'This browser cannot record. Install the app to your home screen, or try Chrome or Safari.',
      ),
    }
  }
  const fmt = pickFormat()
  if (!fmt) {
    return {
      ok: false,
      error: pick('这个浏览器没有能用的录音格式', 'No supported audio format on this browser'),
    }
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    /*
     * 被拒和「没有麦克风」要分开说：一个要去设置里开权限，
     * 一个是这台设备本来就录不了，两条出路完全不同。
     */
    const name = (e as { name?: string }).name
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return {
        ok: false,
        error: pick(
          '没有麦克风权限。去系统设置里给 RALLY 开一下。',
          'Microphone permission denied — allow it for RALLY in your settings.',
        ),
      }
    }
    return {
      ok: false,
      error: pick('打不开麦克风', 'Could not open the microphone'),
    }
  }

  const rec = new MediaRecorder(stream, { mimeType: fmt.mime })
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const startedAt = Date.now()
  /*
   * 时长按「录了多久」算，不去解码音频问它。
   *
   * MediaRecorder 产出的 webm 大多没有时长头 —— 解出来是 Infinity，
   * 界面上就成了「∞ 秒」。掐表算出来的那个数对得上人的感觉，
   * 而这里要的正是人的感觉。
   */
  const elapsed = () => Date.now() - startedAt

  const timer = window.setInterval(() => onTick(elapsed()), 100)

  /** 麦克风一定要关。不关的话手机状态栏上那个红点一直亮着 */
  const release = () => {
    window.clearInterval(timer)
    stream.getTracks().forEach((t) => t.stop())
  }

  let settled = false
  const finish = (): Promise<Recording | null> =>
    new Promise((resolve) => {
      const ms = elapsed()
      rec.onstop = () => {
        release()
        if (ms < MIN_VOICE_MS) {
          resolve(null)
          return
        }
        resolve({ blob: new Blob(chunks, { type: fmt.type }), type: fmt.type, ext: fmt.ext, durationMs: ms })
      }
      rec.stop()
    })

  const auto = window.setTimeout(() => {
    if (settled) return
    onAuto()
  }, MAX_VOICE_MS)

  rec.start()

  return {
    ok: true,
    recorder: {
      stop: () => {
        settled = true
        window.clearTimeout(auto)
        return finish()
      },
      cancel: () => {
        settled = true
        window.clearTimeout(auto)
        rec.onstop = null
        try {
          rec.stop()
        } catch {
          /* 已经停了就算了 */
        }
        release()
      },
    },
  }
}

/* ------------------------------------------------------------------ *
 * 传和放
 * ------------------------------------------------------------------ */

/** 桶的名字。和 010 那段 SQL 里的一致 */
const BUCKET = 'voice'

/**
 * 传一段录音，返回它的路径。
 *
 * 路径的形状就是权限（见文件开头）—— 这三段拼错任何一段，
 * Storage 那边都会拒，而拒的理由看起来会像「你没有权限」。
 */
export async function uploadVoice(
  meUid: string,
  toUid: string,
  rec: Recording,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  }
  const name =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const path = `${meUid}/${toUid}/${name}.${rec.ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, rec.blob, { contentType: rec.type, upsert: false })

  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes('bucket') && m.includes('not found')) {
      return {
        ok: false,
        error: pick(
          '语音还没开通 —— 数据库那边还没建 voice 那个桶（010 那段 SQL）。',
          'Voice is not switched on yet — the storage bucket is missing (migration 010).',
        ),
      }
    }
    if (m.includes('row-level security') || m.includes('violates')) {
      return {
        ok: false,
        error: pick('发不出去 —— 你们现在不是好友', 'Could not send — you are not friends right now'),
      }
    }
    /*
     * 传文件走的是另一条网络路径（Storage，不是数据库），所以
     * 它自己的网络错也要自己翻。原样吐一句 Failed to fetch，
     * 对着一个刚对手机说完话的人一个字都没用。
     */
    if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) {
      return {
        ok: false,
        error: pick('传不上去，检查一下网络', 'Upload failed — check your connection'),
      }
    }
    if (m.includes('exceeded') || m.includes('too large')) {
      return {
        ok: false,
        error: pick('这段太长了', 'That recording is too long'),
      }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, path }
}

/**
 * 签一条能听的临时链接。
 *
 * 一小时，够听完也够重听几遍；长了的话这条链接被转出去之后
 * 会一直有效，而它绕过了所有权限判断。
 */
export async function voiceUrl(path: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) {
    console.warn('签不出播放链接:', error.message)
    return null
  }
  return data?.signedUrl ?? null
}

/** 把录音文件删掉。撤回自己那条语音时用 */
export async function removeVoice(path: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) console.warn('录音删不掉:', error.message)
}

/** 毫秒 → 「0:07」。语音气泡上那个数 */
export function voiceLength(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
