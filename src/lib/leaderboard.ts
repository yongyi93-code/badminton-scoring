import { supabase } from '@/lib/supabase'
import { pick } from '@/lib/i18n'
import { opponentConfirmed } from '@/lib/confirm'
import { chronological, decidedMatches, sideOf } from '@/lib/ranking'
import type { Match } from '@/types'

/* ------------------------------------------------------------------ *
 * 全国榜 —— 和云端打交道的那一层
 *
 * 规则在 supabase/017-leaderboard.sql，那边写了为什么要单开一张表、
 * 为什么是「各自报各自的」。这一层只管把话说对。
 *
 * -------------------------------------------------------------------
 * 上榜是自己决定的
 *
 * 有行 = 在榜上，删掉 = 下榜。没有第三种状态。
 *
 * 默认不在榜上：把名字挂到一个全国范围的公开榜上，是该由本人点头的事。
 * 这一点在数据库那边也是这么设计的 —— 没有「隐藏」开关，
 * 因为一个开关总有一天会和「有没有行」对不上。
 *
 * -------------------------------------------------------------------
 * 只推结果，不推原始记录
 *
 * 推上去的只有：名字、MMR、胜负场次、其中多少场对手确认过、州。
 * 比赛记录、球局、对手是谁，一行都不出自己的球群 ——
 * records 那张表的读策略（只读得到自己在的群）一点没被掀开。
 * ------------------------------------------------------------------ */

export type LeaderRow = {
  uid: string
  name: string
  mmr: number
  wins: number
  losses: number
  /** 其中多少场被对手确认过。这张表上唯一一个不容易伪造的数 */
  confirmed: number
  state: string | null
  updated_at: string
}

export type LeaderResult = { ok: true } | { ok: false; error: string }

/**
 * 我要报上去的那几个数。
 *
 * MMR 不在这里算 —— 它由 progressByPlayer 一处算出来（src/lib/avatar.ts），
 * 这个函数只负责数「打了几场、其中几场对手确认过」。
 * 算法只有一份是这整个设计的前提，见 017 开头那段。
 */
export function myTally(matches: Match[], playerId: string): {
  wins: number
  losses: number
  confirmed: number
} {
  let wins = 0
  let losses = 0
  let confirmed = 0
  for (const m of chronological(decidedMatches(matches))) {
    const side = sideOf(m, playerId)
    if (side === null) continue
    const a = m.games.reduce((n, g) => n + (g.a > g.b ? 1 : 0), 0)
    const b = m.games.reduce((n, g) => n + (g.b > g.a ? 1 : 0), 0)
    if (a === b) continue
    if ((a > b) === (side === 'A')) wins++
    else losses++
    if (opponentConfirmed(m)) confirmed++
  }
  return { wins, losses, confirmed }
}

/** 整张榜，MMR 从高到低。带 state 就只要那个州的 */
export async function fetchLeaderboard(state?: string | null): Promise<LeaderRow[]> {
  if (!supabase) return []
  let q = supabase
    .from('leaderboard')
    .select('uid, name, mmr, wins, losses, confirmed, state, updated_at')
    .order('mmr', { ascending: false })
    .limit(200)
  if (state) q = q.eq('state', state)
  const { data, error } = await q
  if (error) {
    /* 没跑过 017 和「榜是空的」在这里是同一个结果：显示空榜 */
    console.warn('全国榜没拿到:', error.message)
    return []
  }
  return (data ?? []) as LeaderRow[]
}

/** 我在不在榜上。不在就是 null */
export async function fetchMyRow(): Promise<LeaderRow | null> {
  if (!supabase) return null
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('leaderboard')
    .select('uid, name, mmr, wins, losses, confirmed, state, updated_at')
    .eq('uid', uid)
    .limit(1)
  if (error) return null
  return ((data ?? [])[0] as LeaderRow | undefined) ?? null
}

/**
 * 报一次成绩（上榜，或者更新已经在榜上的那一行）。
 *
 * uid 不用传：数据库那条策略是 `with check (uid = auth.uid())`，
 * 传错了会被当场拒掉。这里传的是自己的，取自当前会话。
 */
export async function publishMe(row: {
  name: string
  mmr: number
  wins: number
  losses: number
  confirmed: number
  state: string | null
}): Promise<LeaderResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }
  const { data, error } = await supabase
    .from('leaderboard')
    .upsert({ uid, ...row, name: row.name.slice(0, 24) }, { onConflict: 'uid' })
    .select('uid')
  if (error) return { ok: false, error: error.message }
  /*
   * 和管理员那边同一条：被策略挡下来的写**不报错**，只是动了 0 行。
   * 只看 error 是不是 null 的话，界面会显示「上榜了」，
   * 而刷新一下榜上根本没有你。
   */
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没上成 —— 只能报自己的成绩', 'You can only publish your own') }
  }
  return { ok: true }
}

/** 下榜。把自己那一行删掉，没有第二种状态 */
export async function leaveLeaderboard(): Promise<LeaderResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }
  const { data, error } = await supabase
    .from('leaderboard')
    .delete()
    .eq('uid', uid)
    .select('uid')
  if (error) return { ok: false, error: error.message }
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('本来就不在榜上', 'You were not on the board') }
  }
  return { ok: true }
}
