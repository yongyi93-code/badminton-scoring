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
 * SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 由平台自动注入，不用自己填。
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

/** service_role：绕过 RLS 才读得到所有人的订阅 */
const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

type Row = { kind?: string; id?: string; data?: Record<string, unknown> }

Deno.serve(async (req) => {
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

    if (row?.kind !== 'session') {
      console.log('不是球局，跳过')
      return new Response(JSON.stringify({ skipped: 'not a session' }), { status: 200 })
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
      return new Response(JSON.stringify({ skipped: 'not active' }), { status: 200 })
    }

    /* 开局的人叫什么 —— 通知里没有名字，收到的人不知道该不该去 */
    let hostName = ''
    if (data.createdBy) {
      const { data: host } = await admin
        .from('records')
        .select('data')
        .eq('kind', 'player')
        .eq('id', data.createdBy)
        .maybeSingle()
      hostName = (host?.data as { name?: string } | undefined)?.name ?? ''
    }

    const venue = data.venue?.trim() || '球馆'
    const title = hostName ? `${hostName} 开球局了` : '有人开球局了'
    const body_ = data.maxPlayers
      ? `${venue} · 上限 ${data.maxPlayers} 人，点进来加入`
      : `${venue} · 点进来加入`

    const { data: subs, error } = await admin
      .from('push_subscribers')
      .select('endpoint,p256dh,auth,player_id')
    if (error) throw error
    console.log('订阅数:', subs?.length ?? 0, '| 开局的人:', hostName || '(没名字)', '| 球馆:', venue)

    const payload = JSON.stringify({ title, body: body_, url: './' })

    const results = await Promise.allSettled(
      (subs ?? [])
        // 开局的人自己不用收 —— 他就是按下那个按钮的人
        .filter((s) => !data.createdBy || s.player_id !== data.createdBy)
        .map(async (s) => {
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
            console.error('推送失败:', code, (e as Error).message, '| endpoint:', s.endpoint.slice(0, 60))
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
    return new Response(
      JSON.stringify({ sent, failed: results.length - sent }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  } catch (e) {
    console.error('整个函数炸了:', e instanceof Error ? e.stack : String(e))
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }
})
