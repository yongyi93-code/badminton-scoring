import { useMemo, useRef, useState } from 'react'
import { playerMap, sessionMatches, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  Card,
  EmptyState,
  Field,
  Pill,
  Screen,
  SectionTitle,
  Stepper,
  TopBar,
  cx,
  inputClass,
} from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import { RankTable } from '@/components/RankTable'
import { computeStats, mvpOf, rankPlayers } from '@/lib/ranking'
import { money, splitFee } from '@/lib/fee'
import { matchesAtVenue, playerIdsAtVenue, venueLabel } from '@/lib/venues'
import { shareNodeAsImage } from '@/lib/shareImage'
import { earnedPointsByPlayer, levelOf, type LevelInfo } from '@/lib/pet'
import { duration, formatDateFull, percent, signed } from '@/lib/format'
import {
  FORMAT_LABELS,
  formatOf,
  RANK_MIN_GAMES,
  type Player,
  type PlayerStats,
  type Session,
} from '@/types'

/* ------------------------------------------------------------------ *
 * 战绩分享图（离屏渲染后截成 PNG）
 * ------------------------------------------------------------------ */

function ShareCard({
  session,
  ranked,
  mvp,
  names,
  matchCount,
  perPerson,
  venueKing,
  innerRef,
}: {
  session: Session
  ranked: PlayerStats[]
  mvp: PlayerStats | null
  names: Map<string, Player>
  matchCount: number
  perPerson: number
  /** 这个球馆的累计第一，发到群里让人知道该挑战谁 */
  venueKing: { name: string; winRate: number; games: number } | null
  innerRef: React.Ref<HTMLDivElement>
}) {
  const top = ranked.filter((r) => r.qualified).slice(0, 8)
  return (
    <div className="pointer-events-none fixed top-0 -left-[2000px]" aria-hidden>
      <div
        ref={innerRef}
        style={{ width: 480 }}
        className="bg-ink-900 p-7 font-sans text-ink-100"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] tracking-[0.22em] text-lime-glow uppercase">
              Badminton Night
            </p>
            <p className="mt-1 text-2xl font-bold">{session.venue || '羽球局'}</p>
            <p className="mt-0.5 text-sm text-ink-400">
              {formatDateFull(session.date)}
            </p>
          </div>
          <span className="text-4xl">🏸</span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            { label: '出席', value: `${session.playerIds.length} 人` },
            { label: '打了', value: `${matchCount} 场` },
            { label: '人均', value: perPerson > 0 ? money(perPerson) : '—' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-ink-850 px-3 py-2.5">
              <p className="text-[11px] text-ink-400">{s.label}</p>
              <p className="text-lg font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {mvp && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-lime-glow/40 bg-lime-glow/10 px-4 py-3">
            <span className="text-2xl">🏆</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] tracking-widest text-lime-glow uppercase">
                今晚 MVP
              </p>
              <p className="truncate text-lg font-bold">
                {names.get(mvp.playerId)?.name}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">{percent(mvp.winRate)}</p>
              <p className="text-[11px] text-ink-400">
                {mvp.wins}胜{mvp.losses}负
              </p>
            </div>
          </div>
        )}

        {venueKing && (
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
            <span className="text-2xl">👑</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] tracking-widest text-ink-400 uppercase">
                {venueLabel(session.venue)}累计第一
              </p>
              <p className="truncate text-lg font-bold">{venueKing.name}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">{percent(venueKing.winRate)}</p>
              <p className="text-[11px] text-ink-400">{venueKing.games} 场</p>
            </div>
          </div>
        )}

        <p className="mt-5 mb-2 text-[11px] tracking-[0.18em] text-ink-400 uppercase">
          今晚排名
        </p>
        <div className="space-y-1.5">
          {top.map((s, i) => (
            <div
              key={s.playerId}
              className={cx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2',
                i === 0 ? 'bg-lime-glow/12' : 'bg-ink-850',
              )}
            >
              <span className="w-5 text-center text-sm font-bold text-ink-400">
                {i + 1}
              </span>
              <Avatar name={names.get(s.playerId)?.name ?? '?'} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {names.get(s.playerId)?.name}
              </span>
              <span className="text-xs text-ink-400">
                {s.wins}胜{s.losses}负
              </span>
              <span className="w-14 text-right text-xs text-ink-400">
                净 {signed(s.diff)}
              </span>
              <span className="w-10 text-right text-sm font-bold">
                {percent(s.winRate)}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-5 text-center text-[10px] text-ink-400">
          排名按胜率 → 净分差 · 至少 {RANK_MIN_GAMES} 场上榜
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 结算屏
 * ------------------------------------------------------------------ */

export function SessionSummary({ sessionId }: { sessionId: string }) {
  const session = useApp((s) => s.sessions.find((x) => x.id === sessionId))
  const allMatches = useApp((s) => s.matches)
  const allSessions = useApp((s) => s.sessions)
  const players = useApp((s) => s.players)
  const updateSession = useApp((s) => s.updateSession)
  const reopenSession = useApp((s) => s.reopenSession)
  const deleteSession = useApp((s) => s.deleteSession)

  const resetTo = useNav((s) => s.resetTo)
  const push = useNav((s) => s.push)
  const back = useNav((s) => s.back)

  const shareRef = useRef<HTMLDivElement>(null)
  const [shareState, setShareState] = useState<'idle' | 'working' | string>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const names = useMemo(() => playerMap(players), [players])
  const matches = useMemo(
    () => (session ? sessionMatches(allMatches, session.id) : []),
    [allMatches, session],
  )
  const ranked = useMemo(
    () => (session ? rankPlayers(computeStats(matches, session.playerIds)) : []),
    [matches, session],
  )

  /** 段位按所有球局的总战绩算，不只今晚这一场 —— 它反映的是整体水平 */
  const levelsById = useMemo(() => {
    const map = new Map<string, LevelInfo>()
    for (const [playerId, earned] of earnedPointsByPlayer(allMatches)) {
      map.set(playerId, levelOf(earned))
    }
    return map
  }, [allMatches])

  /** 这个球馆的累计第一 —— 挑战者该找的人 */
  const venueKing = useMemo(() => {
    if (!session) return null
    const ms = matchesAtVenue(allSessions, allMatches, session.venue)
    const ids = playerIdsAtVenue(allSessions, allMatches, session.venue)
    const top = rankPlayers(computeStats(ms, ids)).find((r) => r.qualified)
    if (!top) return null
    return {
      playerId: top.playerId,
      name: names.get(top.playerId)?.name ?? '已删除的球员',
      winRate: top.winRate,
      games: top.games,
    }
  }, [session, allSessions, allMatches, names])

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

  const done = matches.filter((m) => m.status === 'done')
  const mvp = mvpOf(computeStats(matches, session.playerIds))
  const fee = splitFee(session)
  const played =
    session.endedAt && session.createdAt
      ? duration(session.endedAt - session.createdAt)
      : null

  /** 改费用时从 store 现取，避免连续几次修改互相覆盖 */
  const patchFee = (fn: (fee: Session['fee']) => Partial<Session['fee']>) => {
    const fresh = useApp.getState().sessions.find((x) => x.id === sessionId)
    if (!fresh) return
    updateSession(sessionId, { fee: { ...fresh.fee, ...fn(fresh.fee) } })
  }

  const setFee = (patch: Partial<Session['fee']>) => patchFee(() => patch)

  const togglePaid = (playerId: string) =>
    patchFee((f) => ({
      paidPlayerIds: f.paidPlayerIds.includes(playerId)
        ? f.paidPlayerIds.filter((id) => id !== playerId)
        : [...f.paidPlayerIds, playerId],
    }))

  async function share() {
    if (!shareRef.current) return
    setShareState('working')
    // 兜底超时：出图卡住时也要把按钮从「生成中」放出来
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('生成超时，请重试')), 15000),
    )
    try {
      const outcome = await Promise.race([
        shareNodeAsImage(
          shareRef.current,
          `羽球战绩-${session!.date}.png`,
          `${session!.venue || '羽球局'} 战绩`,
        ),
        timeout,
      ])
      setShareState(
        outcome === 'shared'
          ? '已打开分享面板'
          : outcome === 'downloaded'
            ? '图片已下载，可以手动发到群里'
            : '生成图片失败',
      )
    } catch (err) {
      setShareState(err instanceof Error ? err.message : '生成图片失败')
    }
  }

  const numberInput = (
    value: number,
    onChange: (v: number) => void,
    placeholder: string,
  ) => (
    <input
      className={inputClass}
      type="number"
      inputMode="decimal"
      min={0}
      value={value === 0 ? '' : value}
      placeholder={placeholder}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
    />
  )

  return (
    <Screen>
      <TopBar
        title="今晚结算"
        subtitle={`${session.venue || '球局'} · ${formatDateFull(session.date)}`}
        onBack={session.status === 'ended' ? back : () => resetTo({ name: 'home' })}
      />
      <Body>
        {done.length === 0 ? (
          <EmptyState
            icon="🤷"
            title="今晚没有打完的比赛"
            hint="没有战绩可以结算，但费用还是可以在下面分摊"
          />
        ) : (
          <>
            {mvp ? (
              <Card className="border-lime-glow/40 bg-lime-glow/5">
                <div className="flex items-center gap-4">
                  <span className="text-3xl">🏆</span>
                  <div className="min-w-0 flex-1">
                    <Pill tone="lime">今晚 MVP</Pill>
                    <p className="mt-1.5 truncate text-xl font-bold">
                      {names.get(mvp.playerId)?.name}
                    </p>
                    <p className="tnum text-sm text-ink-400">
                      {mvp.games} 场 {mvp.wins}胜{mvp.losses}负 · 胜率{' '}
                      {percent(mvp.winRate)} · 净分 {signed(mvp.diff)}
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              <Card>
                <p className="text-sm text-ink-300">
                  今晚没有人打满 {RANK_MIN_GAMES} 场，不评 MVP。
                </p>
              </Card>
            )}

            {venueKing && (
              <button
                onClick={() => push({ name: 'profile', playerId: venueKing.playerId })}
                className="flex w-full items-center gap-3 rounded-xl border border-ink-700/70 bg-ink-850 px-3.5 py-3 text-left active:bg-ink-800"
              >
                <span className="text-2xl">👑</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink-400">
                    {venueLabel(session.venue)}累计第一
                  </span>
                  <span className="block truncate font-semibold">
                    {venueKing.name}
                  </span>
                </span>
                <span className="tnum shrink-0 text-right">
                  <span className="block font-bold">{percent(venueKing.winRate)}</span>
                  <span className="block text-xs text-ink-400">
                    {venueKing.games} 场
                  </span>
                </span>
              </button>
            )}

            <p className="text-sm text-ink-400">
              {FORMAT_LABELS[formatOf(session)]}
              {session.rotationPerPlayer
                ? ` · 每人 ${session.rotationPerPlayer} 场的赛程`
                : ''}
              {formatOf(session) === 'king' && (session.kingStreakCap ?? 0) > 0
                ? ` · 连胜上限 ${session.kingStreakCap}`
                : ''}
            </p>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '打了', value: `${done.length} 场` },
                { label: '出席', value: `${session.playerIds.length} 人` },
                { label: '用时', value: played ?? '—' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-ink-700/70 bg-ink-850 px-3 py-2.5"
                >
                  <p className="text-xs text-ink-400">{s.label}</p>
                  <p className="mt-0.5 font-bold">{s.value}</p>
                </div>
              ))}
            </div>

            <SectionTitle>今晚排名</SectionTitle>
            <RankTable
              ranked={ranked}
              playersById={names}
              levelsById={levelsById}
              minGames={RANK_MIN_GAMES}
              onPick={(playerId) => push({ name: 'profile', playerId })}
            />
          </>
        )}

        <SectionTitle>费用 AA</SectionTitle>
        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="场地费">
              {numberInput(session.fee.courtFee, (v) => setFee({ courtFee: v }), '0')}
            </Field>
            <Field label="球单价">
              {numberInput(
                session.fee.shuttleUnitPrice,
                (v) => setFee({ shuttleUnitPrice: v }),
                '0',
              )}
            </Field>
          </div>
          <Field label="用了几个球">
            <Stepper
              value={session.fee.shuttleCount}
              onChange={(v) => setFee({ shuttleCount: v })}
              onDelta={(d) =>
                patchFee((f) => ({
                  shuttleCount: Math.min(99, Math.max(0, f.shuttleCount + d)),
                }))
              }
              min={0}
              max={99}
              suffix="个"
            />
          </Field>

          <div className="rounded-xl bg-ink-800 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-300">
                总额 {money(fee.total)}（场地 {money(session.fee.courtFee)} + 球{' '}
                {money(fee.shuttleTotal)}）
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm text-ink-300">每人</span>
              <span className="tnum text-2xl font-bold text-lime-glow">
                {money(fee.perPerson)}
              </span>
            </div>
            {fee.outstanding > 0 && (
              <p className="mt-1 text-xs text-amber-300">
                还有 {fee.unpaidIds.length} 人没付，共 {money(fee.outstanding)}
              </p>
            )}
            {fee.total > 0 && fee.outstanding === 0 && (
              <p className="mt-1 text-xs text-lime-glow">全部收齐 ✓</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs text-ink-400">点名字标记已付</p>
            <div className="flex flex-wrap gap-2">
              {session.playerIds.map((id) => {
                const paid = session.fee.paidPlayerIds.includes(id)
                return (
                  <button
                    key={id}
                    onClick={() => togglePaid(id)}
                    className={cx(
                      'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm',
                      paid
                        ? 'border-lime-glow/60 bg-lime-glow/15 text-lime-glow'
                        : 'border-ink-700 bg-ink-850 text-ink-300',
                    )}
                  >
                    <Avatar name={names.get(id)?.name ?? '?'} size="sm" />
                    {names.get(id)?.name ?? '?'}
                    {paid && <span>✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </Card>

        <Button
          variant="primary"
          size="lg"
          block
          onClick={share}
          disabled={shareState === 'working'}
        >
          {shareState === 'working' ? '生成中…' : '生成战绩图，发到群里'}
        </Button>
        {shareState !== 'idle' && shareState !== 'working' && (
          <p className="text-center text-sm text-lime-glow">{shareState}</p>
        )}

        {session.status === 'ended' && (
          <Button
            block
            variant="ghost"
            onClick={() => {
              reopenSession(session.id)
              resetTo({ name: 'board', sessionId: session.id })
            }}
          >
            结束错了，回去继续打
          </Button>
        )}

        <Button block variant="soft" onClick={() => resetTo({ name: 'home' })}>
          回首页
        </Button>

        {confirmDelete ? (
          <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-200">
              删除后这个球局的所有比赛记录都会消失，累计排行榜也会跟着变。确定吗？
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  deleteSession(session.id)
                  resetTo({ name: 'home' })
                }}
              >
                确定删除
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setConfirmDelete(false)}
              >
                算了
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full pb-4 text-center text-sm text-ink-500 underline decoration-ink-700 underline-offset-4"
          >
            删除这个球局
          </button>
        )}
      </Body>

      <ShareCard
        session={session}
        ranked={ranked}
        mvp={mvp}
        names={names}
        matchCount={done.length}
        perPerson={fee.perPerson}
        venueKing={venueKing}
        innerRef={shareRef}
      />
    </Screen>
  )
}
