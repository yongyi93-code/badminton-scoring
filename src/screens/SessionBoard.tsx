import { useEffect, useMemo, useState } from 'react'
import { playerMap, sessionMatches, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
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
import { pickNextMatch, playerLoads } from '@/lib/rotation'
import {
  buildSchedule,
  courtHolder,
  matchInput,
  queueOrder,
  sessionProgress,
  type SessionProgress,
} from '@/lib/sessionFormat'
import { formatDate } from '@/lib/format'
import {
  FORMAT_LABELS,
  formatOf,
  type Match,
  type MatchType,
  type Player,
  type Session,
} from '@/types'

/* ------------------------------------------------------------------ *
 * 场地卡片
 * ------------------------------------------------------------------ */

function TeamLine({
  ids,
  names,
  tone,
  score,
  leading,
}: {
  ids: string[]
  names: Map<string, Player>
  tone: 'teamA' | 'teamB'
  score?: number
  leading?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cx(
          'h-8 w-1 shrink-0 rounded-full',
          tone === 'teamA' ? 'bg-teamA' : 'bg-teamB',
        )}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {ids.map((id) => (
          <span key={id} className="flex min-w-0 items-center gap-1.5">
            <Avatar name={names.get(id)?.name ?? '?'} size="sm" />
            <span className="truncate text-[15px]">{names.get(id)?.name ?? '?'}</span>
          </span>
        ))}
      </div>
      {score !== undefined && (
        <span
          className={cx(
            'tnum shrink-0 text-2xl font-bold',
            leading ? 'text-ink-100' : 'text-ink-400',
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
            <span className="text-ink-400">{b.label}</span>
            <span className="tnum text-ink-300">{b.text}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full bg-lime-glow transition-[width]"
              style={{ width: `${Math.min(100, Math.max(0, b.ratio * 100))}%` }}
            />
          </div>
        </div>
      ))}
      {progress.estimatedMatchesLeft !== undefined && !progress.shouldWrapUp && (
        <p className="text-xs text-ink-400">
          按目前节奏，剩下的时间还够打{' '}
          <span className="font-semibold text-lime-glow">
            {progress.estimatedMatchesLeft} 场
          </span>
        </p>
      )}
    </Card>
  )
}

function CourtCard({
  index,
  match,
  session,
  names,
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
  onScore: () => void
  onArrange: () => void
  onManage: () => void
  arranging: boolean
  holder?: { ids: string[]; streak: number } | null
}) {
  if (!match) {
    return (
      <Card className="border-dashed">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-300">{index + 1} 号场</p>
            <p className="text-xs text-ink-400">空场</p>
          </div>
          <Button variant="primary" onClick={onArrange} disabled={arranging}>
            排下一场
          </Button>
        </div>
      </Card>
    )
  }

  const gi = activeGameIndex(match, session.rules)
  const g = match.games[gi]
  const sets = gamesWon(match.games, session.rules)

  return (
    <Card>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold text-lime-glow">{index + 1} 号场</span>
        <div className="flex items-center gap-2">
          {holder && holder.streak > 0 && (
            <Pill tone="lime">守场 {holder.streak} 连胜</Pill>
          )}
          {session.rules.bestOf === 3 && (
            <Pill>
              第 {gi + 1} 局 · {sets.A}:{sets.B}
            </Pill>
          )}
          <Pill tone="lime">进行中</Pill>
          <button
            onClick={onManage}
            aria-label="调整这一场"
            className="-mr-1 flex size-8 items-center justify-center rounded-lg text-ink-400 active:bg-ink-800"
          >
            ⋯
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <TeamLine
          ids={match.teamA}
          names={names}
          tone="teamA"
          score={g?.a ?? 0}
          leading={(g?.a ?? 0) >= (g?.b ?? 0)}
        />
        <TeamLine
          ids={match.teamB}
          names={names}
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
  const addMatch = useApp((s) => s.addMatch)
  const addMatches = useApp((s) => s.addMatches)
  const updateMatch = useApp((s) => s.updateMatch)
  const deleteMatch = useApp((s) => s.deleteMatch)
  const updateSession = useApp((s) => s.updateSession)
  const endSession = useApp((s) => s.endSession)

  const push = useNav((s) => s.push)
  const resetTo = useNav((s) => s.resetTo)
  const replace = useNav((s) => s.replace)

  const [nextType, setNextType] = useState<MatchType | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [endOpen, setEndOpen] = useState(false)
  const [managing, setManaging] = useState<Match | null>(null)
  const [swapping, setSwapping] = useState<{ match: Match; playerId: string } | null>(null)
  const [pickingRest, setPickingRest] = useState<Player | null>(null)
  const [mustInclude, setMustInclude] = useState<string[]>([])
  const [showAllSchedule, setShowAllSchedule] = useState(false)

  const names = useMemo(() => playerMap(players), [players])
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
  const attending = session.playerIds
    .map((id) => names.get(id))
    .filter((p): p is Player => Boolean(p))

  const live = matches.filter((m) => m.status === 'playing')
  const queued = matches.filter((m) => m.status === 'queued')
  const finished = matches.filter((m) => m.status === 'done')

  const busyIds = [...live, ...queued].flatMap((m) => [...m.teamA, ...m.teamB])
  const onCourt = new Map(live.map((m) => [m.courtIndex, m]))

  const format = formatOf(session)
  const progress = sessionProgress(session, matches, now)

  const loads = playerLoads(attending, matches)
  const loadById = new Map(loads.map((l) => [l.playerId, l]))

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
        subtitle={`${FORMAT_LABELS[format]} · ${session.rules.pointsToWin} 分制 · ${formatDate(session.date)} · ${attending.length} 人 · 已打 ${finished.length} 场`}
        onBack={() => resetTo({ name: 'home' })}
        right={
          <Button size="sm" variant="ghost" onClick={() => setEndOpen(true)}>
            结束
          </Button>
        }
      />

      <Body className="pb-32">
        {progress.shouldWrapUp && (
          <div className="rounded-card border border-lime-glow/40 bg-lime-glow/10 px-4 py-3.5">
            <p className="font-semibold text-lime-glow">{progress.wrapUpReason}</p>
            {progress.unmetFloor && (
              <p className="mt-1 text-sm text-amber-300">{progress.unmetFloor}</p>
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
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-200">
            {notice}
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
              <button className="text-xs text-lime-glow" onClick={regenerateSchedule}>
                按现在的人重排
              </button>
            ) : format === 'king' ? null : (
              <button
                className="text-xs text-lime-glow disabled:text-ink-500"
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
          <p className="text-sm text-ink-400">
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
              </Card>
            ))}
            {format === 'rotation' && queued.length > 3 && (
              <button
                onClick={() => setShowAllSchedule((v) => !v)}
                className="w-full py-2 text-center text-sm text-lime-glow"
              >
                {showAllSchedule
                  ? '收起'
                  : `查看全部赛程（还剩 ${queued.length} 场）`}
              </button>
            )}
          </div>
        )}

        <SectionTitle>
          {format === 'king'
            ? `排队顺序（${waiting.length} 人）`
            : `等待区（${waiting.length} 人）`}
        </SectionTitle>

        {format === 'king' && (
          <p className="text-sm text-ink-400">
            队头两人下一场上。赢的留场
            {(session.kingStreakCap ?? 0) > 0
              ? `，连赢 ${session.kingStreakCap} 场强制下场休息`
              : '，赢到底'}
            。
          </p>
        )}

        {format !== 'rotation' && (
          <div>
            <p className="mb-1.5 text-xs text-ink-400">下一场排什么</p>
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
                    ? 'border-lime-glow/60 bg-lime-glow/10'
                    : 'border-ink-700/70 bg-ink-850 active:bg-ink-800',
                )}
              >
                <span className="tnum w-5 shrink-0 text-center text-sm text-ink-400">
                  {idx + 1}
                </span>
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-xs text-ink-400">
                    已打 {l.games} 场
                    {l.restRounds > 0 && ` · 休息 ${l.restRounds} 轮`}
                  </span>
                </span>
                {must && <Pill tone="lime">下一场必上</Pill>}
              </button>
            )
          })}

          {restingIds.length > 0 && (
            <div className="pt-1">
              <p className="mb-2 text-xs text-ink-400">休息中（不参与排场）</p>
              <div className="flex flex-wrap gap-2">
                {restingIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => toggleResting(id)}
                    className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-ink-300"
                  >
                    <Avatar name={names.get(id)?.name ?? '?'} size="sm" />
                    {names.get(id)?.name}
                    <span className="text-ink-500">↩</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {waiting.length === 0 && restingIds.length === 0 && (
            <p className="text-sm text-ink-400">所有人都在场上。</p>
          )}
        </div>
      </Body>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-ink-800 bg-ink-900/95 px-4 pt-3 backdrop-blur">
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
            <p className="text-sm text-ink-300">
              点某个球员可以换人，换人或重排都会把比分清零。
            </p>
            <div className="space-y-2">
              {[...managing.teamA, ...managing.teamB].map((id) => (
                <button
                  key={id}
                  onClick={() => setSwapping({ match: managing, playerId: id })}
                  className="flex w-full items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-left active:bg-ink-800"
                >
                  <Avatar name={names.get(id)?.name ?? '?'} size="sm" />
                  <span className="flex-1 truncate">{names.get(id)?.name}</span>
                  <span className="text-xs text-ink-400">换人 ›</span>
                </button>
              ))}
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

      {/* 换人：从等待区挑一个 */}
      <Sheet open={Boolean(swapping)} onClose={() => setSwapping(null)} title="换成谁">
        {swapping && (
          <div className="space-y-2">
            {waiting.length === 0 ? (
              <p className="text-sm text-ink-400">等待区没人了。</p>
            ) : (
              waiting.map((l) => (
                <button
                  key={l.playerId}
                  onClick={() => swapPlayer(swapping.match, swapping.playerId, l.playerId)}
                  className="flex w-full items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-left active:bg-ink-800"
                >
                  <Avatar name={names.get(l.playerId)?.name ?? '?'} size="sm" />
                  <span className="flex-1 truncate">{names.get(l.playerId)?.name}</span>
                  <span className="text-xs text-ink-400">已打 {l.games} 场</span>
                </button>
              ))
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
        <p className="text-sm text-ink-300">
          结束后会算出今晚排名、MVP 和 AA 费用。
          {live.length > 0 && (
            <span className="mt-2 block text-amber-300">
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
