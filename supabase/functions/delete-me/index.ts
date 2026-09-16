/* ------------------------------------------------------------------ *
 * 删号
 *
 * 部署在 Supabase Edge Functions（Deno）。由本人在 App 里点「注销账号」
 * 调用一次。
 *
 * 为什么非要有服务端这一环：**Supabase 没有「删掉我自己」这个客户端
 * API**。`auth.admin.deleteUser()` 要服务端钥匙,而服务端钥匙绝不能
 * 发到手机上。所以只能是:手机带着自己的登录令牌来,服务端验明正身,
 * 再以管理员身份删掉那一行。
 *
 * -------------------------------------------------------------------
 * 这个函数只做数据库替不了的那三件事
 *
 * 绝大部分连带删除是**外键**干的（见 supabase/020-delete-account.sql）：
 * 好友、拉黑、私信、举报、反馈、错误、管理员、全国榜、球群成员、
 * 推送订阅 —— 删掉 auth.users 那一行,它们自动跟着没。
 *
 * 交给外键而不是写在这里,是因为**谁保证**不一样:写在这个函数里,
 * 从后台手动删一个用户就全绕过去了。
 *
 * 剩下三件外键做不到的,才归这里:
 *
 *   1. 清掉球员行里的 ownerId（JSONB 里的一个字符串,不是外键）
 *   2. 删掉语音文件（在 Storage 里,不在数据库里）
 *   3. 本人要求的话,把球员名字也抹掉
 *
 * -------------------------------------------------------------------
 * 「比分要留、人要脱钩」
 *
 * 这是整件事的核心,也是为什么不能简单粗暴地全删。
 *
 * 一个人打过的四十场比赛,是另外三个人战绩的一部分。整条删掉的话,
 * 别人的 MMR、胜负、历史全乱 —— 而那是**别人的**数据,他无权删。
 *
 * 所以球员行留着、比赛留着,只把「这个球员属于哪个账号」那根线剪断。
 * 剪断之后那一行就是个没有主人的名字,和一个代建的球友没有区别。
 *
 * -------------------------------------------------------------------
 * 顺序:先清,后删
 *
 * 反过来也能跑,但失败的样子差很多:
 *   先删账号再清 → 清失败的话,账号已经没了,谁也没法再补
 *   先清再删账号 → 删失败的话,人还登录着,重试一次就好
 *                  （清的那两步都是幂等的）
 * ------------------------------------------------------------------ */

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

const describe = (e: unknown): string =>
  e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e)

/* ------------------------------------------------------------------ *
 * 找一把真的能删用户的钥匙
 *
 * 和 notify-session / notify-social 里那一段同源,理由也一样：
 * Supabase 正在换 API key 体系,老项目注入 SUPABASE_SERVICE_ROLE_KEY,
 * 新项目改注入 SUPABASE_SECRET_KEYS,两个可能同时存在而老的已停用。
 * 不猜,全试一遍。
 *
 * **但探针不一样,而且这个区别要紧。** 那两个函数探的是「查得通
 * 某张表吗」—— 那个探针对这里没用:拿一把 anon 钥匙去 select,
 * RLS 会过滤掉所有行然后返回**空数组、不报错**,探针照样通过。
 *
 * 这里探的是 listUsers —— 它就是真正要用的那种权限。
 * ------------------------------------------------------------------ */

function candidateKeys(): { name: string; key: string }[] {
  const out: { name: string; key: string }[] = []
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
    /* 探针 = 真正要用的那种权限。见上面那段为什么不探 select */
    const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 })
    if (!error) {
      console.log('用的钥匙:', c.name)
      cached = client
      return client
    }
    tried.push(`${c.name} → ${error.message}`)
  }
  throw new Error(`手上的钥匙都删不了用户：${tried.join(' ; ')}`)
}

type Admin = Awaited<ReturnType<typeof getAdmin>>

/* ------------------------------------------------------------------ *
 * 剪断「这个球员属于哪个账号」那根线
 *
 * 一个人可能在好几个球群里各有一个球员行,全都要剪。
 *
 * 为什么是读出来改完再写回去,而不是一句 SQL：
 * ownerId 在 JSONB 里,supabase-js 发不出 `data = data - 'ownerId'`
 * 这种表达式。行数是个位数（一个人几个球群),读回来改没有代价。
 *
 * 改完 records.updated_at 会被触发器盖上新时间,所以别人的手机
 * 下次同步就拿到「这个球员没有主人了」。少了这一步,别的设备上
 * 那根线还连着,而那台设备是按本机缓存认人的。
 * ------------------------------------------------------------------ */
async function unlinkPlayers(admin: Admin, uid: string, scrubName: boolean) {
  const { data, error } = await admin
    .from('records')
    .select('kind, id, data')
    .eq('kind', 'player')
    .eq('data->>ownerId', uid)
  if (error) throw new Error(`读球员行失败：${error.message}`)

  const rows = (data ?? []) as { kind: string; id: string; data: Record<string, unknown> }[]
  for (const row of rows) {
    const next = { ...row.data, ownerId: null }
    /*
     * 抹名字是本人选的。默认不抹 —— 全抹成「已注销」的话,所有人的
     * 历史会变成一堆认不出的空壳,而且两个人注销就分不清谁是谁。
     * 但有人就是想让名字消失,那也是他的权利。
     */
    if (scrubName) next.name = '已注销'
    const { error: e2 } = await admin
      .from('records')
      .update({ data: next })
      .eq('kind', 'player')
      .eq('id', row.id)
    if (e2) throw new Error(`剪断球员 ${row.id} 失败：${e2.message}`)
  }
  return rows.length
}

/* ------------------------------------------------------------------ *
 * 删语音文件
 *
 * 私信那一行是外键连着的,删账号就没了 —— **但文件不在数据库里**,
 * 不会跟着走。不删的话,桶里留下一堆谁也听不到、谁也不知道它存在的
 * 录音,而里面是真的人声。
 *
 * 所以必须**赶在删账号之前**把路径捞出来:那一行一旦被级联删掉,
 * 就再也不知道文件叫什么了。
 *
 * 两个方向都要:他发出去的,和别人发给他的。后者他自己删不掉
 * （Storage 的删除策略只认路径第一段是自己的),所以只能在这儿删。
 * ------------------------------------------------------------------ */
async function deleteVoiceFiles(admin: Admin, uid: string) {
  const { data, error } = await admin
    .from('messages')
    .select('audio_path')
    .not('audio_path', 'is', null)
    .or(`sender.eq.${uid},recipient.eq.${uid}`)
  if (error) throw new Error(`读语音路径失败：${error.message}`)

  const paths = (data ?? [])
    .map((m) => (m as { audio_path: string | null }).audio_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (paths.length === 0) return 0

  const { error: e2 } = await admin.storage.from('voice').remove(paths)
  /*
   * 删文件失败不拦住整个注销。
   *
   * 人要走,拦着他等于这个按钮不管用 —— 而剩下的都是不可逆的删除,
   * 为一个清理步骤把它们全挡回去是本末倒置。记一行日志,
   * 让 020 那句自检以后数出来。
   */
  if (e2) console.error('语音文件没删干净:', e2.message)
  return paths.length
}

Deno.serve(async (req) => {
  try {
    /* ----------------------------------------------------------- *
      验明正身。

      **绝不能信请求体里的 uid** —— 那样任何人都能删任何人的账号,
      而且是不可逆的。uid 只能从调用者自己的登录令牌里拿。
     * ----------------------------------------------------------- */
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) {
      return new Response(JSON.stringify({ error: '没带登录令牌' }), { status: 401 })
    }

    const admin = await getAdmin()
    const { data: who, error: whoErr } = await admin.auth.getUser(token)
    const uid = who?.user?.id
    if (whoErr || !uid) {
      return new Response(JSON.stringify({ error: '令牌认不出是谁' }), { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const scrubName = body?.scrubName === true

    console.log('开始注销:', uid, scrubName ? '（连名字一起抹）' : '（名字保留）')

    /* 顺序要紧：先捞语音路径（删账号之后就捞不到了），再剪线，最后删账号 */
    const voices = await deleteVoiceFiles(admin, uid)
    const players = await unlinkPlayers(admin, uid, scrubName)

    const { error: delErr } = await admin.auth.admin.deleteUser(uid)
    if (delErr) throw new Error(`删账号失败：${delErr.message}`)

    console.log('注销完成:', uid, `球员 ${players} 个，语音 ${voices} 条`)
    return new Response(JSON.stringify({ ok: true, players, voices }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    console.error('注销炸了:', describe(e))
    return new Response(JSON.stringify({ error: describe(e) }), { status: 500 })
  }
})
