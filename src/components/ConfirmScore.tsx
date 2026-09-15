import { useMemo } from 'react'
import { useT } from '@/lib/i18n'
import { rosterForSession, useApp } from '@/store/useApp'
import { shouldAsk, withConfirm, withDispute } from '@/lib/confirm'
import { Button } from '@/components/ui'
import type { Session } from '@/types'

/* ------------------------------------------------------------------ *
 * 「这个比分对吗」
 *
 * 一场打完之后，问场上其他装了 App 的人一句。规矩在 lib/confirm.ts，
 * 这里只说为什么它长这样：
 *
 * **它不拦任何事。** 比分记下来就算数了，MMR、金币、排行榜照走。
 * 这一条出现的时候，那一场已经进了榜 —— 所以它是一个问句，
 * 不是一道闸。要每一场都等人点才算数的话，球场上没人受得了。
 *
 * **「不对」不会把那一场撤下来。** 撤的话，每个输的人都会点它。
 * 点了之后发生的事是：那一场被标出来，谁都看得见，催拿手机的人
 * 退回去改。改完大家重新表态。
 *
 * 不问没装 App 的人 —— 他们手机上没有这个按钮，
 * 把他们算进「还差谁」只会让那一行永远消不掉。
 *
 * -------------------------------------------------------------------
 * 为什么两个地方都要摆
 *
 * 看板（还在打）和结算（打完了）各一份。
 *
 * 光摆在看板上是不够的：球局一结束，列表里点那一场就跳去结算，
 * 看板根本回不去了 —— 而人恰恰是回到家躺下才翻手机的，
 * 那时候这个问句要是只活在看板上，等于没有。
 * ------------------------------------------------------------------ */
export function ConfirmScore({ session }: { session: Session }) {
  const t = useT()
  const meId = useApp((s) => s.meId)
  const matches = useApp((s) => s.matches)
  const players = useApp((s) => s.players)
  const updateMatch = useApp((s) => s.updateMatch)

  const names = useMemo(() => rosterForSession(players, session), [players, session])
  const nameOf = (id: string) => names.get(id)?.name ?? '?'

  /*
   * 时间只用来判「过没过 24 小时」，读一次就够。
   * 挂个定时器每分钟重渲染，是为了让一行字准点消失 ——
   * 不值得，而且那一屏正有人在记分。
   */
  const now = Date.now()
  const asking = matches.filter(
    (m) => m.sessionId === session.id && shouldAsk(m, meId, players, now),
  )
  if (!meId || asking.length === 0) return null

  return (
    <>
      {asking.map((m) => (
        <div key={m.id} className="border-line bg-surface rounded-card border px-4 py-3.5">
          <p className="text-ink-900 font-semibold">
            {t('这一场的比分对吗？', 'Is this score right?')}
          </p>
          <p className="text-ink-700 mt-0.5 text-label">
            {m.teamA.map(nameOf).join(' / ')}
            <span className="tnum mx-1.5 font-semibold">
              {m.games.map((g) => `${g.a}-${g.b}`).join(' ')}
            </span>
            {m.teamB.map(nameOf).join(' / ')}
          </p>
          <p className="text-ink-500 mt-1 text-caption">
            {m.recordedBy
              ? t(`${nameOf(m.recordedBy)} 记的分`, `Recorded by ${nameOf(m.recordedBy)}`)
              : t('不知道谁记的分', 'Recorder unknown')}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              variant="primary"
              onClick={() => updateMatch(m.id, withConfirm(m, meId))}
            >
              {t('没错', 'Looks right')}
            </Button>
            {/*
              点「不对」不会撤销任何东西，所以不用二次确认 ——
              它只是把这一场标出来给拿手机的人看。点错了再点「没错」就回去了。
            */}
            <Button
              className="flex-1"
              variant="soft"
              onClick={() => updateMatch(m.id, withDispute(m, meId))}
            >
              {t('不对', 'Not right')}
            </Button>
          </div>
        </div>
      ))}
    </>
  )
}
