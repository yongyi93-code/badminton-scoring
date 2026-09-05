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
import { GlobalRanking } from '@/screens/GlobalRanking'
import { Leaderboard } from '@/screens/Leaderboard'
import { SessionSummary } from '@/screens/SessionSummary'
import { PlayerProfile } from '@/screens/PlayerProfile'
import { Avatar } from '@/screens/Avatar'
import { TabBar } from '@/components/TabBar'
import { ProgressProvider } from '@/store/progress'
import { RecoverySheet } from '@/components/RecoverySheet'
import { ClubGate, useClubGate } from '@/components/Club'

export default function App() {
  const route = useRoute()
  const popFromHistory = useNav((s) => s.popFromHistory)
  /*
   * 还没进任何球群 —— 整个 App 先不给用。
   *
   * 拦得这么狠是因为没有群的时候这个 App 是坏的：记的分推不上去
   * （数据库不收没有群的行），排行榜是空的，开的局别人也看不见。
   * 让人先玩半小时再告诉他「刚才那些都没存」，比一开始就拦住难受得多。
   *
   * 那一屏自己带着「退出登录」—— 登错账号的人不能被锁在这里。
   */
  const gated = useClubGate()

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
      {gated ? <ClubGate /> : screenFor(route)}
      {!gated && tabBar && <TabBar />}
      {/*
        「设置新密码」挂在最外层：邮件链接会把人带回上次停在的任何一页，
        而这件事必须当场做完 —— 那个临时会话是一次性的。
      */}
      <RecoverySheet />
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
    case 'ranking':
      return <GlobalRanking />
    case 'summary':
      return <SessionSummary sessionId={route.sessionId} />
    case 'profile':
      return <PlayerProfile playerId={route.playerId} />
    case 'avatar':
      return <Avatar playerId={route.playerId} />
  }
}
