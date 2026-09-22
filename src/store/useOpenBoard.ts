import { useEffect } from 'react'
import { create } from 'zustand'
import { useApp, lastActivityAt } from '@/store/useApp'
import { socialState } from '@/store/useSocial'
import { openRow, shouldPublish, type OpenRow } from '@/lib/openBoard'
import { fetchOpenSessions, syncOpenSessions } from '@/lib/openSessions'

/* ------------------------------------------------------------------ *
 * 公开球局：全 App 共用的那一份，外加「把我开的局发布出去」
 *
 * 两件事长在一起，因为它们说的是同一张表的两头：
 *   拉  别人开的局，「加入球局」那一屏要显示
 *   推  我开的局，让别人看得到
 *
 * -------------------------------------------------------------------
 * 发布这件事只有**开局的那台手机**在做
 *
 * 写策略是 `host_uid = auth.uid()`（030），所以也只有它做得成。
 * 别人的手机连写都写不进来 —— 这条规矩在数据库那一层，不靠前端自觉。
 * ------------------------------------------------------------------ */

type State = {
  rows: OpenRow[]
  loaded: boolean
  load: (force?: boolean) => Promise<void>
}

export const useOpenBoard = create<State>((set, get) => ({
  rows: [],
  loaded: false,
  load: async (force = false) => {
    if (get().loaded && !force) return
    set({ rows: await fetchOpenSessions(), loaded: true })
  },
}))

/** 发布了一场新的局之后叫一声，别等下次开 App */
export const refreshOpenBoard = () => useOpenBoard.getState().load(true)

/**
 * 我这台手机现在**应该**公开哪几场，以及它这一刻替哪个球群说话。
 *
 * 只认自己开的局：`createdBy` 是那一场的球员 id，而我是哪个球员由
 * `meId` 说了算。没认领过球员身份的设备（meId 是空的）一场都不发布 ——
 * 那时候分不清哪一场是「我开的」。
 *
 * -------------------------------------------------------------------
 * 返回 null = 「这一刻什么都别动」
 *
 * 没登录、没认领身份、还不知道在哪个群 —— 这三种情况下这台手机
 * **什么都不知道**，而「不知道」不等于「该撤掉」。以前这里返回空数组，
 * 于是换群那一瞬间（useApp 会把 sessions 和 meId 一起清空）云端那几行
 * 被当成多余的全删了：A 群里正开着的局，切到 B 群就从公开列表上没了。
 *
 * scope 也是这么来的：撤行只在当前球群码底下发生，别的群那几行不归
 * 这一刻的这台手机管。
 */
function mine(): { want: OpenRow[]; scope: string | null } | null {
  const { sessions, matches, players, meId, clubs, clubId } = useApp.getState()
  const uid = socialState().meUid
  if (!uid || !meId) return null

  const code = clubs.find((c) => c.id === clubId)?.code ?? null
  if (!code) return null

  const myName = players.find((p) => p.id === meId)?.name ?? null
  const now = Date.now()

  const want = sessions
    .filter((s) => s.createdBy === meId)
    .filter((s) => shouldPublish(s, { lastActivity: lastActivityAt(s, matches), now }))
    .map((s) => openRow(s, { hostUid: uid, clubCode: code, hostName: myName }))

  return { want, scope: code }
}

/**
 * 开 App 拉一次，并且把自己开的局对齐一次。挂在最外层。
 *
 * 跟着球局和比赛变 —— 加一个人、打完一场，公开列表上那个「4 / 8 人」
 * 就该跟着动。不跟的话别人看到的是一个永远差四个人的局，
 * 跑过去发现早就满了。
 *
 * -------------------------------------------------------------------
 * 为什么要防抖
 *
 * 一场球局打起来之后，比赛记录每几分钟就变一次，而每一次变动都会
 * 触发这个 effect。不压一下的话，一晚上是几十次网络请求 ——
 * 而真正需要更新的只有「人数变了」那几次。
 *
 * diff 那一层（openDiff）已经挡掉了「内容没变就不写」，这里再压一道
 * 是为了连**比较**都不用做得那么勤 —— 比较要先拉一次云端。
 */
export function useOpenBoardSync(): void {
  const sessions = useApp((s) => s.sessions)
  const matches = useApp((s) => s.matches)
  const meId = useApp((s) => s.meId)
  const clubId = useApp((s) => s.clubId)
  const load = useOpenBoard((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = setTimeout(() => {
      const now = mine()
      /* 还不知道自己是谁、在哪个群 —— 这一轮什么都别动（理由见 mine） */
      if (!now) return
      void syncOpenSessions(now.want, now.scope).then((r) => {
        /*
         * 发布不成功不吭声（球照打、分照记，只是别人看不到这一场），
         * 但要在控制台留一句 —— 不然线上出了事没有任何线索。
         * 029 那次就是「没人看日志」，所以这一句宁可留着。
         */
        if (!r.ok) console.warn('公开球局没发布成功:', r.error)
        else if (r.upserted || r.removed) void useOpenBoard.getState().load(true)
      })
    }, 3000)
    return () => clearTimeout(id)
  }, [sessions, matches, meId, clubId])
}
