import { useEffect } from 'react'
import { useNav, useRoute, TAB_ROUTES } from '@/store/useNav'
import { Home } from '@/screens/Home'
import { Sessions } from '@/screens/Sessions'
import { Discover } from '@/screens/Discover'
import { Me } from '@/screens/Me'
import { SessionSetup } from '@/screens/SessionSetup'
import { SessionBoard } from '@/screens/SessionBoard'
import { ScoreBoard } from '@/screens/ScoreBoard'
import { MatchResult } from '@/screens/MatchResult'
import { VenueDetail } from '@/screens/VenueDetail'
import { Leaderboard } from '@/screens/Leaderboard'
import { SessionSummary } from '@/screens/SessionSummary'
import { PlayerProfile } from '@/screens/PlayerProfile'
import { Avatar } from '@/screens/Avatar'
import { TabBar } from '@/components/TabBar'
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

  /*
   * 底部导航只在四个落脚点上出现。
   * 记分、排场、开球这些是「正在做一件事」的界面 ——
   * 规格第 4 节说球局内的记分优先于任何社交入口，
   * 底下横一条导航条，正好是让人半路点走的邀请。
   */
  const tabBar = (TAB_ROUTES as readonly string[]).includes(route.name)

  return (
    <ProgressProvider>
      {screenFor(route)}
      {tabBar && <TabBar />}
    </ProgressProvider>
  )
}

/** 路由 → 画面。段位表由外面的 Provider 统一提供，每个画面不用自己算。 */
function screenFor(route: ReturnType<typeof useRoute>) {
  switch (route.name) {
    case 'home':
      return <Home />
    case 'sessions':
      return <Sessions />
    case 'discover':
      return <Discover />
    case 'me':
      return <Me />
    case 'setup':
      return <SessionSetup />
    case 'board':
      return <SessionBoard sessionId={route.sessionId} />
    case 'score':
      return <ScoreBoard matchId={route.matchId} />
    case 'result':
      return <MatchResult matchId={route.matchId} />
    case 'leaderboard':
      return route.sessionId !== undefined ? (
        <Leaderboard sessionId={route.sessionId} />
      ) : (
        <Leaderboard venue={route.venue} />
      )
    case 'venue':
      return <VenueDetail venue={route.venue} />
    case 'summary':
      return <SessionSummary sessionId={route.sessionId} />
    case 'profile':
      return <PlayerProfile playerId={route.playerId} />
    case 'avatar':
      return <Avatar playerId={route.playerId} />
  }
}
