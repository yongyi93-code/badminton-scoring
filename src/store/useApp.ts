import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_RULES,
  type Gender,
  type Level,
  type Match,
  type MatchType,
  type Player,
  type Rules,
  type Session,
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
}

/** 导出/导入的备份文件结构 */
export type Backup = {
  app: 'badminton-scoring'
  version: 1
  exportedAt: string
  players: Player[]
  sessions: Session[]
  matches: Match[]
}

type AppState = {
  players: Player[]
  sessions: Session[]
  matches: Match[]

  addPlayer: (name: string, level: Level, gender: Gender) => Player
  updatePlayer: (id: string, patch: Partial<Omit<Player, 'id'>>) => void
  setPlayerArchived: (id: string, archived: boolean) => void

  createSession: (draft: SessionDraft) => Session
  updateSession: (id: string, patch: Partial<Omit<Session, 'id'>>) => void
  endSession: (id: string) => void
  reopenSession: (id: string) => void
  deleteSession: (id: string) => void

  addMatch: (match: Omit<Match, 'id' | 'seq'>) => Match
  updateMatch: (id: string, patch: Partial<Omit<Match, 'id'>>) => void
  replaceMatch: (match: Match) => void
  deleteMatch: (id: string) => void

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
        }
        set((s) => ({ sessions: [session, ...s.sessions] }))
        return session
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

      exportBackup() {
        const { players, sessions, matches } = get()
        return {
          app: 'badminton-scoring',
          version: 1,
          exportedAt: new Date().toISOString(),
          players,
          sessions,
          matches,
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
        })
      },

      resetAll() {
        set({ players: [], sessions: [], matches: [] })
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        players: s.players,
        sessions: s.sessions,
        matches: s.matches,
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
