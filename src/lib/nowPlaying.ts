import { useEffect } from 'react'
import { pick } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { venueLabel } from '@/lib/venues'
import { activeSessionOf, useApp } from '@/store/useApp'
import { FORMAT_LABELS, type Session } from '@/types'

/* ------------------------------------------------------------------ *
 * 「正在打」
 *
 * 好友列表上那一行：**正在 Twin ark 开打轮转局**。
 *
 * -------------------------------------------------------------------
 * 为什么不直接读球局
 *
 * 球局就在 records 里，status='active'、playerIds 里有谁，全都算得出来。
 * 但 records 的读策略是「只读得到自己在的球群」，而**你的好友多半
 * 不在你的球群里** —— 他的手机根本读不到那一行。
 *
 * 这和串场（全国榜）撞的是同一堵墙，解法也同源：各自报各自的状态。
 * 规矩和细节在 supabase/021-now-playing.sql 开头。
 *
 * -------------------------------------------------------------------
 * 报上去的只有两个字符串
 *
 * 球馆名和赛制名 —— 就是要显示的那几个字，不是 session id。
 *
 * 存 id 看起来更规范，但好友拿到 id 之后照样读不到那场球局（RLS 拦着），
 * 等于给了一把打不开任何门的钥匙。存字符串，这一行就是自足的。
 *
 * 顺带一个好处：这一行不含对手是谁、比分多少。就算哪天读策略写松了，
 * 泄漏的也只是「他在打球」。
 * ------------------------------------------------------------------ */

export type Playing = {
  uid: string
  venue: string
  format: string | null
  started_at: string
  expires_at: string
}

/**
 * 报上去的那一行多久过期。
 *
 * 球局要靠人按「结束」才收摊，而**没人记得按** —— useApp 里专门有一段
 * 算「最后一次有动静是什么时候」，就是为了认出那些打完各回各家、
 * 没人收摊的局。
 *
 * 没有过期时间的话，一个忘了按结束的人会在好友列表上「正在打球」
 * 好几天，而这种错没人会来报 —— 看的人只会觉得这个功能不准。
 *
 * 8 小时：比任何一场球局都长（通宵局也就五六个钟），
 * 又短到第二天早上一定已经消失。
 *
 * 数据库那边还卡了一道 12 小时的上限（021 里那条 check），
 * 防的是哪天这个常量被改成一个荒唐的值。
 */
export const PLAY_WINDOW_MS = 8 * 60 * 60 * 1000

/**
 * 从一场球局里取出要报的那两样东西。
 *
 * **赛制报的是 key（`rotation`），不是译好的名字（「轮转赛」）。**
 *
 * 这一条是在浏览器里看出来的：第一版报的是当场译好的字，于是一个
 * 中文界面的人开局，他英文界面的朋友看到的是
 * 「Playing 轮转赛 at Twin ark」—— 半句英文半句中文。
 * 报的人和看的人用的不是同一种语言，这是跨设备的东西的常态。
 *
 * 球馆名照样是原文：它是个专有名词，没有译法。
 *
 * 赛制可以是空的 —— v1 那时候的球局没有 format 这个字段，
 * 而那些局照样打得开。空的时候句子会退成「正在 X 打球」，
 * 不编一个赛制出来。
 */
export function describeSession(s: Session): { venue: string; format: string | null } {
  return { venue: venueLabel(s.venue), format: s.format ?? null }
}

/**
 * 把报上来的赛制 key 译成看的人那一边的字。
 *
 * 认不出来的 key 原样显示，不吞掉也不编一个 —— 以后加了新赛制，
 * 旧版本的 App 会收到不认识的 key，那时候显示原文（`beach`）
 * 比显示空白强：至少看得出是个赛制，而且能猜。
 */
const formatName = (key: string | null): string | null => {
  if (!key) return null
  const label = FORMAT_LABELS[key as keyof typeof FORMAT_LABELS]
  return label ? pick(...label) : key
}

/**
 * 那一行中文/英文长什么样。
 *
 * 中文用「开打」而不是「打」：「正在 Twin ark 打轮转赛」读起来像
 * 在陈述习惯，「开打」才有「此刻正在进行」的意思 —— 而这一行的
 * 全部价值就在「此刻」。
 */
export function playingLine(p: { venue: string; format: string | null }, zh: boolean): string {
  const f = formatName(p.format)
  if (zh) return f ? `正在 ${p.venue} 开打${f}` : `正在 ${p.venue} 打球`
  return f ? `Playing ${f} at ${p.venue}` : `Playing at ${p.venue}`
}

export type PlayResult = { ok: true } | { ok: false; error: string }

/** 报一行「我在打球」。同一个人只有一行，所以报第二次就是覆盖 */
export async function publishPlaying(
  what: { venue: string; format: string | null },
  now = Date.now(),
): Promise<PlayResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }

  const { data, error } = await supabase
    .from('now_playing')
    .upsert(
      {
        uid,
        venue: what.venue.slice(0, 60),
        format: what.format?.slice(0, 24) ?? null,
        expires_at: new Date(now + PLAY_WINDOW_MS).toISOString(),
      },
      { onConflict: 'uid' },
    )
    .select('uid')
  if (error) return { ok: false, error: error.message }
  /*
   * 和管理员、全国榜那边同一条：被策略挡下来的写**不报错**，只是动了 0 行。
   * 这一处其实不致命（大不了好友看不到我在打球），但报出来总比
   * 悄悄失败强 —— 悄悄失败的话，永远没人知道这个功能坏了。
   */
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没报上去 —— 只能报自己的', 'You can only publish your own') }
  }
  return { ok: true }
}

/** 收工。把自己那一行删掉 */
export async function clearPlaying(): Promise<PlayResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }
  const { error } = await supabase.from('now_playing').delete().eq('uid', uid)
  if (error) return { ok: false, error: error.message }
  /*
   * 删了 0 行不算失败：本来就没在打球的时候也会走到这儿
   * （下面那个 effect 一挂载就会清一次）。
   */
  return { ok: true }
}

/**
 * 好友里谁在打球。
 *
 * 非好友的由数据库那边挡掉。**过期的要在这里再滤一次** ——
 * 读策略里「自己那一行永远看得见」那一条（021 里写了为什么：
 * 不这样的话过期之后自己就删不掉它了）意味着自己那一行过期了
 * 也会回来。不滤的话，一个昨晚打过球的人今天早上会看到
 * 自己还挂在「正在打球」。
 */
export async function fetchPlaying(now = Date.now()): Promise<Playing[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('now_playing')
    .select('uid, venue, format, started_at, expires_at')
    .order('started_at', { ascending: false })
    .limit(100)
  if (error) {
    /* 没跑过 021 和「没人在打球」在这里是同一个结果：一行都不显示 */
    console.warn('「正在打」没拿到:', error.message)
    return []
  }
  return (data ?? []).filter((r) => Date.parse((r as Playing).expires_at) > now) as Playing[]
}

/* ------------------------------------------------------------------ *
 * 自动报 / 自动收
 *
 * 挂在 App 最外层挂一次。为什么是盯着状态而不是在「开局」「结束」
 * 那两个按钮里各调一次：
 *
 *   · 球局是同步下来的 —— 别人把我拉进一场局、别人结束了这场局，
 *     我这台手机上都不会经过那两个按钮
 *   · 换球群、退出登录也会让「我在不在打球」变化
 *
 * 盯着算出来的结果，上面这些情况自动都对。
 * ------------------------------------------------------------------ */
export function useBroadcastPlaying(): void {
  const sessions = useApp((s) => s.sessions)
  const meId = useApp((s) => s.meId)

  /*
   * 故意**不引 useAuth**。
   *
   * 两个理由，第二个是硬的：
   *
   *   · 用不着 —— publishPlaying 自己会取会话，没登录就直接返回错误
   *   · `lib/` 里引 store 会把 useAuth 那条模块级的登录订阅拖进来，
   *     于是任何 import 这个文件的测试都会去发真网络请求。
   *     errorlog 那次就是这么把部署卡住的（见 tests/errorlog.test.ts 开头）。
   *
   * 登录之后 effect 照样会跑：同步把球局拉下来，key 跟着变。
   * 退出登录时 resetAll 清空球局，key 变成空，跟着收工。
   */
  const active = activeSessionOf(sessions, meId)
  /*
   * 依赖是两个**字符串**，不是 session 对象，也不是把两者拼成一个 key。
   *
   * 不能用对象：每次同步都是一个新引用，effect 每次都重跑，
   * 一晚上往云端写几百次，换来的是同一行数据。
   *
   * 也不能拼成一个字符串再拆开 —— 我第一版就是那么写的，
   * 而球馆名里有空格（「Twin ark」），拆回来变成
   * venue='Twin'、format='ark'。用两个依赖，没有编码就没有解码，
   * 这一类错根本没有机会发生。
   */
  const venue = active ? describeSession(active).venue : ''
  const format = active ? (describeSession(active).format ?? '') : ''

  useEffect(() => {
    if (venue) {
      void publishPlaying({ venue, format: format || null })
    } else {
      void clearPlaying()
    }
    /*
     * 故意不在卸载时清 —— 这个 hook 只在 App 最外层挂一次，
     * 卸载就等于整个 App 没了（关标签页）。那时候发一个删除请求
     * 多半也发不出去，而那一行 8 小时后自己就过期了。
     */
  }, [venue, format])
}
