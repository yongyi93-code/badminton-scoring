/* ------------------------------------------------------------------ *
 * 开局提醒：真正发推送的那一段
 *
 * 部署在 Supabase Edge Functions（Deno）。触发方式是数据库 Webhook：
 * records 表里插进一条 kind='session' 的行，就调这个函数一次。
 *
 * 为什么非要有服务端这一环：推送的意义就是「你的 App 关着也能收到」，
 * 那就必须有个别人的机器在那时候替你发。前端再怎么写也做不到。
 *
 * 需要两个 Secret（在后台 Edge Functions → Secrets 里设）：
 *   VAPID_PUBLIC_KEY   和前端 .env 里那个是同一个
 *   VAPID_PRIVATE_KEY  只在这里，绝不进仓库
 * 服务端钥匙由平台自动注入，不用自己填 —— 但注入的是哪一个跟项目
 * 年代有关，见下面 candidateKeys()。
 * ------------------------------------------------------------------ */

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''

/*
 * 推送服务要求给一个联系方式，出问题时能找到人。
 * 用 mailto: 就够，不会真有人发信过来。
 */
webpush.setVapidDetails(
  'mailto:rally@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
)

/**
 * 把任何东西变成看得懂的一行。
 *
 * 第一版直接 String(e)，而 Supabase 的数据库错误是个普通对象、
 * 不是 Error —— 于是日志里只有一句 [object Object]，等于什么都没说。
 */
const describe = (e: unknown): string =>
  e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e)

/* ------------------------------------------------------------------ *
 * 找一把真的能绕过 RLS 的钥匙
 *
 * Supabase 正在换 API key 体系：老项目注入 SUPABASE_SERVICE_ROLE_KEY，
 * 新项目改注入 SUPABASE_SECRET_KEYS。麻烦的是这两个可能同时存在，
 * 而老的那个在新项目里已经被停用 —— 拿它去查表会被回一句
 * 「Invalid API key」，跟「表不存在」「没权限」长得差不多。
 *
 * 所以不猜：把手上有的钥匙全试一遍，谁能查通就用谁，并把结果写进日志。
 * 这样不管这个项目属于哪一代，一次部署就能跑通。
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
      // 不是 JSON 就当成一把、或者逗号分隔的几把
      raw.split(',').forEach((k, i) => add(`SECRET_KEYS[${i}]`, k.trim()))
    }
  }
  return out
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

/** 试通了就记下来，同一个实例后面的请求不用再试一遍 */
let cached: ReturnType<typeof createClient> | null = null

/**
 * 挨个试，返回第一把查得通的。
 *
 * 探针故意选 push_subscribers —— 它正是后面真要读的那张表，
 * 探得通就代表后面一定读得到，不会出现「探针过了正事却挂了」。
 */
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
 * 谁在调这个函数
 *
 * 以前一个字都不问，而这个函数比别的都危险：**整条通知的文字都来自
 * 请求体**（球馆名、上限人数、开局的人），而且它推给订阅表里的
 * 每一个人。也就是说，拿到那个地址的人可以让所有装了这个 App 的
 * 手机弹出他想要的任何一句话。
 *
 * 挡在前面的只有网关那个「Verify JWT」开关，而它认的是「有没有一把
 * 这个项目的钥匙」—— anon key 打包在前端里，谁都看得到。
 *
 * -------------------------------------------------------------------
 * 验到「你就是开这场局的人」，不只是「你登录了」
 *
 * 只验登录的话，任何一个装了 App 的人照样能广播任意文字。
 * 所以再往下问一句：body 里那个 createdBy，是不是你？
 *
 * 那一行球员本来就要读出来（通知里要写开局的人叫什么），所以这一步
 * 不多花一次查询 —— 顺手把 ownerId 一起读回来比一下就行。
 *
 * **代价写在明面上**：一个登录了、但球员身份还没认领的人（ownerId
 * 是空的）开局，通知发不出去了。那种人本来也拿不到名字，通知上会写
 * 「有人开球局了」—— 少一条没名字的通知，比留着一个任何人都能
 * 广播任意文字的口子划算。日志里会写清楚是被这一条挡的。
 * ------------------------------------------------------------------ */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

type Admin = Awaited<ReturnType<typeof getAdmin>>

/** 调用者是谁。认不出来就是 null —— uid 只从令牌里拿，绝不从请求体里拿 */
async function callerUid(req: Request, admin: Admin): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error) return null
  return data?.user?.id ?? null
}

type Row = { kind?: string; id?: string; data?: Record<string, unknown> }

Deno.serve(async (req) => {
  /*
   * 预检要在验身份之前回 —— 预检本来就不带 Authorization 头，
   * 拿它当「没带令牌」挡回去的话，正式请求永远发不出来。
   */
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    // 数据库 Webhook 的格式：{ type, table, record, old_record }
    const row: Row = body?.record ?? body

    /*
     * 只管新开的球局。
     *
     * records 是一张什么都往里塞的表 —— 每记一分都会更新一条 match，
     * 不挡住的话一晚上能推几十条通知，人只会把推送关掉。
     */
    /*
     * 每一步都往日志里写一句。
     *
     * 第一版只 return 不 log —— 结果是日志里只有一条 booted，
     * 看不出它到底走到哪一步、为什么没推出去。而这个函数是整条链路里
     * 唯一看不见摸不着的一段，恰恰最需要它自己说话。
     */
    console.log('收到:', row?.kind, row?.id)
    /* 只打印有没有、多长，绝不打印密钥本身 */
    console.log('环境自检:', JSON.stringify({
      url: Boolean(SUPABASE_URL),
      serviceRoleKey: (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').length,
      secretKeys: (Deno.env.get('SUPABASE_SECRET_KEYS') ?? '').length,
      候选钥匙: candidateKeys().map((c) => c.name),
      vapid公钥: (Deno.env.get('VAPID_PUBLIC_KEY') ?? '').length,
      vapid私钥: (Deno.env.get('VAPID_PRIVATE_KEY') ?? '').length,
    }))

    if (row?.kind !== 'session') {
      console.log('不是球局，跳过')
      return reply({ skipped: 'not a session' })
    }

    const data = (row.data ?? {}) as {
      venue?: string
      createdBy?: string
      maxPlayers?: number
      playerIds?: string[]
      status?: string
    }
    if (data.status && data.status !== 'active') {
      console.log('球局不是进行中，跳过:', data.status)
      return reply({ skipped: 'not active' })
    }

    /* 到这儿才去挑钥匙：不是球局的那些请求根本不用碰数据库 */
    const admin = await getAdmin()

    const uid = await callerUid(req, admin)
    if (!uid) {
      console.log('认不出调用者，拒掉')
      return reply({ error: '不知道你是谁' }, 401)
    }

    /*
     * 开局的人叫什么 —— 通知里没有名字，收到的人不知道该不该去。
     * 顺手把 ownerId 一起读回来：这一行就是用来验「是不是你开的局」的。
     */
    if (!data.createdBy) {
      console.log('没说是谁开的局，拒掉')
      return reply({ error: '没说是谁开的局' }, 400)
    }
    const { data: host } = await admin
      .from('records')
      .select('data')
      .eq('kind', 'player')
      .eq('id', data.createdBy)
      .maybeSingle()
    const hostRow = host?.data as { name?: string; ownerId?: string | null } | undefined
    if (!hostRow) {
      console.log('开局的那个球员查不到，拒掉')
      return reply({ error: '开局的人查不到' }, 400)
    }
    /*
     * 只有本人能替自己吆喝。
     *
     * 不验的话，这一整条通知的文字（球馆、人数、谁开的）都来自请求体，
     * 而它推给订阅表里的每一个人 —— 那等于一个对全网开着的广播口。
     */
    if (hostRow.ownerId !== uid) {
      console.log('不是开局那个人本人，拒掉')
      return reply({ error: '这不是你开的局' }, 403)
    }
    const hostName = hostRow.name ?? ''

    const venueZh = data.venue?.trim() || '球馆'
    const venueEn = data.venue?.trim() || 'a venue'

    /*
     * 两种说法都备着，发的时候按收的那台设备挑。
     *
     * 语言存在每台设备的 localStorage 里，服务端没别的办法知道 ——
     * 订阅那一行上的 lang 就是设备自己报上来的（见 011 那段 SQL）。
     * 空的（这次改动之前订的那些）退回中文：空的意思是「不知道」，
     * 不去猜，猜错了是推一条他读不懂的话。
     */
    const title = {
      zh: hostName ? `${hostName} 开球局了` : '有人开球局了',
      en: hostName ? `${hostName} started a session` : 'Someone started a session',
    }
    const body_ = {
      zh: data.maxPlayers
        ? `${venueZh} · 上限 ${data.maxPlayers} 人，点进来加入`
        : `${venueZh} · 点进来加入`,
      en: data.maxPlayers
        ? `${venueEn} · up to ${data.maxPlayers} players — tap to join`
        : `${venueEn} · tap to join`,
    }

    const { data: subs, error } = await admin
      .from('push_subscribers')
      .select('endpoint,p256dh,auth,player_id,lang')
    if (error) throw error
    console.log('订阅数:', subs?.length ?? 0, '| 开局的人:', hostName || '(没名字)', '| 球馆:', venueZh)

    const results = await Promise.allSettled(
      (subs ?? [])
        // 开局的人自己不用收 —— 他就是按下那个按钮的人
        .filter((s) => !data.createdBy || s.player_id !== data.createdBy)
        .map(async (s) => {
          const en = s.lang === 'en'
          const payload = JSON.stringify({
            title: en ? title.en : title.zh,
            body: en ? body_.en : body_.zh,
            url: './',
          })
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload,
            )
          } catch (e) {
            /*
             * 410 Gone / 404 = 这个订阅已经作废了（App 删了、
             * 权限被关了）。留着只会每次都失败一遍，直接清掉。
             */
            const code = (e as { statusCode?: number }).statusCode
            console.error('推送失败:', code, describe(e), '| endpoint:', s.endpoint.slice(0, 60))
            if (code === 404 || code === 410) {
              console.log('订阅已失效，删掉')
              await admin.from('push_subscribers').delete().eq('endpoint', s.endpoint)
            }
            throw e
          }
        }),
    )

    const sent = results.filter((r) => r.status === 'fulfilled').length
    console.log('推完:', sent, '成功 /', results.length - sent, '失败')
    return reply({ sent, failed: results.length - sent })
  } catch (e) {
    console.error('整个函数炸了:', describe(e))
    return reply({ error: describe(e) }, 500)
  }
})
