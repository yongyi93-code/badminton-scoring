import { create } from 'zustand'

export type Route =
  | { name: 'home' }
  | { name: 'sessions' }
  | { name: 'discover' }
  | { name: 'me' }
  | { name: 'setup' }
  | { name: 'board'; sessionId: string }
  | { name: 'score'; matchId: string }
  /** 赛后结算：这一场谁赢了、每个人 MMR 变了多少 */
  | { name: 'result'; matchId: string }
  /*
   * 排行榜一定带范围：某场球局的，或者某个球馆的。
   * 没有全员榜 —— 这个 App 不再有「翻一遍所有人」这件事。
   */
  | { name: 'leaderboard'; sessionId: string; venue?: undefined }
  | { name: 'leaderboard'; sessionId?: undefined; venue: string }
  /** 球馆详情。venue 是球局上那段自由文本，归组交给 venueKey */
  | { name: 'venue'; venue: string }
  /** 全体排名：所有人放在一起，按 MMR 排 */
  | { name: 'ranking' }
  | { name: 'summary'; sessionId: string }
  | { name: 'profile'; playerId: string }
  /**
   * 个人主页 —— 账号那一层的「这个人是谁」。
   *
   * 按 uid 走，不按球员 id，和私聊同一条理由，而且这里更硬：
   * 这一屏**存在的意义**就是那些不在我球群里的人（串场认识的、
   * 全国榜上看到的）—— 他们在我这台手机上根本没有球员记录。
   *
   * hint 是调用方手上已经有的名字（全国榜那一行、战绩页上那个）。
   * 陌生人读不到他的名片，没有这个就只能显示「不认识的人」——
   * 而我明明刚在榜上看到他叫什么。
   */
  | { name: 'person'; uid: string; hint?: string }
  | { name: 'avatar'; playerId: string }
  /**
   * 朋友圈。
   *
   * 不带 uid 是整个朋友圈（我的 + 好友的），带 uid 是只看一个人的 ——
   * 同一屏两种用法，所以两处的规矩必然一样（见 screens/Moments.tsx）。
   */
  | { name: 'moments'; uid?: string }
  /** 好友：已经是好友的、发来的申请、聊过的那几段对话 */
  | { name: 'friends' }
  /*
   * 一段私聊。按 auth 的 uid 走，不按球员 id ——
   * 私聊这套东西数据库那边认的就是 uid，而且好友有可能
   * 在本机根本没有对应的球员记录（他换了球群、或者还没同步过来）。
   * 按球员 id 走的话，那种人点进去是一片空白。
   */
  | { name: 'chat'; uid: string }
  /*
   * 举报队列。只有管理员点得进来，而且进来了也读不到东西 ——
   * 真正把门的是数据库那边的策略，不是这条路由。
   */
  | { name: 'reports' }
  /** 收到的反馈。同样只有管理员点得进来 */
  | { name: 'feedback' }
  /**
   * 申诉队列。只有管理员点得进来，而且同样挡门的是数据库策略。
   *
   * 和举报队列分开一屏：举报有人催（被骚扰的人会再来一次），
   * 申诉没人催 —— 申诉的人已经被禁言了，连问一句「看了吗」都发不出来。
   */
  | { name: 'appeals' }
  /**
   * 管理员名单。只有 owner 点得进来。
   *
   * 和举报队列同一条：这条路由挡不住任何人，把门的是数据库策略 ——
   * 进来了也读不到名单、改不动一行。
   */
  | { name: 'admins' }
  /**
   * 球群成员名单 —— 把不打了的人收起来，也把收起来的放回去。
   *
   * 不挡任何人：同群的人本来就能改彼此的球员行（006），
   * 在路由上摆一道门只是自欺。
   */
  | { name: 'roster' }
  /** 隐私政策 / 服务条款。谁都看得到，不用登录 */
  | { name: 'legal'; tab?: 'privacy' | 'terms' }

/**
 * 底部导航的四个落脚点（中间的「开球」不是 tab，它推一个流程出来）。
 *
 * 这四个之间互相切换不该往回退栈里堆东西 —— 在 tab 之间点来点去二十次，
 * 再按二十次返回才出得去，那是最烦人的一种。
 */
export const TAB_ROUTES = ['home', 'sessions', 'discover', 'me'] as const
export type TabName = (typeof TAB_ROUTES)[number]

const isTab = (r: Route): r is Route & { name: TabName } =>
  (TAB_ROUTES as readonly string[]).includes(r.name)

type NavState = {
  stack: Route[]
  push: (route: Route) => void
  replace: (route: Route) => void
  /** 切底部导航。栈顶已经是某个 tab 就原地换掉，否则才压一层 */
  switchTab: (tab: TabName) => void
  /** 返回上一屏；已在首屏则不动 */
  back: () => void
  /** 系统返回键触发，不再写 history */
  popFromHistory: () => void
  resetTo: (route: Route) => void
}

export const useNav = create<NavState>((set, get) => ({
  stack: [{ name: 'home' }],

  push(route) {
    set((s) => ({ stack: [...s.stack, route] }))
    if (typeof history !== 'undefined') {
      history.pushState({ depth: get().stack.length }, '')
    }
  },

  replace(route) {
    set((s) => ({ stack: [...s.stack.slice(0, -1), route] }))
  },

  /*
   * 首页是这四个 tab 的根，别的 tab 都停在它上面一层。
   *
   *   首页 → 球局      压一层
   *   球局 → 排名      原地换掉（tab 之间平移不该堆回退栈）
   *   排名 → 首页      退一层，不是再压一层
   *
   * 这样系统返回键在任何一个 tab 上按一下都回首页，在首页上按才退出 App，
   * 而且 history 深度和 stack 始终一比一 —— 少了这条，
   * 返回键会被「吃掉」好几次才有反应。
   */
  switchTab(tab) {
    const stack = get().stack
    const top = stack[stack.length - 1]
    if (top.name === tab) return

    // 从球局看板、记分这些深层页面点 tab：正常压一层，返回还能回去
    if (!isTab(top)) {
      get().push({ name: tab } as Route)
      return
    }
    if (tab === 'home' && stack[stack.length - 2]?.name === 'home') {
      get().back()
      return
    }
    if (top.name === 'home') get().push({ name: tab } as Route)
    else get().replace({ name: tab } as Route)
  },

  back() {
    if (get().stack.length <= 1) return
    // 交给 history 回退，popstate 里再收拢 stack，保证和系统返回键一致
    if (typeof history !== 'undefined') history.back()
    else set((s) => ({ stack: s.stack.slice(0, -1) }))
  },

  popFromHistory() {
    set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : s))
  },

  resetTo(route) {
    set({ stack: [route] })
  },
}))

export const useRoute = () => useNav((s) => s.stack[s.stack.length - 1])
