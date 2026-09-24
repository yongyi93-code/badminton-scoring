import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { useSocial } from '@/store/useSocial'
import {
  Body,
  Button,
  EmptyState,
  Screen,
  SectionTitle,
  Sheet,
  Toast,
  TopBar,
} from '@/components/ui'
import { PlayerRow } from '@/components/PlayerBits'
import { decidedMatches } from '@/lib/ranking'
import { archiveBlocker, splitRoster } from '@/lib/roster'

/* ------------------------------------------------------------------ *
 * 球群成员
 *
 * 一直缺的那个按钮：**把不打了的人收起来**。
 *
 * `setPlayerArchived` 在 store 里放了很久，一处调用都没有 —— 于是
 * 退群的、建错的、代建重复的会一直堆在选人列表和排行榜上，而唯一的
 * 清理办法是到后台手写 SQL（真发生过：一个注销了账号的人留下一行
 * 0 场比赛的球员，最后是手写 SQL 软删的）。
 *
 * -------------------------------------------------------------------
 * 「收起来」不是「删掉」
 *
 * 他打过的每一场都原样留着 —— 那些比赛同时也是另外三个人的战绩，
 * 删掉等于改了别人的历史。和注销账号那边是同一条规矩：
 * **人要脱钩，比分要留**。
 *
 * 收起来之后他不再出现在选人、排行榜、好友搜索里，仅此而已。
 * 随时放得回来，所以这一屏也列着收起来的那些 —— 一个收得起来
 * 但找不回来的按钮，比没有那个按钮更吓人。
 *
 * -------------------------------------------------------------------
 * 谁能按
 *
 * 同一个球群里的人都能按，和这个 App 里别的东西一样（同群的人本来
 * 就能改彼此的比分，见 supabase/006-who-can-delete.sql）。
 * 挡住的只有两种**按了会立刻出乱子**的情形，见 lib/roster.ts。
 * ------------------------------------------------------------------ */

export function Roster() {
  const t = useT()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const matches = useApp((s) => s.matches)
  const meId = useApp((s) => s.meId)
  const setPlayerArchived = useApp((s) => s.setPlayerArchived)
  /*
   * 收人归管理员。这一道拦的是**手滑**不是坏人 —— 同群的人本来就能改
   * 彼此的比分，所以改过的客户端照样收得动（整段说明在 lib/roster.ts）。
   */
  const { isAdmin } = useSocial()

  /** 正要收起谁。null = 没在收 */
  const [picking, setPicking] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const { active, archived } = useMemo(() => splitRoster(players), [players])

  /* 打过几场。收起来之前要让人看见「这些一场都不会少」 */
  const gamesOf = useMemo(() => {
    const out = new Map<string, number>()
    for (const m of decidedMatches(matches, { includeFriendly: true })) {
      for (const id of [...m.teamA, ...m.teamB]) out.set(id, (out.get(id) ?? 0) + 1)
    }
    return out
  }, [matches])

  /** 还在进行中的球局里有谁 */
  const onCourt = useMemo(() => {
    const out = new Set<string>()
    for (const s of sessions) {
      if (s.status !== 'active') continue
      for (const id of s.playerIds) out.add(id)
    }
    return out
  }, [sessions])

  const target = picking ? players.find((p) => p.id === picking) : undefined

  const archive = (id: string) => {
    setPlayerArchived(id, true)
    setPicking(null)
    const name = players.find((p) => p.id === id)?.name ?? ''
    setNote(t(`${name} 收起来了`, `${name} is put away`))
  }

  const restore = (id: string) => {
    setPlayerArchived(id, false)
    const name = players.find((p) => p.id === id)?.name ?? ''
    setNote(t(`${name} 回来了`, `${name} is back`))
  }

  const rowOf = (id: string) => {
    const g = gamesOf.get(id) ?? 0
    return g > 0 ? t(`打过 ${g} 场`, `${g} matches played`) : t('还没打过球', 'No matches yet')
  }

  /*
   * 不是管理员就整屏不给看。
   *
   * 入口那边已经藏了（screens/Me），这儿是第二道：只藏入口的话，
   * 从别处跳进来照样看得到，而「藏起来了」和「真的进不去」是两件事。
   *
   * 说清楚这是一道什么门：这一屏上的东西（名字、打过几场）别处本来
   * 也看得到 —— 排名那一栏、每一场球局的名单、开局选人都列着同样的人。
   * 所以它挡的是「整个群的名册摊成一屏」，**不是保密**。
   * 真正决定谁看得到这些人的是「谁进得来这个群」。
   */
  if (!isAdmin) {
    return (
      <Screen>
        <TopBar title={t('球群成员', 'Club roster')} onBack={back} />
        <Body>
          <EmptyState
            icon="🔒"
            title={t('这一屏只有管理员看得到', 'Admins only')}
            hint={t(
              '谁在这个群里、谁不打了，由管理员管。要找人的话，开局选人那一屏和排名里都列着还在打的人。',
              'Who is in this club and who stopped is managed by admins. To find someone, the player picker and the rankings both list everyone still playing.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  return (
    <Screen>
      <TopBar title={t('球群成员', 'Club roster')} onBack={back} />
      <Body>
        {/*
          走到这儿的一定是管理员（上面整屏挡过了），所以这段话只说
          「你能做什么」，不用再分身份。
        */}
        <p className="text-ink-500 text-caption">
          {t(
            '不打了的人可以收起来 —— 他就不再出现在选人、排行榜和好友搜索里。他打过的比赛一场都不会少，因为那些同时也是别人的战绩。随时放得回来。',
            'Put away anyone who stopped playing — they disappear from pickers, leaderboards and friend search. Every match they played stays, because those are other people’s records too. You can bring them back any time.',
          )}
        </p>

        <SectionTitle>{t(`在打（${active.length} 人）`, `Playing (${active.length})`)}</SectionTitle>
        <div className="space-y-2">
          {active.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              meta={rowOf(p.id)}
              onClick={() => push({ name: 'profile', playerId: p.id })}
              right={
                <button
                  onClick={() => setPicking(p.id)}
                  className="text-ink-500 active:text-danger-600 shrink-0 px-2 py-2 text-caption"
                >
                  {t('收起来', 'Put away')}
                </button>
              }
            />
          ))}
        </div>

        {/*
          收起来的那些也列出来。

          一个收得起来但找不回来的按钮，比没有那个按钮更吓人 ——
          按下去之前人得先看见「后悔了怎么办」。
        */}
        {archived.length > 0 && (
          <>
            <SectionTitle>
              {t(`不打了（${archived.length} 人）`, `Stopped (${archived.length})`)}
            </SectionTitle>
            <div className="space-y-2">
              {archived.map((p) => (
                <PlayerRow
                  key={p.id}
                  player={p}
                  meta={rowOf(p.id)}
                  onClick={() => push({ name: 'profile', playerId: p.id })}
                  right={
                    <button
                      onClick={() => restore(p.id)}
                      className="text-brand-600 shrink-0 px-2 py-2 text-caption"
                    >
                      {t('放回来', 'Bring back')}
                    </button>
                  }
                />
              ))}
            </div>
          </>
        )}

        {active.length === 0 && archived.length === 0 && (
          <EmptyState
            icon="🏸"
            title={t('这个球群里还没有人', 'Nobody in this club yet')}
            hint={t('开一场球局的时候就能加人。', 'Add people when you start a session.')}
          />
        )}
      </Body>

      {/* ------------------------------------------------------------ *
        收起来之前问一句。

        不是走流程：这一下会让一个人从所有名单里消失，而他本人多半
        不在场。问一句的成本是一次点击，不问的成本是有人第二天发现
        自己不见了。
      * ------------------------------------------------------------ */}
      <Sheet
        open={Boolean(target)}
        onClose={() => setPicking(null)}
        title={t('收起来', 'Put away')}
      >
        {target && (
          <div className="space-y-4">
            <p className="text-ink-700 text-label">
              {t(
                `${target.name} 不再出现在选人、排行榜和好友搜索里。他打过的 ${gamesOf.get(target.id) ?? 0} 场比赛一场都不会少 —— 那些同时也是别人的战绩。`,
                `${target.name} disappears from pickers, leaderboards and friend search. All ${gamesOf.get(target.id) ?? 0} matches they played stay — those are other people’s records too.`,
              )}
            </p>

            {(() => {
              const bad = archiveBlocker(target, { meId, onCourt, isAdmin })
              if (!bad) {
                return (
                  <div className="space-y-2">
                    <Button block variant="dangerSoft" onClick={() => archive(target.id)}>
                      {t('收起来', 'Put away')}
                    </Button>
                    <Button block variant="ghost" onClick={() => setPicking(null)}>
                      {t('先不', 'Not now')}
                    </Button>
                  </div>
                )
              }
              return (
                <>
                  <div className="border-warning-600/30 bg-warning-50 rounded-card border p-3.5">
                    <p className="text-ink-700 text-caption">
                      {/*
                        'not-admin' 这一支现在走不到（整屏已经挡过了）。
                        留着是因为那个判断是 archiveBlocker 的合同，
                        哪天这一屏又对所有人开放，少了它就是个默默失效
                        的门 —— 而那种失效没人会发现。
                      */}
                      {bad === 'not-admin'
                        ? t(
                            '这件事归管理员。收起一个人等于把他从这个群的每一个名单里拿掉，而他不会收到任何通知 —— 所以不该是谁都按得动的。找管理员说一声。',
                            'Only an admin can do this. Putting someone away removes them from every list in this club, and they are not notified — so it should not be one tap for everyone. Ask an admin.',
                          )
                        : bad === 'self'
                        ? t(
                            '这是你自己。要退出这个球群的话在「我的」里换球群，要连账号一起删就用注销账号 —— 把自己收起来只会让你在自己的球群里消失，而账号还在。',
                            'This is you. To leave this club, switch clubs under “Me”; to delete your account, use Delete account. Putting yourself away would only make you vanish inside your own club while the account stays.',
                          )
                        : t(
                            '他还在一场进行中的球局里。先把那一场打完或者把他移出去 —— 现在收起来的话，场上会挂着一个名单里找不到的人。',
                            'They are still in a live session. Finish it or remove them from it first — otherwise the court shows someone who is no longer in the roster.',
                          )}
                    </p>
                  </div>
                  <Button block variant="ghost" onClick={() => setPicking(null)}>
                    {t('知道了', 'Got it')}
                  </Button>
                </>
              )
            })()}
          </div>
        )}
      </Sheet>

      <Toast message={note} onClose={() => setNote(null)} />
    </Screen>
  )
}
