import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { myCard } from '@/lib/profile'
import {
  setCloudWriter,
  useTournament,
  type Tournament,
  type TournamentOp,
} from '@/store/useTournament'

/* ------------------------------------------------------------------ *
 * 淘汰赛表 ↔ 云端（supabase/032-tournaments.sql）
 *
 * 本机那份（useTournament，存在 localStorage）还是界面读的唯一来源。
 * 这一层只做两件事：
 *
 *   往上推  本机改了 → 写到云端
 *   往下拉  云端变了（别的手机填了分）→ 落到本机
 *
 * -------------------------------------------------------------------
 * 撞车
 *
 * 整张赛表是一个 jsonb，所以两台手机同时各填一场，后写的会把前一笔
 * 整张盖掉。每一行带一个 version，写的时候只写「还是我看到的那一版」
 * 的那一行；写不进去就说明别人先改了 —— 拉最新那版，把**这一笔改动**
 * （不是整张表）重新套一遍再写。改动是纯函数（store 里的 opXxx），
 * 所以套几遍都一样。
 *
 * 同一场比赛的写入排成一队，一笔写完再写下一笔：连着填三场分，
 * 并发写的话后两笔必定撞上自己。
 * ------------------------------------------------------------------ */

type Row = {
  id: string
  host_uid: string
  editors: string[] | null
  name: string
  date: string
  doubles: boolean
  mode: Tournament['mode']
  size: number
  entrants: Tournament['entrants']
  matches: Tournament['matches']
  host_name: string | null
  version: number
  created_at: string
}

export const fromRow = (r: Row): Tournament => ({
  id: r.id,
  hostUid: r.host_uid,
  editors: r.editors ?? [],
  hostName: r.host_name,
  name: r.name,
  date: r.date,
  doubles: r.doubles,
  mode: r.mode,
  size: r.size,
  entrants: r.entrants ?? [],
  matches: r.matches ?? [],
  version: r.version,
  createdAt: Date.parse(r.created_at) || Date.now(),
})

/**
 * 要写上去的那几栏。
 *
 * 记分员只送 matches —— 别的栏就算原样送上去数据库也收（值没变），
 * 但少送一栏就少一种「我手上那份名单是旧的、顺手把开比赛的人刚改的
 * 名单盖回去」的可能。
 */
export function rowPatch(t: Tournament, asHost: boolean): Partial<Row> {
  /* JSON 来回一趟：把 undefined 的栏位去掉，和数据库里存的样子一致 */
  const matches = JSON.parse(JSON.stringify(t.matches)) as Row['matches']
  if (!asHost) return { matches }
  return {
    name: t.name,
    date: t.date,
    doubles: t.doubles,
    mode: t.mode,
    size: t.size,
    entrants: JSON.parse(JSON.stringify(t.entrants)) as Row['entrants'],
    matches,
    editors: t.editors ?? [],
  }
}

let me: string | null = null
let myName: string | null = null
let channel: RealtimeChannel | null = null
/** 每场比赛一条写入队列 */
const queues = new Map<string, Promise<void>>()
/** 还有几笔没写完。有的话，云端推下来的旧版本先不落 —— 会把本机刚填的分闪回去 */
const pending = new Map<string, number>()

const store = () => useTournament.getState()
const local = (id: string) => store().list.find((t) => t.id === id)

function enqueue(id: string, job: () => Promise<void>) {
  pending.set(id, (pending.get(id) ?? 0) + 1)
  const next = (queues.get(id) ?? Promise.resolve())
    .then(job)
    .catch((err) => console.warn('比赛没写上云端:', err))
    .finally(() => {
      const left = (pending.get(id) ?? 1) - 1
      if (left > 0) pending.set(id, left)
      else pending.delete(id)
    })
  queues.set(id, next)
}

async function fetchOne(id: string): Promise<Tournament | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return fromRow(data as Row)
}

/** 推一场本机的比赛上去，推成了它就有了 host，从此跟着云端走 */
async function upload(t: Tournament): Promise<void> {
  if (!supabase || !me) return
  const row = {
    id: t.id,
    host_uid: me,
    host_name: myName,
    created_at: new Date(t.createdAt).toISOString(),
    ...rowPatch({ ...t, editors: [] }, true),
  }
  const { data, error } = await supabase.from('tournaments').insert(row).select('*').single()
  if (error) throw error
  const saved = fromRow(data as Row)
  /* 推的这一会儿本机可能又改了（填了一场分），那几笔改动接着推 */
  const now = local(t.id)
  if (now && JSON.stringify(now.matches) !== JSON.stringify(saved.matches)) {
    store().putRemote({ ...now, hostUid: saved.hostUid, editors: [], version: saved.version })
    write(t.id, (x) => ({ ...x, matches: now.matches, entrants: now.entrants, name: now.name }))
  } else {
    store().putRemote(saved)
  }
}

/** 一笔改动写上去。撞车就拿最新那版重套，最多试几次 */
function write(id: string, op: TournamentOp) {
  enqueue(id, async () => {
    if (!supabase || !me) return
    let base = local(id)
    /* 还没上云的比赛：只在本机，开机同步时会整场推上去 */
    if (!base?.hostUid) return
    let next = base
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!base || !base.hostUid) return
      /* 第一次：本机已经套过这一笔了，直接写；之后每次都在最新那版上重套 */
      next = attempt === 0 ? base : op(base)
      const asHost = base.hostUid === me
      const { data, error } = await supabase
        .from('tournaments')
        .update(rowPatch(next, asHost))
        .eq('id', id)
        .eq('version', base.version ?? 0)
        .select('*')
        .maybeSingle()
      if (error) throw error
      if (data) {
        const saved = fromRow(data as Row)
        /* 后面还排着几笔的话只更新版本号，内容以本机为准（那几笔已经套在上面了） */
        const now = local(id)
        if ((pending.get(id) ?? 1) > 1 && now) store().putRemote({ ...now, version: saved.version })
        else store().putRemote(saved)
        return
      }
      /* 版本对不上：别人先改了。拉最新的，下一圈重套 */
      base = (await fetchOne(id)) ?? undefined
      if (!base) {
        store().dropRemote(id)
        return
      }
      store().putRemote(op(base))
    }
    /* 试了几次都撞：落回云端那版，别让本机和云端各说各话 */
    const latest = await fetchOne(id)
    if (latest) store().putRemote(latest)
  })
}

function remove(id: string) {
  enqueue(id, async () => {
    if (!supabase) return
    const { error } = await supabase.from('tournaments').delete().eq('id', id)
    if (error) throw error
  })
}

/**
 * 整份拉下来，和本机对一遍。
 *
 * 出了错只记一笔，不往外抛：它是开机、回前台时顺手跑的，
 * 没有谁在等它的结果，抛出去就是一个没人接的 rejection。
 */
export async function pullTournaments(): Promise<void> {
  try {
    await pullOnce()
  } catch (err) {
    console.warn('比赛没拉下来:', err)
  }
}

async function pullOnce(): Promise<void> {
  if (!supabase || !me) return
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) {
    console.warn('比赛没拉下来:', error.message)
    return
  }
  const rows = (data ?? []) as Row[]
  const remote = new Map(rows.map((r) => [r.id, fromRow(r)]))

  for (const t of store().list) {
    if (pending.has(t.id)) continue
    const r = remote.get(t.id)
    if (r) continue
    /* 本机有、云端没有：没上过云的推上去；上过云的说明被删了 */
    if (!t.hostUid) enqueue(t.id, () => upload(t))
    else if (rows.length < 200) store().dropRemote(t.id)
  }
  for (const t of remote.values()) {
    if (pending.has(t.id)) continue
    const mine = local(t.id)
    if (!mine || (mine.version ?? -1) <= (t.version ?? 0)) store().putRemote(t)
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') void pullTournaments()
}

/** 登录之后开起来；挂在 useAuth 的 follow 里 */
export function startTournamentSync(uid: string, name: string | null = null): void {
  if (!supabase) return
  if (me === uid && channel) return
  /* 换了个账号登录：上一个人的那份先清掉 */
  stopTournamentSync(me !== null && me !== uid)
  me = uid
  myName = name
  void myCard()
    .then((c) => {
      if (me === uid && c?.name) myName = c.name
    })
    .catch(() => {})
  setCloudWriter({
    create: (t) => enqueue(t.id, () => upload(t)),
    write,
    remove,
  })
  void pullTournaments()
  /*
   * 别人填了分，推过来就直接落。自己写的那一笔回声也会推回来 ——
   * 版本号一样、内容一样，落了也没事；本机还有没写完的就先不落。
   */
  channel = supabase
    .channel('tournaments-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        const id = (payload.old as { id?: string }).id
        if (id && !pending.has(id)) store().dropRemote(id)
        return
      }
      const t = fromRow(payload.new as Row)
      if (pending.has(t.id)) return
      const mine = local(t.id)
      if (!mine || (mine.version ?? -1) <= (t.version ?? 0)) store().putRemote(t)
    })
    .subscribe()
  document.addEventListener('visibilitychange', onVisible)
}

/**
 * 退出登录：断开，并把云端来的比赛从这台手机上清掉 ——
 * 下一个用这台手机的人不该翻到上一个人记分的那些比赛。
 * 本机还没上云的那几场留着，它们本来就只属于这台手机。
 */
export function stopTournamentSync(clear = true): void {
  if (channel && supabase) void supabase.removeChannel(channel)
  channel = null
  me = null
  setCloudWriter(null)
  document.removeEventListener('visibilitychange', onVisible)
  if (clear) store().dropAllRemote()
}

/** 自己的名字晚到了（名片是另外拉的），补上，下次推新比赛时带上 */
export function setTournamentHostName(name: string | null): void {
  myName = name
}
