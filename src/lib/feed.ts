import { pick } from './i18n'
import { progressByPlayer } from './avatar'
import {
  chronological,
  computeStats,
  decidedMatches,
  matchWinnerBySets,
  rankPlayers,
  sideOf,
} from './ranking'
import { matchesAtVenue, playerIdsAtVenue, venueSummaries } from './venues'
import type { Match, Player, Session } from '@/types'
import { UNNAMED_VENUE } from './venues'

/* ------------------------------------------------------------------ *
 * 首页快讯
 *
 * 首页原来只有「开始新球局」和一长串历史，打完球回来看不到任何变化 ——
 * 而大家最想知道的恰恰是：这个馆现在谁是第一、谁升段了、谁在连胜。
 * 这些数字本来就有，只是散在排行榜和个人页里，没人会一个个点进去看。
 *
 * 所以在首页滚一条快讯。全部从比赛记录现算，不落库 ——
 * 删掉一场比赛，快讯跟着变，不会留下对不上的旧消息。
 * ------------------------------------------------------------------ */

export type FeedLink =
  /** 排行榜一定带范围 —— 这里只会是某个球馆的 */
  | { kind: 'leaderboard'; venue: string }
  | { kind: 'player'; playerId: string }
  | { kind: 'summary'; sessionId: string }

export type FeedItem = {
  id: string
  icon: string
  text: string
  /** 排序用，越大越靠前 */
  weight: number
  link?: FeedLink
}

/** 一个球馆至少打满这么多场才好意思说「谁是第一」 */
const VENUE_MIN_MATCHES = 6

/** 连胜到几场才值得播报 */
const STREAK_MIN = 3

/**
 * 最近一局过了这么久，首页就不再播报了。
 *
 * 公告是新闻，不是档案。原来这里没有时限，于是「阿明 5 连胜」「城中现在
 * 是老陈的天下」会一直挂在首页第一屏 —— 三个月没打球也挂着。人看第二遍
 * 就不看了，看第十遍就学会了整块跳过，那时候真有事要说也传不出去。
 *
 * 三天是按羽球的节奏定的：周末打完，周一还看得到；到了周中就该安静下来，
 * 等下一局带来新的。首页空着不是毛病 —— 没有新闻就是没有新闻。
 */
const FRESH_MS = 3 * 24 * 60 * 60 * 1000

/** 当前还在延续的连胜（从最后一场往回数） */
function currentStreak(playerId: string, matches: Match[]): number {
  let n = 0
  for (const m of [...chronological(matches)].reverse()) {
    const side = sideOf(m, playerId)
    if (!side) continue
    if (matchWinnerBySets(m) === side) n += 1
    else break
  }
  return n
}

/**
 * 首页快讯。
 *
 * 传进来的是完整数据，里面自己按需要过滤 ——
 * 调用方不用关心哪条消息依赖什么。
 */
export function buildFeed(
  players: Player[],
  sessions: Session[],
  matches: Match[],
  /** 现在几点。测试要能定住它，不然「新不新鲜」没法测 */
  now: number = Date.now(),
): FeedItem[] {
  const out: FeedItem[] = []
  const nameOf = new Map(players.map((p) => [p.id, p.name]))
  const done = decidedMatches(matches)
  if (done.length === 0) return out

  const ended = sessions
    .filter((s) => s.status === 'ended')
    .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))
  const latest = ended[0]

  /*
   * 最近一局是不是还新鲜。不新鲜就一条都不播 —— 包括连胜和馆主那两类。
   *
   * 那两类是「状态」不是「事件」：只要数据在，它们永远成立，
   * 所以必须跟着这一道闸一起关，否则首页永远清不空。
   */
  const fresh =
    latest !== undefined && now - (latest.endedAt ?? latest.createdAt) <= FRESH_MS
  if (!fresh) return out

  /* ---- 谁升段了 ----------------------------------------------------
   * 拿「所有比赛」和「去掉最近一局的比赛」各算一次段位，比出差别。
   * MMR 是逐场重放算出来的，所以这是真的「那一局打完升的段」，
   * 不是拿总分估的。
   * ---------------------------------------------------------------- */
  if (latest) {
    const before = progressByPlayer(matches.filter((m) => m.sessionId !== latest.id))
    const after = progressByPlayer(matches)
    for (const [id, now] of after) {
      const was = before.get(id)
      const wasIndex = was?.level.index ?? 0
      if (now.level.index <= wasIndex) continue
      const name = nameOf.get(id)
      if (!name) continue
      out.push({
        id: `rankup-${id}-${now.level.index}`,
        icon: '⬆️',
        /*
          label 是个 [中文, English] 二元组，早先这里直接插进模板串，
          于是首页上写着「阿明 升到 卫士,Guardian Guardian 了」——
          数组被 JS 拿逗号拼了一遍，后面又跟着重复一次英文名。
          取 label[0] 就够：display 本身已经是英文段位名，
          而且冠绝那几级带着编号（Immortal 3），不能拿 tierName 替。
        */
        text: pick(
          `${name} 升到 ${now.level.tier.label[0]} ${now.level.display} 了`,
          `${name} climbed to ${now.level.display}`,
        ),
        weight: 1000 + now.level.index,
        link: { kind: 'player', playerId: id },
      })
    }
  }

  /* ---- 每个馆现在谁是第一 ---- */
  for (const v of venueSummaries(sessions, matches)) {
    if (v.matchCount < VENUE_MIN_MATCHES) continue
    const ids = playerIdsAtVenue(sessions, matches, v.key)
    const ranked = rankPlayers(computeStats(matchesAtVenue(sessions, matches, v.key), ids))
    const king = ranked[0]
    const name = king && nameOf.get(king.playerId)
    if (!name) continue
    out.push({
      id: `king-${v.key}`,
      icon: '👑',
      text: pick(
        `${v.label} 现在是 ${name} 的天下（${king.wins}胜${king.games - king.wins}负）`,
        `${name} rules ${v.label} (${king.wins}W ${king.games - king.wins}L)`,
      ),
      weight: 500 + Math.min(99, v.matchCount),
      link: { kind: 'leaderboard', venue: v.key },
    })
  }

  /* ---- 谁在连胜 ---- */
  for (const p of players) {
    if (p.archived) continue
    const n = currentStreak(p.id, done)
    if (n < STREAK_MIN) continue
    out.push({
      id: `streak-${p.id}-${n}`,
      icon: '🔥',
      text: pick(`${p.name} ${n} 连胜，还没人拦得住`, `${p.name} is on ${n} straight wins`),
      weight: 300 + n,
      link: { kind: 'player', playerId: p.id },
    })
  }

  /* ---- 新球馆 ----
   * 只在「这个馆的第一次球局就是最近这一局」时播报，
   * 否则每次回首页都在说同一个馆是新的。
   */
  if (latest) {
    const summaries = venueSummaries(sessions, matches)
    const v = summaries.find((x) => x.key === venueKeyOf(latest))
    if (v && v.sessionCount === 1) {
      out.push({
        id: `newvenue-${v.key}`,
        icon: '📍',
        text: pick(`新球馆：${v.label}，第一次在这里打球`, `New venue: ${v.label}, played here for the first time`),
        weight: 800,
        link: { kind: 'summary', sessionId: latest.id },
      })
    }
  }

  /* ---- 上一局打了多少 ---- */
  if (latest) {
    const n = done.filter((m) => m.sessionId === latest.id).length
    if (n > 0) {
      out.push({
        id: `last-${latest.id}`,
        icon: '🏸',
        text: pick(
      `上一局在${latest.venue || UNNAMED_VENUE()}打了 ${n} 场`,
      `${n} matches last time at ${latest.venue || UNNAMED_VENUE()}`,
    ),
        weight: 100,
        link: { kind: 'summary', sessionId: latest.id },
      })
    }
  }

  return out.sort((a, b) => b.weight - a.weight)
}

/** 这里只需要 key，单独包一层免得把 venues 的实现细节漏出去 */
function venueKeyOf(s: Session) {
  return (s.venue ?? '').replace(/\s+/g, '').toLowerCase()
}
