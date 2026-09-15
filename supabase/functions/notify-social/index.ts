/* ------------------------------------------------------------------ *
 * 好友、私聊、举报、反馈的提醒
 *
 * 部署在 Supabase Edge Functions（Deno）。和 notify-session 是两个
 * 函数，因为它们要回答的问题不一样：那个是「所有人，有局了」，
 * 这个是「就你一个人，有人找你」。
 *
 * -------------------------------------------------------------------
 * 举报为什么也塞在这个函数里
 *
 * 它比前两件事多干一件：先把那段对话拍成快照存进 reports.evidence，
 * 再通知管理员。严格说这不只是「通知」，名字有点撑。
 *
 * 还是塞进来，是因为另一条路更差：上面那六十行找钥匙的样板要再抄
 * 一份，而且要在后台多建、多部署一个函数 —— 而「在后台手动部署
 * 函数」这一步本身就出过错。一个函数少一次手动步骤，比一个名字
 * 更贴切值钱。
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
  /* 点开落在哪一屏。举报要落在举报队列，不是好友页 */
  url = './#friends',
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
       * url 带上 #friends / #reports：点开通知直接落在该去的那一屏。
       * 不带的话人落在首页，还得自己找一遍 —— 那一下的摩擦足够
       * 让一半的人放弃。
       */
      const payload = JSON.stringify({
        title: en ? title.en : title.zh,
        body: en ? body.en : body.zh,
        tag,
        url,
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
 * 举报
 * ------------------------------------------------------------------ */

/** 快照里留几条。够看清来龙去脉，又不至于把半年的聊天记录搬一份 */
const EVIDENCE_LIMIT = 30

/**
 * 兜底：万一这条举报还没有证据，补拍一次。
 *
 * 正常情况下轮不到它 —— 013 之后，证据由数据库在举报落库的同一刻
 * 自己拍好了。留着这段是为了「013 还没跑」的那段窗口。
 *
 * 为什么快照非得挪去数据库：这段代码原本是主力，结果上线第一天
 * 就丢了一条 —— 第一次调用撞上冷启动，客户端等不到就放弃，
 * 那 18 句对话再也拍不回来。证据有时效（消息会被删），
 * 一条会偶尔丢证据的路，不配当主力。
 *
 * 拍一次就冻住 —— 数据库那个触发器管着，这里重复调也改不掉第一次
 * 拍到的内容。所以这个函数可以安全地被重试。
 */
async function snapshot(admin: Admin, reportId: string, a: string, b: string): Promise<number> {
  const { data, error } = await admin
    .from('messages')
    .select('id,sender,body,kind,audio_path,duration_ms,created_at')
    .or(`and(sender.eq.${a},recipient.eq.${b}),and(sender.eq.${b},recipient.eq.${a})`)
    .order('created_at', { ascending: false })
    .limit(EVIDENCE_LIMIT)
  if (error) throw error

  /* 拉的时候倒着取最近的，存的时候要顺着，不然读起来是倒放的 */
  const messages = (data ?? []).reverse()
  const { error: upErr } = await admin
    .from('reports')
    .update({ evidence: { taken_at: new Date().toISOString(), messages } })
    .eq('id', reportId)
  if (upErr) throw upErr
  return messages.length
}

/** 管理员都有谁。名单是服务端读的 —— App 那边查不到别人在不在名单里 */
async function adminUids(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.from('app_admins').select('uid')
  if (error) throw error
  return (data ?? []).map((r: { uid: string }) => r.uid)
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
    const kind =
      body.kind ??
      (body.table === 'messages'
        ? 'message'
        : body.table === 'friendships'
          ? 'friend'
          : body.table === 'reports'
            ? 'report'
            : body.table === 'feedback'
              ? 'feedback'
              : '')
    const id = body.id ?? body.record?.id
    console.log('收到:', kind, id)

    if (!id || (kind !== 'message' && kind !== 'friend' && kind !== 'report' && kind !== 'feedback')) {
      return new Response(JSON.stringify({ skipped: 'not mine' }), { status: 200 })
    }

    const admin = await getAdmin()

    /*
     * 反馈：通知每个管理员。
     *
     * 和举报的区别是这条**带内容**。反馈说的是软件，不是某个人 ——
     * 锁屏上露出「结束球局点不动」不伤害任何人，而它省掉球主
     * 点开 App 才知道是不是急事的那一步。
     *
     * 但仍然不信请求体：回数据库把那一行读出来，只是这次读的是
     * 正文。伪造一个 id 最多让球主多收一条他本来就该看到的反馈。
     */
    if (kind === 'feedback') {
      const { data, error } = await admin
        .from('feedback')
        .select('kind,body,author')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        console.log('这条反馈不存在，跳过')
        return new Response(JSON.stringify({ skipped: 'no such feedback' }), { status: 200 })
      }
      const fb = data as { kind: string; body: string; author: string }

      const admins = await adminUids(admin)
      if (admins.length === 0) {
        console.error('一个管理员都没有：反馈存下来了，但不会有人看到。跑 012 最后那句 SQL')
        return new Response(JSON.stringify({ admins: 0 }), { status: 200 })
      }

      const who = await nameOf(admin, fb.author)
      const label: Record<string, Line> = {
        bug: { zh: '报了个问题', en: 'reported a problem' },
        idea: { zh: '想要个功能', en: 'wants a feature' },
        other: { zh: '说了点什么', en: 'sent feedback' },
      }
      const what = label[fb.kind] ?? label.other
      const title: Line = {
        zh: who ? `${who} ${what.zh}` : `有人${what.zh}`,
        en: who ? `${who} ${what.en}` : `Someone ${what.en}`,
      }
      /* 正文截一下：锁屏上本来也只显示两行，整段两千字传过去是白费 */
      const excerpt = fb.body.length > 120 ? `${fb.body.slice(0, 120)}…` : fb.body
      const text: Line = { zh: excerpt, en: excerpt }

      const out = await Promise.all(
        admins.map((uid) => pushTo(admin, uid, title, text, `rally-feedback-${id}`, './#feedback')),
      )
      const sent = out.reduce((n, r) => n + r.sent, 0)
      const failed = out.reduce((n, r) => n + r.failed, 0)
      console.log('推完:', sent, '成功 /', failed, '失败')
      return new Response(JSON.stringify({ sent, failed }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    /*
     * 举报走一条单独的路，因为它和上面两件事有三处不一样：
     *   收的人是一群（全部管理员），不是一个
     *   通知之前还要先把证据拍下来
     *   点开要落在举报队列，不是好友页
     *
     * 通知里不写理由、也不写被举报的人说了什么 —— 锁屏上那一行
     * 谁都看得到，而这条通知的内容恰恰是「某个人被指控了什么」。
     * 名字是必要的（不然管理员不知道急不急），细节留到 App 里看。
     */
    if (kind === 'report') {
      const { data, error } = await admin
        .from('reports')
        .select('reporter,reported,status,evidence')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        console.log('这条举报不存在，跳过')
        return new Response(JSON.stringify({ skipped: 'no such report' }), { status: 200 })
      }
      const rep = data as {
        reporter: string
        reported: string
        status: string
        evidence: unknown
      }

      /*
       * 数据库那边已经拍好了就别再跑一趟 —— 013 之后正常都是这一支。
       * 还空着才补拍（013 还没跑的那段窗口）。
       */
      const shot = rep.evidence
        ? -1
        : await snapshot(admin, id, rep.reporter, rep.reported)
      console.log(shot < 0 ? '证据数据库那边已经拍好了' : `补拍了 ${shot} 条证据`)

      const admins = await adminUids(admin)
      if (admins.length === 0) {
        /*
         * 一个管理员都没有。举报还是好好地存着，但没人会知道 ——
         * 所以这里大声地记一笔，不然这件事只能等到有人翻表才发现。
         */
        console.error('一个管理员都没有：举报存下来了，但不会有人看到。跑 012 最后那句 SQL')
        return new Response(JSON.stringify({ evidence: shot, admins: 0 }), { status: 200 })
      }

      const who = await nameOf(admin, rep.reported)
      const title: Line = {
        zh: who ? `有人举报了 ${who}` : '有一条新举报',
        en: who ? `${who} was reported` : 'A new report came in',
      }
      const text: Line = { zh: '点开看看是什么事', en: 'Tap to review it' }

      const out = await Promise.all(
        /* 每条举报一个 tag：两条不同的举报不该互相顶掉 */
        admins.map((uid) => pushTo(admin, uid, title, text, `rally-report-${id}`, './#reports')),
      )
      const sent = out.reduce((n, r) => n + r.sent, 0)
      const failed = out.reduce((n, r) => n + r.failed, 0)
      console.log('推完:', sent, '成功 /', failed, '失败')
      return new Response(JSON.stringify({ evidence: shot, sent, failed }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

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
