/* ------------------------------------------------------------------ *
 * 好友和私聊的提醒
 *
 * 部署在 Supabase Edge Functions（Deno）。和 notify-session 是两个
 * 函数，因为它们要回答的问题不一样：那个是「所有人，有局了」，
 * 这个是「就你一个人，有人找你」。
 *
 * -------------------------------------------------------------------
 * 一条规矩：通知里不带私信内容
 *
 * 只说「Sean 给你发了一条消息」，不说他说了什么。
 *
 * 两个理由，都够硬：
 *   锁屏上那一行谁都看得到。私信的意思就是「只有你们俩看得到」，
 *   而手机搁在桌上时它是一屋子人看得到。
 *   其次，这个函数是客户端调的，而客户端是可以被伪造的 —— 内容
 *   如果来自请求体，谁都能让别人的手机弹出任意一句话。
 *
 * 所以请求体里只认「哪一条」，不认「写了什么」：拿到 id 之后自己
 * 回数据库把那一行读出来。伪造一个 id 最多让人多收一条「你有新
 * 消息」的提醒，而那条消息是真的存在的。
 * -------------------------------------------------------------------
 *
 * 需要的 Secret 和 notify-session 完全一样，两个函数共用：
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
 * ------------------------------------------------------------------ */

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''

webpush.setVapidDetails(
  'mailto:rally@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
)

const describe = (e: unknown): string =>
  e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e)

/* ------------------------------------------------------------------ *
 * 找一把真的能绕过 RLS 的钥匙
 *
 * 和 notify-session 里那一段是同一份，理由也一样：Supabase 正在换
 * API key 体系，老项目注入 SUPABASE_SERVICE_ROLE_KEY，新项目改注入
 * SUPABASE_SECRET_KEYS，而两个可能同时存在、老的那个已经停用。
 * 不猜，全试一遍，谁查得通用谁。
 *
 * 没有抽成共享模块：Edge Functions 每个函数各自打包部署，抽出去
 * 要多一层目录和 import 映射，而这段三十行的东西改一次的频率
 * 远低于那层结构带来的麻烦。
 * ------------------------------------------------------------------ */

type Candidate = { name: string; key: string }

function candidateKeys(): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const add = (name: string, key: unknown) => {
    if (typeof key !== 'string' || !key || seen.has(key)) return
    seen.add(key)
    out.push({ name, key })
  }

  add('SERVICE_ROLE_KEY', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))

  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim()
  if (raw) {
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw)
        const values: unknown[] = Array.isArray(parsed) ? parsed : Object.values(parsed)
        values.forEach((it, i) => {
          const k =
            typeof it === 'string'
              ? it
              : ((it as Record<string, unknown> | null)?.api_key ??
                 (it as Record<string, unknown> | null)?.key ??
                 (it as Record<string, unknown> | null)?.secret)
          add(`SECRET_KEYS[${i}]`, k)
        })
      } catch (e) {
        console.error('SECRET_KEYS 解析不了:', describe(e))
      }
    } else {
      raw.split(',').forEach((k, i) => add(`SECRET_KEYS[${i}]`, k.trim()))
    }
  }
  return out
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

let cached: ReturnType<typeof createClient> | null = null

async function getAdmin() {
  if (cached) return cached
  const candidates = candidateKeys()
  if (candidates.length === 0) {
    throw new Error(
      '一把服务端钥匙都没有：SUPABASE_SERVICE_ROLE_KEY 和 SUPABASE_SECRET_KEYS 都是空的',
    )
  }
  const tried: string[] = []
  for (const c of candidates) {
    const client = createClient(SUPABASE_URL, c.key)
    const { error } = await client.from('push_subscribers').select('endpoint').limit(1)
    if (!error) {
      console.log('用的钥匙:', c.name)
      cached = client
      return client
    }
    tried.push(`${c.name} → ${error.message}`)
  }
  throw new Error(`手上的钥匙都查不通 push_subscribers：${tried.join(' ; ')}`)
}

/* ------------------------------------------------------------------ *
 * 谁是谁
 * ------------------------------------------------------------------ */

type Admin = Awaited<ReturnType<typeof getAdmin>>

/**
 * 这个账号在球员名册上叫什么。
 *
 * 通知里没有名字就等于没有通知 ——「你有一条新消息」，谁发的？
 * 收到的人还是得打开 App 才知道要不要理，那推送就白推了。
 *
 * 查的是 records 里的球员行，靠 data->>ownerId 认人。查不到名字
 * （他还没建球员、或者在别的球群）就退回「有人」，不编一个。
 */
async function nameOf(admin: Admin, uid: string): Promise<string> {
  const { data, error } = await admin
    .from('records')
    .select('data')
    .eq('kind', 'player')
    .eq('deleted', false)
    .filter('data->>ownerId', 'eq', uid)
    .limit(1)
  if (error) {
    console.error('查名字失败:', error.message)
    return ''
  }
  const row = (data ?? [])[0] as { data?: { name?: string } } | undefined
  return row?.data?.name?.trim() ?? ''
}

/** 一句话的两种说法。哪一种由收的那台设备决定 */
type Line = { zh: string; en: string }

/**
 * 推给这个账号的每一台设备。
 *
 * tag 决定通知栏里会不会互相顶掉，所以由这里给：私聊按人分开，
 * 三个人找你就是三条；好友的事共用一条 —— 那本来就是一件事的
 * 两个阶段（他加你 / 他答应了），后一条盖掉前一条正好。
 *
 * 语言一台一台地挑，不是整个人挑一次：同一个人手机上看中文、
 * iPad 上看英文完全说得通，而 push_subscribers 一行正好就是一台
 * 设备。lang 是空的（这次改动之前订的那些）就退回中文 ——
 * 空的意思是「不知道」，不去猜，猜错了是推一条他读不懂的话。
 */
async function pushTo(
  admin: Admin,
  uid: string,
  title: Line,
  body: Line,
  tag: string,
): Promise<{ sent: number; failed: number }> {
  const { data: subs, error } = await admin
    .from('push_subscribers')
    .select('endpoint,p256dh,auth,lang')
    .eq('user_id', uid)
  if (error) throw error

  console.log('目标设备数:', subs?.length ?? 0)
  if (!subs || subs.length === 0) return { sent: 0, failed: 0 }

  const results = await Promise.allSettled(
    subs.map(async (s: { endpoint: string; p256dh: string; auth: string; lang?: string | null }) => {
      const en = s.lang === 'en'
      /*
       * url 带上 #friends：点开通知直接落在好友那一屏。
       * 不带的话人落在首页，还得自己找一遍 —— 那一下的摩擦足够
       * 让一半的人放弃。
       */
      const payload = JSON.stringify({
        title: en ? title.en : title.zh,
        body: en ? body.en : body.zh,
        tag,
        url: './#friends',
      })
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        console.error('推送失败:', code, describe(e), '| endpoint:', s.endpoint.slice(0, 60))
        // 410 Gone / 404 = 订阅作废了，留着只会每次都失败一遍
        if (code === 404 || code === 410) {
          await admin.from('push_subscribers').delete().eq('endpoint', s.endpoint)
        }
        throw e
      }
    }),
  )
  const sent = results.filter((r) => r.status === 'fulfilled').length
  return { sent, failed: results.length - sent }
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

type Ask = { kind?: string; id?: string; table?: string; record?: { id?: string } }

Deno.serve(async (req) => {
  try {
    const body: Ask = await req.json()

    /*
     * 两种调用方式都认：
     *   客户端直接调   { kind: 'message' | 'friend', id }
     *   数据库 Webhook { table, record: { id } }
     *
     * 客户端那条路上线就能用，不用在后台配 Webhook；Webhook 那条
     * 更可靠（发消息的人网断了也照样推）。两条都留着，配了就走
     * Webhook，没配也不至于一条通知都没有。
     */
    const kind = body.kind ?? (body.table === 'messages' ? 'message' : body.table === 'friendships' ? 'friend' : '')
    const id = body.id ?? body.record?.id
    console.log('收到:', kind, id)

    if (!id || (kind !== 'message' && kind !== 'friend')) {
      return new Response(JSON.stringify({ skipped: 'not mine' }), { status: 200 })
    }

    const admin = await getAdmin()

    let to = ''
    let title: Line = { zh: '', en: '' }
    let text: Line = { zh: '', en: '' }
    let tag = 'rally-social'

    if (kind === 'message') {
      /*
       * 回数据库把这一行读出来，不信请求体里的任何内容。
       * 读出来的只用 sender / recipient 两栏 —— body 一个字都不看，
       * 它不会进通知（见文件开头那段）。
       */
      const { data, error } = await admin
        .from('messages')
        .select('sender,recipient')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        console.log('这条消息不存在，跳过')
        return new Response(JSON.stringify({ skipped: 'no such message' }), { status: 200 })
      }
      const m = data as { sender: string; recipient: string }
      to = m.recipient
      const who = await nameOf(admin, m.sender)
      title = {
        zh: who ? `${who} 给你发了消息` : '你有一条新消息',
        en: who ? `${who} sent you a message` : 'You have a new message',
      }
      text = { zh: '点开看看', en: 'Tap to read it' }
      // 按人分开：三个人找你，就该是三条通知
      tag = `rally-msg-${m.sender}`
    } else {
      const { data, error } = await admin
        .from('friendships')
        .select('requester,addressee,status')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        console.log('这条关系不存在，跳过')
        return new Response(JSON.stringify({ skipped: 'no such friendship' }), { status: 200 })
      }
      const f = data as { requester: string; addressee: string; status: string }

      /*
       * 申请和同意是两个方向：
       *   pending  发起的人 → 被申请的人   「他想加你」
       *   accepted 被申请的人 → 发起的人   「他答应了」
       * 弄反的话，通知会发给刚刚自己按了按钮的那个人。
       */
      if (f.status === 'pending') {
        to = f.addressee
        const who = await nameOf(admin, f.requester)
        title = {
          zh: who ? `${who} 想加你好友` : '有人想加你好友',
          en: who ? `${who} wants to be friends` : 'Someone wants to be friends',
        }
        text = { zh: '同意之后就能私聊', en: 'Accept and you can chat' }
      } else {
        to = f.requester
        const who = await nameOf(admin, f.addressee)
        title = {
          zh: who ? `${who} 同意了你的好友申请` : '好友申请通过了',
          en: who ? `${who} accepted your friend request` : 'Your friend request was accepted',
        }
        text = { zh: '现在可以私聊了', en: 'You can chat now' }
      }
    }

    const r = await pushTo(admin, to, title, text, tag)
    console.log('推完:', r.sent, '成功 /', r.failed, '失败')
    return new Response(JSON.stringify(r), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    console.error('整个函数炸了:', describe(e))
    return new Response(JSON.stringify({ error: describe(e) }), { status: 500 })
  }
})
