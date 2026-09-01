import { useEffect, useMemo, useState } from 'react'
import { rosterForSession, sessionMatches, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { matchWinnerBySets } from '@/lib/ranking'
import {
  Body,
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  TopBar,
  cx,
} from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import { activeGameIndex, gamesWon } from '@/lib/scoring'
import { duration } from '@/lib/format'
import { pairingNotes, pickNextMatch, playerLoads } from '@/lib/rotation'
import { progressByPlayer } from '@/lib/avatar'
import {
  buildSchedule,
  courtHolder,
  matchInput,
  queueOrder,
  sessionProgress,
  type SessionProgress,
} from '@/lib/sessionFormat'
import {
  FORMAT_LABELS,
  formatOf,
  pairingModeOf,
  PAIRING_MODE_HINTS,
  PAIRING_MODE_LABELS,
  type PairingMode,
  type Match,
  type MatchType,
  type Player,
  type Session,
} from '@/types'
import type { AvatarProfile } from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * 场地卡片
 * ------------------------------------------------------------------ */

function TeamLine({
  ids,
  names,
  avatars,
  tone,
  score,
  leading,
}: {
  ids: string[]
  names: Map<string, Player>
  avatars?: Map<string, AvatarProfile>
  tone: 'teamA' | 'teamB'
  score?: number
  leading?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cx(
          'h-8 w-1 shrink-0 rounded-full',
          tone === 'teamA' ? 'bg-team-a' : 'bg-team-b',
        )}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {ids.map((id) => (
          <span key={id} className="flex min-w-0 items-center gap-1.5">
            <Avatar
              name={names.get(id)?.name ?? '?'}
              avatar={avatars?.get(id)}
              size="sm"
            />
            <span className="truncate text-[15px]">{names.get(id)?.name ?? '?'}</span>
          </span>
        ))}
      </div>
      {score !== undefined && (
        <span
          className={cx(
            'tnum shrink-0 text-2xl font-bold',
            leading ? 'text-ink-900' : 'text-ink-500',
          )}
        >
          {score}
        </span>
      )}
    </div>
  )
}

/** 进度条：只显示设了的项，没设的不占地方 */
function ProgressStrip({ progress }: { progress: SessionProgress }) {
  const bars = [
    progress.scheduleTotal !== undefined && {
      label: '赛程',
      text: `第 ${progress.played} / ${progress.scheduleTotal} 场`,
      ratio: progress.scheduleTotal
        ? progress.played / progress.scheduleTotal
        : 0,
    },
    progress.totalTarget && {
      label: '场数',
      text: `${progress.played} / ${progress.totalTarget} 场`,
      ratio: progress.played / progress.totalTarget,
    },
    progress.durationTarget && {
      label: '时间',
      text: `${progress.elapsedMinutes} / ${progress.durationTarget} 分钟`,
      ratio: progress.elapsedMinutes / progress.durationTarget,
    },
    progress.perPlayerTarget && {
      label: '每人',
      text: `最少 ${progress.perPlayerMin} / ${progress.perPlayerTarget} 场`,
      ratio: progress.perPlayerMin / progress.perPlayerTarget,
    },
  ].filter(Boolean) as { label: string; text: string; ratio: number }[]

  if (bars.length === 0) return null

  return (
    <Card className="space-y-2.5">
      {bars.map((b) => (
        <div key={b.label}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-ink-500">{b.label}</span>
            <span className="tnum text-ink-700">{b.text}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-fill">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${Math.min(100, Math.max(0, b.ratio * 100))}%` }}
            />
          </div>
        </div>
      ))}
      {progress.estimatedMatchesLeft !== undefined && !progress.shouldWrapUp && (
        <p className="text-xs text-ink-500">
          按目前节奏，剩下的时间还够打{' '}
          <span className="font-semibold text-brand-600">
            {progress.estimatedMatchesLeft} 场
          </span>
        </p>
      )}
    </Card>
  )
}

/**
 * 打完的一场，带一个「退回」出口。
 *
 * 比分按局列出来，一眼能认出是不是记错的那一场 ——
 * 光看双方名字的话，同样四个人打过好几场，分不清要退哪一场。
 */
function FinishedRow({
  match,
  names,
  onReopen,
}: {
  match: Match
  names: Map<string, Player>
  onReopen: () => void
}) {
  const winner = matchWinnerBySets(match)
  const side = (ids: string[], team: 'A' | 'B') => (
    <span
      className={cx(
        'min-w-0 flex-1 truncate text-sm',
        winner === team ? 'font-semibold text-brand-600' : 'text-ink-700',
      )}
    >
      {ids.map((id) => names.get(id)?.name ?? '?').join(' / ')}
    </span>
  )
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="tnum shrink-0 text-xs text-ink-500">#{match.seq}</span>
        {side(match.teamA, 'A')}
        <span className="tnum shrink-0 text-sm text-ink-700">
          {match.games.map((g) => `${g.a}-${g.b}`).join(' ')}
        </span>
        {side(match.teamB, 'B')}
      </div>
      <button
        className="mt-1.5 text-xs text-brand-600"
        onClick={onReopen}
      >
        记错了，退回去改 ›
      </button>
    </div>
  )
}

/** 已打了多久。一分钟走一次就够，别为了秒针每秒重渲染整块看板 */
function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  return <>已打 {duration(Date.now() - since)}</>
}

function CourtCard({
  index,
  match,
  session,
  names,
  avatars,
  onScore,
  onArrange,
  onManage,
  arranging,
  holder,
}: {
  index: number
  match: Match | undefined
  session: Session
  names: Map<string, Player>
  avatars?: Map<string, AvatarProfile>
  onScore: () => void
  onArrange: () => void
  onManage: () => void
  arranging: boolean
  holder?: { ids: string[]; streak: number } | null
}) {
  if (!match) {
    /* 空场是这一屏上最要紧的一件事，按钮就该是大号的 */
    return (
      <Card className="border-dashed">
        <p className="text-ink-700 text-title">{index + 1} 号场</p>
        <p className="text-ink-500 mt-0.5 text-label">空着，等下一场</p>
        <Button
          variant="primary"
          size="lg"
          block
          className="mt-3"
          onClick={onArrange}
          disabled={arranging}
        >
          安排下一场
        </Button>
      </Card>
    )
  }

  const gi = activeGameIndex(match, session.rules)
  const g = match.games[gi]
  const sets = gamesWon(match.games, session.rules)

  return (
    <Card>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-brand-600 flex items-baseline gap-2 text-title">
          {index + 1} 号场
          {/* 已打时长：场地按小时算钱，「这场打多久了」是每晚都要问的 */}
          {match.startedAt && (
            <span className="tnum text-ink-500 text-caption font-normal">
              <Elapsed since={match.startedAt} />
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {holder && holder.streak > 0 && (
            <Pill tone="brand">守场 {holder.streak} 连胜</Pill>
          )}
          {session.rules.bestOf === 3 && (
            <Pill>
              第 {gi + 1} 局 · {sets.A}:{sets.B}
            </Pill>
          )}
          <Pill tone="brand">进行中</Pill>
          <button
            onClick={onManage}
            aria-label="调整这一场"
            className="-mr-1 flex size-8 items-center justify-center rounded-lg text-ink-500 active:bg-fill"
          >
            ⋯
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <TeamLine
          ids={match.teamA}
          names={names}
          avatars={avatars}
          tone="teamA"
          score={g?.a ?? 0}
          leading={(g?.a ?? 0) >= (g?.b ?? 0)}
        />
        <TeamLine
          ids={match.teamB}
          names={names}
          avatars={avatars}
          tone="teamB"
          score={g?.b ?? 0}
          leading={(g?.b ?? 0) >= (g?.a ?? 0)}
        />
      </div>

      <Button variant="primary" block className="mt-3" onClick={onScore}>
        记分
      </Button>
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 * 主屏
 * ------------------------------------------------------------------ */

export function SessionBoard({ sessionId }: { sessionId: string }) {
  const session = useApp((s) => s.sessions.find((x) => x.id === sessionId))
  const allMatches = useApp((s) => s.matches)
  const players = useApp((s) => s.players)
  const avatars = useApp((s) => s.avatars)
  const addMatch = useApp((s) => s.addMatch)
  const addMatches = useApp((s) => s.addMatches)
  const updateMatch = useApp((s) => s.updateMatch)
  const deleteMatch = useApp((s) => s.deleteMatch)
  const updateSession = useApp((s) => s.updateSession)
  const endSession = useApp((s) => s.endSession)

  const push = useNav((s) => s.push)
  const resetTo = useNav((s) => s.resetTo)
  const replace = useNav((s) => s.replace)

  /**
   * 配对时的实力平衡看 MMR，而且要用「所有球局」的战绩算 ——
   * MMR 是跨球局的整体水平，只看今晚这一场配不准。
   */
  /** 头像用角色，没建角色的人自动退回名字色块 */
  const avatarsById = useMemo(
    () => new Map(avatars.map((a) => [a.playerId, a])),
    [avatars],
  )

  const mmrById = useMemo(() => {
    const map = new Map<string, number>()
    for (const [id, prog] of progressByPlayer(allMatches)) map.set(id, prog.mmr)
    return map
  }, [allMatches])

  // 配对模式跟着球局走，打到一半也能换 —— 后面排的场立刻按新口径来
  const pairingMode = session ? pairingModeOf(session) : 'balanced'

  const [nextType, setNextType] = useState<MatchType | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [endOpen, setEndOpen] = useState(false)
  const [managing, setManaging] = useState<Match | null>(null)
  const [swapping, setSwapping] = useState<{ match: Match; playerId: string } | null>(null)
  const [pickingRest, setPickingRest] = useState<Player | null>(null)
  const [mustInclude, setMustInclude] = useState<string[]>([])
  const [showAllSchedule, setShowAllSchedule] = useState(false)
  const [showAllFinished, setShowAllFinished] = useState(false)
  const [adding, setAdding] = useState(false)
  const [pairOpen, setPairOpen] = useState(false)

  // 名册要带上友谊赛的客队 —— 他们不在正式球员名单里，但看板得叫得出名字
  const names = useMemo(
    () => rosterForSession(players, session),
    [players, session],
  )
  const matches = useMemo(
    () => (session ? sessionMatches(allMatches, session.id) : []),
    [allMatches, session],
  )

  // 设了时长上限时进度条要自己走，每 30 秒重算一次就够了
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!session?.endCondition?.durationMinutes) return
    if (session.status !== 'active') return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [session?.endCondition?.durationMinutes, session?.status])

  if (!session) {
    return (
      <Screen>
        <TopBar title="球局不存在" onBack={() => resetTo({ name: 'home' })} />
        <Body>
          <EmptyState title="这个球局已经被删掉了" />
        </Body>
      </Screen>
    )
  }

  const type = nextType ?? session.defaultType
  const restingIds = session.restingIds ?? []
  /*
   * 友谊赛的出场人 = 主队（正式球员）+ 客队（只属于这场的客人）。
   * 客队不在 session.playerIds 里，所以要单独接上去，否则自动排场找不到人。
   */
  const guests = session.friendly?.awayPlayers ?? []
  const attending = [
    ...session.playerIds
      .map((id) => names.get(id))
      .filter((p): p is Player => Boolean(p)),
    ...guests
      .map((g) => names.get(g.id))
      .filter((p): p is Player => Boolean(p)),
  ]

  /** 友谊赛：谁是主队谁是客队，交给配对算法当硬约束 */
  const clubOf = session.friendly
    ? new Map<string, 'home' | 'away'>([
        ...session.playerIds.map((id) => [id, 'home'] as const),
        ...guests.map((g) => [g.id, 'away'] as const),
      ])
    : undefined

  const live = matches.filter((m) => m.status === 'playing')
  const queued = matches.filter((m) => m.status === 'queued')
  const finished = matches.filter((m) => m.status === 'done')

  const busyIds = [...live, ...queued].flatMap((m) => [...m.teamA, ...m.teamB])
  const onCourt = new Map(live.map((m) => [m.courtIndex, m]))

  const format = formatOf(session)

  /** 友谊赛实时比分：teamA 一定是主队，配对时就这么约束的 */
  const clubScore = finished.reduce(
    (acc, m) => {
      const w = matchWinnerBySets(m)
      if (w === 'A') acc.home += 1
      else if (w === 'B') acc.away += 1
      return acc
    },
    { home: 0, away: 0 },
  )
  const progress = sessionProgress(session, matches, now)

  const loads = playerLoads(attending, matches)
  const loadById = new Map(loads.map((l) => [l.playerId, l]))

  /** 这一场凭什么是这四个人 */
  const notesFor = (m: Match) =>
    pairingNotes(
      m.teamA,
      m.teamB,
      (id) => mmrById.get(id) ?? 0,
      loadById,
      (id) => names.get(id)?.name ?? '?',
    )

  // 车轮赛的等待区就是排队顺序（最久没上场的在前），不是按已打场数排
  const waiting =
    format === 'king'
      ? queueOrder(attending, matches, {
          excludeIds: restingIds,
          busyIds,
        })
          .map((id) => loadById.get(id))
          .filter((l): l is NonNullable<typeof l> => Boolean(l))
      : loads.filter(
          (l) =>
            !busyIds.includes(l.playerId) && !restingIds.includes(l.playerId),
        )

  /*
   * 场上/已排队的人，按已打场数排在等待区后面。
   *
   * 原来这一栏只列没在场上的人，于是「谁被晾着」根本看不出来 ——
   * 想确认某个人是不是一直没轮到，只能自己数。
   * 全部列出来之后，最上面就是最该上的，最下面就是打得最多的，
   * 一眼能看出公不公平；觉得不对就点谁「下一场必上」。
   */
  const onCourtLoads = loads.filter(
    (l) => busyIds.includes(l.playerId) && !restingIds.includes(l.playerId),
  )

  function buildMatch(
    pairing: { teamA: string[]; teamB: string[]; type: MatchType },
    courtIndex: number | null,
  ) {
    // 谁先发球现场猜边决定，这里随机一次
    const servingTeam = Math.random() < 0.5 ? 'A' : 'B'
    return addMatch({
      sessionId: session!.id,
      courtIndex,
      type: pairing.type,
      teamA: pairing.teamA,
      teamB: pairing.teamB,
      // 标在比赛上，统计那边一处就能过滤掉，不会漏
      friendly: session!.friendly ? true : undefined,
      games: [
        {
          a: 0,
          b: 0,
          points: [],
          serveInit: {
            servingTeam,
            rightA: pairing.teamA[0],
            rightB: pairing.teamB[0],
          },
        },
      ],
      status: courtIndex === null ? 'queued' : 'playing',
      startedAt: courtIndex === null ? undefined : Date.now(),
    })
  }

  /**
   * 排下一场。
   *
   * 这里必须从 store 现取状态，不能用渲染闭包里的 matches：
   * 连点两下（或先点 1 号场再点 2 号场）时组件还没重渲染，
   * 用旧的 busyIds 会把同一个人同时排进两片场。
   */
  function arrange(target: number | 'auto' | 'queue') {
    setNotice(null)
    const fresh = sessionMatches(useApp.getState().matches, session!.id)
    const liveNow = fresh.filter((m) => m.status === 'playing')
    const queuedNow = fresh.filter((m) => m.status === 'queued')
    const occupied = new Set(liveNow.map((m) => m.courtIndex))

    let courtIndex: number | null
    if (target === 'queue') {
      courtIndex = null
    } else if (target === 'auto') {
      courtIndex = courts.find((i) => !occupied.has(i)) ?? null
    } else {
      if (occupied.has(target)) return // 这片场刚被上一次点击占掉了
      courtIndex = target
    }

    // 已经预排好的就直接上场，不用再算
    if (courtIndex !== null && queuedNow.length > 0) {
      updateMatch(queuedNow[0].id, {
        courtIndex,
        status: 'playing',
        startedAt: Date.now(),
      })
      return
    }

    const busyNow = [...liveNow, ...queuedNow].flatMap((m) => [
      ...m.teamA,
      ...m.teamB,
    ])

    // 车轮赛的公平性完全由队列决定，不能用平衡算法配对，
    // 否则会越过等最久的人。空场时就按队头顺序直接组队。
    if (format === 'king') {
      const teamSize = type === 'singles' ? 1 : 2
      const queue = queueOrder(attending, fresh, {
        excludeIds: restingIds,
        busyIds: busyNow,
      })
      if (queue.length < teamSize * 2) {
        setNotice(`排队区只有 ${queue.length} 人，还开不了一场`)
        return
      }
      buildMatch(
        {
          teamA: queue.slice(0, teamSize),
          teamB: queue.slice(teamSize, teamSize * 2),
          type,
        },
        courtIndex,
      )
      return
    }

    const { pairing, reason } = pickNextMatch({
      attending,
      matches: fresh,
      busyIds: busyNow,
      excludeIds: restingIds,
      mustInclude,
      type,
      mmrById,
      pairingMode,
      clubOf,
    })
    if (!pairing) {
      setNotice(reason ?? '排不出下一场')
      return
    }
    buildMatch(pairing, courtIndex)
    setMustInclude([])
  }

  function reshuffle(match: Match) {
    // 把这一场先摘出去再重算，否则算法会把当前这四个人也算进历史
    const others = sessionMatches(useApp.getState().matches, session!.id).filter(
      (m) => m.id !== match.id,
    )
    const otherBusy = others
      .filter((m) => m.status !== 'done')
      .flatMap((m) => [...m.teamA, ...m.teamB])
    const { pairing, reason } = pickNextMatch({
      attending,
      matches: others,
      busyIds: otherBusy,
      excludeIds: restingIds,
      type: match.type,
      mmrById,
      pairingMode,
      clubOf,
    })
    if (!pairing) {
      setNotice(reason ?? '重排失败')
      return
    }
    updateMatch(match.id, {
      teamA: pairing.teamA,
      teamB: pairing.teamB,
      games: [
        {
          a: 0,
          b: 0,
          points: [],
          serveInit: {
            servingTeam: Math.random() < 0.5 ? 'A' : 'B',
            rightA: pairing.teamA[0],
            rightB: pairing.teamB[0],
          },
        },
      ],
    })
    setManaging(null)
  }

  function swapPlayer(match: Match, outId: string, inId: string) {
    const swap = (team: string[]) => team.map((id) => (id === outId ? inId : id))
    const teamA = swap(match.teamA)
    const teamB = swap(match.teamB)
    updateMatch(match.id, {
      teamA,
      teamB,
      games: [
        {
          a: 0,
          b: 0,
          points: [],
          serveInit: {
            servingTeam: match.games[0]?.serveInit?.servingTeam ?? 'A',
            rightA: teamA[0],
            rightB: teamB[0],
          },
        },
      ],
    })
    setSwapping(null)
    setManaging(null)
  }

  /**
   * 把打完的一场退回场上。
   *
   * 按错「结束」是最常发生的事 —— 尤其是没人盯着手机、事后补分的那几场。
   * 退回之后这一场立刻从 MMR、金币和排行榜里消失（那些都是从
   * status === 'done' 的比赛实时算的），改完分再结束一次就对了。
   *
   * 得先找一片空场：直接退回去的话，同一片场上会同时挂着两场，
   * 界面按 courtIndex 取，后面那场会被前面那场盖掉、点不开。
   */
  const reopenMatch = (match: Match) => {
    const free = courts.find((i) => !onCourt.has(i))
    if (free === undefined) {
      setNotice('场上都满了，先把某一场打完或取消，再退回这一场')
      return
    }
    updateMatch(match.id, {
      status: 'playing',
      endedAt: undefined,
      courtIndex: free,
    })
    push({ name: 'score', matchId: match.id })
  }

  /**
   * 中途加人。迟到的人开局时不用先勾上，来了再加。
   * 已打场数从 0 算起，公平轮转会优先把他排上去 —— 这正是我们要的。
   */
  const addToSession = (playerId: string) => {
    const current =
      useApp.getState().sessions.find((x) => x.id === sessionId)?.playerIds ?? []
    if (current.includes(playerId)) return
    updateSession(sessionId, { playerIds: [...current, playerId] })
    setAdding(false)
  }

  const toggleResting = (playerId: string) => {
    // 同样从 store 现取，连续标记几个人休息时不会互相覆盖
    const current =
      useApp.getState().sessions.find((x) => x.id === sessionId)?.restingIds ?? []
    updateSession(sessionId, {
      restingIds: current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId],
    })
    setPickingRest(null)
  }

  const toggleMustInclude = (playerId: string) => {
    setMustInclude((s) =>
      s.includes(playerId) ? s.filter((x) => x !== playerId) : [...s, playerId],
    )
    setPickingRest(null)
  }

  /** 参与自动排场的人：出席且没在休息 */
  const schedulable = attending.filter((p) => !restingIds.includes(p.id))

  /** 还能加进来的人：没归档、还不在这一局里 */
  const attendingIds = new Set(attending.map((p) => p.id))
  const addable = players.filter((p) => !p.archived && !attendingIds.has(p.id))

  /**
   * 有人提前走、有人晚到之后重排剩余赛程。
   * 只删还没打的，已经打完的一场都不动，并且把已打记录喂回算法，
   * 免得重新生成后又撞回刚打过的搭档。
   */
  function regenerateSchedule() {
    const fresh = sessionMatches(useApp.getState().matches, session!.id)
    const done = fresh.filter((m) => m.status === 'done')
    fresh.filter((m) => m.status === 'queued').forEach((m) => deleteMatch(m.id))

    const target = session!.rotationPerPlayer ?? 6
    const playedCounts = schedulable.map(
      (p) =>
        done.filter((m) => m.teamA.includes(p.id) || m.teamB.includes(p.id))
          .length,
    )
    const minPlayed = playedCounts.length ? Math.min(...playedCounts) : 0
    const left = Math.max(1, target - minPlayed)

    const schedule = buildSchedule({
      attending: schedulable,
      courtCount: session!.courtCount,
      type: session!.defaultType,
      perPlayer: left,
      history: done,
      mmrById,
      pairingMode,
      clubOf,
    })
    if (!schedule.pairings.length) {
      setNotice(schedule.reason ?? '排不出剩余赛程')
      return
    }
    addMatches(schedule.pairings.map((p) => matchInput(p, session!.id, null)))
    setNotice(`已按现在的 ${schedulable.length} 人重排了 ${schedule.pairings.length} 场`)
  }

  /** 轮转赛：在赛程后面再接几场 */
  function appendSchedule(count: number) {
    const fresh = sessionMatches(useApp.getState().matches, session!.id)
    const schedule = buildSchedule({
      attending: schedulable,
      courtCount: session!.courtCount,
      type: session!.defaultType,
      perPlayer: 1,
      total: count,
      history: fresh,
      mmrById,
      pairingMode,
      clubOf,
    })
    if (!schedule.pairings.length) {
      setNotice(schedule.reason ?? '排不出更多场次')
      return
    }
    addMatches(schedule.pairings.map((p) => matchInput(p, session!.id, null)))
  }

  /** 自由模式 / 车轮赛：把上限往后推 */
  function extendLimit() {
    const fresh = useApp.getState().sessions.find((x) => x.id === sessionId)
    if (!fresh) return
    const end = { ...(fresh.endCondition ?? {}) }
    if (end.totalMatches) end.totalMatches += 5
    if (end.durationMinutes) end.durationMinutes += 30
    updateSession(sessionId, { endCondition: end })
  }

  const courts = Array.from({ length: session.courtCount }, (_, i) => i)

  return (
    <Screen>
      <TopBar
        title={session.venue || '球局'}
        subtitle={`${FORMAT_LABELS[format]} · ${session.rules.pointsToWin} 分制 · ${attending.length} 人 · 已打 ${finished.length} 场`}
        onBack={() => resetTo({ name: 'home' })}
        right={
          <Button size="sm" variant="ghost" onClick={() => setEndOpen(true)}>
            结束
          </Button>
        }
      />

      <Body className="pb-32">
        {progress.shouldWrapUp && (
          <div className="rounded-card border border-brand-500 bg-brand-100 px-4 py-3.5">
            <p className="font-semibold text-brand-600">{progress.wrapUpReason}</p>
            {progress.unmetFloor && (
              <p className="mt-1 text-sm text-warning-600">{progress.unmetFloor}</p>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                onClick={() => setEndOpen(true)}
              >
                去结算
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1"
                onClick={() => (format === 'rotation' ? appendSchedule(4) : extendLimit())}
              >
                {format === 'rotation' ? '再排 4 场' : '再加一点'}
              </Button>
            </div>
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-warning-600/30 bg-warning-50 px-3.5 py-2.5 text-sm text-warning-600">
            {notice}
          </div>
        )}

        {/* 友谊赛的实时总比分：打的时候两边最想知道的就是现在几比几 */}
        {session.friendly && (
          <div className="flex items-center justify-center gap-4 rounded-xl border border-line bg-surface px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-right text-sm text-ink-700">
              {session.friendly.homeName}
            </span>
            <span className="tnum shrink-0 text-2xl font-bold">
              <span className={clubScore.home >= clubScore.away ? 'text-brand-600' : ''}>
                {clubScore.home}
              </span>
              <span className="mx-1.5 text-ink-500">:</span>
              <span className={clubScore.away >= clubScore.home ? 'text-brand-600' : ''}>
                {clubScore.away}
              </span>
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-700">
              {session.friendly.awayName}
            </span>
          </div>
        )}

        <ProgressStrip progress={progress} />

        <div className="space-y-3">
          {courts.map((i) => (
            <CourtCard
              key={i}
              index={i}
              match={onCourt.get(i)}
              session={session}
              names={names}
              avatars={avatarsById}
              holder={format === 'king' ? courtHolder(matches, i) : null}
              arranging={waiting.length < (type === 'singles' ? 2 : 4) && queued.length === 0}
              onScore={() => push({ name: 'score', matchId: onCourt.get(i)!.id })}
              onArrange={() => arrange(i)}
              onManage={() => setManaging(onCourt.get(i)!)}
            />
          ))}
        </div>

        <SectionTitle
          right={
            format === 'rotation' ? (
              <button className="text-xs text-brand-600" onClick={regenerateSchedule}>
                按现在的人重排
              </button>
            ) : format === 'king' ? null : (
              <button
                className="text-xs text-brand-600 disabled:text-ink-500"
                onClick={() => arrange('queue')}
              >
                + 预排一场
              </button>
            )
          }
        >
          {format === 'rotation'
            ? `赛程（还剩 ${queued.length} 场）`
            : '排队中'}
        </SectionTitle>

        {queued.length === 0 ? (
          <p className="text-sm text-ink-500">
            {format === 'rotation'
              ? '赛程都打完了。可以「再排 4 场」加时，或者去结算。'
              : format === 'king'
                ? '下一场由这一场谁赢决定，打完记分自动排上，不用预排。'
                : '没有预排的比赛。场地空出来时点「排下一场」即可，也可以先预排让大家知道下一场是谁。'}
          </p>
        ) : (
          <div className="space-y-2">
            {(format === 'rotation' && !showAllSchedule
              ? queued.slice(0, 3)
              : queued
            ).map((m, idx) => (
              <Card key={m.id}>
                <div className="mb-2 flex items-center justify-between">
                  <Pill>下一场 {idx + 1}</Pill>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => reshuffle(m)}>
                      重排
                    </Button>
                    {/* 轮转赛删掉单场会打乱整份赛程，改用「按现在的人重排」 */}
                    {format !== 'rotation' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => deleteMatch(m.id)}
                      >
                        取消
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <TeamLine ids={m.teamA} names={names} tone="teamA" />
                  <TeamLine ids={m.teamB} names={names} tone="teamB" />
                </div>
                {/*
                  凭什么是这四个人。规格 §D 要求配对结果可解释 ——
                  写不出理由的自动配对，人只会绕过它自己点。
                */}
                <p className="text-ink-500 mt-2 text-caption">
                  {notesFor(m).join(' · ')}
                </p>
              </Card>
            ))}
            {format === 'rotation' && queued.length > 3 && (
              <button
                onClick={() => setShowAllSchedule((v) => !v)}
                className="w-full py-2 text-center text-sm text-brand-600"
              >
                {showAllSchedule
                  ? '收起'
                  : `查看全部赛程（还剩 ${queued.length} 场）`}
              </button>
            )}
          </div>
        )}

        {/*
          规格 §D：配对设置收进底部 Sheet，不再占着主页面一整块。
          但入口留在等待区上面 —— 这里正是「下一场谁跟谁」发生的地方，
          觉得排得不对的人第一眼就该看得见它。
        */}
        <SectionTitle
          right={
            <div className="flex items-center gap-3">
              <button className="text-brand-600 text-caption" onClick={() => setPairOpen(true)}>
                配对设置
              </button>
              <button className="text-brand-600 text-caption" onClick={() => setAdding(true)}>
                + 加人
              </button>
            </div>
          }
        >
          {format === 'king'
            ? `排队顺序（${waiting.length} 人）`
            : `谁该上场（等待 ${waiting.length} 人）`}
        </SectionTitle>

        {format === 'king' && (
          <p className="text-sm text-ink-500">
            队头两人下一场上。赢的留场
            {(session.kingStreakCap ?? 0) > 0
              ? `，连赢 ${session.kingStreakCap} 场强制下场休息`
              : '，赢到底'}
            。
          </p>
        )}

        {format !== 'rotation' && (
          <div>
            <p className="mb-1.5 text-xs text-ink-500">下一场排什么</p>
            <Segmented
              value={type}
              onChange={(v) => setNextType(v)}
              options={[
                { value: 'doubles', label: '双打' },
                { value: 'singles', label: '单打' },
                { value: 'mixed', label: '混双' },
              ]}
            />
          </div>
        )}

        <div className="space-y-2">
          {waiting.map((l, idx) => {
            const p = names.get(l.playerId)!
            const must = mustInclude.includes(l.playerId)
            return (
              <button
                key={l.playerId}
                onClick={() => setPickingRest(p)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
                  must
                    ? 'border-brand-500 bg-brand-100'
                    : 'border-line bg-surface active:bg-fill',
                )}
              >
                <span className="tnum w-5 shrink-0 text-center text-sm text-ink-500">
                  {idx + 1}
                </span>
                <Avatar name={p.name} avatar={avatarsById.get(p.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-xs text-ink-500">
                    已打 {l.games} 场
                    {l.restRounds > 0 && ` · 休息 ${l.restRounds} 轮`}
                  </span>
                </span>
                {must && <Pill tone="brand">下一场必上</Pill>}
              </button>
            )
          })}

          {/* 场上的人也列出来，才看得出「谁一直在打、谁一直没轮到」 */}
          {onCourtLoads.map((l) => {
            const p = names.get(l.playerId)
            if (!p) return null
            return (
              <div
                key={l.playerId}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-fill/60 px-3 py-2.5 opacity-60"
              >
                <span className="w-5 shrink-0" />
                <Avatar name={p.name} avatar={avatarsById.get(p.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-xs text-ink-500">已打 {l.games} 场</span>
                </span>
                <Pill>场上</Pill>
              </div>
            )
          })}

          {restingIds.length > 0 && (
            <div className="pt-1">
              <p className="mb-2 text-xs text-ink-500">休息中（不参与排场）</p>
              <div className="flex flex-wrap gap-2">
                {restingIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => toggleResting(id)}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-700"
                  >
                    <Avatar
                    name={names.get(id)?.name ?? '?'}
                    avatar={avatarsById.get(id)}
                    size="sm"
                  />
                    {names.get(id)?.name}
                    <span className="text-ink-500">↩</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {waiting.length === 0 && onCourtLoads.length === 0 && restingIds.length === 0 && (
            <p className="text-sm text-ink-500">这一局还没有人。</p>
          )}
        </div>

        {/*
          打完的场次。
          原来这里什么都不显示，比分一旦按了结束就再也回不去 ——
          而按错「结束」是最常发生的事，尤其是没人盯着手机的那几场。
        */}
        {finished.length > 0 && (
          <>
            <SectionTitle>已打完（{finished.length} 场）</SectionTitle>
            <div className="space-y-2">
              {[...finished]
                .sort((a, b) => b.seq - a.seq)
                .slice(0, showAllFinished ? undefined : 3)
                .map((m) => (
                  <FinishedRow
                    key={m.id}
                    match={m}
                    names={names}
                    onReopen={() => reopenMatch(m)}
                  />
                ))}
              {finished.length > 3 && (
                <button
                  className="w-full py-1 text-xs text-brand-600"
                  onClick={() => setShowAllFinished((v) => !v)}
                >
                  {showAllFinished ? '收起' : `展开全部 ${finished.length} 场`}
                </button>
              )}
            </div>
          </>
        )}
      </Body>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => push({ name: 'leaderboard', sessionId: session.id })}
          >
            今晚排名
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => arrange('auto')}
          >
            {courts.some((i) => !onCourt.has(i)) ? '排下一场' : '预排下一场'}
          </Button>
        </div>
      </div>

      {/* 调整某一场 */}
      <Sheet
        open={Boolean(managing)}
        onClose={() => setManaging(null)}
        title="调整这一场"
      >
        {managing && (
          <div className="space-y-3">
            <p className="text-sm text-ink-700">
              点某个球员可以换人，换人或重排都会把比分清零。
              打得最多的那个标出来了，换他下去最公平。
            </p>
            <div className="space-y-2">
              {(() => {
                const ids = [...managing.teamA, ...managing.teamB]
                // 场上打得最多的那个：手动换人时最该被换下去的
                const most = Math.max(
                  ...ids.map((id) => loadById.get(id)?.games ?? 0),
                )
                return ids.map((id) => {
                  const games = loadById.get(id)?.games ?? 0
                  return (
                    <button
                      key={id}
                      onClick={() => setSwapping({ match: managing, playerId: id })}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:bg-fill',
                        games === most && most > 0
                          ? 'border-warning-600/40 bg-warning-50'
                          : 'border-line bg-surface',
                      )}
                    >
                      <Avatar
                        name={names.get(id)?.name ?? '?'}
                        avatar={avatarsById.get(id)}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{names.get(id)?.name}</span>
                        <span className="text-xs text-ink-500">已打 {games} 场</span>
                      </span>
                      {games === most && most > 0 && (
                        <span className="shrink-0 text-xs text-warning-600">打得最多</span>
                      )}
                      <span className="shrink-0 text-xs text-ink-500">换人 ›</span>
                    </button>
                  )
                })
              })()}
            </div>
            <Button block variant="ghost" onClick={() => reshuffle(managing)}>
              整场重排
            </Button>
            <Button
              block
              variant="danger"
              onClick={() => {
                deleteMatch(managing.id)
                setManaging(null)
              }}
            >
              取消这一场
            </Button>
          </div>
        )}
      </Sheet>

      {/* 中途加人 */}
      <Sheet open={pairOpen} onClose={() => setPairOpen(false)} title="怎么配对">
        <Segmented
          value={pairingMode}
          onChange={(m: PairingMode) => updateSession(sessionId, { pairingMode: m })}
          options={(Object.keys(PAIRING_MODE_LABELS) as PairingMode[]).map((m) => ({
            value: m,
            label: PAIRING_MODE_LABELS[m],
          }))}
        />
        <p className="text-ink-500 mt-2 text-label">
          {PAIRING_MODE_HINTS[pairingMode]}。已排好的场不动，之后排的按新口径来。
        </p>
        <Button block variant="soft" className="mt-4" onClick={() => setPairOpen(false)}>
          知道了
        </Button>
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="加人进这一局">
        <div className="space-y-2">
          {addable.length === 0 ? (
            <p className="text-sm text-ink-500">
              所有球员都已经在这一局里了。新面孔要先去「球员」里建一个。
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-700">
                迟到的人来了就加进来，已打场数从 0 算起，下一场会优先排到他。
              </p>
              {addable.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToSession(p.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left active:bg-fill"
                >
                  <Avatar name={p.name} avatar={avatarsById.get(p.id)} size="sm" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-brand-600">加进来 ›</span>
                </button>
              ))}
            </>
          )}
        </div>
      </Sheet>

      {/* 换人：从等待区挑一个 */}
      <Sheet open={Boolean(swapping)} onClose={() => setSwapping(null)} title="换成谁">
        {swapping && (
          <div className="space-y-2">
            {waiting.length === 0 ? (
              <p className="text-sm text-ink-500">等待区没人了。</p>
            ) : (
              <>
                {/*
                  手动换人不走公平轮转 —— 自动排场那条硬约束（场数最少的必须上）
                  在这里一点都不管用，全凭你点谁。所以把「该轮到谁」直接标出来，
                  不然谁被晾着只能自己数。列表本来就按该上场的顺序排。
                */}
                <p className="text-sm text-ink-700">
                  按「该轮到谁」排的，最上面的等最久、打得最少。
                </p>
                {waiting.map((l) => (
                  <button
                    key={l.playerId}
                    onClick={() => swapPlayer(swapping.match, swapping.playerId, l.playerId)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:bg-fill',
                      l.games === waiting[0].games
                        ? 'border-brand-500 bg-brand-100'
                        : 'border-line bg-surface',
                    )}
                  >
                    <Avatar
                      name={names.get(l.playerId)?.name ?? '?'}
                      avatar={avatarsById.get(l.playerId)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{names.get(l.playerId)?.name}</span>
                      <span className="text-xs text-ink-500">
                        已打 {l.games} 场
                        {l.restRounds > 0 && ` · 休息 ${l.restRounds} 轮`}
                      </span>
                    </span>
                    {l.games === waiting[0].games && <Pill tone="brand">该轮到</Pill>}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </Sheet>

      {/* 等待区球员操作 */}
      <Sheet
        open={Boolean(pickingRest)}
        onClose={() => setPickingRest(null)}
        title={pickingRest?.name ?? ''}
      >
        {pickingRest && (
          <div className="space-y-2">
            <Button
              block
              variant={mustInclude.includes(pickingRest.id) ? 'primary' : 'ghost'}
              onClick={() => toggleMustInclude(pickingRest.id)}
            >
              {mustInclude.includes(pickingRest.id)
                ? '取消「下一场必上」'
                : '下一场必上'}
            </Button>
            <Button block variant="ghost" onClick={() => toggleResting(pickingRest.id)}>
              先休息，不参与排场
            </Button>
            <Button
              block
              variant="ghost"
              onClick={() => {
                const id = pickingRest.id
                setPickingRest(null)
                push({ name: 'profile', playerId: id })
              }}
            >
              看他的战绩
            </Button>
          </div>
        )}
      </Sheet>

      {/* 结束球局 */}
      <Sheet open={endOpen} onClose={() => setEndOpen(false)} title="结束今晚球局">
        <p className="text-sm text-ink-700">
          结束后会算出今晚排名、MVP 和 AA 费用。
          {live.length > 0 && (
            <span className="mt-2 block text-warning-600">
              还有 {live.length} 场在打，结束后这些比分不会计入排名。
            </span>
          )}
        </p>
        <div className="mt-4 space-y-2">
          <Button
            block
            variant="primary"
            onClick={() => {
              endSession(session.id)
              setEndOpen(false)
              replace({ name: 'summary', sessionId: session.id })
            }}
          >
            结束并结算
          </Button>
          <Button block variant="ghost" onClick={() => setEndOpen(false)}>
            继续打
          </Button>
        </div>
      </Sheet>
    </Screen>
  )
}
