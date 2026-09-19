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
import { Person } from '@/screens/Person'
import { Moments } from '@/screens/Moments'
import { Avatar } from '@/screens/Avatar'
import { Friends } from '@/screens/Friends'
import { Chat } from '@/screens/Chat'
import { Reports } from '@/screens/Reports'
import { Feedback } from '@/screens/Feedback'
import { Appeals } from '@/screens/Appeals'
import { Admins } from '@/screens/Admins'
import { Roster } from '@/screens/Roster'
import { Legal } from '@/screens/Legal'
import { setRoute } from '@/lib/errorlog'
import { TabBar } from '@/components/TabBar'
import { ProgressProvider } from '@/store/progress'
import { RecoverySheet } from '@/components/RecoverySheet'
import { ClubGate, useClubGate } from '@/components/Club'
import { InviteHandler } from '@/components/InviteHandler'
import { useOpenFromPush } from '@/lib/openFromPush'
import { useBroadcastPlaying } from '@/lib/nowPlaying'
import { useSeedMyName } from '@/lib/profile'
import { useLoadCards } from '@/store/useCards'

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

  /* 点了推送通知，落到该落的那一屏（冷启动和已经开着两条路都管） */
  useOpenFromPush()

  /*
   * 我在不在打球，报给好友看。
   *
   * 挂在这里而不是在「开局」「结束」那两个按钮里各调一次：球局是
   * 同步下来的 —— 别人把我拉进一场局、别人结束了这场局，我这台手机
   * 上都不会经过那两个按钮。盯着算出来的结果，这些情况自动都对。
   */
  useBroadcastPlaying()

  /*
   * 名字还空着的话，拿球群里那个补一次。
   *
   * 不补的话这个功能对所有老用户都是关着的：谁都不会主动跑去设置里
   * 填一个自己看不到效果的字段 —— 效果长在**别人**那块屏幕上
   * （不同群的好友那边，你一直显示「不认识的人」）。
   */
  useSeedMyName()

  /*
   * 照片拉一次，全 App 的头像共用一份。
   *
   * 挂在最外层而不是各屏自己拉：头像出现在十来屏上，各拉各的话
   * 切一次 tab 就是一个新请求，而且会出现「排行榜上已经是新照片、
   * 看板上还是旧的」——它们只隔一个手势。
   */
  useLoadCards()

  /*
   * 把「现在在哪一屏」告诉报错那边。
   *
   * 喂的是路由名（'score'、'board'），不是网址 —— 重设密码回来时
   * 地址栏里是 #access_token=...，那是一把能登录的钥匙，
   * 崩在那一屏时原样存进数据库等于把钥匙抄一份留在日志里。
   */
  setRoute(route.name)

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
      {/*
        点着球局链接进来的人。挂在最外层，和重设密码那个一样 ——
        中间要经过登录、进群、等同步，这几步会把人带到别的页面上去，
        挂在某一屏里的话，一离开那屏这条邀请就断了。
      */}
      <InviteHandler />
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
    case 'person':
      return <Person uid={route.uid} hint={route.hint} />
    case 'moments':
      return <Moments uid={route.uid} />
    case 'avatar':
      return <Avatar playerId={route.playerId} />
    case 'friends':
      return <Friends />
    case 'chat':
      return <Chat uid={route.uid} />
    case 'reports':
      return <Reports />
    case 'feedback':
      return <Feedback />
    case 'appeals':
      return <Appeals />
    case 'admins':
      return <Admins />
    case 'roster':
      return <Roster />
    case 'legal':
      return <Legal tab={route.tab} />
  }
}
