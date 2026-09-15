import { supabase } from '@/lib/supabase'
import { pick } from '@/lib/i18n'
import { BUILD_ID } from '@/lib/update'

/* ------------------------------------------------------------------ *
 * 反馈 —— 「这个 App 有问题」
 *
 * 在这之前，发现 bug 的方式只有一条：球主自己在球场上撞见了。
 * 别人遇到的问题他永远不会知道 —— 而球群一旦不止一个，
 * 这个样本就彻底不够用了。
 *
 * 规则在 supabase/014-feedback.sql。
 *
 * -------------------------------------------------------------------
 * 和举报（lib/report.ts）分开放
 *
 *   举报  对象是人。要留证据、要防滥用、被举报的人一个字都看不到
 *   反馈  对象是软件。没有第三方，也没什么可隐瞒的
 *
 * 混在一起的话，迟早有一处照着举报那套严格规矩来处理反馈
 * （或者反过来，更糟）。
 * ------------------------------------------------------------------ */

export type FeedbackKind = 'bug' | 'idea' | 'other'

export type Feedback = {
  id: string
  author: string
  kind: FeedbackKind
  body: string
  app_build: string | null
  device: string | null
  status: 'open' | 'done'
  handled_at: string | null
  created_at: string
}

export type FeedbackResult = { ok: true } | { ok: false; error: string }

/**
 * 三类就够了。
 *
 * 再细的分类是给有客服团队的人用的 —— 而这里看反馈的人和写代码的
 * 是同一个，分那么细只是多几下点击。
 */
export const FEEDBACK_KINDS: {
  value: FeedbackKind
  zh: string
  en: string
  hintZh: string
  hintEn: string
}[] = [
  {
    value: 'bug',
    zh: '出问题了',
    en: 'Something is broken',
    hintZh: '点不动、数字不对、白屏',
    hintEn: 'Not responding, wrong numbers, blank screen',
  },
  {
    value: 'idea',
    zh: '想要个功能',
    en: 'I want a feature',
    hintZh: '希望它还能做什么',
    hintEn: 'Something you wish it could do',
  },
  {
    value: 'other',
    zh: '其他',
    en: 'Something else',
    hintZh: '夸一句也行',
    hintEn: 'Praise is welcome too',
  },
]

export const kindLabel = (k: FeedbackKind): string => {
  const it = FEEDBACK_KINDS.find((x) => x.value === k)
  return it ? pick(it.zh, it.en) : k
}

/**
 * 这台设备大概是什么。
 *
 * 「我这里打不开」没有机型和版本号的话什么都查不了，而撞上问题的人
 * 多半也答不上来自己跑的是哪一版 —— 所以不问他，App 自己填。
 *
 * userAgent 原样太长（一条能有两百字），列表里根本看不过来。
 * 这里只挑出真正用得上的那几段：什么系统、什么浏览器、
 * 是不是装到主屏幕上跑的（装了和没装行为差别很大，尤其 iOS）。
 */
function deviceLine(): string {
  if (typeof navigator === 'undefined') return ''
  const ua = navigator.userAgent
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : '其他'
  /* 顺序有讲究：Chrome 的 UA 里也有 Safari，先判 Chrome 才分得开 */
  const browser =
    /EdgA?\//.test(ua) ? 'Edge'
    : /CriOS|Chrome/.test(ua) ? 'Chrome'
    : /FxiOS|Firefox/.test(ua) ? 'Firefox'
    : /Safari/.test(ua) ? 'Safari'
    : '其他'
  const standalone =
    (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as { standalone?: boolean }).standalone === true
  const ver = ua.match(/OS (\d+[_.]\d+)|Android (\d+)/)
  const v = (ver?.[1] ?? ver?.[2] ?? '').replace('_', '.')
  return [os + (v ? ` ${v}` : ''), browser, standalone ? '主屏幕' : '浏览器'].join(' · ')
}

const noCloud = () =>
  pick('还没接云端，反馈送不出去', 'Cloud is not set up — feedback cannot be sent')

function readable(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('permission denied')) {
    return pick(
      '反馈功能还没开通 —— 数据库那边少了一步（014 那段 SQL 里的 grant）。',
      'Feedback is not switched on yet — the database is missing a grant (see migration 014).',
    )
  }
  if (m.includes('does not exist') || m.includes('schema cache')) {
    return pick(
      '反馈功能还没开通 —— 数据库里还没有这张表，要先跑 014 那段 SQL。',
      'Feedback is not switched on yet — the table does not exist. Run migration 014 first.',
    )
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return pick('连不上服务器，检查一下网络', 'Cannot reach the server — check your connection')
  }
  return message
}

const fail = (e: { message: string }): FeedbackResult => ({ ok: false, error: readable(e.message) })

/* ------------------------------------------------------------------ *
 * 写
 * ------------------------------------------------------------------ */

/**
 * 提一条反馈。
 *
 * 不传 author —— 那一栏的默认值是 auth.uid()，数据库自己填。
 * 版本号和设备由这里填：见 deviceLine 上面那段。
 */
export async function sendFeedback(
  kind: FeedbackKind,
  body: string,
): Promise<FeedbackResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const text = body.trim().slice(0, 2000)
  if (!text) return { ok: false, error: pick('还没写内容', 'Nothing written yet') }
  const { data, error } = await supabase
    .from('feedback')
    .insert({ kind, body: text, app_build: BUILD_ID, device: deviceLine() })
    .select('id')
    .single()
  if (error) return fail(error)
  await notifyAdmins((data as { id: string }).id)
  return { ok: true }
}

/**
 * 叫服务端通知管理员。
 *
 * 和举报那边同一条规矩：只递「哪一条」，不递内容 —— 这个请求是
 * 客户端发的，内容如果从这儿来，谁都能让球主的手机弹出任意一句话。
 *
 * 推不出去不算提失败：那一行已经落库了，管理员进 App 照样看得到。
 */
async function notifyAdmins(id: string): Promise<void> {
  if (!supabase) return
  try {
    await supabase.functions.invoke('notify-social', { body: { kind: 'feedback', id } })
  } catch (e) {
    console.warn('管理员没收到提醒（反馈本身已经落库了）:', e)
  }
}

/** 管理员标记处理完。不传 handled_by —— 触发器会自己记 */
export async function markFeedbackDone(id: string): Promise<FeedbackResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.from('feedback').update({ status: 'done' }).eq('id', id)
  return error ? fail(error) : { ok: true }
}

/* ------------------------------------------------------------------ *
 * 读
 * ------------------------------------------------------------------ */

/**
 * 全部反馈，没处理的排前面。
 *
 * 普通人调它拿回来的是「自己提过的那几条」—— 策略就是这么写的。
 * 管理员那一屏之外没人调它，但这个性质值得记着。
 */
export async function fetchFeedback(): Promise<Feedback[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('feedback')
    .select('id,author,kind,body,app_build,device,status,handled_at,created_at')
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('反馈没拉到:', error.message)
    return []
  }
  const rows = (data ?? []) as Feedback[]
  return [...rows].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'))
}

/** 还没处理的有几条。管理员那个入口上的小红点看这个 */
export async function fetchOpenFeedbackCount(): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
  if (error) {
    console.warn('反馈条数没拿到:', error.message)
    return 0
  }
  return count ?? 0
}

/** 还没处理的有几条。纯函数，给那一屏用 */
export const openFeedbackCount = (rows: Feedback[]): number =>
  rows.filter((r) => r.status === 'open').length
