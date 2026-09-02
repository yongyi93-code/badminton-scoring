import { useSyncExternalStore } from 'react'
import { pick } from './i18n'
import { supabase } from './supabase'
import { useApp } from '@/store/useApp'
import type { AvatarProfile } from './avatar'
import type { Match, Player, Session } from '@/types'

/* ------------------------------------------------------------------ *
 * 同步引擎：云端为准
 *
 * 一句话：云端那张 records 表是唯一的一份历史，本机是它的缓存。
 *
 * 为什么不是「本地优先 + 双向合并」：合并要处理「两台手机同时改了
 * 同一场比赛」，而且每台手机各有一份 id 不同的球员库，推上去会变成
 * 好几个同名的人 —— 那个问题没有干净的解法。改成云端唯一一份之后，
 * 冲突面小一个数量级。
 *
 * 三条线：
 *   1. 登录后整份拉下来（云端覆盖本机）
 *   2. 本机一改就推上去（防抖，攒一下再发）
 *   3. 别人改了，realtime 推过来，写进本机
 *
 * 挂钩子的方式是订阅整个 store 然后算差异，而不是去改那十几个
 * 操作函数 —— 那样每加一个新操作都要记得补一句推送，迟早漏。
 * ------------------------------------------------------------------ */

export type Kind = 'player' | 'session' | 'match' | 'avatar'

export type Row = { kind: Kind; id: string; data: unknown; deleted: boolean }

/** 一行的键。kind 和 id 一起才唯一 —— 不同类型的 id 可能撞 */
export const keyOf = (kind: Kind, id: string) => `${kind} ${id}`

/** 当前本机状态摊平成行 */
function rowsOf(): Map<string, Row> {
  const { players, sessions, matches, avatars } = useApp.getState()
  const out = new Map<string, Row>()
  const put = (kind: Kind, id: string, data: unknown) =>
    out.set(keyOf(kind, id), { kind, id, data, deleted: false })

  for (const p of players) put('player', p.id, p)
  for (const s of sessions) put('session', s.id, s)
  for (const m of matches) put('match', m.id, m)
  // 角色一人一个，用 playerId 当主键
  for (const a of avatars) put('avatar', a.playerId, a)
  return out
}

/*
 * 上一次推上去时每一行长什么样（JSON）。
 * 算差异用：内容一样就不推，省流量也省得把 updated_at 白白刷新一遍。
 */
let pushed = new Map<string, string>()

/**
 * 正在把远端的改动写进本机。
 *
 * 这期间 store 会变，但那不是「本机的改动」，不能再推回去 ——
 * 不挡的话两台手机会互相把对方的更新当成自己的新改动，来回推个没完。
 */
let applying = false

/** 还没推上去的行数。断网时攒着，界面上显示出来 */
let pending = 0

export type SyncStatus =
  | { state: 'off' }
  | { state: 'idle'; pending: number }
  | { state: 'syncing' }
  | { state: 'error'; message: string; pending: number }

let status: SyncStatus = { state: 'off' }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
const setStatus = (next: SyncStatus) => {
  status = next
  emit()
}

export const syncStatus = () => status
export const subscribeSync = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

const OFF: SyncStatus = { state: 'off' }

/** 组件里用这个，同步状态一变就重渲染 */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSync, syncStatus, () => OFF)
}

/**
 * 给网络请求兜一个超时。
 *
 * 不兜的话，网络是「连得上但没人应」那种状态时，界面会一直停在
 * 「同步中…」不动 —— 实测过一次，比直接报错还难受，因为看不出
 * 到底是在跑还是卡死了。
 */
const TIMEOUT_MS = 15000

function withTimeout<T>(work: PromiseLike<T>): Promise<T> {
  return Promise.race([
    work as Promise<T>,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(pick('等太久了，网络可能不通', 'Timed out — the network may be down'))),
        TIMEOUT_MS,
      ),
    ),
  ])
}

/**
 * 先确认真的登录着，再去碰数据库。
 *
 * RLS 只放行 authenticated 这个角色。没登录的时候请求照样发得出去，
 * 只是带着 anon 身份 —— 数据库拒收，回来的是
 * 「new row violates row-level security policy」。
 *
 * 麻烦在于：这条错误和「策略压根没建好」返回的是同一句话（都是 42501）。
 * 光看那句话分不出是「你没登录」还是「后台 SQL 没跑完」，
 * 而这两件事要做的处理完全相反。所以在发请求之前先把「没登录」摘出来，
 * 剩下那条错误才真的只剩一种解释。
 */
async function needsSignIn(): Promise<string | null> {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session) return null
  } catch {
    // 问不出来就别拦着，让请求自己去撞，至少还能拿到真实错误
    return null
  }
  return pick(
    '还没登录。先在「我的」里登录，云端才认得你',
    'Not signed in — sign in under “Me” first so the cloud knows you',
  )
}

function readable(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('jwt') || m.includes('not authenticated')) {
    return pick('登录过期了，退出重新登录一次', 'Session expired — sign out and back in')
  }
  /*
   * 数据库拒收有两种，长得像但完全不是一回事，别再合成一句：
   *
   *   permission denied for table  = 没给 authenticated 授权。
   *     连碰这张表的资格都没有，还没轮到策略就被挡了。
   *   row-level security policy    = 授权有了，是策略不放行。
   *
   * 曾经把这两条归成同一句话，结果是：后台查出来 RLS 开着、三条策略
   * 一条不少，看着完全正常，手机上就是写不进去 —— 因为真正缺的是
   * grant，而那句话把人往策略上引。分开写，看到哪句就知道去补哪样。
   */
  if (m.includes('permission denied')) {
    return pick(
      '数据库没给这个账号写的权限 —— 去 SQL Editor 跑：grant select, insert, update on public.records to authenticated;',
      'The database has not granted this account write access — run in the SQL Editor: grant select, insert, update on public.records to authenticated;',
    )
  }
  if (m.includes('row-level security')) {
    return pick(
      '权限有了但策略不放行 —— 去 Supabase 后台 SQL Editor 把 001-records.sql 整段再跑一遍',
      'Access is granted but a policy is blocking it — re-run all of 001-records.sql in the Supabase SQL Editor',
    )
  }
  if (m.includes('relation') && m.includes('does not exist')) {
    return pick('云端还没有 records 这张表', 'The records table does not exist yet')
  }
  if (m.includes('等太久') || m.includes('timed out')) {
    return pick('连不上云端，等一下会自动重试', 'Cannot reach the cloud — will retry')
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return pick('离线中，等联网了会自动补推', 'Offline — will push once you are back online')
  }
  return message
}

/* ------------------------------------------------------------------ *
 * 拉：云端整份盖到本机
 * ------------------------------------------------------------------ */

export type PullOutcome =
  | { ok: true; empty: boolean }
  | { ok: false; error: string }

export async function pullAll(): Promise<PullOutcome> {
  if (!supabase) return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  const noSession = await needsSignIn()
  if (noSession) {
    setStatus({ state: 'error', message: noSession, pending })
    return { ok: false, error: noSession }
  }
  setStatus({ state: 'syncing' })
  try {
    const { data, error } = await withTimeout(
      supabase.from('records').select('kind,id,data').eq('deleted', false),
    )
    if (error) {
      const msg = readable(error.message)
      setStatus({ state: 'error', message: msg, pending })
      return { ok: false, error: msg }
    }

    const rows = data ?? []
    if (rows.length === 0) {
      // 云端空的：不要拿空的去盖本机，那多半会把人的数据抹掉
      pushed = new Map()
      setStatus({ state: 'idle', pending })
      return { ok: true, empty: true }
    }

    applying = true
    try {
      useApp.setState({
        players: rows.filter((r) => r.kind === 'player').map((r) => r.data as Player),
        sessions: rows.filter((r) => r.kind === 'session').map((r) => r.data as Session),
        matches: rows.filter((r) => r.kind === 'match').map((r) => r.data as Match),
        avatars: rows.filter((r) => r.kind === 'avatar').map((r) => r.data as AvatarProfile),
      })
    } finally {
      applying = false
    }

    // 刚拉下来的就是云端的样子，基线对齐，别把它当成本机的新改动推回去
    pushed = new Map(
      [...rowsOf()].map(([k, r]) => [k, JSON.stringify(r.data)]),
    )
    pending = 0
    setStatus({ state: 'idle', pending: 0 })
    return { ok: true, empty: false }
  } catch (e) {
    const msg = readable(e instanceof Error ? e.message : String(e))
    setStatus({ state: 'error', message: msg, pending })
    return { ok: false, error: msg }
  }
}

/* ------------------------------------------------------------------ *
 * 推：本机改了什么就推什么
 * ------------------------------------------------------------------ */

/**
 * 和基线比一遍，算出这次要推的行（含删掉的）。
 *
 * 纯函数，单独拿出来是为了能测 —— 推送链路要连数据库才跑得起来，
 * 但「哪些该推」这个判断是整个同步里最容易写错的地方。
 */
export function diffRows(
  now: Map<string, Row>,
  baseline: Map<string, string>,
): Row[] {
  const out: Row[] = []

  for (const [key, row] of now) {
    const json = JSON.stringify(row.data)
    if (baseline.get(key) !== json) out.push(row)
  }
  // 基线里有、现在没有的 = 本机删掉了。软删除，别真删 ——
  // 真删出去，别人的手机下次拉取根本不知道这条没了
  for (const key of baseline.keys()) {
    if (!now.has(key)) {
      const [kind, ...rest] = key.split(' ')
      out.push({ kind: kind as Kind, id: rest.join(' '), data: {}, deleted: true })
    }
  }
  return out
}

const changedRows = (): Row[] => diffRows(rowsOf(), pushed)

let flushTimer: ReturnType<typeof setTimeout> | null = null

async function flush(): Promise<void> {
  if (!supabase) return
  const rows = changedRows()
  if (rows.length === 0) {
    setStatus({ state: 'idle', pending: 0 })
    return
  }

  pending = rows.length
  const noSession = await needsSignIn()
  if (noSession) {
    // 基线不动，等重新登录了这一批还在
    setStatus({ state: 'error', message: noSession, pending })
    return
  }
  setStatus({ state: 'syncing' })
  try {
    const { error } = await withTimeout(
      supabase.from('records').upsert(rows, { onConflict: 'kind,id' }),
    )
    if (error) {
      // 推不上去就把基线留着，下次连上再推同一批
      setStatus({ state: 'error', message: readable(error.message), pending })
      return
    }
  } catch (e) {
    setStatus({
      state: 'error',
      message: readable(e instanceof Error ? e.message : String(e)),
      pending,
    })
    return
  }

  // 推成功了才移基线
  const now = rowsOf()
  pushed = new Map([...now].map(([k, r]) => [k, JSON.stringify(r.data)]))
  pending = 0
  setStatus({ state: 'idle', pending: 0 })
}

/** 攒一下再发：一场比赛连点几分会触发好几次 store 变化 */
function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, 600)
}

/* ------------------------------------------------------------------ *
 * 接线
 * ------------------------------------------------------------------ */

let started = false
let unsubStore: (() => void) | null = null
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null

/** 登录之后调一次。会先整份拉下来，然后开始双向跟进 */
export async function startSync(): Promise<PullOutcome> {
  if (!supabase) return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  if (started) return { ok: true, empty: false }
  started = true

  const outcome = await pullAll()

  /*
   * 云端是空的，而本机有东西 —— 这是「第一次开局」：把本机整份推上去。
   *
   * 不做这一步的话，只有「登录之后再改」的东西才会上去：先建好人
   * 再登录的人，数据就永远卡在本地。而「先建人后登录」恰恰是最自然的
   * 顺序 —— 谁会先想到去登录再开始用。
   */
  if (outcome.ok && outcome.empty && rowsOf().size > 0) {
    await pushAll()
  }

  unsubStore = useApp.subscribe(() => {
    if (applying) return
    scheduleFlush()
  })

  /*
   * 别人改了什么，直接推过来。
   * 不去解析事件内容，收到就整份重拉 —— 数据量是几百行，
   * 重拉一次比在客户端拼装增量少一整类对不上的 bug。
   */
  channel = supabase
    .channel('records-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'records' },
      () => {
        if (applying) return
        void pullAll()
      },
    )
    .subscribe()

  // 回到线上先补推一次没推成的
  window.addEventListener('online', scheduleFlush)
  document.addEventListener('visibilitychange', pullOnResume)
  return outcome
}

/*
 * 回到前台就重拉一次。
 *
 * 只靠 realtime 是不够的：手机把后台的网页冻结之后长连接就断了，
 * 睡醒时错过的那些改动没有任何东西会补回来。而这恰恰是最常见的用法 ——
 * 两个人不会同时开着 app，对方建好角色时你的 app 多半在后台或者根本没开。
 *
 * 症状还特别难认：界面上一切正常，只是永远看不到别人。
 */
function pullOnResume() {
  if (document.visibilityState !== 'visible') return
  if (applying) return
  void pullAll()
}

/** 退出登录时收摊，别让上一个账号的订阅留着 */
export function stopSync() {
  started = false
  unsubStore?.()
  unsubStore = null
  if (channel) {
    void supabase?.removeChannel(channel)
    channel = null
  }
  window.removeEventListener('online', scheduleFlush)
  document.removeEventListener('visibilitychange', pullOnResume)
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pushed = new Map()
  pending = 0
  setStatus({ state: 'off' })
}

/** 本机整份推上去。云端是空的时候用这个开局 */
export async function pushAll(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  const rows = [...rowsOf().values()]
  if (rows.length === 0) return { ok: true, count: 0 }

  const noSession = await needsSignIn()
  if (noSession) {
    setStatus({ state: 'error', message: noSession, pending })
    return { ok: false, error: noSession }
  }
  setStatus({ state: 'syncing' })
  try {
    const { error } = await withTimeout(
      supabase.from('records').upsert(rows, { onConflict: 'kind,id' }),
    )
    if (error) {
      const msg = readable(error.message)
      setStatus({ state: 'error', message: msg, pending })
      return { ok: false, error: msg }
    }
  } catch (e) {
    const msg = readable(e instanceof Error ? e.message : String(e))
    setStatus({ state: 'error', message: msg, pending })
    return { ok: false, error: msg }
  }
  pushed = new Map([...rowsOf()].map(([k, r]) => [k, JSON.stringify(r.data)]))
  pending = 0
  setStatus({ state: 'idle', pending: 0 })
  return { ok: true, count: rows.length }
}
