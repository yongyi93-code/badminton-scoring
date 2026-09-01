import { pick, useT } from '@/lib/i18n'
import { useMemo, useState } from 'react'
import { rosterForSession, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Button,
  EmptyState,
  Field,
  Pill,
  Screen,
  Sheet,
  Toast,
  TopBar,
  cx,
  inputClass,
} from '@/components/ui'
import {
  activeGameIndex,
  addPoint,
  deriveServe,
  deuceNote,
  gamesWon,
  isGameOver,
  isGamePoint,
  matchWinner,
  nextGame,
  undoPoint,
  withOpeningServe,
  type Court,
  type ServeState,
} from '@/lib/scoring'
import { useWakeLock } from '@/lib/wakeLock'
import { kingOfCourtNext, matchInput } from '@/lib/sessionFormat'
import {
  DEFAULT_STREAK_CAP,
  formatOf,
  type Player,
  type Rules,
  type TeamSide,
} from '@/types'

/* ------------------------------------------------------------------ *
 * 站位图：双打最常吵的就是「谁该发、站哪边」
 *
 * 排布让斜对角在视觉上真的是斜对角：
 *   A 右区 | B 左区
 *   A 左区 | B 右区
 * 于是 A 右区 与 B 右区 正好互为对角，和实际发球方向一致。
 * ------------------------------------------------------------------ */

function CourtCell({
  name,
  label,
  isServer,
  isReceiver,
  tone,
}: {
  name: string
  label: string
  isServer: boolean
  isReceiver: boolean
  tone: 'teamA' | 'teamB'
}) {
  return (
    <div
      className={cx(
        'relative flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 text-center',
        isServer
          ? 'border-brand-600 bg-brand-100'
          : isReceiver
            ? 'border-dashed border-brand-500 bg-fill'
            : 'border-line bg-surface',
      )}
    >
      <span className="text-[10px] text-ink-500">{label}</span>
      <span
        className={cx(
          'max-w-full truncate text-[13px] font-medium',
          tone === 'teamA' ? 'text-team-a' : 'text-team-b',
        )}
      >
        {name}
      </span>
      {isServer && <span className="absolute -top-2 -right-1.5 text-sm">🏸</span>}
    </div>
  )
}

function CourtDiagram({
  serve,
  names,
  isDoubles,
}: {
  serve: ServeState
  names: Map<string, Player>
  isDoubles: boolean
}) {
  const nameOf = (id: string) => names.get(id)?.name ?? '?'
  const cell = (team: TeamSide, court: Court) => {
    const id = serve.positions[team][court]
    return (
      <CourtCell
        name={nameOf(id)}
        label={pick(
          `${team} 队${court === 'right' ? '右' : '左'}区`,
          `${team} ${court === 'right' ? 'right' : 'left'}`,
        )}
        isServer={id === serve.serverId}
        isReceiver={id === serve.receiverId && id !== serve.serverId}
        tone={team === 'A' ? 'teamA' : 'teamB'}
      />
    )
  }

  if (!isDoubles) {
    return (
      <div className="relative grid grid-cols-2 gap-2">
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
        {cell('A', serve.serveCourt)}
        {cell('B', serve.serveCourt)}
      </div>
    )
  }

  return (
    <div className="relative grid grid-cols-2 grid-rows-2 gap-2">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
      {cell('A', 'right')}
      {cell('B', 'left')}
      {cell('A', 'left')}
      {cell('B', 'right')}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 计分区
 * ------------------------------------------------------------------ */

function ScoreZone({
  ids,
  names,
  score,
  team,
  tone,
  serverId,
  gamePoint,
  disabled,
  onTap,
}: {
  ids: string[]
  names: Map<string, Player>
  score: number
  team: TeamSide
  tone: 'teamA' | 'teamB'
  serverId?: string
  gamePoint: boolean
  disabled: boolean
  onTap: () => void
}) {
  const who = ids.map((id) => names.get(id)?.name ?? '?').join(' / ')
  return (
    <button
      onClick={() => {
        if (disabled) return
        // 汗手 + 强光下看不清，震一下比看一眼可靠
        navigator.vibrate?.(12)
        onTap()
      }}
      disabled={disabled}
      /* 读屏和大字体模式下，「点这里 +1」那种小字提示是没用的，标签才有用 */
      aria-label={pick(
        `为 ${team} 队 ${who} 加 1 分，当前 ${score} 分`,
        `Add a point for team ${team}, ${who}. Currently ${score}.`,
      )}
      className={cx(
        'relative flex flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border px-4 py-6 transition-colors',
        tone === 'teamA'
          ? 'border-team-a/30 bg-team-a/8 active:bg-team-a/20'
          : 'border-team-b/30 bg-team-b/8 active:bg-team-b/20',
        disabled && 'opacity-60',
      )}
    >
      {/* 队色收成顶上一条细带，不再整块高饱和铺满 */}
      <span
        aria-hidden
        className={cx(
          'absolute inset-x-0 top-0 h-1.5',
          tone === 'teamA' ? 'bg-team-a' : 'bg-team-b',
        )}
      />
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
        <span
          className={cx(
            'text-label font-semibold',
            tone === 'teamA' ? 'text-team-a' : 'text-team-b',
          )}
        >
          {pick(`${team} 队`, `Team ${team}`)}
        </span>
        {ids.map((id) => (
          <span
            key={id}
            className={cx(
              'text-label',
              id === serverId ? 'text-brand-600 font-semibold' : 'text-ink-700',
            )}
          >
            {id === serverId && '🏸 '}
            {names.get(id)?.name ?? '?'}
          </span>
        ))}
      </div>
      <span
        className={cx(
          'tnum text-[clamp(4.5rem,20vh,7.5rem)] leading-none font-black',
          tone === 'teamA' ? 'text-team-a' : 'text-team-b',
        )}
      >
        {score}
      </span>
      {gamePoint && <Pill tone="warn">{pick('局点', 'Game point')}</Pill>}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * 主屏
 * ------------------------------------------------------------------ */

export function ScoreBoard({ matchId }: { matchId: string }) {
  const match = useApp((s) => s.matches.find((m) => m.id === matchId))
  const session = useApp((s) =>
    s.sessions.find((x) => x.id === match?.sessionId),
  )
  const t = useT()
  const players = useApp((s) => s.players)
  const updateMatch = useApp((s) => s.updateMatch)
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)

  const [directOpen, setDirectOpen] = useState(false)
  const [directA, setDirectA] = useState('')
  const [directB, setDirectB] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [serveOpen, setServeOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /**
   * 只换屏幕上的左右，不动数据。
   * 11 分和换局时两队要交换场地，人站过去了，手机上却还是原来的上下 ——
   * 每次都要在脑子里镜像一遍，迟早点错。
   */
  const [flipped, setFlipped] = useState(false)
  /**
   * 打完之后弹的结果确认。
   * 不做成「到分自动结束」——最后一分点错的代价是整场重来，
   * 而多按一下确认的代价是一秒。
   */
  const [confirmEnd, setConfirmEnd] = useState(false)

  // 友谊赛的客队不在正式名单里，记分屏也要叫得出他们的名字
  const names = useMemo(
    () => rosterForSession(players, session),
    [players, session],
  )
  useWakeLock(Boolean(match) && match?.status === 'playing')

  if (!match || !session) {
    return (
      <Screen>
        <TopBar title={t('比赛不存在', 'Match not found')} onBack={back} />
        <div className="px-4 pt-4">
          <EmptyState title={t('这场比赛已经被删掉了', 'This match was deleted')} />
        </div>
      </Screen>
    )
  }

  const rules: Rules = session.rules
  const gi = activeGameIndex(match, rules)
  const game = match.games[gi]
  const serve = deriveServe(match, gi)
  const gameOver = isGameOver(game.a, game.b, rules)
  const winner = matchWinner(match.games, rules)
  const sets = gamesWon(match.games, rules)
  const gamePoint = isGamePoint(game.a, game.b, rules)
  const isDoubles = match.teamA.length > 1
  const deuce = deuceNote(game.a, game.b, rules)

  /*
   * 开局站右区的那两个人 —— 0:0 是偶数分，从右区发，所以
   * 「开局发球人」和「开局接发人」就是 serveInit 里的 rightA / rightB。
   * 选择器要标的是这两个，不是「此刻谁在发」：打到一半时此刻发球的人
   * 早就换过了，标它会让人以为自己改的是当前发球权。
   */
  const openingServer = game.serveInit
    ? game.serveInit.servingTeam === 'A'
      ? game.serveInit.rightA
      : game.serveInit.rightB
    : null
  const openingReceiver = game.serveInit
    ? game.serveInit.servingTeam === 'A'
      ? game.serveInit.rightB
      : game.serveInit.rightA
    : null

  const writeGame = (next: typeof game) => {
    const games = [...match.games]
    games[gi] = next
    updateMatch(match.id, { games })
  }

  /**
   * 加分要从 store 现取最新比赛，不能用渲染闭包里的 game：
   * 手快连点两下时组件还没重渲染，两次都会基于同一个旧比分算，第二分会丢。
   */
  const tap = (team: TeamSide) => {
    const fresh = useApp.getState().matches.find((m) => m.id === matchId)
    if (!fresh) return
    const idx = activeGameIndex(fresh, rules)
    const current = fresh.games[idx]
    if (isGameOver(current.a, current.b, rules)) return
    const games = [...fresh.games]
    games[idx] = addPoint(current, team, rules)
    updateMatch(fresh.id, { games })
  }

  const undoLast = () => {
    const fresh = useApp.getState().matches.find((m) => m.id === matchId)
    if (!fresh) return
    const idx = activeGameIndex(fresh, rules)
    const games = [...fresh.games]
    const before = games[idx]
    games[idx] = undoPoint(before)
    if (games[idx] === before) {
      setToast(t('这一局还没有可以撤销的分', 'Nothing to undo in this game'))
      return
    }
    updateMatch(fresh.id, { games })
    // 说清撤掉的是哪一队的分 —— 「已撤销」三个字本身不解决任何争议
    const removed = before.points?.[before.points.length - 1]
    setToast(
      removed
        ? t(`已撤销 ${removed} 队 1 分`, `Undid 1 point for team ${removed}`)
        : t('已撤销上一分', 'Undid the last point'),
    )
  }

  /**
   * 把当前这场当成已结束，算出车轮赛的下一场。
   * 结束前预览和结束后真排都用这个，保证界面上看到的和实际排出来的一致。
   * （连胜要把当前这场算进去，所以这里手动把它标成 done）
   */
  const previewKing = () => {
    if (formatOf(session) !== 'king' || !winner) return null
    const all = useApp
      .getState()
      .matches.filter((m) => m.sessionId === session.id)
      .sort((a, b) => a.seq - b.seq)
    const current = all.find((m) => m.id === matchId)
    if (!current) return null
    const asDone = { ...current, status: 'done' as const }
    const timeline = all.map((m) => (m.id === matchId ? asDone : m))
    const attending = session.playerIds
      .map((id) => names.get(id))
      .filter((p): p is Player => Boolean(p))
    const busyIds = timeline
      .filter((m) => m.status === 'playing' && m.id !== matchId)
      .flatMap((m) => [...m.teamA, ...m.teamB])

    return kingOfCourtNext({
      attending,
      matches: timeline,
      finished: asDone,
      streakCap: session.kingStreakCap ?? DEFAULT_STREAK_CAP,
      excludeIds: session.restingIds ?? [],
      busyIds,
    })
  }

  const kingNext = gameOver && winner ? previewKing() : null

  /** 轮转赛 / 车轮赛：打完自动把下一场顶到同一片场，不用回看板再点一次 */
  const autoArrangeNext = () => {
    const format = formatOf(session)
    if (format === 'free') return
    const courtIndex = match.courtIndex ?? 0
    const state = useApp.getState()
    const all = state.matches
      .filter((m) => m.sessionId === session.id)
      .sort((a, b) => a.seq - b.seq)

    if (format === 'rotation') {
      const next = all.find((m) => m.status === 'queued')
      if (next) {
        state.updateMatch(next.id, {
          courtIndex,
          status: 'playing',
          startedAt: Date.now(),
        })
      }
      return
    }

    const out = previewKing()
    if (out?.pairing) {
      state.addMatch(matchInput(out.pairing, session.id, courtIndex))
    }
  }

  const finishMatch = () => {
    updateMatch(match.id, { status: 'done', endedAt: Date.now() })
    autoArrangeNext()
    /*
     * 打完先看一眼这一场值多少分，再回看板。
     * 用 replace 不用 push —— 记分屏已经翻篇了，
     * 从结算页按返回该回到看板，而不是回到一场打完的比赛。
     */
    replace({ name: 'result', matchId: match.id })
  }

  const startNextGame = () => {
    const g = nextGame(match, rules)
    if (!g) return
    updateMatch(match.id, { games: [...match.games, g] })
  }

  /**
   * 改这一局的开局发球设定，然后整局重推。
   * 只动当前这一局 —— 三局两胜里前面打完的局各有各的开局设定，不该被连坐。
   */
  const fixServe = (serverId: string, receiverId?: string) => {
    const fresh = useApp.getState().matches.find((m) => m.id === matchId)
    if (!fresh) return
    const idx = activeGameIndex(fresh, rules)
    const cur = fresh.games[idx]
    if (!cur.serveInit) return
    const games = [...fresh.games]
    games[idx] = {
      ...cur,
      serveInit: withOpeningServe(fresh, cur.serveInit, serverId, receiverId),
    }
    updateMatch(fresh.id, { games })
  }

  const applyDirect = () => {
    const a = Number(directA)
    const b = Number(directB)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return
    writeGame({ a, b, points: null, serveInit: null })
    setDirectOpen(false)
    setDirectA('')
    setDirectB('')
  }

  return (
    <Screen>
      <div className="flex min-h-dvh flex-col">
        <TopBar
          title={t(`${(match.courtIndex ?? 0) + 1} 号场`, `Court ${(match.courtIndex ?? 0) + 1}`)}
          subtitle={
            rules.bestOf === 3
              ? t(
                  `${rules.pointsToWin} 分制 · 第 ${gi + 1} 局 · 大比分 ${sets.A}:${sets.B}`,
                  `to ${rules.pointsToWin} · game ${gi + 1} · sets ${sets.A}:${sets.B}`,
                )
              : t(
                  `${rules.pointsToWin} 分制${rules.winBy2 ? ' · 净胜 2 分' : ''}`,
                  `to ${rules.pointsToWin}${rules.winBy2 ? ' · win by 2' : ''}`,
                )
          }
          onBack={back}
          right={
            <button
              onClick={() => setMoreOpen(true)}
              aria-label={t('更多', 'More')}
              className="text-ink-700 active:bg-fill -mr-1 flex size-10 shrink-0 items-center justify-center rounded-xl"
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
          }
        />

        {serve && !gameOver && (
          <div className="px-5 pt-3">
            <div className="rounded-card border-line bg-surface border p-3">
              {/*
                开局发球方是随机定的。要是场上其实是对面先发，这一整条
                （发球人、发球区、接发人）从头到尾都是错的 —— 所以这行本身
                就是入口，点一下能改。
              */}
              <button
                onClick={() => setServeOpen(true)}
                className="active:bg-fill mb-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-1 text-center text-label"
              >
                <span>
                  <span className="text-brand-600 font-semibold">
                    {names.get(serve.serverId)?.name}
                  </span>
                  <span className="text-ink-700">{t(' 发球 · ', ' serves · ')}</span>
                  <span className="font-medium">
                    {serve.serveCourt === 'right'
                      ? t('右发球区', 'right court')
                      : t('左发球区', 'left court')}
                  </span>
                  {isDoubles && (
                    <>
                      <span className="text-ink-700">{t(' · 接发 ', ' · receiver ')}</span>
                      <span className="font-medium">
                        {names.get(serve.receiverId)?.name}
                      </span>
                    </>
                  )}
                </span>
                <span className="text-ink-500 shrink-0 text-caption">{t('改 ›', 'Change ›')}</span>
              </button>
              <CourtDiagram serve={serve} names={names} isDoubles={isDoubles} />
            </div>
          </div>
        )}

        {!serve && !gameOver && (
          <p className="px-4 pt-3 text-center text-xs text-ink-500">
            {t(
              '这一局是直接输入比分的，没有发球提示',
              'This game was entered as a final score — no serve tracking',
            )}
          </p>
        )}

        {deuce && !gameOver && (
          <p className="text-warning-600 bg-warning-50 mx-5 mt-3 rounded-btn px-3 py-2 text-center text-label font-medium">
            {deuce}
          </p>
        )}

        <div
          className={cx(
            'flex flex-1 gap-3 p-5',
            flipped ? 'flex-col-reverse' : 'flex-col',
          )}
        >
          <ScoreZone
            ids={match.teamA}
            names={names}
            score={game.a}
            team="A"
            tone="teamA"
            serverId={serve?.servingTeam === 'A' ? serve.serverId : undefined}
            gamePoint={gamePoint === 'A'}
            disabled={gameOver}
            onTap={() => tap('A')}
          />
          <ScoreZone
            ids={match.teamB}
            names={names}
            score={game.b}
            team="B"
            tone="teamB"
            serverId={serve?.servingTeam === 'B' ? serve.serverId : undefined}
            gamePoint={gamePoint === 'B'}
            disabled={gameOver}
            onTap={() => tap('B')}
          />
        </div>

        <div className="safe-bottom border-t border-line bg-canvas px-4 pt-3">
          {gameOver ? (
            <div className="space-y-2">
              <p className="text-center text-sm">
                <span className="font-semibold text-brand-600">
                  {(game.a > game.b ? match.teamA : match.teamB)
                    .map((id) => names.get(id)?.name ?? '?')
                    .join(' / ')}
                </span>
                <span className="text-ink-700">
                  {t(
                    ` 拿下这一局 ${Math.max(game.a, game.b)}:${Math.min(game.a, game.b)}`,
                    ` won it ${Math.max(game.a, game.b)}:${Math.min(game.a, game.b)}`,
                  )}
                </span>
              </p>
              {kingNext && (
                <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-center text-sm">
                  {kingNext.cappedOut ? (
                    <p className="text-warning-600">
                      {t(`${kingNext.streak} 连胜到顶，`, `${kingNext.streak} wins is the cap — `)}
                      {(game.a > game.b ? match.teamA : match.teamB)
                        .map((id) => names.get(id)?.name)
                        .join('/')}
                      {t(' 下场休息', ' sits out next')}
                    </p>
                  ) : (
                    <p className="text-brand-600">
                      {t(
                        `守场成功 · ${kingNext.streak} 连胜`,
                        `Held the court · ${kingNext.streak} in a row`,
                      )}
                    </p>
                  )}
                  {kingNext.pairing ? (
                    <p className="mt-1 text-ink-700">
                      {t('下一场：', 'Next: ')}
                      {kingNext.pairing.teamA
                        .map((id) => names.get(id)?.name)
                        .join('/')}
                      {t(' 对 ', ' vs ')}
                      {kingNext.pairing.teamB
                        .map((id) => names.get(id)?.name)
                        .join('/')}
                    </p>
                  ) : (
                    <p className="mt-1 text-warning-600">{kingNext.reason}</p>
                  )}
                </div>
              )}

              {winner ? (
                <Button variant="primary" size="lg" block onClick={() => setConfirmEnd(true)}>
                  {/* 结束之后先去赛后结算页，别再写「回到看板」 */}
                  {kingNext?.pairing || formatOf(session) === 'rotation'
                    ? t('结束比赛，排下一场', 'Finish and set up the next')
                    : t('结束比赛', 'Finish the match')}
                </Button>
              ) : (
                <Button variant="primary" size="lg" block onClick={startNextGame}>
                  {t(`打第 ${match.games.length + 1} 局`, `Play game ${match.games.length + 1}`)}
                </Button>
              )}
              <Button block variant="ghost" onClick={() => undoLast()}>
                {t('改错了，撤销上一分', 'Undo the last point')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={!game.points || game.points.length === 0}
                  onClick={() => undoLast()}
                >
                  {t('撤销', 'Undo')}
                </Button>
                {/* 场上交换场地之后，屏幕上的上下也跟着换，省得每次在脑子里镜像一遍 */}
                <Button
                  variant="soft"
                  className="flex-1"
                  onClick={() => {
                    setFlipped((v) => !v)
                    setToast(
                      flipped
                        ? t('已换回原来的上下', 'Sides put back')
                        : t('已换边，A 队现在在下面', 'Swapped — team A is now at the bottom'),
                    )
                  }}
                >
                  {t('换边', 'Swap ends')}
                </Button>
              </div>
              <Button block variant="soft" onClick={back}>
                {t('先回看板', 'Back to the board')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <Toast message={toast} onClose={() => setToast(null)} />

      <Sheet open={serveOpen} onClose={() => setServeOpen(false)} title={t('谁先发球', 'Who serves first')}>
        <p className="text-ink-700 text-label">
          {t(
            '改的是这一局「开局」谁发球，整局会按新设定重推 —— 比分一分不动，发球人、发球区和接发人跟着改正。',
            'This changes who served at 0:0. The whole game is re-derived from it — the score does not move, but the server, service court and receiver are corrected.',
          )}
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-ink-500 mb-2 text-caption">{t('开局发球', 'First server')}</p>
            <div className="grid grid-cols-2 gap-2">
              {[...match.teamA, ...match.teamB].map((id) => (
                <button
                  key={id}
                  onClick={() => fixServe(id)}
                  className={cx(
                    'rounded-btn h-12 truncate border px-3 text-label',
                    id === openingServer
                      ? 'border-brand-500 bg-brand-100 text-brand-600 font-semibold'
                      : 'border-line bg-surface active:bg-fill',
                  )}
                >
                  <span className={match.teamA.includes(id) ? 'text-team-a' : 'text-team-b'}>
                    {match.teamA.includes(id) ? 'A ' : 'B '}
                  </span>
                  {names.get(id)?.name ?? '?'}
                </button>
              ))}
            </div>
          </div>

          {isDoubles && openingServer && (
            <div>
              <p className="text-ink-500 mb-2 text-caption">
                {t(
                  '开局对面谁接（决定他俩开局谁站右区）',
                  'First receiver (decides who starts in the right court)',
                )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(match.teamA.includes(openingServer) ? match.teamB : match.teamA).map(
                  (id) => (
                    <button
                      key={id}
                      onClick={() => fixServe(openingServer, id)}
                      className={cx(
                        'rounded-btn h-12 truncate border px-3 text-label',
                        id === openingReceiver
                          ? 'border-brand-500 bg-brand-100 text-brand-600 font-semibold'
                          : 'border-line bg-surface active:bg-fill',
                      )}
                    >
                      {names.get(id)?.name ?? '?'}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
        <Button block variant="soft" className="mt-4" onClick={() => setServeOpen(false)}>
          {t('完成', 'Done')}
        </Button>
      </Sheet>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('这一场', 'This match')}>
        <div className="space-y-2">
          <Button
            block
            variant="soft"
            onClick={() => {
              setMoreOpen(false)
              setDirectOpen(true)
            }}
          >
            {t('直接输入最终比分', 'Enter the final score')}
          </Button>
          <Button
            block
            variant="soft"
            onClick={() => {
              setFlipped((v) => !v)
              setMoreOpen(false)
              setToast(
                      flipped
                        ? t('已换回原来的上下', 'Sides put back')
                        : t('已换边，A 队现在在下面', 'Swapped — team A is now at the bottom'),
                    )
            }}
          >
            {t('交换屏幕上的上下', 'Swap top and bottom')}
          </Button>
          {/*
            场地时间到了、或者比分输错卡在没打完的状态时的出口。
            按当前比分算胜负（谁分高谁赢），不然这场会一直挂在场上。
          */}
          {game.a !== game.b && !gameOver && (
            <Button
              block
              variant="dangerSoft"
              onClick={() => {
                setMoreOpen(false)
                setConfirmEnd(true)
              }}
            >
              {t(
                `提前结束这一场（按 ${game.a}:${game.b} 算）`,
                `End it now at ${game.a}:${game.b}`,
              )}
            </Button>
          )}
        </div>
      </Sheet>

      {/*
        规格 §E：打到分了不直接结束，弹一层确认，可以「继续比赛」。
        最后一分点错的代价是整场重来，多按一下的代价是一秒。
      */}
      <Sheet open={confirmEnd} onClose={() => setConfirmEnd(false)} title={t('这一场结束了？', 'Match over?')}>
        <p className="tnum text-display text-center">
          {game.a} : {game.b}
        </p>
        <p className="text-ink-700 mt-2 text-center text-label">
          {(game.a > game.b ? match.teamA : match.teamB)
            .map((id) => names.get(id)?.name ?? '?')
            .join(' / ')}{' '}
          {t('获胜', 'win')}
        </p>
        <p className="text-ink-500 mt-3 text-caption">
          {t(
            '结束后这一场会记进战绩和排名。记错了可以在看板上把它退回来改。',
            'Once finished this counts towards records and rankings. If you got it wrong you can send it back from the board.',
          )}
        </p>
        <div className="mt-4 space-y-2">
          <Button
            block
            variant="primary"
            size="lg"
            onClick={() => {
              setConfirmEnd(false)
              finishMatch()
            }}
          >
            {t('确认结束', 'Confirm')}
          </Button>
          <Button block variant="ghost" onClick={() => setConfirmEnd(false)}>
            {t('继续比赛', 'Keep playing')}
          </Button>
        </div>
      </Sheet>

      <Sheet open={directOpen} onClose={() => setDirectOpen(false)} title={t('直接输入最终比分', 'Enter the final score')}>
        <p className="text-sm text-ink-700">
          {t(
            '没人盯着手机计分的那几场用这个。输入后这一局就没有发球提示和撤销了。',
            'For games nobody scored live. Once entered, this game has no serve tracking and no undo.',
          )}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label={`${t('A 队', 'Team A')} ${match.teamA.map((id) => names.get(id)?.name).join('/')}`}>
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={0}
              value={directA}
              onChange={(e) => setDirectA(e.target.value)}
              placeholder="21"
            />
          </Field>
          <Field label={`${t('B 队', 'Team B')} ${match.teamB.map((id) => names.get(id)?.name).join('/')}`}>
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={0}
              value={directB}
              onChange={(e) => setDirectB(e.target.value)}
              placeholder="18"
            />
          </Field>
        </div>
        <Button
          variant="primary"
          block
          className="mt-4"
          disabled={directA === '' || directB === ''}
          onClick={applyDirect}
        >
          {t('保存这一局比分', 'Save this game')}
        </Button>
      </Sheet>
    </Screen>
  )
}
