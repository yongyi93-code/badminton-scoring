import { supabase } from '@/lib/supabase'
import { pick } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 好友和私聊 —— 和云端打交道的那一层
 *
 * 这一块和 App 其余部分有一条很硬的界线：它不走 records 那张表，
 * 也不进本机那份 localStorage 缓存。
 *
 * 不走 records 是因为那张表的规则是「同一个球群的人都读得到」，
 * 而所有人现在都在同一个默认球群里 —— 私信塞进去等于公开。
 * 规则见 supabase/009-friends-and-chat.sql，那三张表各有一套
 * 「只有相关的人看得到」的策略。
 *
 * 不进本机缓存是因为这些东西没法离线用：发不出去的消息不是消息，
 * 而把私信留在这台手机上，下一个用这台手机的人就翻得到。
 * 所以断网时这一块是空的，界面得说清楚。
 *
 * 这里全部按 auth 的 uid 走，不按球员 id —— 数据库那套策略认的是
 * auth.uid()，中间多一层映射就多一个能对不上的地方。球员 ↔ uid
 * 的换算在 store/useSocial.ts 里，只那一处。
 * ------------------------------------------------------------------ */

export type Friendship = {
  id: string
  requester: string
  addressee: string
  status: 'pending' | 'accepted'
  created_at: string
}

export type Message = {
  id: string
  sender: string
  recipient: string
  body: string
  created_at: string
  read_at: string | null
}

export type SocialResult = { ok: true } | { ok: false; error: string }

/**
 * 一次最多拉多少条私信。
 *
 * 拉的是「我参与的全部对话」，不是某一段 —— 这样未读数、会话列表、
 * 每一段的内容都从同一份数据里算，不用为每个数字各跑一次查询。
 * 代价是有个上限：聊了几千条之后最早的那些翻不到。
 *
 * 现在这个量级（十几个人）离这个上限还很远。真到了那天，
 * 该做的是「按会话分页」，而不是把这个数字调大。
 */
const MESSAGE_LIMIT = 500

const noCloud = () => pick('还没接云端，私聊用不了', 'Cloud is not set up — chat is unavailable')

/** 把数据库的报错翻成人话。认不出来的退回原文，至少还能搜 */
function readable(message: string): string {
  const m = message.toLowerCase()
  /*
   * 这两条是「后端还没装好」，不是「你做错了什么」。
   *
   * 摆在最前面，而且说的是该去干什么 —— 上线那天真的撞上过：
   * 界面上原样吐出一句 permission denied for table friendships，
   * 对着一个只想加好友的人，那句话一个字都没用。
   */
  if (m.includes('permission denied')) {
    return pick(
      '好友功能还没开通 —— 数据库那边少了一步（009 那段 SQL 里的 grant）。',
      'Friends is not switched on yet — the database is missing a grant (see migration 009).',
    )
  }
  if (m.includes('does not exist') || m.includes('schema cache')) {
    return pick(
      '好友功能还没开通 —— 数据库里还没有这几张表，要先跑 009 那段 SQL。',
      'Friends is not switched on yet — the tables do not exist. Run migration 009 first.',
    )
  }
  if (m.includes('row-level security') || m.includes('violates row-level')) {
    /*
     * 这一条几乎总是同一件事：你们不是好友了，或者被对方拉黑了。
     * 数据库那边不区分（区分了就等于告诉他「你被拉黑了」），
     * 所以这里也只能给一句含糊但真实的话。
     */
    return pick(
      '发不出去 —— 你们现在不是好友',
      'Could not send — you are not friends right now',
    )
  }
  if (m.includes('duplicate key')) {
    return pick('你们之间已经有一条申请了', 'There is already a request between you')
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return pick('连不上服务器，检查一下网络', 'Cannot reach the server — check your connection')
  }
  return message
}

const fail = (e: { message: string }): SocialResult => ({ ok: false, error: readable(e.message) })

/* ------------------------------------------------------------------ *
 * 读
 * ------------------------------------------------------------------ */

/** 我牵涉在内的全部好友关系（申请中的也算）。策略保证只查得到自己的 */
export async function fetchFriendships(): Promise<Friendship[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('friendships')
    .select('id,requester,addressee,status,created_at')
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('好友列表没拉到:', error.message)
    return []
  }
  return (data ?? []) as Friendship[]
}

/** 我参与的最近这些私信。策略保证只查得到收发双方是自己的 */
export async function fetchMessages(): Promise<Message[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('messages')
    .select('id,sender,recipient,body,created_at,read_at')
    .order('created_at', { ascending: false })
    .limit(MESSAGE_LIMIT)
  if (error) {
    console.warn('私信没拉到:', error.message)
    return []
  }
  /* 拉的时候倒着取最近的，用的时候要顺着读 */
  return ((data ?? []) as Message[]).reverse()
}

/** 我拉黑了谁。查不到「谁拉黑了我」—— 那是故意的，见 009 里的注释 */
export async function fetchBlocked(): Promise<string[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('blocks').select('blocked')
  if (error) {
    console.warn('黑名单没拉到:', error.message)
    return []
  }
  return (data ?? []).map((r: { blocked: string }) => r.blocked)
}

/* ------------------------------------------------------------------ *
 * 写
 *
 * 每一处都不传 requester / sender / blocker —— 那几栏的默认值是
 * auth.uid()，由数据库自己填。客户端不传就伪造不了，
 * 而策略里又不允许改成别人。
 * ------------------------------------------------------------------ */

export async function sendFriendRequest(uid: string): Promise<SocialResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.from('friendships').insert({ addressee: uid })
  return error ? fail(error) : { ok: true }
}

export async function acceptFriendRequest(id: string): Promise<SocialResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', id)
  return error ? fail(error) : { ok: true }
}

/**
 * 删掉一段关系。
 *
 * 拒绝申请、撤回自己发的申请、删好友 —— 三件事在数据上是同一件：
 * 把那一行删掉。分成三个函数只会让三处各写一遍同样的 SQL。
 */
export async function removeFriendship(id: string): Promise<SocialResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.from('friendships').delete().eq('id', id)
  return error ? fail(error) : { ok: true }
}

export async function sendMessage(uid: string, body: string): Promise<SocialResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const text = body.trim()
  if (!text) return { ok: false, error: pick('空的发不出去', 'Nothing to send') }
  const { error } = await supabase
    .from('messages')
    .insert({ recipient: uid, body: text.slice(0, 2000) })
  return error ? fail(error) : { ok: true }
}

/**
 * 把这个人发给我的都标记成已读。
 *
 * 只动 read_at —— 数据库那边有个触发器把别的栏都按回旧值，
 * 所以就算这里写错了，也改不掉对方说过的话。
 */
export async function markRead(fromUid: string, meUid: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sender', fromUid)
    .eq('recipient', meUid)
    .is('read_at', null)
  if (error) console.warn('标记已读没成功:', error.message)
}

export async function blockUser(uid: string): Promise<SocialResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.from('blocks').insert({ blocked: uid })
  return error ? fail(error) : { ok: true }
}

export async function unblockUser(uid: string): Promise<SocialResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.from('blocks').delete().eq('blocked', uid)
  return error ? fail(error) : { ok: true }
}

/* ------------------------------------------------------------------ *
 * 实时
 * ------------------------------------------------------------------ */

type Channel = ReturnType<NonNullable<typeof supabase>['channel']>
let channel: Channel | null = null

/**
 * 有动静就叫一声，不带内容。
 *
 * 和 sync.ts 那边同一个做法：收到就整份重拉，不解析事件内容。
 * 数据量是几百行，重拉一次比在客户端拼装增量少一整类对不上的 bug ——
 * 尤其是私信，拼错的后果是聊天记录里少一句或者多一句。
 */
export function watchSocial(onChange: () => void): void {
  if (!supabase || channel) return
  channel = supabase
    .channel('social-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onChange)
    .subscribe()
}

export function unwatchSocial(): void {
  if (channel) {
    void supabase?.removeChannel(channel)
    channel = null
  }
}
