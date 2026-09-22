import { pick } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { flushNow, stopSync } from '@/lib/sync'
import { clearSignCache } from '@/lib/moments'
import { useApp } from '@/store/useApp'
import { useSeen } from '@/store/useSeen'

/* ------------------------------------------------------------------ *
 * 注销账号
 *
 * 真正干活的在服务端（supabase/functions/delete-me），因为 Supabase
 * 没有「删掉我自己」这个客户端 API —— 删用户要服务端钥匙，而那把钥匙
 * 绝不能发到手机上。这一层只管三件事：走之前把没推上去的推完、
 * 调那个函数、回来之后把这台手机擦干净。
 *
 * -------------------------------------------------------------------
 * 为什么不直接复用 signOut()
 *
 * signOut() 第一句是 flushNow()，**推不上去就整个中止**（return）。
 * 那条规矩在平时是对的：没同步完就退出登录，等于把本机那几场
 * 比赛丢掉。
 *
 * 但账号删掉之后，令牌立刻失效，flushNow() 必然失败 —— 于是
 * signOut() 会在第一句就掉头回去，既不 resetAll 也不 signOut。
 * 结果是这台手机**还登录着一个已经不存在的账号**，满屏是已经
 * 读不回来的数据。
 *
 * 所以这里自己走一遍：推在前（趁令牌还有效），擦在后（不管推成没推成）。
 * ------------------------------------------------------------------ */

export type DeleteResult = { ok: true } | { ok: false; error: string }

/** 注销之后这台手机上还剩什么。用来在确认那一屏上如实说 */
export type DeleteOptions = {
  /**
   * 连球员名字一起抹掉。
   *
   * 默认 false。抹掉之后别人的历史里那个人变成「已注销」——
   * 战绩一场不少，但看的人认不出是谁了，两个人注销更分不清。
   * 所以默认保留，让本人自己选。
   */
  scrubName: boolean
}

/**
 * 从 functions.invoke 的错误里把服务端那句话挖出来。
 *
 * supabase-js 把非 2xx 包成 FunctionsHttpError，`error.message` 永远是
 * 那句没用的「Edge Function returned a non-2xx status code」——
 * 真正的原因在响应体里。不挖的话，界面上显示的是一句放之四海而皆准
 * 的废话，而这一屏恰恰最需要说清楚为什么没成。
 */
async function serverSaid(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown } | null)?.context
  if (!(ctx instanceof Response)) return null
  try {
    const body = (await ctx.json()) as { error?: unknown }
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

export async function deleteMyAccount(opts: DeleteOptions): Promise<DeleteResult> {
  if (!supabase) return { ok: false, error: pick('没连上云端', 'Not connected') }

  /*
   * 先把没推上去的推完 —— 趁令牌还有效。
   *
   * 推不上去也照样往下走：人已经决定要走了，为一次同步失败把注销
   * 拦回去，等于这个按钮时灵时不灵。最坏的情况是他最后那一场没进
   * 云端，而他本来就要走了。
   */
  const flushed = await flushNow()
  if (!flushed.ok) console.warn('注销前最后一次同步没成功:', flushed.error)

  const { error } = await supabase.functions.invoke('delete-me', {
    body: { scrubName: opts.scrubName },
  })
  if (error) {
    const said = await serverSaid(error)
    return { ok: false, error: said ?? (error instanceof Error ? error.message : String(error)) }
  }

  /*
   * 账号没了，这台手机上那一份也得擦掉。
   *
   * 三句都不看返回值：账号已经删了，这是不可逆的，剩下的清理
   * 失败一两句也不该把界面留在「注销失败」上 —— 那会让人再按一次，
   * 而第二次必然报「令牌认不出是谁」。
   */
  stopSync()
  useApp.getState().resetAll()
  /* 签好的那些照片链接也要清 —— 和 signOut 同一条理由 */
  clearSignCache()
  /* 看过哪几条 Story 也清 —— 和 signOut 同一条理由 */
  useSeen.getState().reset()
  await supabase.auth.signOut().catch(() => {})

  return { ok: true }
}
