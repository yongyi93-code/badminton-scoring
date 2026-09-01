import { useT } from '@/lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { rosterForSession, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  BottomBar,
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  TopBar,
  cx,
} from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import { RankChip } from '@/components/RankMedal'
import {
  levelOf,
  outcomeOf,
  tierName,
  UPSET_MULTIPLIER,
  type MatchImpact,
} from '@/lib/avatar'
import { gamesWon } from '@/lib/scoring'
import { matchWinnerBySets } from '@/lib/ranking'
import { signed } from '@/lib/format'
import { DEFAULT_RULES, type TeamSide } from '@/types'

/* ------------------------------------------------------------------ *
 * 赛后结算（规格 §F）
 *
 * 一场打完，最想知道的两件事：赢了没有，以及这一场值多少分。
 * 原来打完直接弹回看板，那两件事一件都没说 —— MMR 静悄悄地变了，
 * 只有下次翻排行榜才发现。
 *
 * 这一屏只读：所有数字都是从比赛记录重放出来的（outcomeOf），
 * 不落库、也不改任何东西。退回去改比分，这里的数字跟着就变。
 * ------------------------------------------------------------------ */

/** 数字滚上去。跑一次就停，不循环 —— 这是个结果，不是个进度条 */
function useCountUp(target: number, enabled: boolean) {
  const [value, setValue] = useState(enabled ? 0 : target)
  const raf = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setValue(target)
      return
    }
    const start = performance.now()
    const DURATION = 650
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION)
      // easeOutCubic：开头快、末尾慢，停下来的那一下才像「落定」
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, enabled])

  return value
}

/** 系统里关了动效就一切从简 —— 这一屏的动画纯属锦上添花，不承载信息 */
function usePrefersMotion() {
  const [ok, setOk] = useState(true)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setOk(!mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return ok
}

function ImpactRow({
  impact,
  name,
  animate,
  delay,
}: {
  impact: MatchImpact
  name: string
  animate: boolean
  delay: number
}) {
  const t = useT()
  const avatar = useApp((s) => s.avatars.find((a) => a.playerId === impact.playerId))
  const [shown, setShown] = useState(!animate)

  useEffect(() => {
    if (!animate) return
    const id = window.setTimeout(() => setShown(true), delay)
    return () => window.clearTimeout(id)
  }, [animate, delay])

  const delta = useCountUp(Math.abs(impact.delta), animate && shown)
  const before = levelOf(impact.mmrBefore)
  const after = levelOf(impact.mmrAfter)
  const promoted = after.index > before.index
  const demoted = after.index < before.index

  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-all duration-300',
        impact.won ? 'border-brand-500/40 bg-brand-50' : 'border-line bg-surface',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <Avatar name={name} avatar={avatar} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{name}</p>
        <p className="tnum text-ink-500 text-caption">
          {t(
            `MMR ${impact.mmrBefore} → ${impact.mmrAfter}`,
            `MMR ${impact.mmrBefore} → ${impact.mmrAfter}`,
          )}
          {impact.coins > 0 &&
            t(` · 金币 +${impact.coins}`, ` · +${impact.coins} coins`)}
        </p>
        {/*
          升段是这一屏的高光时刻，不能直接拿 tier.color 当文字色 ——
          先锋、卫士那几档本来就是浅灰绿浅灰蓝，压在浅色底上像被禁用了。
          RankChip 自带底色和描边，浅色段位也压得住。
        */}
        {promoted && (
          <span className="mt-1 inline-flex items-center gap-1.5">
            <span className="text-brand-600 text-caption font-semibold">
              {t('升段', 'Promoted')}
            </span>
            <RankChip level={after} />
          </span>
        )}
        {demoted && (
          <p className="text-ink-500 mt-1 text-caption">
            {t(`掉到 ${tierName(after.tier)}`, `Down to ${tierName(after.tier)}`)}
          </p>
        )}
      </div>
      <span
        className={cx(
          'tnum shrink-0 text-lg font-bold',
          impact.delta > 0
            ? 'text-brand-600'
            : impact.delta < 0
              ? 'text-danger-600'
              : 'text-ink-500',
        )}
      >
        {/*
          扣到 0 封底的那些人这里就是 0，不写成 −10。
          显示名义值会让人对不上自己的 MMR —— 明明写着 −10，分却没少。
        */}
        {impact.delta === 0 ? '0' : signed(impact.delta > 0 ? delta : -delta)}
      </span>
    </div>
  )
}

export function MatchResult({ matchId }: { matchId: string }) {
  const t = useT()
  const match = useApp((s) => s.matches.find((m) => m.id === matchId))
  const allMatches = useApp((s) => s.matches)
  const players = useApp((s) => s.players)
  const session = useApp((s) => s.sessions.find((x) => x.id === match?.sessionId))
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)
  const motion = usePrefersMotion()

  const names = useMemo(
    () => rosterForSession(players, session),
    [players, session],
  )
  const outcome = useMemo(
    () => (match ? outcomeOf(allMatches, match.id) : null),
    [allMatches, match],
  )

  if (!match) {
    return (
      <Screen>
        <TopBar title={t('比赛不存在', 'Match not found')} onBack={back} />
        <Body>
          <EmptyState title={t('这场比赛已经被删掉了', 'This match was deleted')} />
        </Body>
      </Screen>
    )
  }

  const nameOf = (id: string) => names.get(id)?.name ?? '?'
  const teamName = (side: TeamSide) =>
    (side === 'A' ? match.teamA : match.teamB).map(nameOf).join(' / ')
  // 规则跟着球局走；球局没了（理论上不该发生）就退回默认规则
  const sets = gamesWon(match.games, session?.rules ?? DEFAULT_RULES)
  /*
   * 胜负看比赛本身，不看 outcome —— 友谊赛是有输赢的，
   * 只是不进 MMR，所以它的 outcome 是 null。
   * 拿 outcome 判胜负会让友谊赛显示成「没有分出胜负」。
   */
  const winner = matchWinnerBySets(match)

  /** 赢的那队排前面 —— 这一屏是给赢家看的 */
  const ordered = outcome
    ? [
        ...outcome.impacts.filter((i) => i.won),
        ...outcome.impacts.filter((i) => !i.won),
      ]
    : []

  /*
   * 记分屏是被 replace 掉的，所以栈里紧挨着下面那层就是看板 ——
   * 直接 back() 就回去了。再 replace 一个看板上去会变成两层看板。
   */
  const backToBoard = back

  return (
    <Screen>
      <TopBar
        title={t('这一场打完了', 'Match done')}
        subtitle={session?.venue || undefined}
        onBack={backToBoard}
      />
      <Body>
        {/* 比分：这一屏最大的那个数字 */}
        <Card
          className={cx(
            'text-center transition-all duration-500',
            winner && 'border-brand-500/40 bg-brand-50',
          )}
        >
          {winner ? (
            <>
              <p className="text-ink-500 text-caption">{t('获胜', 'Winner')}</p>
              <p className="mt-1 text-xl font-bold">{teamName(winner)}</p>
            </>
          ) : (
            <p className="text-ink-700 font-semibold">
              {t('这一场没有分出胜负', 'No winner recorded')}
            </p>
          )}

          {/*
            一局定胜负的时候「1 : 0」什么都没说，大家要看的是 21:12。
            三局两胜才反过来 —— 那时局分是结果，每局比分是过程。
          */}
          {match.games.length === 1 ? (
            <p className="tnum text-display mt-2">
              {match.games[0].a} : {match.games[0].b}
            </p>
          ) : (
            <>
              <p className="tnum text-display mt-2">
                {sets.A} : {sets.B}
              </p>
              <p className="text-ink-500 mt-1 text-caption">
                {match.games.map((g) => `${g.a}-${g.b}`).join('  ')}
              </p>
            </>
          )}

          {outcome?.upset && (
            <div className="mt-3 flex justify-center">
              <Pill tone="warn">
                {t(
                  `爆冷 · MMR ${UPSET_MULTIPLIER} 倍`,
                  `Upset · ${UPSET_MULTIPLIER}× MMR`,
                )}
              </Pill>
            </div>
          )}
        </Card>

        {/*
          三种情况各说各的：
          友谊赛本来就不进 MMR；没分出胜负的场次也没有账；
          正常打完的才有下面这张表。
        */}
        {match.friendly ? (
          <Card>
            <p className="text-ink-700 text-sm">
              {t(
                '友谊赛成绩单独记，不算进 MMR、段位和累计排行榜。',
                'Club matches are kept separate — no MMR, tier or all-time leaderboard.',
              )}
            </p>
          </Card>
        ) : !outcome ? (
          <Card>
            <p className="text-ink-700 text-sm">
              {t(
                '这一场没有分出胜负，所以没有 MMR 变化。',
                'No winner, so no MMR changed hands.',
              )}
            </p>
          </Card>
        ) : (
          <>
            <p className="text-ink-500 px-1 text-label">
              {t('这一场的 MMR', 'MMR from this match')}
            </p>
            <div className="space-y-2">
              {ordered.map((impact, i) => (
                <ImpactRow
                  key={impact.playerId}
                  impact={impact}
                  name={nameOf(impact.playerId)}
                  animate={motion}
                  /* 一个一个落下来，比一整块同时冒出来好读 */
                  delay={i * 90}
                />
              ))}
            </div>
            <p className="text-ink-500 px-1 text-caption">
              {t(
                'MMR 和金币都是从比赛记录实时算的。回看板把这一场退回来改比分，这里的数字跟着就变。',
                'MMR and coins are computed from the match records. Send this match back from the board and these numbers follow.',
              )}
            </p>
          </>
        )}
      </Body>

      <BottomBar>
        <div className="space-y-2">
          <Button variant="primary" size="lg" block onClick={backToBoard}>
            {t('回看板', 'Back to the board')}
          </Button>
          {session && (
            <Button
              variant="soft"
              block
              onClick={() => replace({ name: 'summary', sessionId: session.id })}
            >
              {t('看今晚结算', 'Tonight’s wrap-up')}
            </Button>
          )}
        </div>
      </BottomBar>
    </Screen>
  )
}
