import { createClient } from 'npm:@supabase/supabase-js@2'

/* ------------------------------------------------------------------ *
 * 清掉过期的 Story
 *
 * import 摆在第一行、所有注释前面，是被真事教的（2026-09-19）：
 * 这个文件要被人整段贴进后台那个网页编辑器，而一段块注释只要在粘贴
 * 时掉了结尾那两个字符，从那儿往下就全变成注释 —— 底下的 import
 * 会被静静吞掉。那时候函数照样部署成功、照样跑得起来、401 那道门
 * 照样把得住，只在真去用 createClient 的那一刻才报一句
 * 「createClient is not defined」，而那句话指向的地方是对的、原因
 * 却在几十行之外。摆在第一行，注释再怎么坏也吞不到它。
 *
 * 部署在 Supabase Edge Functions（Deno）。由**排班**每小时调一次，
 * 不是由人调。
 *
 * -------------------------------------------------------------------
 * 为什么非要有这一环
 *
 * 028 那条读策略已经把过期的挡住了 —— 界面上看不见了。但**行还在、
 * 文件还在桶里**，存储只涨不跌，而那些照片其实还在，只是没人显示它。
 *
 * docs/社交化.md 里点名说过别用「查询时过滤掉过期的」糊弄过去。
 * 这个函数就是不糊弄的那一半。
 *
 * -------------------------------------------------------------------
 * 文件必须走 Storage 的接口删，不能直接删 storage.objects 那一行
 *
 * 删行只是把账本上那一笔划掉，真正的文件还躺在对象存储里 —— 谁也
 * 看不到它、谁也删不掉它，而它每个月照样算钱。这是那种一年后才被
 * 发现、发现时已经堆了几个 G 的错。
 *
 * 所以：先用接口删文件，成功了再删行。
 *
 * -------------------------------------------------------------------
 * 顺序：先删文件，后删行
 *
 * 反过来的话，行没了就再也找不到那些文件的路径了 —— 它们会永远留在
 * 桶里，而且**没有任何办法知道哪些是孤儿**。
 *
 * 先删文件的话，中间挂了就是「行还在、文件没了」：下一轮照样会
 * 再试一次这一行（删一个不存在的文件不报错），然后把行删掉。
 * 两种失败方式里，可恢复的那种更好。
 *
 * -------------------------------------------------------------------
 * 谁能调它
 *
 * 排班没有「登录用户」这回事，所以它不能靠 JWT 把门。改成一个约定的
 * 密钥：后台 Secrets 里放一条 CLEANUP_SECRET，排班在请求头里带上，
 * 对不上就 401。
 *
 * 密钥**不写在代码里**，也不写进数据库 —— 019 那次就是因为一个
 * 服务端钥匙被硬编码进了触发器定义里。
 * ------------------------------------------------------------------ */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

/** 一轮最多清多少条。清不完下一轮接着来 —— 一次跑太久会被超时掐断 */
const BATCH = 200

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-cleanup-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e))

/* ------------------------------------------------------------------ *
 * 找一把服务端钥匙。
 *
 * 和 delete-me 里那一段同源：Supabase 正在换 API key 体系，老项目
 * 注入 SUPABASE_SERVICE_ROLE_KEY，新项目改注入 SUPABASE_SECRET_KEYS，
 * 两个可能同时存在而老的已停用。不猜，全试一遍。
 *
 * 探针用的是「读得到 expired_stories 吗」—— 那个视图只发给了
 * service_role（028），所以拿一把 anon 钥匙探必定失败。
 * 探一张普通表是没用的：anon 读得通，RLS 只会返回空数组、不报错。
 *
 * **这个探针只证明钥匙是对的，不证明这个函数干得成活。**
 *
 * 分清这件事是有代价的（029）：expired_stories 是个普通视图，视图
 * 跟着**建它的人**的权限走，所以哪怕 service_role 在 posts 上一点
 * 读权限都没有，这个探针照样过。本机验过：读得到 2 条、删掉 0 条。
 *
 * 真正的那道检查在底下 —— 删完数一下动了几行。探针管「钥匙对不对」，
 * 那一句管「这活干成了没有」，两件事，谁也代替不了谁。
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
    /* 探针 = 那个只发给 service_role 的视图。见上面为什么不探普通表 */
    const { error } = await client.from('expired_stories').select('id').limit(1)
    if (!error) {
      console.log('用的钥匙:', c.name)
      cached = client
      return client
    }
    tried.push(`${c.name} → ${error.message}`)
  }
  throw new Error(`手上的钥匙都读不到 expired_stories：${tried.join(' ; ')}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  /*
   * 把门。排班没有「登录用户」，所以靠一个约定的密钥。
   *
   * 没配 CLEANUP_SECRET 的话**直接拒**，不是放行 —— 忘了配那一条
   * 而函数照样跑，等于把「删数据」这件事对全网开着。
   */
  const want = Deno.env.get('CLEANUP_SECRET')
  if (!want) {
    console.error('CLEANUP_SECRET 没配 —— 拒掉，不能默认放行')
    return json({ error: '这个函数还没配好（缺 CLEANUP_SECRET）' }, 503)
  }
  if (req.headers.get('x-cleanup-secret') !== want) {
    return json({ error: '不是排班来的' }, 401)
  }

  try {
    const admin = await getAdmin()

    /* 过期的那些行和它们的照片。什么算过期由视图说了算（028） */
    const { data, error } = await admin
      .from('expired_stories')
      .select('id, author, photos')
      .limit(BATCH)
    if (error) throw new Error(`读过期列表失败：${error.message}`)

    const rows = (data ?? []) as { id: string; author: string; photos: string[] }[]
    if (rows.length === 0) return json({ ok: true, 清了: 0, 还剩: 0 })

    /*
     * 先删文件。
     *
     * 一批一起删（不是一张一次）—— 两百条动态每条九张就是一千八百个
     * 请求，那一轮跑不完就被超时掐断了。
     *
     * 删文件失败不中止：那一行的照片可能本来就已经被作者删过了。
     * 删一个不存在的文件在 Storage 那边不报错，所以真报错的时候
     * 是别的问题 —— 记下来，但别让一条卡住整批。
     */
    const paths = rows.flatMap((r) => r.photos ?? [])
    if (paths.length > 0) {
      const { error: rmErr } = await admin.storage.from('moments').remove(paths)
      if (rmErr) {
        /* 文件没删掉就**不删行** —— 删了行就再也找不到这些路径了 */
        throw new Error(`删照片失败，这一轮不动行：${rmErr.message}`)
      }
    }

    /* 文件没了，才删行 */
    const ids = rows.map((r) => r.id)
    const { data: gone, error: delErr } = await admin
      .from('posts')
      .delete()
      .in('id', ids)
      .select('id')
    if (delErr) throw new Error(`删行失败：${delErr.message}`)

    /*
     * 数一下真的删掉了几行，别只看 error 是不是 null。
     *
     * 被 RLS 挡下来的 DELETE **不报错**，只是动了 0 行 —— 这个仓库
     * 栽过好几次（delete-me 那次是本机跑真 Postgres 撞出来的）。
     * 数不上的话，这个函数会年复一年地返回成功，而一行都没清掉。
     */
    const removed = (gone ?? []).length

    /*
     * 一行都没删掉 = 这一轮**失败了**，不是「清了 0 条」。
     *
     * 原来这儿只 console.error 一句就照样返回 200 —— 也就是上面那段
     * 注释担心的事，我自己在它下面三行又犯了一遍。排班那边看到的是
     * 一串绿色的成功，而每一轮都在原地打转：文件删掉、行删不掉、
     * 下一轮再来一遍。线上就是这么过了一整天没人发现的（029）。
     *
     * 返回 500 之后，排班列表里那一行会是红的 —— 这个函数没有别的
     * 出口能让人知道它出事了。
     *
     * 只在**一行都没删掉**的时候算失败。删掉了一部分是正常的：
     * 作者可以在这中间自己把某一条删了，那一行就不在了。
     */
    if (removed === 0) {
      throw new Error(
        `该删 ${ids.length} 行，一行都没删掉 —— 多半是 service_role 在 posts 上少了权限（见 supabase/029-cleanup-grants.sql）`,
      )
    }
    if (removed !== ids.length) {
      console.error(`该删 ${ids.length} 行，实际删了 ${removed} 行`)
    }

    /* 还剩多少（这一轮之后）。排班每小时一次，剩得多说明批量不够大 */
    const { count } = await admin
      .from('expired_stories')
      .select('id', { count: 'exact', head: true })

    return json({
      ok: true,
      清了: removed,
      照片: paths.length,
      还剩: count ?? 0,
    })
  } catch (e) {
    console.error('清理失败:', describe(e))
    return json({ error: describe(e) }, 500)
  }
})
