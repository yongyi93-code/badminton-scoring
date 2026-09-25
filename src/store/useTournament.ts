import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  buildBracket,
  drawSize,
  placeRanked,
  rankEntrants,
  setScore as setMatchScore,
  type BracketMatch,
  type DrawMode,
  type Entrant,
} from '@/lib/bracket'

/* ------------------------------------------------------------------ *
 * 比赛：存在这台手机上
 *
 * -------------------------------------------------------------------
 * 为什么不上云（这一版）
 *
 * 比赛是**跨球群**的：来的人多半不在你的球群里，很多连 App 都没装。
 * 所以它塞不进 records —— 那张表按球群隔离（is_club_member），
 * 是这个 App 权限的地基。
 *
 * 要上云就得另开一张公开表，还要决定「没装 App 的人点链接看不看得到」。
 * 那个决定最好等真办过一场再拍：办过一次才知道观众到底会不会去点。
 *
 * 所以这一版整场比赛活在主办方手机里，分享靠导一张赛表图（和战绩卡
 * 同一套）。代价写在明面上：**一台手机说了算**，清了数据就没了。
 * 上云那一步换的只是「从哪读、往哪写」，赛表逻辑和界面一个字都不用动。
 *
 * -------------------------------------------------------------------
 * 存整张表，不存「怎么排出来的」
 *
 * 排签有随机，所以存种子和模式是重现不出同一张表的。存最终那几十场
 * 比赛反而最省事，也最经得起以后改排签算法 —— 老比赛不会因为算法
 * 变了就换了对阵。
 * ------------------------------------------------------------------ */

export type Tournament = {
  id: string
  /** 比赛叫什么。「2026 城中公开赛 男双」 */
  name: string
  /** yyyy-mm-dd */
  date: string
  /** 单打还是双打。只影响报名那一屏要几个名字框 */
  doubles: boolean
  mode: DrawMode
  entrants: Entrant[]
  /** 表多大。存下来，别每次从人数重算 —— 排完之后加人不该改表 */
  size: number
  matches: BracketMatch[]
  createdAt: number
}

type State = {
  list: Tournament[]
  create: (draft: {
    name: string
    date: string
    doubles: boolean
    entrants: Entrant[]
    mode: DrawMode
    /** 手动排的时候直接给每一格是谁；其余两档不用给 */
    slots?: (Entrant | null)[]
  }) => Tournament
  /** 重新抽一次签。整张表推倒重来 —— 所以界面上要问一句 */
  redraw: (id: string, mode: DrawMode) => void
  score: (id: string, round: number, index: number, a: number, b: number) => void
  remove: (id: string) => void
  rename: (id: string, name: string) => void
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** 一份草稿 → 摆好的格子。三档排签唯一分岔的地方 */
function slotsFor(
  entrants: Entrant[],
  mode: DrawMode,
  size: number,
  manual?: (Entrant | null)[],
): (Entrant | null)[] {
  if (mode === 'manual' && manual) return manual
  return placeRanked(rankEntrants(entrants, mode === 'manual' ? 'seeded' : mode), size)
}

export const useTournament = create<State>()(
  persist(
    (set) => ({
      list: [],

      create(draft) {
        const size = drawSize(draft.entrants.length)
        const t: Tournament = {
          id: newId(),
          name: draft.name.trim(),
          date: draft.date,
          doubles: draft.doubles,
          mode: draft.mode,
          entrants: draft.entrants,
          size,
          matches: buildBracket(slotsFor(draft.entrants, draft.mode, size, draft.slots)),
          createdAt: Date.now(),
        }
        set((s) => ({ list: [t, ...s.list] }))
        return t
      },

      redraw(id, mode) {
        set((s) => ({
          list: s.list.map((t) => {
            if (t.id !== id) return t
            /*
             * 人数可能变了（有人退赛、有人补上），所以表大小重算。
             * 已经填的比分全没了 —— 重抽签本来就是这个意思，
             * 界面上必须先问一句。
             */
            const size = drawSize(t.entrants.length)
            return {
              ...t,
              mode,
              size,
              matches: buildBracket(slotsFor(t.entrants, mode, size)),
            }
          }),
        }))
      },

      score(id, round, index, a, b) {
        set((s) => ({
          list: s.list.map((t) =>
            t.id === id ? { ...t, matches: setMatchScore(t.matches, round, index, a, b) } : t,
          ),
        }))
      },

      remove(id) {
        set((s) => ({ list: s.list.filter((t) => t.id !== id) }))
      },

      rename(id, name) {
        set((s) => ({
          list: s.list.map((t) => (t.id === id ? { ...t, name: name.trim() } : t)),
        }))
      },
    }),
    {
      /*
       * 和球局那份分开存。
       *
       * 换球群会把球局那份整个清掉（换群 = 换一整份数据），而比赛
       * 不属于任何球群 —— 混在一起的话，切一次群办到一半的比赛就没了。
       */
      name: 'rally-tournaments-v1',
    },
  ),
)

/** 这场比赛里 id → 参赛者。画表那一屏每一格都要查 */
export const entrantMap = (t: Tournament) => new Map(t.entrants.map((e) => [e.id, e]))
