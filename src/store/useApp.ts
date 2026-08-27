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
} from '@/types'

export const STORAGE_KEY = 'badminton-scoring-v1'

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
}

/**
 * 导出/导入的备份文件结构。
 * version 3 起是 avatars（v2 的 pets 会被丢弃，那套宠物已经换掉了）。
 * version 4 起女生用分层换装，导入老备份时会自动补上开局那几件。
 * 老字段缺失一律按空处理，v1/v2 的备份照样能导入。
 */
export type Backup = {
  app: 'badminton-scoring'
  version: 1 | 2 | 3 | 4
  exportedAt: string
  players: Player[]
  sessions: Session[]
  matches: Match[]
  avatars?: AvatarProfile[]
}

type AppState = {
  players: Player[]
  sessions: Session[]
  matches: Match[]
  avatars: AvatarProfile[]

  addPlayer: (name: string, gender: Gender) => Player
  updatePlayer: (id: string, patch: Partial<Omit<Player, 'id'>>) => void
  setPlayerArchived: (id: string, archived: boolean) => void

  createSession: (draft: SessionDraft) => Session
  updateSession: (id: string, patch: Partial<Omit<Session, 'id'>>) => void
  endSession: (id: string) => void
  reopenSession: (id: string) => void
  deleteSession: (id: string) => void

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

  exportBackup: () => Backup
  importBackup: (backup: Backup) => void
  resetAll: () => void
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      players: [],
      sessions: [],
      matches: [],
      avatars: [],

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

      exportBackup() {
        const { players, sessions, matches, avatars } = get()
        return {
          app: 'badminton-scoring',
          version: 4,
          exportedAt: new Date().toISOString(),
          players,
          sessions,
          matches,
          avatars,
        }
      },

      importBackup(backup) {
        if (backup?.app !== 'badminton-scoring') {
          throw new Error('不是本 App 的备份文件')
        }
        set({
          players: backup.players ?? [],
          sessions: backup.sessions ?? [],
          matches: backup.matches ?? [],
          // v1/v2 的备份没有 avatars，按还没建角色处理；
          // 有的话可能还带着换掉的旧装备 id，一并换成新的，
          // 再把分层换装那几件补齐 —— 和 migrate 走的是同两个函数
          avatars: (backup.avatars ?? []).map(retireOldGear).map(grantDressUp),
        })
      },

      resetAll() {
        set({ players: [], sessions: [], matches: [], avatars: [] })
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
