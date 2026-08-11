import { useMemo, useState } from 'react'
import { playerMap, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Button,
  EmptyState,
  Field,
  Pill,
  Screen,
  Sheet,
  TopBar,
  cx,
  inputClass,
} from '@/components/ui'
import {
  activeGameIndex,
  addPoint,
  deriveServe,
  gamesWon,
  isGameOver,
  isGamePoint,
  matchWinner,
  nextGame,
  undoPoint,
  type Court,
  type ServeState,
} from '@/lib/scoring'
import { useWakeLock } from '@/lib/wakeLock'
import type { Player, Rules, TeamSide } from '@/types'

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
          ? 'border-lime-glow bg-lime-glow/20'
          : isReceiver
            ? 'border-dashed border-lime-glow/60 bg-ink-800'
            : 'border-ink-700 bg-ink-850',
      )}
    >
      <span className="text-[10px] text-ink-400">{label}</span>
      <span
        className={cx(
          'max-w-full truncate text-[13px] font-medium',
          tone === 'teamA' ? 'text-teamA' : 'text-teamB',
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
        label={`${team} 队${court === 'right' ? '右' : '左'}区`}
        isServer={id === serve.serverId}
        isReceiver={id === serve.receiverId && id !== serve.serverId}
        tone={team === 'A' ? 'teamA' : 'teamB'}
      />
    )
  }

  if (!isDoubles) {
    return (
      <div className="relative grid grid-cols-2 gap-2">
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink-600" />
        {cell('A', serve.serveCourt)}
        {cell('B', serve.serveCourt)}
      </div>
    )
  }

  return (
    <div className="relative grid grid-cols-2 grid-rows-2 gap-2">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink-600" />
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
  tone,
  serverId,
  gamePoint,
  disabled,
  onTap,
}: {
  ids: string[]
  names: Map<string, Player>
  score: number
  tone: 'teamA' | 'teamB'
  serverId?: string
  gamePoint: boolean
  disabled: boolean
  onTap: () => void
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className={cx(
        'relative flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-4 py-6 transition-colors',
        tone === 'teamA'
          ? 'border-teamA/40 bg-teamA/10 active:bg-teamA/20'
          : 'border-teamB/40 bg-teamB/10 active:bg-teamB/20',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
        {ids.map((id) => (
          <span
            key={id}
            className={cx(
              'text-sm',
              id === serverId ? 'font-semibold text-lime-glow' : 'text-ink-300',
            )}
          >
            {id === serverId && '🏸 '}
            {names.get(id)?.name ?? '?'}
          </span>
        ))}
      </div>
      <span
        className={cx(
          'tnum text-[clamp(3.5rem,18vh,7rem)] leading-none font-black',
          tone === 'teamA' ? 'text-teamA' : 'text-teamB',
        )}
      >
        {score}
      </span>
      {gamePoint && <Pill tone="warn">局点</Pill>}
      {!disabled && <span className="text-xs text-ink-400">点这里 +1</span>}
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
  const players = useApp((s) => s.players)
  const updateMatch = useApp((s) => s.updateMatch)
  const back = useNav((s) => s.back)

  const [directOpen, setDirectOpen] = useState(false)
  const [directA, setDirectA] = useState('')
  const [directB, setDirectB] = useState('')

  const names = useMemo(() => playerMap(players), [players])
  useWakeLock(Boolean(match) && match?.status === 'playing')

  if (!match || !session) {
    return (
      <Screen>
        <TopBar title="比赛不存在" onBack={back} />
        <div className="px-4 pt-4">
          <EmptyState title="这场比赛已经被删掉了" />
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
    games[idx] = undoPoint(games[idx])
    updateMatch(fresh.id, { games })
  }

  const finishMatch = () => {
    updateMatch(match.id, { status: 'done', endedAt: Date.now() })
    back()
  }

  const startNextGame = () => {
    const g = nextGame(match, rules)
    if (!g) return
    updateMatch(match.id, { games: [...match.games, g] })
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
          title={`${(match.courtIndex ?? 0) + 1} 号场`}
          subtitle={
            rules.bestOf === 3
              ? `第 ${gi + 1} 局 · 大比分 ${sets.A}:${sets.B}`
              : `${rules.pointsToWin} 分制${rules.winBy2 ? ' · 净胜 2 分' : ''}`
          }
          onBack={back}
          right={
            <Button size="sm" variant="ghost" onClick={() => setDirectOpen(true)}>
              直接输比分
            </Button>
          }
        />

        {serve && !gameOver && (
          <div className="px-4 pt-3">
            <div className="rounded-card border border-ink-700/70 bg-ink-850 p-3">
              <p className="mb-2.5 text-center text-sm">
                <span className="font-semibold text-lime-glow">
                  {names.get(serve.serverId)?.name}
                </span>
                <span className="text-ink-300"> 发球 · </span>
                <span className="font-medium">
                  {serve.serveCourt === 'right' ? '右发球区' : '左发球区'}
                </span>
                {isDoubles && (
                  <>
                    <span className="text-ink-300"> · 接发 </span>
                    <span className="font-medium">
                      {names.get(serve.receiverId)?.name}
                    </span>
                  </>
                )}
              </p>
              <CourtDiagram serve={serve} names={names} isDoubles={isDoubles} />
            </div>
          </div>
        )}

        {!serve && !gameOver && (
          <p className="px-4 pt-3 text-center text-xs text-ink-400">
            这一局是直接输入比分的，没有发球提示
          </p>
        )}

        <div className="flex flex-1 flex-col gap-3 p-4">
          <ScoreZone
            ids={match.teamA}
            names={names}
            score={game.a}
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
            tone="teamB"
            serverId={serve?.servingTeam === 'B' ? serve.serverId : undefined}
            gamePoint={gamePoint === 'B'}
            disabled={gameOver}
            onTap={() => tap('B')}
          />
        </div>

        <div className="safe-bottom border-t border-ink-800 bg-ink-900 px-4 pt-3">
          {gameOver ? (
            <div className="space-y-2">
              <p className="text-center text-sm">
                <span className="font-semibold text-lime-glow">
                  {(game.a > game.b ? match.teamA : match.teamB)
                    .map((id) => names.get(id)?.name ?? '?')
                    .join(' / ')}
                </span>
                <span className="text-ink-300">
                  {' '}
                  拿下这一局 {Math.max(game.a, game.b)}:{Math.min(game.a, game.b)}
                </span>
              </p>
              {winner ? (
                <Button variant="primary" size="lg" block onClick={finishMatch}>
                  结束比赛，回到看板
                </Button>
              ) : (
                <Button variant="primary" size="lg" block onClick={startNextGame}>
                  打第 {match.games.length + 1} 局
                </Button>
              )}
              <Button block variant="ghost" onClick={() => undoLast()}>
                改错了，撤销上一分
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={!game.points || game.points.length === 0}
                onClick={() => undoLast()}
              >
                撤销
              </Button>
              <Button variant="soft" className="flex-1" onClick={back}>
                先回看板
              </Button>
            </div>
          )}
        </div>
      </div>

      <Sheet open={directOpen} onClose={() => setDirectOpen(false)} title="直接输入最终比分">
        <p className="text-sm text-ink-300">
          没人盯着手机计分的那几场用这个。输入后这一局就没有发球提示和撤销了。
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label={`A 队 ${match.teamA.map((id) => names.get(id)?.name).join('/')}`}>
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
          <Field label={`B 队 ${match.teamB.map((id) => names.get(id)?.name).join('/')}`}>
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
          保存这一局比分
        </Button>
      </Sheet>
    </Screen>
  )
}
