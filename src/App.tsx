import { useEffect } from 'react'
import { useNav, useRoute } from '@/store/useNav'
import { Home } from '@/screens/Home'
import { Players } from '@/screens/Players'
import { SessionSetup } from '@/screens/SessionSetup'
import { SessionBoard } from '@/screens/SessionBoard'
import { ScoreBoard } from '@/screens/ScoreBoard'
import { Leaderboard } from '@/screens/Leaderboard'
import { SessionSummary } from '@/screens/SessionSummary'
import { PlayerProfile } from '@/screens/PlayerProfile'
import { Avatar } from '@/screens/Avatar'
import { ProgressProvider } from '@/store/progress'

export default function App() {
  const route = useRoute()
  const popFromHistory = useNav((s) => s.popFromHistory)

  // 让手机系统返回键 / 浏览器后退和界面里的返回一致
  useEffect(() => {
    const onPop = () => popFromHistory()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [popFromHistory])

  return <ProgressProvider>{screenFor(route)}</ProgressProvider>
}

/** 路由 → 画面。段位表由外面的 Provider 统一提供，每个画面不用自己算。 */
function screenFor(route: ReturnType<typeof useRoute>) {
  switch (route.name) {
    case 'home':
      return <Home />
    case 'players':
      return <Players />
    case 'setup':
      return <SessionSetup />
    case 'board':
      return <SessionBoard sessionId={route.sessionId} />
    case 'score':
      return <ScoreBoard matchId={route.matchId} />
    case 'leaderboard':
      return <Leaderboard sessionId={route.sessionId} />
    case 'summary':
      return <SessionSummary sessionId={route.sessionId} />
    case 'profile':
      return <PlayerProfile playerId={route.playerId} />
    case 'avatar':
      return <Avatar playerId={route.playerId} />
  }
}
