import { useMemo, useState } from 'react'
import { playerMap, sessionMatches, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, EmptyState, Screen, Segmented, TopBar } from '@/components/ui'
import { RankTable } from '@/components/RankTable'
import { computeStats, rankPlayers } from '@/lib/ranking'
import { formatDate } from '@/lib/format'
import { RANK_MIN_GAMES } from '@/types'

type Scope = 'session' | 'all'

export function Leaderboard({ sessionId }: { sessionId?: string }) {
  const { players, sessions, matches } = useApp()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const [scope, setScope] = useState<Scope>(sessionId ? 'session' : 'all')

  const session = sessions.find((s) => s.id === sessionId)
  const names = useMemo(() => playerMap(players), [players])

  const ranked = useMemo(() => {
    if (scope === 'session' && session) {
      const ms = sessionMatches(matches, session.id)
      return rankPlayers(computeStats(ms, session.playerIds))
    }
    // 累计榜把所有出现过的球员都算进来，包含已移出球员库的人
    const everyone = Array.from(
      new Set([...players.map((p) => p.id), ...matches.flatMap((m) => [...m.teamA, ...m.teamB])]),
    )
    return rankPlayers(computeStats(matches, everyone))
  }, [scope, session, matches, players])

  return (
    <Screen>
      <TopBar
        title="排行榜"
        subtitle={
          scope === 'session' && session
            ? `${session.venue || '球局'} · ${formatDate(session.date)}`
            : '所有球局累计'
        }
        onBack={back}
      />
      <Body>
        {session && (
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'session', label: '今晚' },
              { value: 'all', label: '累计' },
            ]}
          />
        )}

        {ranked.length === 0 ? (
          <EmptyState
            icon="📊"
            title="还没有打完的比赛"
            hint={`排名按胜率排，同胜率看净分差；至少 ${RANK_MIN_GAMES} 场才上榜`}
          />
        ) : (
          <>
            <RankTable
              ranked={ranked}
              playersById={names}
              minGames={RANK_MIN_GAMES}
              onPick={(playerId) => push({ name: 'profile', playerId })}
            />
            <p className="pt-2 pb-4 text-xs leading-relaxed text-ink-400">
              排名口径：胜率 ↓ → 净分差 ↓ → 场数 ↓。
              净分差 = 本人所在队伍的总得分 − 总失分，
              双打里搭档的表现也会算进你的净分差。
            </p>
          </>
        )}
      </Body>
    </Screen>
  )
}
