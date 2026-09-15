import { supabase } from '@/lib/supabase'
import { pick } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 管理员名单 —— 和云端打交道的那一层
 *
 * 规则在 supabase/016-admins.sql，那边写了为什么分两级、
 * 为什么最后一个 owner 删不掉。这一层只管把话说对。
 *
 * -------------------------------------------------------------------
 * 这个文件最容易写错的一件事：RLS 拦住的删除**不报错**
 *
 * 一个没权限的人执行 delete，Postgres 不会抛异常 —— 那一行只是
 * 「他看不见」，于是删掉 0 行，安安静静地返回成功。
 *
 * 所以这里每个写操作都带 .select()，看真正动了几行。
 * 只看 error 是不是 null 的话，一个被策略挡下来的操作会在界面上
 * 显示「去掉了」，刷新一下那个人还在 —— 而这种界面比报错难查得多。
 *
 * （insert 不一样：它违反 with check 时是真的抛错。但一样带 select，
 * 免得读的人以为这两个差别是有意的。）
 * ------------------------------------------------------------------ */

export type AdminRow = {
  uid: string
  note: string | null
  owner: boolean
  created_at: string
}

export type AdminResult = { ok: true } | { ok: false; error: string }

const failed = (msg: string): AdminResult => ({ ok: false, error: msg })

/**
 * 名单。
 *
 * 只有 owner 拿得到全部 —— 普通管理员拿回来的是**他自己那一行**，
 * 不是空的。所以这个函数的返回值不能拿去判断「有几个管理员」，
 * 那个数只有 owner 问得对。
 */
export async function fetchAdmins(): Promise<AdminRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('app_admins')
    .select('uid, note, owner, created_at')
    .order('created_at')
  if (error) {
    console.warn('管理员名单没拿到:', error.message)
    return []
  }
  return (data ?? []) as AdminRow[]
}

/** 我是不是 owner（能不能改这张名单） */
export async function fetchIsOwner(): Promise<boolean> {
  if (!supabase) return false
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return false
  /*
   * 用 limit(1) 不用 single()：查不到的时候 single() 是报错，
   * 而「我不是 owner」本来就查不到 —— 那不是个错，是个答案。
   * report.ts 里的 fetchIsAdmin 同一个写法。
   */
  const { data, error } = await supabase
    .from('app_admins')
    .select('owner')
    .eq('uid', uid)
    .limit(1)
  if (error) {
    /* 没跑过 016（没有 owner 这一列）和「我不是」在这里是同一个结果 */
    console.warn('owner 身份没查到:', error.message)
    return false
  }
  return (data ?? [])[0]?.owner === true
}

/**
 * 加一个管理员。
 *
 * uid 是从球群成员里点出来的（Player.ownerId），不是手打的，
 * 也不是对邮箱对出来的 —— 这一点是这次改动的全部意义所在。
 * 对邮箱那条路栽过一次：邮箱看着对，人是球群里的另一个。
 */
export async function addAdmin(uid: string, note: string): Promise<AdminResult> {
  if (!supabase) return failed(pick('没连上云端', 'Not connected'))
  const { data, error } = await supabase
    .from('app_admins')
    .insert({ uid, note: note.slice(0, 80) })
    .select('uid')
  if (error) {
    /* 23505 = 已经在名单上了。这不算出事，说清楚就行 */
    if (error.code === '23505') {
      return failed(pick('他已经是管理员了', 'They are already an admin'))
    }
    return failed(error.message)
  }
  if ((data ?? []).length === 0) {
    return failed(pick('没加成 —— 只有 owner 改得了这张名单', 'Only an owner can change this list'))
  }
  return { ok: true }
}

/** 去掉一个管理员 */
export async function removeAdmin(uid: string): Promise<AdminResult> {
  if (!supabase) return failed(pick('没连上云端', 'Not connected'))
  const { data, error } = await supabase
    .from('app_admins')
    .delete()
    .eq('uid', uid)
    .select('uid')
  if (error) return failed(error.message)
  if ((data ?? []).length === 0) {
    return failed(
      pick(
        '没去掉 —— 要么你不是 owner，要么他是最后一个 owner',
        'Nothing changed — you are not an owner, or they are the last one',
      ),
    )
  }
  return { ok: true }
}

/** 给 / 收回 owner */
export async function setOwner(uid: string, owner: boolean): Promise<AdminResult> {
  if (!supabase) return failed(pick('没连上云端', 'Not connected'))
  const { data, error } = await supabase
    .from('app_admins')
    .update({ owner })
    .eq('uid', uid)
    .select('uid')
  if (error) return failed(error.message)
  if ((data ?? []).length === 0) {
    return failed(
      pick(
        '没改成 —— 要么你不是 owner，要么他是最后一个 owner',
        'Nothing changed — you are not an owner, or they are the last one',
      ),
    )
  }
  return { ok: true }
}

/**
 * 名单上这个 uid 是谁。
 *
 * 只认球群里的人（Player.ownerId 对得上）。对不上的显示 note ——
 * 那是加他的时候写下的那句话。两样都没有才退回 uid 的前 8 位，
 * 那是最后的兜底，不是给人看的。
 */
export function adminLabel(row: AdminRow, nameByUid: Map<string, string>): string {
  return nameByUid.get(row.uid) ?? row.note ?? row.uid.slice(0, 8)
}
