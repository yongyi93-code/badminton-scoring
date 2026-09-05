import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  buyBlocker,
  defaultHair,
  grantDressUp,
  itemById,
  newAvatar,
  retireOldGear,
  STARTER_IDS,
  type AvatarProfile,
  type AvatarSex,
  type AvatarSlot,
  type Progress,
} from '@/lib/avatar'
import {
  DEFAULT_RULES,
  type EndCondition,
  type FriendlySetup,
  type Gender,
  type Match,
  type MatchType,
  type Player,
  type PairingMode,
  type Rules,
  type Session,
  type SessionFormat,
  type Announcement,
  type Club,
} from '@/types'

export const STORAGE_KEY = 'badminton-scoring-v1'

/** 人数满了没。maxPlayers 缺失或者 0 都当不限 —— 老数据没有这个字段 */
export const isFull = (session: Pick<Session, 'playerIds' | 'maxPlayers'>) =>
  Boolean(session.maxPlayers) && session.playerIds.length >= session.maxPlayers!

/** 还能进几个人；不限时返回 null */
export const spotsLeft = (session: Pick<Session, 'playerIds' | 'maxPlayers'>) =>
  session.maxPlayers ? Math.max(0, session.maxPlayers - session.playerIds.length) : null

/**
 * 这个人现在在哪一场进行中的球局里。不在就是 undefined。
 *
 * 一个人同一时间只能在一场球局里 —— 他只有一副身子，同时出现在两个
 * 场馆的名单上没有任何现实含义，而排场、休息轮次、AA 分账全都按
 * 「名单上的人此刻都在这儿」算的。
 */
export const activeSessionOf = (
  sessions: Session[],
  playerId: string | null | undefined,
): Session | undefined =>
  playerId
    ? sessions.find((s) => s.status === 'active' && s.playerIds.includes(playerId))
    : undefined

/**
 * 这一局最后一次「有动静」是什么时候。
 *
 * 用来判断一场球局是不是已经散了 —— 球局要靠人按「结束」才收摊，
 * 而没人记得按，打完就各回各家了。
 *
 * 为什么不能拿开局时间算：那样一场从傍晚打到第二天早上的长局，会在
 * 还在打的时候从首页消失 —— 而首页正是别人找它加入的地方。以最后
 * 一场比赛为准，只要还在打就一直算「活的」，真散了才开始计时。
 *
 * 取的是每场比赛身上最新的那个时间戳：还在打的场次没有 endedAt，
 * 只看 endedAt 的话，一场正打得火热的球局会被当成从开局起就没动静。
 */
export function lastActivityAt(session: Session, matches: Match[]): number {
  let last = session.createdAt
  for (const m of matches) {
    if (m.sessionId !== session.id) continue
    const stamp = Math.max(m.endedAt ?? 0, m.startedAt ?? 0)
    if (stamp > last) last = stamp
  }
  return last
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

export type SessionDraft = {
  date: string
  venue: string
  courtCount: number
  playerIds: string[]
  defaultType: MatchType
  rules?: Partial<Rules>
  format?: SessionFormat
  endCondition?: EndCondition
  kingStreakCap?: number
  rotationPerPlayer?: number
  pairingMode?: PairingMode
  friendly?: FriendlySetup
  /** 最多几个人，0 = 不限 */
  maxPlayers?: number
  /** 谁开的（球员 id）。首页那份「谁在哪开了局」要显示 */
  createdBy?: string
}

type AppState = {
  players: Player[]
  sessions: Session[]
  matches: Match[]
  avatars: AvatarProfile[]
  /** 人工发的公告。首页快讯里那些是算出来的，这些是有人说的 */
  announcements: Announcement[]

  /**
   * 这台手机是谁在用 —— 「我的」那一页要显示谁的战绩、首页要跟谁打招呼。
   *
   * 只是本机的一个绑定，不是账号：数据还是整份存在这台手机上，
   * 谁拿到这台手机都能改任何人的分。真正的登录要等云端那一步。
   * 也正因为只属于这台手机，它不进备份 —— 备份恢复到别人手机上，
   * 不该顺手把「我是谁」也带过去。
   */
  meId: string | null

  /**
   * 我在哪些球群里。
   *
   * 从云端拉下来的一份缓存，只为了让「切换球群」那个界面能离线画出来。
   * 谁是成员这件事以数据库为准 —— 这里改了不算数。
   */
  clubs: Club[]
  /**
   * 当前在看哪个球群。
   *
   * 本机任何时候只装着这一个群的数据：球员、球局、比赛、排行榜全是它的。
   * 切群 = 清空本机 + 重新拉那个群的。不做「本机同时存好几个群」——
   * 那样每处查询都要带上群的条件，漏一处就是串数据，而串了很难发现。
   */
  clubId: string | null

  /**
   * 「我在哪些群」这件事有没有问过云端。
   *
   * 只为了一件事：没进任何群的人要被拦下来引导建群，而「还没问」和
   * 「问过了，一个群都没有」在数据上长得一模一样（clubId 都是 null）。
   * 分不出来的话，每次冷启动都会先闪一下引导页再跳走。
   *
   * 故意不进 partialize：换一次页面就该重新问一遍。存下来的话，
   * 上次退群这件事这台手机永远不知道。
   */
  clubsChecked: boolean

  setClubs: (clubs: Club[]) => void
  setClubsChecked: (checked: boolean) => void
  /**
   * 换一个球群来看。
   *
   * 会把本机数据清空。必须清：不清的话，切过去之后同步会把上一个群的
   * 球员和比赛当成「本机的新改动」推进新群里 —— 数据库那边会拒
   * （改不了别人群的行），但界面上已经是两个群的数据混在一起了。
   */
  setClubId: (clubId: string | null) => void

  setMeId: (playerId: string | null) => void
  /**
   * 把刚建出来的自己和登录账号绑在一起。
   *
   * 和 setMeId 的区别：setMeId 只在这台手机上做个标记，绑定会把账号
   * 写进球员本身、跟着同步出去 —— 别人手机上就知道那个「阿伟」有主。
   *
   * 现在只在「建一个你自己」那一步调用：谁建的就是谁的，
   * 没有从别人那里认领过来这回事，也就没有松开这一说。
   */
  claimPlayer: (playerId: string, ownerId: string) => void
  /**
   * 换了设备之后，重新认出「我是谁」。
   *
   * meId 只存在这台设备上，ownerId 则跟着球员同步到云端。换台手机、
   * 换个浏览器、甚至只是从 Safari 标签页换成主屏幕图标（iOS 上这两者
   * 的存储是分开的两份），meId 就是空的 —— 而球员本身已经从云端拉
   * 回来了。少了这一步，界面会说「还没建角色」，人自然就再建一个，
   * 于是同一个人在排名里出现两次，两边的场次还各算各的。
   *
   * 每次拉完云端都调一次：realtime 推过来、切回前台重拉，走的都是
   * 同一条路，所以这里挂一次就够。
   */
  adoptMe: (ownerId: string | null) => void
  addPlayer: (name: string, gender: Gender) => Player
  updatePlayer: (id: string, patch: Partial<Omit<Player, 'id'>>) => void
  setPlayerArchived: (id: string, archived: boolean) => void

  createSession: (draft: SessionDraft) => Session
  updateSession: (id: string, patch: Partial<Omit<Session, 'id'>>) => void
  endSession: (id: string) => void
  reopenSession: (id: string) => void
  deleteSession: (id: string) => void
  /**
   * 自己加入一个别人开的球局。返回加没加进去。
   *
   * 幂等：已经在里面了就什么都不做 —— 两台手机同时点、
   * 或者同步把同一条改动送回来时，不能把人加两遍。
   *
   * 人数上限在这里挡，不是只在界面上挡：界面那份是从同步过来的
   * 数据算的，可能已经过时了，而这里读的是当下的 store。
   *
   * 已经在另一场进行中的球局里也会被挡（见 activeSessionOf）——
   * 一个人同一时间只能在一场里。
   */
  joinSession: (sessionId: string, playerId: string) => boolean
  /**
   * 自己退出。返回退没退成。
   *
   * 打过球的人退不掉：他那几场比赛还在，退了之后那些记录就挂着一个
   * 不在名单里的人，排行榜和结算都会对不上。
   *
   * 返回值是给界面用的 —— 原来这里默默 return，界面上按了没反应，
   * 人只会以为按钮坏了，而真正的原因（你已经打过了）没有任何地方说。
   */
  leaveSession: (sessionId: string, playerId: string) => boolean

  addMatch: (match: Omit<Match, 'id' | 'seq'>) => Match
  addMatches: (matches: Omit<Match, 'id' | 'seq'>[]) => Match[]
  updateMatch: (id: string, patch: Partial<Omit<Match, 'id'>>) => void
  replaceMatch: (match: Match) => void
  deleteMatch: (id: string) => void

  /** 创建角色，或换性别（换了会把发型换成对应性别的免费款） */
  setAvatarSex: (playerId: string, sex: AvatarSex) => void
  /** 换肤色，免费 */
  setAvatarSkin: (playerId: string, skin: number) => void
  /** 买下道具并扣金币。买不起 / 段位不够 / 已拥有都返回 false，不改动任何东西 */
  buyItem: (playerId: string, itemId: string, progress: Progress) => boolean
  /** 戴上或脱下某个槽位的装备，itemId 传 null 表示脱下 */
  equipItem: (playerId: string, slot: AvatarSlot, itemId: string | null) => void

  /** 发一条公告。空字符串不发，返回发出去的那条（没发就是 null） */
  postAnnouncement: (text: string, authorId: string) => Announcement | null
  /** 撤掉一条公告 */
  deleteAnnouncement: (id: string) => void

  resetAll: () => void
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      players: [],
      sessions: [],
      matches: [],
      avatars: [],
      announcements: [],
      meId: null,
      clubs: [],
      clubId: null,
      clubsChecked: false,

      setClubs(clubs) {
        set({ clubs })
      },

      setClubsChecked(clubsChecked) {
        set({ clubsChecked })
      },

      setClubId(clubId) {
        if (get().clubId === clubId) return
        /*
         * 换群 = 换一整份数据。本机那份属于上一个群，一条都不能留。
         *
         * meId 也要清：那是「我在这个群里是哪个球员」。同一个人在不同
         * 群里是不同的球员记录 —— 留着上一个群的 meId，新群里会指到
         * 一个根本不存在的人，界面直接空掉。拉完之后 adoptMe 会按
         * 登录账号在新群里重新认出「我是谁」。
         */
        set({
          clubId,
          players: [],
          sessions: [],
          matches: [],
          avatars: [],
          announcements: [],
          meId: null,
        })
      },

      setMeId(playerId) {
        set({ meId: playerId })
      },

      claimPlayer(playerId, ownerId) {
        set((st) => ({
          players: st.players.map((p) =>
            p.id === playerId
              ? { ...p, ownerId }
              : // 一个账号只能是一个人。认领新的就把旧的松开，
                // 否则同一个账号会挂在两个球员上，谁都说不清哪个是他
                p.ownerId === ownerId
                ? { ...p, ownerId: null }
                : p,
          ),
          meId: playerId,
        }))
      },

      adoptMe(ownerId) {
        set((st) => {
          // 云端有一个人挂着这个账号 —— 那就是我，不管这台设备原来指着谁
          const mine = ownerId
            ? st.players.find((p) => p.ownerId === ownerId && !p.archived)
            : undefined
          if (mine) return mine.id === st.meId ? {} : { meId: mine.id }

          const current = st.meId ? st.players.find((p) => p.id === st.meId) : undefined
          // 指着一个云端已经没有的人，就别再指了，让界面老实说「还没建角色」
          if (st.meId && !current) return { meId: null }

          /*
           * 这台设备认定的那个人还没有主 —— 多半是「先建角色、后登录」。
           * 顺手盖个章，下次换设备才认得回来。
           *
           * 代价说清楚：要是有人借别人的手机登录自己的账号，而那台手机
           * 上的人从来没登录过，会被盖成他的。按「谁创建就谁的」这条规则
           * 这没法完全避免 —— 但比每换一次设备就多出一个自己好得多。
           */
          if (ownerId && current && !current.ownerId) {
            return {
              players: st.players.map((p) =>
                p.id === current.id ? { ...p, ownerId } : p,
              ),
            }
          }
          return {}
        })
      },

      addPlayer(name, gender) {
        const player: Player = {
          id: newId(),
          name: name.trim(),
          // level 是旧版手填的水平星级，现在配对改看 MMR，字段留着只为兼容旧数据
          level: 3,
          gender,
          archived: false,
          createdAt: Date.now(),
        }
        set((s) => ({ players: [...s.players, player] }))
        return player
      },

      updatePlayer(id, patch) {
        set((s) => ({
          players: s.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }))
        /*
         * 角色的男女跟着球员资料走，不在角色页单独改。
         *
         * 性别是一件事，只该有一个地方填。原来角色页有个「换个角色」，
         * 于是同一个人可能资料里写着男、角色却是女 —— 混双按资料排、
         * 立绘按角色画，两边对不上。
         *
         * 改性别不没收任何东西：买过的、花掉的都留着，
         * 换过去先穿那边白送的几件，换回来原样还在（见 setAvatarSex）。
         */
        const sex = patch.gender === 'M' ? 'm' : patch.gender === 'F' ? 'f' : null
        if (sex && get().avatars.some((a) => a.playerId === id && a.sex !== sex)) {
          get().setAvatarSex(id, sex)
        }
      },

      setPlayerArchived(id, archived) {
        set((s) => ({
          players: s.players.map((p) => (p.id === id ? { ...p, archived } : p)),
        }))
      },

      createSession(draft) {
        const session: Session = {
          id: newId(),
          date: draft.date,
          venue: draft.venue.trim(),
          courtCount: draft.courtCount,
          playerIds: [...draft.playerIds],
          defaultType: draft.defaultType,
          rules: { ...DEFAULT_RULES, ...draft.rules },
          fee: {
            courtFee: 0,
            shuttleCount: 0,
            shuttleUnitPrice: 0,
            paidPlayerIds: [],
          },
          status: 'active',
          createdAt: Date.now(),
          format: draft.format ?? 'free',
          endCondition: draft.endCondition,
          kingStreakCap: draft.kingStreakCap,
          rotationPerPlayer: draft.rotationPerPlayer,
          pairingMode: draft.pairingMode ?? 'balanced',
          friendly: draft.friendly,
          maxPlayers: draft.maxPlayers,
          createdBy: draft.createdBy,
        }
        set((s) => ({ sessions: [session, ...s.sessions] }))
        return session
      },

      /** 轮转赛开局时一次写入整份赛程 */
      addMatches(inputs) {
        const created: Match[] = []
        set((s) => {
          let seq = s.matches.filter(
            (m) => m.sessionId === inputs[0]?.sessionId,
          ).length
          for (const input of inputs) {
            seq += 1
            created.push({ ...input, id: newId(), seq })
          }
          return { matches: [...s.matches, ...created] }
        })
        return created
      },

      updateSession(id, patch) {
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        }))
      },

      endSession(id) {
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, status: 'ended', endedAt: Date.now() } : x,
          ),
          // 结束球局时清掉还没打的排队比赛，避免留下垃圾数据
          matches: s.matches.filter(
            (m) => !(m.sessionId === id && m.status === 'queued'),
          ),
        }))
      },

      reopenSession(id) {
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, status: 'active', endedAt: undefined } : x,
          ),
        }))
      },

      joinSession(sessionId, playerId) {
        const session = get().sessions.find((x) => x.id === sessionId)
        if (!session) return false
        if (session.playerIds.includes(playerId)) return true // 已经在里面了
        if (isFull(session)) return false
        /*
         * 同一时间只能在一场球局里。
         *
         * 挡在这里而不是只在界面上挡：界面那份名单是同步过来的，可能
         * 已经过时；而且首页只显示「我不在里面的局」，人在另一场里的
         * 事实在那一屏上根本看不见 —— 于是点了就进去了，两边的名单
         * 各显示一半，「我的」那页却两场都列着。
         *
         * 现实里也只有一个解释：他只有一副身子。排场、休息轮次、AA
         * 分账全都按「名单上的人此刻都在这儿」算的。
         */
        if (activeSessionOf(get().sessions, playerId)) return false
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId && !x.playerIds.includes(playerId)
              ? { ...x, playerIds: [...x.playerIds, playerId] }
              : x,
          ),
        }))
        return true
      },

      leaveSession(sessionId, playerId) {
        // 打过球的人不能退：他的比赛还在，退了那几场就没有主
        const played = get().matches.some(
          (m) =>
            m.sessionId === sessionId &&
            (m.teamA.includes(playerId) || m.teamB.includes(playerId)),
        )
        if (played) return false
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId
              ? {
                  ...x,
                  playerIds: x.playerIds.filter((id) => id !== playerId),
                  restingIds: x.restingIds?.filter((id) => id !== playerId),
                }
              : x,
          ),
        }))
        return true
      },

      deleteSession(id) {
        set((s) => ({
          sessions: s.sessions.filter((x) => x.id !== id),
          matches: s.matches.filter((m) => m.sessionId !== id),
        }))
      },

      addMatch(input) {
        const seq =
          get().matches.filter((m) => m.sessionId === input.sessionId).length + 1
        const match: Match = { ...input, id: newId(), seq }
        set((s) => ({ matches: [...s.matches, match] }))
        return match
      },

      updateMatch(id, patch) {
        set((s) => ({
          matches: s.matches.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        }))
      },

      replaceMatch(match) {
        set((s) => ({
          matches: s.matches.map((m) => (m.id === match.id ? match : m)),
        }))
      },

      deleteMatch(id) {
        set((s) => ({ matches: s.matches.filter((m) => m.id !== id) }))
      },

      setAvatarSex(playerId, sex) {
        set((s) => {
          const exist = s.avatars.find((p) => p.playerId === playerId)
          if (!exist) return { avatars: [...s.avatars, newAvatar(playerId, sex)] }
          if (exist.sex === sex) return s
          // 换性别保留已买的东西和花掉的钱，但发型要换成对应性别的，
          // 否则男号会顶着女发型 —— 那款他也没买过
          return {
            avatars: s.avatars.map((p) =>
              p.playerId === playerId
                ? grantDressUp({
                    ...p,
                    sex,
                    owned: [...new Set([...p.owned, ...STARTER_IDS])],
                    equipped: { ...p.equipped, hair: defaultHair(sex) },
                  })
                : p,
            ),
          }
        })
      },

      setAvatarSkin(playerId, skin) {
        set((s) => ({
          avatars: s.avatars.map((p) =>
            p.playerId === playerId ? { ...p, skin } : p,
          ),
        }))
      },

      buyItem(playerId, itemId, progress) {
        const item = itemById(itemId)
        if (!item) return false
        const avatar = get().avatars.find((p) => p.playerId === playerId)
        if (!avatar) return false
        if (buyBlocker(item, avatar, progress) !== null) return false

        set((s) => ({
          avatars: s.avatars.map((p) =>
            p.playerId === playerId
              ? {
                  ...p,
                  owned: [...p.owned, item.id],
                  spent: p.spent + item.price,
                  // 买完直接戴上，省一步操作
                  equipped: { ...p.equipped, [item.slot]: item.id },
                }
              : p,
          ),
        }))
        return true
      },

      equipItem(playerId, slot, itemId) {
        set((s) => ({
          avatars: s.avatars.map((p) => {
            if (p.playerId !== playerId) return p
            // 没买过的东西不让戴，避免改数据绕过商店
            if (itemId !== null && !p.owned.includes(itemId)) return p
            const equipped = { ...p.equipped }
            if (itemId === null) delete equipped[slot]
            else equipped[slot] = itemId
            return { ...p, equipped }
          }),
        }))
      },

      postAnnouncement(text, authorId) {
        const body = text.trim()
        if (!body) return null
        const item: Announcement = {
          id: newId(),
          text: body,
          authorId,
          createdAt: Date.now(),
        }
        set((s) => ({ announcements: [...s.announcements, item] }))
        return item
      },

      deleteAnnouncement(id) {
        set((s) => ({ announcements: s.announcements.filter((a) => a.id !== id) }))
      },

      resetAll() {
        set({
          players: [],
          sessions: [],
          matches: [],
          avatars: [],
          announcements: [],
          meId: null,
          clubs: [],
          clubId: null,
          clubsChecked: false,
        })
      },
    }),
    {
      name: STORAGE_KEY,
      /**
       * 1 = 宠物那一版（pets）。角色系统把整个商店换掉了，旧的道具 id
       * 一件都不存在，所以直接丢掉 pets 从头开始 —— 花掉的金币等于全额退回，
       * 大家重新挑角色买装备。比赛记录一点都不动，段位和金币照样是算出来的。
       *
       * 2 → 3 = 装备线改成羽球主题，轻甲／骑士铠／暗影战衣和那几把刀剑
       * 换成了战袍和球拍。不做迁移的话已经买过的人身上会挂着一批不存在的
       * id，画的时候找不到就悄悄退回新手队服 —— 人看起来像从来没升过级。
       * 所以这里按同一档位一件换一件，买过什么还是穿着什么。
       *
       * 3 → 4 = 女生换成分层换装（买了衣服就穿上）。素材是后来才加的，
       * 之前建的女号身上一个换装槽位都没有 —— 不补的话打开角色页
       * 只剩一张底图，看起来像衣服被扒了。所以给她们补上白送的那几件。
       */
      version: 4,
      migrate: (state, from) => {
        const s = state as Partial<AppState> & { pets?: unknown }
        if (from < 2) delete s.pets
        let avatars = s.avatars ?? []
        if (from < 3) avatars = avatars.map(retireOldGear)
        if (from < 4) avatars = avatars.map(grantDressUp)
        return { ...s, avatars } as AppState
      },
      partialize: (s) => ({
        players: s.players,
        sessions: s.sessions,
        matches: s.matches,
        avatars: s.avatars,
        announcements: s.announcements,
        meId: s.meId,
        clubs: s.clubs,
        clubId: s.clubId,
      }),
    },
  ),
)

/** 便捷选择器 —— 组件里直接用，避免每处重复 filter */
export const selectActiveSession = (s: AppState) =>
  s.sessions.find((x) => x.status === 'active')

export const sessionMatches = (matches: Match[], sessionId: string) =>
  matches.filter((m) => m.sessionId === sessionId).sort((a, b) => a.seq - b.seq)

export const playerMap = (players: Player[]) =>
  new Map(players.map((p) => [p.id, p]))

/**
 * 这场球局里所有人的名册 = 正式球员 + 友谊赛客队。
 *
 * 客队球员不进正式名单（别人俱乐部的人混进名单和排行榜只会碍事），
 * 但看板、记分屏、结算页都得叫得出他们的名字，所以在这里补进去。
 * 包装成 Player 的形状，界面上那些「按 id 拿名字/性别」的地方一行都不用改。
 */
export const rosterForSession = (
  players: Player[],
  session?: Session,
): Map<string, Player> => {
  const map = playerMap(players)
  for (const g of session?.friendly?.awayPlayers ?? []) {
    map.set(g.id, {
      id: g.id,
      name: g.name,
      level: 3,
      gender: g.gender,
      archived: false,
      createdAt: 0,
    })
  }
  return map
}

/** 友谊赛里这个人属于哪一边；不是友谊赛返回 undefined */
export const clubSideOf = (
  session: Session | undefined,
  playerId: string,
): 'home' | 'away' | undefined => {
  if (!session?.friendly) return undefined
  return session.friendly.awayPlayers.some((g) => g.id === playerId)
    ? 'away'
    : 'home'
}

export const avatarOf = (avatars: AvatarProfile[], playerId: string) =>
  avatars.find((p) => p.playerId === playerId)
