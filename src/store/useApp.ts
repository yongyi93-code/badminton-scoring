import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  buyBlocker,
  itemById,
  newPet,
  type PetKind,
  type PetProfile,
  type PetSlot,
} from '@/lib/pet'
import {
  DEFAULT_RULES,
  type EndCondition,
  type Gender,
  type Level,
  type Match,
  type MatchType,
  type Player,
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
}

/**
 * 导出/导入的备份文件结构。
 * version 2 起多了 pets；读的时候 pets 缺失按空处理，v1 的备份照样能导入。
 */
export type Backup = {
  app: 'badminton-scoring'
  version: 1 | 2
  exportedAt: string
  players: Player[]
  sessions: Session[]
  matches: Match[]
  pets?: PetProfile[]
}

type AppState = {
  players: Player[]
  sessions: Session[]
  matches: Match[]
  pets: PetProfile[]

  addPlayer: (name: string, level: Level, gender: Gender) => Player
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

  /** 领养或换一只宠物；已有装备保留，换种类不用重新买 */
  adoptPet: (playerId: string, kind: PetKind) => void
  renamePet: (playerId: string, name: string) => void
  /** 买下道具并扣分。买不起 / 等级不够 / 已拥有都返回 false，不改动任何东西 */
  buyItem: (playerId: string, itemId: string, earned: number) => boolean
  /** 戴上或脱下某个槽位的装备，itemId 传 null 表示脱下 */
  equipItem: (playerId: string, slot: PetSlot, itemId: string | null) => void

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
      pets: [],

      addPlayer(name, level, gender) {
        const player: Player = {
          id: newId(),
          name: name.trim(),
          level,
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

      adoptPet(playerId, kind) {
        set((s) => {
          const exist = s.pets.find((p) => p.playerId === playerId)
          if (!exist) return { pets: [...s.pets, newPet(playerId, kind)] }
          // 换种类保留已买的装备和花掉的分，换宠物不该等于清零重来
          return {
            pets: s.pets.map((p) =>
              p.playerId === playerId ? { ...p, kind } : p,
            ),
          }
        })
      },

      renamePet(playerId, name) {
        set((s) => ({
          pets: s.pets.map((p) =>
            p.playerId === playerId ? { ...p, name: name.trim() } : p,
          ),
        }))
      },

      buyItem(playerId, itemId, earned) {
        const item = itemById(itemId)
        if (!item) return false
        const pet = get().pets.find((p) => p.playerId === playerId)
        if (!pet) return false
        if (buyBlocker(item, pet, earned) !== null) return false

        set((s) => ({
          pets: s.pets.map((p) =>
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
          pets: s.pets.map((p) => {
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
        const { players, sessions, matches, pets } = get()
        return {
          app: 'badminton-scoring',
          version: 2,
          exportedAt: new Date().toISOString(),
          players,
          sessions,
          matches,
          pets,
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
          // v1 的备份没有 pets，按没养过宠物处理
          pets: backup.pets ?? [],
        })
      },

      resetAll() {
        set({ players: [], sessions: [], matches: [], pets: [] })
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        players: s.players,
        sessions: s.sessions,
        matches: s.matches,
        pets: s.pets,
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

export const petOf = (pets: PetProfile[], playerId: string) =>
  pets.find((p) => p.playerId === playerId)
