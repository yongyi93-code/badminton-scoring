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
import { Pet } from '@/screens/Pet'

export default function App() {
  const route = useRoute()
  const popFromHistory = useNav((s) => s.popFromHistory)

  // 让手机系统返回键 / 浏览器后退和界面里的返回一致
  useEffect(() => {
    const onPop = () => popFromHistory()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [popFromHistory])

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
    case 'pet':
      return <Pet playerId={route.playerId} />
  }
}
