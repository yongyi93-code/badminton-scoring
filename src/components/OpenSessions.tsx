import { useMemo } from 'react'
import { useT } from '@/lib/i18n'
import { isFull, spotsLeft, useApp } from '@/store/useApp'
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
 * ------------------------------------------------------------------ */

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

  /** 进行中、而且我不在里面的 —— 我在里面的那场首页上面已经有大卡片了 */
  const others = useMemo(
    () =>
      sessions
        .filter((s) => s.status === 'active' && (!meId || !s.playerIds.includes(meId)))
        .sort((a, b) => b.createdAt - a.createdAt),
    [sessions, meId],
  )

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
                variant={full ? 'soft' : 'primary'}
                className="shrink-0"
                disabled={full}
                onClick={() => {
                  if (!meId) {
                    switchTab('me')
                    return
                  }
                  /*
                   * 上限由 store 判定，不看这里算出来的 full ——
                   * 界面这份是同步过来的数据，可能已经过时；
                   * 加不进去就别跳转，留在原地能看见「已满」。
                   */
                  if (joinSession(s.id, meId)) push({ name: 'board', sessionId: s.id })
                }}
              >
                {full ? t('已满', 'Full') : t('加入', 'Join')}
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
          </Card>
        )
      })}
    </>
  )
}
