import { supabase } from '@/lib/supabase'
import { pick } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 举报 —— 和云端打交道的那一层
 *
 * 和 social.ts 分开放，因为它们答的不是同一件事：
 * 好友和私聊是「我和他」，举报是「我和他之间出了事，要送到第三个人
 * 手上」。第三个人的存在把权限、时效、能看到的人全改了一遍，
 * 混在一个文件里迟早会有一处照着私聊的规矩写举报。
 *
 * 规则在 supabase/012-reports.sql，那边说了为什么证据必须服务端拍、
 * 为什么管理员名单在 App 里写不进去。
 *
 * -------------------------------------------------------------------
 * 举报和拉黑是两件事
 *
 *   拉黑  我不想再看到这个人。立刻生效，不用任何人同意
 *   举报  这件事该有人管一管。要送出去，要留证据，要有结论
 *
 * 界面上把它们摆在一起（举报的时候顺手拉黑），是因为一个正在被
 * 骚扰的人两件事都想要 —— 但代码这一层不把它们缠在一起：
 * 拉黑失败不该让举报也发不出去，反过来也一样。
 * ------------------------------------------------------------------ */

export type ReportReason =
  | 'harassment'
  | 'abuse'
  | 'spam'
  | 'fake'
  | 'cheating'
  | 'other'

export type ReportStatus = 'open' | 'handled' | 'dismissed'

/** 证据里的一条。服务端拍的快照，App 这边只读不写 */
export type EvidenceMessage = {
  id: string
  sender: string
  body: string | null
  kind?: 'text' | 'voice'
  audio_path?: string | null
  duration_ms?: number | null
  created_at: string
}

export type Evidence = {
  taken_at: string
  messages: EvidenceMessage[]
}

export type Report = {
  id: string
  reporter: string
  reported: string
  reason: ReportReason
  note: string | null
  evidence: Evidence | null
  status: ReportStatus
  handled_by: string | null
  handled_at: string | null
  created_at: string
}

export type ReportResult = { ok: true } | { ok: false; error: string }

/**
 * 理由是一份定死的清单。
 *
 * 照着选比对着空白框打字容易得多 —— 一个正在被骚扰的人不该还要
 * 先组织语言。而且清单能统计（「这个人被三个人以骚扰举报过」），
 * 自由文本不能。想多说的写在备注里。
 *
 * 顺序按「最该有人立刻看一眼」排，不按字母排。
 */
export const REPORT_REASONS: {
  value: ReportReason
  zh: string
  en: string
  hintZh: string
  hintEn: string
}[] = [
  {
    value: 'harassment',
    zh: '骚扰、纠缠',
    en: 'Harassment',
    hintZh: '一直发消息、约不出来还继续找',
    hintEn: 'Repeated unwanted messages or attention',
  },
  {
    value: 'abuse',
    zh: '辱骂、人身攻击',
    en: 'Abuse',
    hintZh: '骂人、威胁、针对长相或种族',
    hintEn: 'Insults, threats, or slurs',
  },
  {
    value: 'spam',
    zh: '广告、推销',
    en: 'Spam',
    hintZh: '卖东西、拉群、发链接',
    hintEn: 'Selling, links, or group invites',
  },
  {
    value: 'fake',
    zh: '冒充别人',
    en: 'Impersonation',
    hintZh: '用别人的名字或者照片',
    hintEn: 'Using someone else’s name or photo',
  },
  {
    value: 'cheating',
    zh: '比分作假',
    en: 'Faking scores',
    hintZh: '乱改比分、刷分刷金币',
    hintEn: 'Editing scores or farming points',
  },
  {
    value: 'other',
    zh: '其他',
    en: 'Something else',
    hintZh: '上面都不是，在下面说清楚',
    hintEn: 'None of the above — say more below',
  },
]

export const reasonLabel = (r: ReportReason): string => {
  const it = REPORT_REASONS.find((x) => x.value === r)
  return it ? pick(it.zh, it.en) : r
}

const noCloud = () =>
  pick('还没接云端，举报送不出去', 'Cloud is not set up — reports cannot be sent')

/** 把数据库的报错翻成人话。和 social.ts 那份是分开的，因为要说的话不一样 */
function readable(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('permission denied')) {
    return pick(
      '举报功能还没开通 —— 数据库那边少了一步（012 那段 SQL 里的 grant）。',
      'Reporting is not switched on yet — the database is missing a grant (see migration 012).',
    )
  }
  if (m.includes('does not exist') || m.includes('schema cache')) {
    return pick(
      '举报功能还没开通 —— 数据库里还没有这两张表，要先跑 012 那段 SQL。',
      'Reporting is not switched on yet — the tables do not exist. Run migration 012 first.',
    )
  }
  /*
   * 这一条不是错，是「你已经举报过了」。说成「重复的键」毫无用处，
   * 而这恰恰是最常撞上的一句 —— 一个人被骚扰的时候会点不止一次。
   */
  if (m.includes('duplicate key') || m.includes('reports_one_open')) {
    return pick(
      '你已经举报过他了，那条还在等处理。',
      'You already reported them — that report is still being reviewed.',
    )
  }
  if (m.includes('row-level security') || m.includes('violates row-level')) {
    return pick('这条举报送不出去', 'That report could not be sent')
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return pick('连不上服务器，检查一下网络', 'Cannot reach the server — check your connection')
  }
  return message
}

const fail = (e: { message: string }): ReportResult => ({ ok: false, error: readable(e.message) })

/* ------------------------------------------------------------------ *
 * 写
 * ------------------------------------------------------------------ */

/**
 * 举报一个人。
 *
 * 不传 reporter —— 那一栏的默认值是 auth.uid()，由数据库自己填，
 * 客户端不传就伪造不了。证据也不传：它由服务端拍（见 012 开头），
 * 这里传了反而会被策略挡下来。
 */
export async function sendReport(
  uid: string,
  reason: ReportReason,
  note: string,
): Promise<ReportResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const text = note.trim().slice(0, 1000)
  const { data, error } = await supabase
    .from('reports')
    .insert({ reported: uid, reason, note: text || null })
    .select('id')
    .single()
  if (error) return fail(error)
  await snapshotAndNotify((data as { id: string }).id)
  return { ok: true }
}

/**
 * 叫服务端去拍证据、再通知管理员。
 *
 * 只递「哪一条」，不递内容 —— 和 notify-social 那边同一条规矩，
 * 而且这里更要紧：这个请求是客户端发的，证据要是从这儿来，
 * 那张表记的就不是证据，是作文。
 *
 * 失败了不算举报失败。那一行已经落库了，管理员进 App 照样看得到；
 * 为了一次没拍成的快照告诉人「举报失败」，只会让他再点一遍 ——
 * 而第二遍会撞上「你已经举报过了」。
 */
async function snapshotAndNotify(id: string): Promise<void> {
  if (!supabase) return
  try {
    await supabase.functions.invoke('notify-social', { body: { kind: 'report', id } })
  } catch (e) {
    console.warn('证据没拍成、管理员也没收到提醒:', e)
  }
}

/** 撤回自己那条还没处理的举报。处理过的撤不掉，策略那边管着 */
export async function withdrawReport(id: string): Promise<ReportResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.from('reports').delete().eq('id', id)
  return error ? fail(error) : { ok: true }
}

/**
 * 管理员下结论。
 *
 * 不传 handled_by / handled_at —— 数据库那个触发器会自己记上是谁、
 * 什么时候。客户端传的话就成了「谁处理的由客户端说了算」。
 */
export async function resolveReport(
  id: string,
  status: 'handled' | 'dismissed',
): Promise<ReportResult> {
  if (!supabase) return { ok: false, error: noCloud() }
  const { error } = await supabase.from('reports').update({ status }).eq('id', id)
  return error ? fail(error) : { ok: true }
}

/* ------------------------------------------------------------------ *
 * 读
 * ------------------------------------------------------------------ */

/**
 * 我举报过谁。
 *
 * 策略保证只查得到自己发出去的 —— 查不到「谁举报了我」，
 * 那是故意的，和拉黑那边同一个道理：知道自己被举报了，
 * 第一反应是去找那个人。
 */
export async function fetchMyReports(): Promise<Report[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('reports')
    .select('id,reporter,reported,reason,note,status,handled_at,created_at')
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('举报记录没拉到:', error.message)
    return []
  }
  /* 自己那份不带证据 —— 列表上用不着，白传一堆聊天记录下来 */
  return (data ?? []).map((r) => ({ ...r, evidence: null, handled_by: null })) as Report[]
}

/** 我是不是管理员。查不到就是不是 —— 策略只让人看到自己那一行 */
export async function fetchIsAdmin(): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.from('app_admins').select('uid').limit(1)
  if (error) {
    /*
     * 没开通（还没跑 012）和「我不是管理员」在这里是同一个结果：
     * 不显示那个入口。所以不吵，只留一句日志。
     */
    console.warn('管理员身份没查到:', error.message)
    return false
  }
  return (data ?? []).length > 0
}

/**
 * 队列里还有几条没处理。「我的」那一栏上那个红点看这个。
 *
 * 只在确认是管理员之后才该调 —— 读策略对普通人也放行「自己举报的」，
 * 所以普通人调它拿回来的是「我自己发出去还没人处理的那几条」。
 * 那个数字摆在「举报队列」旁边是错的，而且错得很难看出来。
 */
export async function fetchOpenReportCount(): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
  if (error) {
    console.warn('举报队列的数没拿到:', error.message)
    return 0
  }
  return count ?? 0
}

/**
 * 管理员那一屏：全部举报，没处理的排前面。
 *
 * 这一份带证据，而证据里是别人的私聊内容 —— 所以只在真的要看
 * 那一屏时才拉，不进那个每次都重拉的社交 store。
 */
export async function fetchAllReports(): Promise<Report[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('reports')
    .select('id,reporter,reported,reason,note,evidence,status,handled_by,handled_at,created_at')
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('举报队列没拉到:', error.message)
    return []
  }
  const rows = (data ?? []) as Report[]
  /* 没处理的排前面。处理过的留着能翻，但不该挡在前面 */
  return [...rows].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'))
}

/* ------------------------------------------------------------------ *
 * 纯函数
 * ------------------------------------------------------------------ */

/** 我对这个人有没有一条还没处理完的举报。有的话界面上要换个说法 */
export const openReportAgainst = (reports: Report[], uid: string): Report | undefined =>
  reports.find((r) => r.reported === uid && r.status === 'open')

/** 还没处理的有几条。管理员那个入口上的小红点看这个 */
export const openCount = (reports: Report[]): number =>
  reports.filter((r) => r.status === 'open').length
