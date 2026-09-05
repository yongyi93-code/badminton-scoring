import { useSyncExternalStore } from 'react'
import { pick } from './i18n'
import { supabase } from './supabase'
import { useApp } from '@/store/useApp'
import type { AvatarProfile } from './avatar'
import type { Announcement, Club, Match, Player, Session } from '@/types'

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

export type Kind =
  | 'player'
  | 'session'
  | 'match'
  | 'avatar'
  | 'announcement'
  | 'club'

/**
 * 一行数据。
 *
 * club_id 是数据库那边的列名（不是 clubId）—— 这个对象是直接 upsert
 * 上去的，字段名得和列名一一对上。
 *
 * 为什么球群不写进 data 里：数据库每次读写都要判断这一行属于哪个群，
 * 那是一个天天要走索引的判据，值得一个真正的列。而且写在 data 里的话，
 * 客户端就能改它 —— 「这行属于哪个群」正是要用来限制客户端的东西。
 */
export type Row = {
  kind: Kind
  id: string
  data: unknown
  deleted: boolean
  club_id: string
}

/** 一行的键。kind 和 id 一起才唯一 —— 不同类型的 id 可能撞 */
export const keyOf = (kind: Kind, id: string) => `${kind} ${id}`

/**
 * 当前本机状态摊平成行。
 *
 * 本机任何时候只装着「当前球群」那一份数据 —— 切群会先清空再重拉。
 * 所以这里给所有行盖同一个 club_id 是对的，不用逐行去查它原本属于谁。
 *
 * 没有当前球群（还没建、还没加入任何一个）就返回空：这时候推什么都
 * 会被数据库拒（策略要求 club_id 非空且是自己的群），不如根本不推。
 */
function rowsOf(): Map<string, Row> {
  const { players, sessions, matches, avatars, announcements, clubId } =
    useApp.getState()
  const out = new Map<string, Row>()
  if (!clubId) return out

  const put = (kind: Kind, id: string, data: unknown) =>
    out.set(keyOf(kind, id), { kind, id, data, deleted: false, club_id: clubId })

  for (const p of players) put('player', p.id, p)
  for (const s of sessions) put('session', s.id, s)
  for (const m of matches) put('match', m.id, m)
  // 角色一人一个，用 playerId 当主键
  for (const a of avatars) put('avatar', a.playerId, a)
  for (const a of announcements) put('announcement', a.id, a)
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

/** 当前登录账号的 id。没登录、问不出来都算 null */
async function currentUid(): Promise<string | null> {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
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
  /*
   * 没有当前球群就不拉 —— 不是出错，是还没进任何一个群（刚注册的人）。
   * 界面那边会引导他建群或者输邀请码。
   */
  const clubId = useApp.getState().clubId
  if (!clubId) {
    setStatus({ state: 'idle', pending: 0 })
    return { ok: true, empty: true }
  }

  setStatus({ state: 'syncing' })
  try {
    /*
     * 只拉自己这个群的。
     *
     * 这一句同时是流量那条的解法：原来不带条件，每台手机每次同步都要
     * 把全表拉一遍 —— 1000 人跑一年是一次 22 MB，而免费额度一个月
     * 只够拉两百多次。按群拉之后，拉的是自己群那几十个人的数据，
     * 和全国有多少人无关。
     *
     * 数据库那边的策略本来也只会给自己群的行，这里再写一次不是多余：
     * 策略是「拦住不该给的」，这个条件是「别去要不需要的」——
     * 少了它，数据库照样要把全表过一遍再筛。
     */
    const { data, error } = await withTimeout(
      supabase
        .from('records')
        .select('kind,id,data')
        .eq('club_id', clubId)
        .eq('deleted', false)
        /*
         * 群记录本身不是数据，是「这个群叫什么、码是多少」。它由
         * listMyClubs 单独管，这里排掉它有两个原因：
         *
         * 一是本机根本不存它（rowsOf 里没有 club 这一档），拉下来也
         * 无处安放；二是一个刚建的群，云端只有这一行 —— 不排掉的话
         * 「云端是空的」这个判断就永远不成立，而那一句正是「把本机
         * 已有的数据推上去当作这个群的第一批」的开关。建群的人会发现
         * 自己之前记的分全没了。
         */
        .neq('kind', 'club'),
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
        announcements: rows
          .filter((r) => r.kind === 'announcement')
          .map((r) => r.data as Announcement),
      })
    } finally {
      applying = false
    }

    // 刚拉下来的就是云端的样子，基线对齐，别把它当成本机的新改动推回去
    pushed = new Map(
      [...rowsOf()].map(([k, r]) => [k, JSON.stringify(r.data)]),
    )

    /*
     * 认一下「我是谁」。
     *
     * 必须放在 applying 关掉、基线也对齐之后：这一步偶尔会给球员盖上
     * ownerId（先建角色后登录的情况），那是一次真正的本机改动，得让它
     * 照常推上去。放在 applying 里面的话，订阅会把它当成远端写入跳过，
     * 章盖了却传不出去，换台设备照样认不出来。
     */
    useApp.getState().adoptMe(await currentUid())

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
  /**
   * 删除行要盖的球群。
   *
   * 基线里只存了 JSON，没存这一行原本属于哪个群 —— 而软删除是拿一行
   * 空数据去覆盖，也得带上 club_id，否则策略会拒（不许写 club_id 为空
   * 的行）。传当前球群是对的：本机只装着当前群的数据，能从本机消失的
   * 也只有当前群的行。
   */
  clubId: string,
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
      out.push({
        kind: kind as Kind,
        id: rest.join(' '),
        data: {},
        deleted: true,
        club_id: clubId,
      })
    }
  }
  return out
}

const changedRows = (): Row[] => {
  const clubId = useApp.getState().clubId
  // 没进群就没什么可推的 —— rowsOf 也会返回空，这里提前挡掉更清楚
  if (!clubId) return []
  return diffRows(rowsOf(), pushed, clubId)
}

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

  await refreshClubs()
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

/**
 * 把攒着还没推的改动立刻推完，等推完再返回。
 *
 * 退出登录要用：登出之后本机那份缓存会被清掉，没推上去的东西就
 * 再也找不回来了。所以先推干净；推不动就把话说出来，别让人退。
 */
export async function flushNow(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase || !started) return { ok: true }
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (changedRows().length === 0) return { ok: true }
  await flush()
  if (status.state === 'error') return { ok: false, error: status.message }
  return { ok: true }
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
  /*
   * 「问过云端我在哪些群」这件事跟着账号走 —— 换个账号进来，
   * 上一个账号问出来的答案一点都不算数。
   */
  useApp.getState().setClubsChecked(false)
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

/* ------------------------------------------------------------------ *
 * 球群
 *
 * 这几个函数直接和数据库打交道，不走 store 那套「改了就推」的机制 ——
 * 建群和加群都要先在服务端落定（成员关系是数据库判断权限的依据），
 * 落定之后本机才谈得上有这个群。
 * ------------------------------------------------------------------ */

export type ClubOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * 邀请码。六位，从一个刻意挑过的字母表里取。
 *
 * 去掉了 0/O、1/I/L：这串码是要人念给球友听、或者照着打进去的。
 * 「零还是欧」这种问题，在球馆嘈杂的环境里问一次就够烦了。
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function newCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/**
 * 我在哪些球群里。
 *
 * 不带 club_id 条件 —— 策略只会给我是成员的那些群，所以这一句拿到的
 * 正好是「我的群」。这是唯一一处故意不按群过滤的查询。
 */
export async function listMyClubs(): Promise<ClubOutcome<Club[]>> {
  if (!supabase) return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  const noSession = await needsSignIn()
  if (noSession) return { ok: false, error: noSession }
  try {
    const { data, error } = await withTimeout(
      supabase.from('records').select('data').eq('kind', 'club').eq('deleted', false),
    )
    if (error) return { ok: false, error: readable(error.message) }
    return { ok: true, value: (data ?? []).map((r) => r.data as Club) }
  } catch (e) {
    return { ok: false, error: readable(e instanceof Error ? e.message : String(e)) }
  }
}

/**
 * 建一个球群，自己成为第一个成员。
 *
 * 顺序不能反：先插成员行，再插群记录。
 * 反过来的话，插群记录时我还不是成员，策略会把这一步拒掉 ——
 * 「只能写进自己的群」对建群的人也一样成立。
 */
export async function createClub(name: string): Promise<ClubOutcome<Club>> {
  if (!supabase) return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  const noSession = await needsSignIn()
  if (noSession) return { ok: false, error: noSession }

  const club: Club = {
    id: `club_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    name: name.trim(),
    code: newCode(),
    createdAt: Date.now(),
  }
  try {
    const joined = await withTimeout(
      supabase.from('club_members').insert({ club_id: club.id }),
    )
    if (joined.error) return { ok: false, error: readable(joined.error.message) }

    const saved = await withTimeout(
      supabase.from('records').insert({
        kind: 'club',
        id: club.id,
        data: club,
        club_id: club.id,
        deleted: false,
      }),
    )
    if (saved.error) {
      // 群没建成，成员行就不该留着 —— 留着会变成一个指向空群的死成员关系
      await supabase.from('club_members').delete().eq('club_id', club.id)
      return { ok: false, error: readable(saved.error.message) }
    }
    return { ok: true, value: club }
  } catch (e) {
    return { ok: false, error: readable(e instanceof Error ? e.message : String(e)) }
  }
}

/**
 * 用邀请码加入。
 *
 * 加入之前我还不是成员，按策略读不到那条群记录 —— 也就查不出邀请码
 * 对应哪个群。所以这一步走 club_by_code 那个函数：它绕过策略，
 * 但只按码查、只回 id 和名字，读不到任何球局数据。
 */
export async function joinClubByCode(code: string): Promise<ClubOutcome<Club>> {
  if (!supabase) return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  const noSession = await needsSignIn()
  if (noSession) return { ok: false, error: noSession }

  const trimmed = code.trim().toUpperCase()
  if (trimmed.length < 4) {
    return { ok: false, error: pick('邀请码不对', 'That invite code looks wrong') }
  }
  try {
    const found = await withTimeout(
      supabase.rpc('club_by_code', { invite_code: trimmed }),
    )
    if (found.error) return { ok: false, error: readable(found.error.message) }
    const hit = (found.data ?? [])[0] as { id: string; name: string } | undefined
    if (!hit) {
      return {
        ok: false,
        error: pick('没有这个邀请码的球群', 'No club with that invite code'),
      }
    }

    const joined = await withTimeout(
      supabase.from('club_members').insert({ club_id: hit.id }),
    )
    // 已经在群里了不算失败 —— 重复点一下不该报错
    if (joined.error && !/duplicate|unique/i.test(joined.error.message)) {
      return { ok: false, error: readable(joined.error.message) }
    }

    // 进了群才读得到完整记录（有邀请码，之后能拿去邀请别人）
    const full = await withTimeout(
      supabase.from('records').select('data').eq('kind', 'club').eq('id', hit.id).limit(1),
    )
    const club = (full.data ?? [])[0]?.data as Club | undefined
    return {
      ok: true,
      value: club ?? { id: hit.id, name: hit.name, code: trimmed, createdAt: Date.now() },
    }
  } catch (e) {
    return { ok: false, error: readable(e instanceof Error ? e.message : String(e)) }
  }
}

/**
 * 把「我在哪些球群里」刷新一遍，顺便挑一个当前球群。
 *
 * 挑的规则：
 *   本机记着的那个还在名单里 —— 就用它（换设备后回到上次看的群）
 *   只有一个群                 —— 直接进去，不用问
 *   有好几个但本机没记          —— 进第一个，界面上能再切
 *   一个都没有                 —— clubId 留空，界面会引导建群或输码
 *
 * 拉数据之前必须先跑这个：pullAll 是按 clubId 过滤的，
 * clubId 没定好就等于拉了个空。
 */
export async function refreshClubs(): Promise<ClubOutcome<Club[]>> {
  const res = await listMyClubs()
  if (!res.ok) {
    /*
     * 问不到（多半是断网）。这时候不动 clubs 和 clubId ——
     * 上次问出来的答案比「什么都没有」准。
     *
     * 但还是要记「问过了」：不记的话，引导页永远不出现，
     * 一个新注册的人会掉进一个什么都同步不了、也没人告诉他为什么的
     * 空 App 里。让他看见引导页、点下去看到网络错误，至少是句实话。
     */
    useApp.getState().setClubsChecked(true)
    return res
  }

  const clubs = res.value
  const { clubId, setClubs, setClubsChecked } = useApp.getState()
  setClubs(clubs)
  setClubsChecked(true)

  const stillIn = clubId && clubs.some((c) => c.id === clubId)
  if (!stillIn) {
    /*
     * 本机记着的群已经不在名单里了（退了群、或者被移出去）。
     * 换成第一个，一个都没有就清空 —— 留着一个进不去的群，
     * 界面会一直转圈拉一份永远拉不到的数据。
     */
    switchTo(clubs[0]?.id ?? null)
  }
  return res
}

/**
 * 建群之前本机就有的东西。
 *
 * 「先自己玩起来、觉得不错才登录」是很自然的顺序，这批数据不能因为
 * 建了个群就没了。
 */
type Carry = {
  players: Player[]
  sessions: Session[]
  matches: Match[]
  avatars: AvatarProfile[]
  announcements: Announcement[]
  meId: string | null
}

/**
 * 换到另一个球群（null = 一个都不在）。
 *
 * 两件事必须一起做，少一件就出事：
 *
 *   清基线 —— 基线里躺着上一个群那些行。不清的话，切完之后本机是空的，
 *             下一次同步会把「空 vs 基线」算成「这些行全被删了」，
 *             然后盖上新群的 club_id 推上去。等于拿新群的身份，
 *             去把上一个群的数据删掉。
 *
 *   挡订阅 —— 清空 store 本身会触发一次推送。applying 期间订阅会跳过它。
 */
function switchTo(id: string | null, carry?: Carry | null) {
  if (useApp.getState().clubId === id && !carry) return
  applying = true
  try {
    pushed = new Map()
    useApp.getState().setClubId(id)
    if (carry) useApp.setState(carry)
  } finally {
    applying = false
  }
}

/**
 * 进入某个球群：换过去，然后把那个群的数据拉下来。
 *
 * carry 只在「刚建群」时给：新群云端是空的，本机那份要推上去成为
 * 这个群的第一批数据。加入别人的群时不能给 —— 那边已经有数据了，
 * 本机这份和它是两回事，混进去只会多出一批来路不明的球员。
 */
export async function enterClub(id: string, carry?: Carry | null): Promise<PullOutcome> {
  switchTo(id, carry)
  const outcome = await pullAll()
  // 新建的群云端是空的：把带过来的那份推上去
  if (outcome.ok && outcome.empty && rowsOf().size > 0) await pushAll()
  return outcome
}

/**
 * 建一个群并且进去，本机已有的数据一起带过去。
 *
 * 界面上用这个，不要直接用 createClub —— 光建出来不进去的话，
 * 人点完「建群」还停在引导页上，看着像没成功。
 */
export async function createAndEnterClub(name: string): Promise<ClubOutcome<Club>> {
  const st = useApp.getState()
  /*
   * 只有「本来就不在任何群里」时才带。已经在群里的人再建一个新群，
   * 本机那份是上一个群的 —— 带过去就是把别人群的球员和战绩复制一份
   * 到新群里。
   */
  const carry: Carry | null =
    st.clubId === null
      ? {
          players: st.players,
          sessions: st.sessions,
          matches: st.matches,
          avatars: st.avatars,
          announcements: st.announcements,
          meId: st.meId,
        }
      : null

  const res = await createClub(name)
  if (!res.ok) return res

  useApp.getState().setClubs([...st.clubs, res.value])
  await enterClub(res.value.id, carry)
  return res
}

/** 用邀请码加入并且进去 */
export async function joinAndEnterClub(code: string): Promise<ClubOutcome<Club>> {
  const res = await joinClubByCode(code)
  if (!res.ok) return res
  await enterClub(res.value.id)
  await refreshClubs()
  return res
}

/**
 * 给球群改名。
 *
 * 群记录不走那套「本机改了就推」的机制（rowsOf 里没有 club 这一档），
 * 所以这里直接写数据库，成了再更新本机那份缓存。
 *
 * 迁移过来的群名字是脚本里写死的「我的球群」，不给改的话它就一直
 * 挂在那 —— 建群那个表单也答应过「之后能改」。
 */
export async function renameClub(id: string, name: string): Promise<ClubOutcome<Club>> {
  if (!supabase) return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  const noSession = await needsSignIn()
  if (noSession) return { ok: false, error: noSession }

  const clubs = useApp.getState().clubs
  const club = clubs.find((c) => c.id === id)
  if (!club) return { ok: false, error: pick('找不到这个球群', 'No such club') }

  const next: Club = { ...club, name: name.trim() }
  try {
    const { error } = await withTimeout(
      supabase
        .from('records')
        .update({ data: next })
        .eq('kind', 'club')
        .eq('id', id),
    )
    if (error) return { ok: false, error: readable(error.message) }
  } catch (e) {
    return { ok: false, error: readable(e instanceof Error ? e.message : String(e)) }
  }

  useApp.getState().setClubs(clubs.map((c) => (c.id === id ? next : c)))
  return { ok: true, value: next }
}

/**
 * 退出球群。
 *
 * 只删自己那条成员关系，群和群里的数据一点都不动 —— 退群是「我不看了」，
 * 不是「这个群没了」。想真的解散一个群，那是另一件事，现在不做：
 * 一个人手滑就能把全群一年的战绩删掉，这种按钮不该存在。
 */
export async function leaveClub(id: string): Promise<ClubOutcome<Club[]>> {
  if (!supabase) return { ok: false, error: pick('还没接云端', 'Cloud is not set up') }
  const noSession = await needsSignIn()
  if (noSession) return { ok: false, error: noSession }

  /*
   * 退之前先把没推上去的推完。退了之后策略就不认这台手机了 ——
   * 那几场刚记的分会一直卡在本机，而本机马上要被清空。
   */
  if (useApp.getState().clubId === id) {
    await flush()
    if (status.state === 'error') {
      return {
        ok: false,
        error: pick(
          `还有东西没同步上去，先连上网再退群：${status.message}`,
          `Some changes are not synced yet — get back online before leaving: ${status.message}`,
        ),
      }
    }
  }

  try {
    // 策略只允许删自己那一行，所以这里不用（也不该）写 user_id
    const { error } = await withTimeout(
      supabase.from('club_members').delete().eq('club_id', id),
    )
    if (error) return { ok: false, error: readable(error.message) }
  } catch (e) {
    return { ok: false, error: readable(e instanceof Error ? e.message : String(e)) }
  }

  // 名单重新问一遍：退的正好是当前群的话，这一步会把本机换到别的群去
  const res = await refreshClubs()
  if (res.ok && useApp.getState().clubId) await pullAll()
  return res
}
