import { useEffect } from 'react'
import { pick } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { supabase } from '@/lib/supabase'
import { photoUrl } from '@/lib/photo'

/* ------------------------------------------------------------------ *
 * 对外的名片 —— 账号那一层的「你是谁」
 *
 * 这个 App 里一直有两套身份（见 docs/社交化.md）：
 *
 *   球员（Player）   每个球群一个   名字、性别、角色、比赛、MMR
 *   账号（uid）      全局一个       好友、私聊、举报、全国榜
 *
 * 名字一直只长在**球员**那一侧，而好友是**跨球群**的 —— 于是从做好友
 * 那天起就有一个窟窿：一个别的球群的好友，列表上显示「不认识的人」。
 * 你自己点头加的人，App 说不出他叫什么。
 *
 * 这一层补的就是那个窟窿：profiles 那张表上放一个名字和一张照片，
 * 跟着账号走。理由和取舍写在 supabase/023-display-name.sql 里。
 *
 * -------------------------------------------------------------------
 * 名字有三个来源，顺序不能颠倒
 *
 *   1. 他在**我这个球群**里那条球员记录上的名字   ← 最可信，优先
 *   2. 他自己填的 display_name
 *   3. 调用方手上已经有的那个（比如全国榜那一行）
 *
 * 第一条排最前是有道理的：同一个群里，记分的人管他叫什么就是什么，
 * 那个名字和比赛记录是对得上的。后两条只在「我这个群里没有这个人」
 * 时才派上用场。
 * ------------------------------------------------------------------ */

/** 一个人的名片。两样都可能是空 —— 陌生人什么都读不到 */
export type Card = {
  uid: string
  /** 他自己填的名字。没填过就是 null */
  name: string | null
  /** 照片的公开地址。没设过就是 null */
  photo: string | null
}

/** 名字最长多少。和 023 里那条 check 是同一个数，改一处要改两处 */
export const NAME_MAX = 24

/**
 * 把输入收拾干净：两头的空白去掉，中间连着的空白并成一个。
 *
 * 不做的话，「  阿  伟  」会原样存进去，而好友列表那一行是靠 truncate
 * 截断的 —— 前面那几个空格会把名字推出可视区，看着像没名字。
 */
export function tidyName(raw: string): string {
  /*
   * 截断按**字符**数，不按 JS 那个 length。
   *
   * 两个理由，第二个才是硬的：
   *   · 数据库那条 check 用的是 char_length，数的就是字符
   *   · 一个 emoji 在 JS 里占两格，用 slice 正好切在中间的话，
   *     留下的是半个字符 —— 传到服务端会变成一个「�」
   */
  return [...raw.trim().replace(/\s+/g, ' ')].slice(0, NAME_MAX).join('')
}

/**
 * 这个名字能不能存。存不了就给一句人话，不是 null。
 *
 * 判的是**收拾之后**的：一串空格收拾完是空的，那不是名字。
 */
export function checkName(raw: string): string | null {
  const name = tidyName(raw)
  if (!name) return pick('名字不能是空的', 'Name cannot be empty')
  return null
}

/**
 * 最后显示成什么。三个来源按顺序挑第一个有内容的，全都没有就是 null ——
 * 由界面决定空的时候说什么，这一层不写文案。
 */
export function nameOf(sources: {
  /** 他在我这个球群里那条球员记录上的名字 */
  club?: string | null
  /** 他自己填的 */
  card?: string | null
  /** 调用方手上已经有的（全国榜那一行、路由带过来的） */
  hint?: string | null
}): string | null {
  for (const s of [sources.club, sources.card, sources.hint]) {
    const v = (s ?? '').trim()
    if (v) return v
  }
  return null
}

/**
 * 一批人的名片。谁看得到谁由数据库那边挡（自己 / 好友 / 同群）。
 *
 * 一次拿回来做成表，而不是每个头像各查一次 —— 好友列表上十几个人，
 * 那就是十几个请求。
 *
 * 拿不到（没跑过 022/023、离线）就是一张空表：名字退回球群里那个，
 * 头像退回换装角色。这一块是锦上添花，不该因为它挂了就让整屏出错。
 */
export async function fetchCards(): Promise<Map<string, Card>> {
  const out = new Map<string, Card>()
  if (!supabase) return out
  const { data, error } = await supabase
    .from('profiles')
    /*
     * 挑 * 而不是把列名写出来，就这一处是故意的：
     * 部署和迁移之间总有一段时间对不上（客户端先上、SQL 还没跑），
     * 而点名要一个还不存在的列，整个查询会报错 —— 连照片一起没了。
     * 用 * 的话，023 没跑就是「名字这一列还没有」，照片照常。
     */
    .select('*')
    .limit(500)
  if (error) {
    console.warn('名片没拿到:', error.message)
    return out
  }
  for (const row of (data ?? []) as {
    uid: string
    photo_path: string | null
    display_name?: string | null
  }[]) {
    out.set(row.uid, {
      uid: row.uid,
      name: row.display_name ?? null,
      photo: photoUrl(row.photo_path),
    })
  }
  return out
}

/**
 * 某一个人那张。个人主页上用 —— 那一屏只关心一个人，
 * 没必要把好友表整个拉下来。
 *
 * 返回 null 有两种情形，而且**这一层分不出来，也不该分**：
 * 他没有名片，或者我没资格看（不是好友、不同群）。
 * 界面上两种都是同一句话：这个人你还不认识。
 */
export async function fetchCard(uid: string): Promise<Card | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('profiles')
    /* 为什么是 * 见 fetchCards */
    .select('*')
    .eq('uid', uid)
    .limit(1)
  if (error) return null
  const row = (data ?? [])[0] as
    | { uid: string; photo_path: string | null; display_name?: string | null }
    | undefined
  if (!row) return null
  return { uid: row.uid, name: row.display_name ?? null, photo: photoUrl(row.photo_path) }
}

/** 我自己那张。没登录、没跑过迁移都是 null */
export async function myCard(): Promise<Card | null> {
  if (!supabase) return null
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('profiles')
    /* 为什么是 * 见 fetchCards */
    .select('*')
    .eq('uid', uid)
    .limit(1)
  if (error) return null
  const row = (data ?? [])[0] as
    | { uid: string; photo_path: string | null; display_name?: string | null }
    | undefined
  if (!row) return { uid, name: null, photo: null }
  return { uid, name: row.display_name ?? null, photo: photoUrl(row.photo_path) }
}

/** 改我对外的名字 */
export async function setMyName(raw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }
  const bad = checkName(raw)
  if (bad) return { ok: false, error: bad }

  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: pick('先登录', 'Sign in first') }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ uid, display_name: tidyName(raw) }, { onConflict: 'uid' })
    .select('uid')
  if (error) return { ok: false, error: error.message }
  /* 被策略挡下来的写不报错，只是动了 0 行 —— 这个仓库栽过好几次 */
  if ((data ?? []).length === 0) {
    return { ok: false, error: pick('没改上 —— 只能改自己的', 'You can only change your own') }
  }
  return { ok: true }
}

/**
 * 还没填过名字的话，拿球群里那个名字**补一次**。
 *
 * 为什么要自动补：不补的话，这个功能对所有老用户都是关着的 ——
 * 谁都不会主动跑去设置里填一个自己看不到效果的字段，而效果长在
 * **别人**的屏幕上（他那边看到的是「不认识的人」）。
 *
 * 为什么只在空的时候补：填过就不动，不然自己改的名字下次开 App
 * 又被球群里那个盖回去 —— 那是最让人抓狂的一种 bug。
 *
 * 补上去的是他在自己群里本来就在用的名字，而这张表只有好友和同群的人
 * 读得到 —— 同群的人本来就看得见它，好友是自己点头加的。
 */
export async function seedMyName(clubName: string): Promise<void> {
  const name = tidyName(clubName)
  if (!name) return
  const card = await myCard()
  if (!card || (card.name ?? '').trim()) return
  await setMyName(name)
}

/**
 * 开 App 的时候，名字还空着就拿球群里那个补上。
 *
 * 挂在 App 顶上而不是塞进「登录成功」那条路里：老用户早就登录过了，
 * 那条路他们这辈子都不会再走一次 —— 而这个功能正是为他们做的。
 *
 * 故意不引 useAuth：lib/ 里引那个 store 会把模块级的登录订阅拖进来，
 * 于是任何 import 这个文件的测试都会发真网络请求（errorlog 那次就是
 * 这么把部署卡住的）。没登录的话 seedMyName 自己就退出了。
 */
export function useSeedMyName(): void {
  const players = useApp((s) => s.players)
  const meId = useApp((s) => s.meId)
  const myName = (meId ? players.find((p) => p.id === meId)?.name : '') ?? ''
  useEffect(() => {
    if (myName) void seedMyName(myName)
  }, [myName])
}
