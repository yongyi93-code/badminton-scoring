import { useT } from '@/lib/i18n'
import { useMemo, useRef, useState } from 'react'
import { rosterForSession, sessionMatches, useApp } from '@/store/useApp'
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
import {
  computeStats,
  decidedMatches,
  matchWinnerBySets,
  mvpOf,
  rankPlayers,
} from '@/lib/ranking'
import { money, splitFee } from '@/lib/fee'
import { matchesAtVenue, playerIdsAtVenue, venueLabel } from '@/lib/venues'
import { shareNodeAsImage } from '@/lib/shareImage'
import { progressByPlayer } from '@/lib/avatar'
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
  const t = useT()
  const top = ranked.filter((r) => r.qualified).slice(0, 8)
  return (
    <div className="pointer-events-none fixed top-0 -left-[2000px]" aria-hidden>
      <div
        ref={innerRef}
        style={{ width: 480 }}
        className="bg-canvas p-7 font-sans text-ink-900"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] tracking-[0.22em] text-brand-600 uppercase">
              Badminton Night
            </p>
            <p className="mt-1 text-2xl font-bold">
              {session.venue || t('羽球局', 'Badminton')}
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              {formatDateFull(session.date)}
            </p>
          </div>
          <span className="text-4xl">🏸</span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            {
              label: t('出席', 'Turnout'),
              value: t(`${session.playerIds.length} 人`, `${session.playerIds.length}`),
            },
            {
              label: t('打了', 'Played'),
              value: t(`${matchCount} 场`, `${matchCount}`),
            },
            {
              label: t('人均', 'Each'),
              value: perPerson > 0 ? money(perPerson) : '—',
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-surface px-3 py-2.5">
              <p className="text-[11px] text-ink-500">{s.label}</p>
              <p className="text-lg font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {mvp && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-brand-500 bg-brand-100 px-4 py-3">
            <span className="text-2xl">🏆</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] tracking-widest text-brand-600 uppercase">
                {t('今晚 MVP', 'MVP tonight')}
              </p>
              <p className="truncate text-lg font-bold">
                {names.get(mvp.playerId)?.name}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">{percent(mvp.winRate)}</p>
              <p className="text-[11px] text-ink-500">
                {t(`${mvp.wins}胜${mvp.losses}负`, `${mvp.wins}W ${mvp.losses}L`)}
              </p>
            </div>
          </div>
        )}

        {venueKing && (
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            <span className="text-2xl">👑</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] tracking-widest text-ink-500 uppercase">
                {t(
                  `${venueLabel(session.venue)}累计第一`,
                  `Top at ${venueLabel(session.venue)}`,
                )}
              </p>
              <p className="truncate text-lg font-bold">{venueKing.name}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">{percent(venueKing.winRate)}</p>
              <p className="text-[11px] text-ink-500">
                {t(`${venueKing.games} 场`, `${venueKing.games} games`)}
              </p>
            </div>
          </div>
        )}

        <p className="mt-5 mb-2 text-[11px] tracking-[0.18em] text-ink-500 uppercase">
          {t('今晚排名', 'Tonight’s standings')}
        </p>
        <div className="space-y-1.5">
          {top.map((s, i) => (
            <div
              key={s.playerId}
              className={cx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2',
                i === 0 ? 'bg-brand-100' : 'bg-surface',
              )}
            >
              <span className="w-5 text-center text-sm font-bold text-ink-500">
                {i + 1}
              </span>
              <Avatar name={names.get(s.playerId)?.name ?? '?'} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {names.get(s.playerId)?.name}
              </span>
              <span className="text-xs text-ink-500">
                {t(`${s.wins}胜${s.losses}负`, `${s.wins}W ${s.losses}L`)}
              </span>
              <span className="w-14 text-right text-xs text-ink-500">
                {t(`净 ${signed(s.diff)}`, signed(s.diff))}
              </span>
              {/* w-11：100% 在 w-10 里差 3px，会顶到左边的净分 */}
              <span className="w-11 shrink-0 text-right text-sm font-bold">
                {percent(s.winRate)}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-5 text-center text-[10px] text-ink-500">
          {t(
            `排名按胜率 → 净分差 · 至少 ${RANK_MIN_GAMES} 场上榜`,
            `Ranked by win rate, then point diff · ${RANK_MIN_GAMES} games to qualify`,
          )}
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 结算屏
 * ------------------------------------------------------------------ */

export function SessionSummary({ sessionId }: { sessionId: string }) {
  const t = useT()
  const session = useApp((s) => s.sessions.find((x) => x.id === sessionId))
  const allMatches = useApp((s) => s.matches)
  const allSessions = useApp((s) => s.sessions)
  const players = useApp((s) => s.players)
  const avatars = useApp((s) => s.avatars)
  const updateSession = useApp((s) => s.updateSession)
  const reopenSession = useApp((s) => s.reopenSession)
  const deleteSession = useApp((s) => s.deleteSession)

  const resetTo = useNav((s) => s.resetTo)
  const push = useNav((s) => s.push)
  const back = useNav((s) => s.back)

  const shareRef = useRef<HTMLDivElement>(null)
  const [shareState, setShareState] = useState<'idle' | 'working' | string>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 结算页要列出双方所有人，客队也得有名字
  const names = useMemo(
    () => rosterForSession(players, session),
    [players, session],
  )
  const matches = useMemo(
    () => (session ? sessionMatches(allMatches, session.id) : []),
    [allMatches, session],
  )
  /*
   * 本场结算要把友谊赛的比赛算进来 —— decidedMatches 默认把它们挡在外面，
   * 那是为了不让客队搅动累计排行榜，但自己这一场的账当然要算。
   */
  const inSession = { includeFriendly: true }
  /** 友谊赛要连客队一起排，普通球局就是出席名单 */
  const rosterIds = useMemo(
    () =>
      session
        ? [
            ...session.playerIds,
            ...(session.friendly?.awayPlayers ?? []).map((g) => g.id),
          ]
        : [],
    [session],
  )
  const ranked = useMemo(
    () =>
      session
        ? rankPlayers(
            computeStats(matches, rosterIds, RANK_MIN_GAMES, inSession),
          )
        : [],
    [matches, session, rosterIds],
  )

  /** 友谊赛的总比分：两队各赢了几场 */
  const clubScore = useMemo(() => {
    if (!session?.friendly) return null
    const done = decidedMatches(matches, { includeFriendly: true })
    let home = 0
    let away = 0
    for (const m of done) {
      // teamA 一定是主队，配对时就是这么约束的
      if (matchWinnerBySets(m) === 'A') home += 1
      else away += 1
    }
    return { home, away, total: done.length }
  }, [session, matches])

  /** 段位与 MMR 按所有球局的总战绩算，不只今晚这一场 —— 它反映的是整体水平 */
  const progressById = useMemo(() => progressByPlayer(allMatches), [allMatches])

  /** 头像用角色，没建角色的人会自动退回名字色块 */
  const avatarsById = useMemo(
    () => new Map(avatars.map((a) => [a.playerId, a])),
    [avatars],
  )

  /** 这个球馆的累计第一 —— 挑战者该找的人 */
  const venueKing = useMemo(() => {
    if (!session) return null
    const ms = matchesAtVenue(allSessions, allMatches, session.venue)
    const ids = playerIdsAtVenue(allSessions, allMatches, session.venue)
    const top = rankPlayers(computeStats(ms, ids)).find((r) => r.qualified)
    if (!top) return null
    return {
      playerId: top.playerId,
      name: names.get(top.playerId)?.name ?? t('已删除的球员', 'Deleted player'),
      winRate: top.winRate,
      games: top.games,
    }
  }, [session, allSessions, allMatches, names, t])

  if (!session) {
    return (
      <Screen>
        <TopBar
          title={t('球局不存在', 'Session not found')}
          onBack={() => resetTo({ name: 'home' })}
        />
        <Body>
          <EmptyState title={t('这个球局已经被删掉了', 'This session was deleted')} />
        </Body>
      </Screen>
    )
  }

  const done = matches.filter((m) => m.status === 'done')
  const mvp = mvpOf(
    computeStats(matches, rosterIds, RANK_MIN_GAMES, inSession),
  )
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
      setTimeout(
        () => reject(new Error(t('生成超时，请重试', 'Timed out — try again'))),
        15000,
      ),
    )
    try {
      const outcome = await Promise.race([
        shareNodeAsImage(
          shareRef.current,
          t(`羽球战绩-${session!.date}.png`, `badminton-${session!.date}.png`),
          t(
            `${session!.venue || '羽球局'} 战绩`,
            `${session!.venue || 'Badminton'} results`,
          ),
        ),
        timeout,
      ])
      setShareState(
        outcome === 'shared'
          ? t('已打开分享面板', 'Share sheet opened')
          : outcome === 'downloaded'
            ? t('图片已下载，可以手动发到群里', 'Image saved — send it to the group')
            : t('生成图片失败', 'Could not make the image'),
      )
    } catch (err) {
      setShareState(
        err instanceof Error
          ? err.message
          : t('生成图片失败', 'Could not make the image'),
      )
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
        title={t('今晚结算', 'Wrap-up')}
        subtitle={`${session.venue || t('球局', 'Session')} · ${formatDateFull(session.date)}`}
        onBack={session.status === 'ended' ? back : () => resetTo({ name: 'home' })}
      />
      <Body>
        {done.length === 0 ? (
          <EmptyState
            icon="🤷"
            title={t('今晚没有打完的比赛', 'No finished matches tonight')}
            hint={t(
              '没有战绩可以结算，但费用还是可以在下面分摊',
              'Nothing to rank yet, but you can still split the cost below',
            )}
          />
        ) : (
          <>
            {/* 友谊赛最想看的就是这一行：两队谁赢了 */}
            {clubScore && session.friendly && (
              <Card className="border-brand-500/40 bg-brand-50">
                <p className="text-center text-xs text-ink-500">
                  {t(
                    `友谊赛总比分 · 共 ${clubScore.total} 场`,
                    `Club match · ${clubScore.total} games`,
                  )}
                </p>
                <div className="mt-2 flex items-center justify-center gap-4">
                  <div className="min-w-0 flex-1 text-right">
                    <p className="truncate text-sm text-ink-700">
                      {session.friendly.homeName}
                    </p>
                    <p
                      className={cx(
                        'tnum text-4xl font-bold',
                        clubScore.home >= clubScore.away
                          ? 'text-brand-600'
                          : 'text-ink-500',
                      )}
                    >
                      {clubScore.home}
                    </p>
                  </div>
                  <span className="shrink-0 text-2xl text-ink-500">:</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink-700">
                      {session.friendly.awayName}
                    </p>
                    <p
                      className={cx(
                        'tnum text-4xl font-bold',
                        clubScore.away >= clubScore.home
                          ? 'text-brand-600'
                          : 'text-ink-500',
                      )}
                    >
                      {clubScore.away}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-center text-sm font-semibold">
                  {clubScore.home === clubScore.away
                    ? t('打平', 'Drawn')
                    : t(
                        `${clubScore.home > clubScore.away ? session.friendly.homeName : session.friendly.awayName} 赢下这场友谊赛`,
                        `${clubScore.home > clubScore.away ? session.friendly.homeName : session.friendly.awayName} take it`,
                      )}
                </p>
                <p className="mt-2 text-center text-xs text-ink-500">
                  {t(
                    '友谊赛成绩单独记，不算进 MMR、段位和累计排行榜',
                    'Club matches are kept separate — no MMR, tier or all-time leaderboard',
                  )}
                </p>
              </Card>
            )}

            {mvp ? (
              <Card className="border-brand-500/40 bg-brand-50">
                <div className="flex items-center gap-4">
                  <span className="text-3xl">🏆</span>
                  <div className="min-w-0 flex-1">
                    <Pill tone="brand">{t('今晚 MVP', 'MVP tonight')}</Pill>
                    <p className="mt-1.5 truncate text-xl font-bold">
                      {names.get(mvp.playerId)?.name}
                    </p>
                    <p className="tnum text-sm text-ink-500">
                      {t(
                        `${mvp.games} 场 ${mvp.wins}胜${mvp.losses}负 · 胜率 ${percent(mvp.winRate)} · 净分 ${signed(mvp.diff)}`,
                        `${mvp.games} games · ${mvp.wins}W ${mvp.losses}L · ${percent(mvp.winRate)} · ${signed(mvp.diff)} diff`,
                      )}
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              <Card>
                <p className="text-sm text-ink-700">
                  {t(
                    `今晚没有人打满 ${RANK_MIN_GAMES} 场，不评 MVP。`,
                    `Nobody reached ${RANK_MIN_GAMES} games tonight, so there is no MVP.`,
                  )}
                </p>
              </Card>
            )}

            {venueKing && (
              <button
                onClick={() => push({ name: 'profile', playerId: venueKing.playerId })}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left active:bg-fill"
              >
                <span className="text-2xl">👑</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink-500">
                    {t(
                      `${venueLabel(session.venue)}累计第一`,
                      `Top at ${venueLabel(session.venue)}`,
                    )}
                  </span>
                  <span className="block truncate font-semibold">
                    {venueKing.name}
                  </span>
                </span>
                <span className="tnum shrink-0 text-right">
                  <span className="block font-bold">{percent(venueKing.winRate)}</span>
                  <span className="block text-xs text-ink-500">
                    {t(`${venueKing.games} 场`, `${venueKing.games} games`)}
                  </span>
                </span>
              </button>
            )}

            {/* 人就在这个馆里，顺手能看这个馆的全部战绩。
                没填球馆的不给这个入口 —— 「看未填球馆的全部战绩」读着莫名其妙 */}
            {session.venue.trim() && (
            <button
              onClick={() => push({ name: 'venue', venue: session.venue })}
              className="text-brand-600 self-start text-sm underline decoration-line underline-offset-4"
            >
              {t(
                `看 ${venueLabel(session.venue)} 的全部战绩 ›`,
                `All records at ${venueLabel(session.venue)} ›`,
              )}
            </button>
            )}

            <p className="text-sm text-ink-500">
              {t(...FORMAT_LABELS[formatOf(session)])}
              {session.rotationPerPlayer
                ? t(
                    ` · 每人 ${session.rotationPerPlayer} 场的赛程`,
                    ` · ${session.rotationPerPlayer} games each`,
                  )
                : ''}
              {formatOf(session) === 'king' && (session.kingStreakCap ?? 0) > 0
                ? t(
                    ` · 连胜上限 ${session.kingStreakCap}`,
                    ` · streak cap ${session.kingStreakCap}`,
                  )
                : ''}
            </p>

            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: t('打了', 'Played'),
                  value: t(`${done.length} 场`, `${done.length}`),
                },
                {
                  label: t('出席', 'Turnout'),
                  value: t(
                    `${session.playerIds.length} 人`,
                    `${session.playerIds.length}`,
                  ),
                },
                { label: t('用时', 'Time'), value: played ?? '—' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-line bg-surface px-3 py-2.5"
                >
                  <p className="text-xs text-ink-500">{s.label}</p>
                  <p className="mt-0.5 font-bold">{s.value}</p>
                </div>
              ))}
            </div>

            <SectionTitle>{t('今晚排名', 'Tonight’s standings')}</SectionTitle>
            <RankTable
              ranked={ranked}
              playersById={names}
              progressById={progressById}
              avatarsById={avatarsById}
              minGames={RANK_MIN_GAMES}
              onPick={(playerId) => push({ name: 'profile', playerId })}
            />
          </>
        )}

        <SectionTitle>{t('费用 AA', 'Split the cost')}</SectionTitle>
        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('场地费', 'Court fee')}>
              {numberInput(session.fee.courtFee, (v) => setFee({ courtFee: v }), '0')}
            </Field>
            <Field label={t('球单价', 'Per shuttle')}>
              {numberInput(
                session.fee.shuttleUnitPrice,
                (v) => setFee({ shuttleUnitPrice: v }),
                '0',
              )}
            </Field>
          </div>
          <Field label={t('用了几个球', 'Shuttles used')}>
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
              suffix={t('个', '')}
            />
          </Field>

          <div className="rounded-xl bg-fill px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-700">
                {t(
                  `总额 ${money(fee.total)}（场地 ${money(session.fee.courtFee)} + 球 ${money(fee.shuttleTotal)}）`,
                  `${money(fee.total)} total — court ${money(session.fee.courtFee)} + shuttles ${money(fee.shuttleTotal)}`,
                )}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm text-ink-700">{t('每人', 'Each')}</span>
              <span className="tnum text-2xl font-bold text-brand-600">
                {money(fee.perPerson)}
              </span>
            </div>
            {fee.outstanding > 0 && (
              <p className="mt-1 text-xs text-warning-600">
                {t(
                  `还有 ${fee.unpaidIds.length} 人没付，共 ${money(fee.outstanding)}`,
                  `${fee.unpaidIds.length} still to pay · ${money(fee.outstanding)}`,
                )}
              </p>
            )}
            {fee.total > 0 && fee.outstanding === 0 && (
              <p className="mt-1 text-xs text-brand-600">
                {t('全部收齐 ✓', 'All settled ✓')}
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs text-ink-500">
              {t('点名字标记已付', 'Tap a name to mark them paid')}
            </p>
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
                        ? 'border-brand-500 bg-brand-100 text-brand-600'
                        : 'border-line bg-surface text-ink-700',
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
          {shareState === 'working'
            ? t('生成中…', 'Making it…')
            : t('生成战绩图，发到群里', 'Make a results card to share')}
        </Button>
        {shareState !== 'idle' && shareState !== 'working' && (
          <p className="text-center text-sm text-brand-600">{shareState}</p>
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
            {t('结束错了，回去继续打', 'Ended by mistake — keep playing')}
          </Button>
        )}

        <Button block variant="soft" onClick={() => resetTo({ name: 'home' })}>
          {t('回首页', 'Back home')}
        </Button>

        {confirmDelete ? (
          <div className="space-y-2 rounded-xl border border-danger-600/30 bg-danger-50 p-3">
            <p className="text-sm text-danger-600">
              {t(
                '删除后这个球局的所有比赛记录都会消失，累计排行榜也会跟着变。确定吗？',
                'Deleting drops every match in this session, and the all-time leaderboard shifts with it. Sure?',
              )}
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
                {t('确定删除', 'Delete it')}
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setConfirmDelete(false)}
              >
                {t('算了', 'Never mind')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full pb-4 text-center text-sm text-ink-500 underline decoration-line underline-offset-4"
          >
            {t('删除这个球局', 'Delete this session')}
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
