import { useMemo } from 'react'
import { useT } from '@/lib/i18n'
import { activeSessionOf, isFull, spotsLeft, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Button, Card, Pill, SectionTitle } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { venueLabel } from '@/lib/venues'

/* ------------------------------------------------------------------ *
 * 别人开的局
 *
 * 球局是公开的：谁开了局，所有装了 App 的人都在首页看得见 ——
 * 谁开的、在哪、几个人了 —— 点一下就加入，不用等人拉。
 *
 * 这一块取代了原来「一个人管名册、开局时替所有人勾到场」的做法。
 * 那种做法的毛病不是麻烦，是它要求开局的人知道今晚谁会来；
 * 而实际上人是陆陆续续到的。
 * 只显示「还新鲜的」几场：球局要靠人按「结束」才收摊，而没人记得按，
 * 不挡的话首页会堆满上个月那些早就散了的局。
 * ------------------------------------------------------------------ */

/** 开了超过这么久还没结束的，当成忘了按结束，首页不再显示 */
const FRESH_MS = 12 * 60 * 60 * 1000

/** 就算都新鲜，首页也最多列这么多 —— 首页不是球局列表 */
const MAX_SHOWN = 5

export function OpenSessions() {
  const t = useT()
  const { sessions, players, matches, meId } = useApp()
  const joinSession = useApp((s) => s.joinSession)
  const push = useNav((s) => s.push)
  const switchTab = useNav((s) => s.switchTab)

  const nameOf = useMemo(
    () => new Map(players.map((p) => [p.id, p.name])),
    [players],
  )

  const playedIn = (sessionId: string) =>
    matches.filter((m) => m.sessionId === sessionId && m.status === 'done').length

  /** 我现在在哪一场里。在的话，别的局一概加不进去 */
  const mine = useMemo(() => activeSessionOf(sessions, meId), [sessions, meId])

  /*
   * 进行中、我不在里面、而且还「新鲜」的那几场。
   *
   * 新鲜是关键：球局要靠人按「结束」才会收摊，而没人记得按 —— 打完
   * 就各回各家了。于是首页会越堆越长，全是上个月开的、早就散了的局，
   * 真正今晚那一场反而埋在里面。
   *
   * 12 小时是按羽球的实际节奏定的：一场球局撑死打一晚上，超过半天
   * 还开着的，一定是忘了按结束，不是还在打。
   */
  const others = useMemo(() => {
    const cutoff = Date.now() - FRESH_MS
    return sessions
      .filter(
        (s) =>
          s.status === 'active' &&
          (!meId || !s.playerIds.includes(meId)) &&
          s.createdAt >= cutoff,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_SHOWN)
  }, [sessions, meId])

  if (others.length === 0) return null

  return (
    <>
      <SectionTitle>{t('别人开的局', 'Other sessions')}</SectionTitle>
      {others.map((s) => {
        const host = s.createdBy ? nameOf.get(s.createdBy) : undefined
        const full = isFull(s)
        const left = spotsLeft(s)
        return (
          /*
            卡片本身不做成可点的。Card 带 onClick 时渲染的是 <button>，
            再往里塞一个「加入」按钮就是按钮套按钮 —— HTML 不合法，
            浏览器会自作主张把外层收掉，点击行为跟着乱。
            所以两个按钮并排放，各管各的。
          */
          <Card key={s.id}>
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => push({ name: 'board', sessionId: s.id })}
                className="min-w-0 flex-1 text-left"
              >
                <Pill tone="brand">{t('进行中', 'Live')}</Pill>
                <p className="mt-2 truncate text-h2">{venueLabel(s.venue)}</p>
                <p className="text-ink-500 mt-0.5 truncate text-label">
                  {host
                    ? t(`${host} 开的 · `, `${host} started it · `)
                    : `${formatDate(s.date)} · `}
                  {s.maxPlayers
                    ? t(
                        `${s.playerIds.length}/${s.maxPlayers} 人 · 已打 ${playedIn(s.id)} 场`,
                        `${s.playerIds.length}/${s.maxPlayers} players · ${playedIn(s.id)} played`,
                      )
                    : t(
                        `${s.playerIds.length} 人 · 已打 ${playedIn(s.id)} 场`,
                        `${s.playerIds.length} players · ${playedIn(s.id)} played`,
                      )}
                </p>
                {/* 还剩一两个位置的时候说出来，比一个数字更能催人 */}
                {left !== null && left > 0 && left <= 2 && (
                  <p className="text-warning-600 mt-0.5 text-caption">
                    {t(`只剩 ${left} 个位置`, `Only ${left} ${left === 1 ? 'spot' : 'spots'} left`)}
                  </p>
                )}
              </button>
              {/*
                加入是这张卡的重点，不能藏进详情页里 ——
                人到了球馆，最想做的第一件事就是「我来了」。
              */}
              <Button
                size="sm"
                variant={full || mine ? 'soft' : 'primary'}
                className="shrink-0"
                disabled={full || Boolean(mine)}
                onClick={() => {
                  if (!meId) {
                    switchTab('me')
                    return
                  }
                  /*
                   * 上限和「已经在别的局里」都由 store 判定，不看这里
                   * 算出来的 full / mine —— 界面这份是同步过来的数据，
                   * 可能已经过时；加不进去就别跳转，留在原地能看见原因。
                   */
                  if (joinSession(s.id, meId)) push({ name: 'board', sessionId: s.id })
                }}
              >
                {full ? t('已满', 'Full') : mine ? t('加不了', 'Busy') : t('加入', 'Join')}
              </Button>
            </div>
            {!meId && (
              <p className="text-ink-500 mt-2 text-caption">
                {t(
                  '先在「我的」里登录、建好你自己，才能加入',
                  'Sign in and create yourself under “Me” before joining',
                )}
              </p>
            )}
            {/*
              已经在别的局里 —— 按钮灰着不说原因，人只会以为坏了。
              这句话还得带上是哪一场，否则他不知道该去哪儿退。
            */}
            {meId && mine && (
              <button
                className="text-brand-600 mt-2 block text-left text-caption"
                onClick={() => push({ name: 'board', sessionId: mine.id })}
              >
                {t(
                  `你还在「${venueLabel(mine.venue)}」那一场里 —— 先结束或退出才能加别的`,
                  `You are still in the session at ${venueLabel(mine.venue)} — end or leave it first`,
                )}
              </button>
            )}
          </Card>
        )
      })}
    </>
  )
}
