import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { rosterForSession, useApp } from '@/store/useApp'
import { sameScore, scoreText, shouldAsk, withConfirm, withDispute } from '@/lib/confirm'
import { Button } from '@/components/ui'
import type { Match, Session } from '@/types'

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
 * 点了之后发生的事是：他要报出**自己认为的比分**，那个数摆到拿手机
 * 的人面前，一个按钮就能采纳。
 *
 * 「说出你认为是多少」这一步是关键。光说「不对」的话，拿手机的人
 * 只能挨个去问 —— 而多半的争议本来就是手滑多点了一分，
 * 对方把数报出来，一眼就认得出。
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
  /** 正在改哪一场的比分。null = 没在改 */
  const [fixing, setFixing] = useState<string | null>(null)

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
          {fixing === m.id ? (
            <ScoreFix
              match={m}
              onCancel={() => setFixing(null)}
              onSubmit={(games) => {
                setFixing(null)
                updateMatch(m.id, withDispute(m, meId, games))
              }}
            />
          ) : (
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
                它只是把你报的数摆到拿手机的人面前。点错了再点「没错」就回去了。
              */}
              <Button className="flex-1" variant="soft" onClick={() => setFixing(m.id)}>
                {t('不对', 'Not right')}
              </Button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ *
 * 「那你说是多少」
 *
 * 一局一行，两个数各配加减。不给键盘输入 ——
 * 球馆里手是湿的，而这个数从来只差一两分，点两下比打字快。
 *
 * 预填的是**现在记着的那个比分**，不是空的。争议几乎总是
 * 「21-18 应该是 21-19」这种，从现有的数上改一下最省事；
 * 空着让人从头填，反而容易填出第三个错的数来。
 * ------------------------------------------------------------------ */
function ScoreFix({
  match,
  onCancel,
  onSubmit,
}: {
  match: Match
  onCancel: () => void
  onSubmit: (games: { a: number; b: number }[]) => void
}) {
  const t = useT()
  const [games, setGames] = useState(() => match.games.map((g) => ({ a: g.a, b: g.b })))

  const bump = (i: number, side: 'a' | 'b', by: number) =>
    setGames((gs) =>
      gs.map((g, j) =>
        /* 不许变成负数。上限不管 —— 封顶分随赛制变，卡死了反而挡住正常的局 */
        j === i ? { ...g, [side]: Math.max(0, g[side] + by) } : g,
      ),
    )

  /* 一个字没改就发出去，等于说「不对」又说不出哪里不对 */
  const unchanged = sameScore(games, match.games)

  return (
    <div className="mt-3">
      <p className="text-ink-700 text-label">{t('那你说是多少？', 'What was it then?')}</p>
      <div className="mt-2 space-y-2">
        {games.map((g, i) => (
          <div key={i} className="flex items-center gap-2">
            {games.length > 1 && (
              <span className="text-ink-500 w-10 shrink-0 text-caption">
                {t(`第 ${i + 1} 局`, `G${i + 1}`)}
              </span>
            )}
            <Stepper value={g.a} onChange={(by) => bump(i, 'a', by)} />
            <span className="text-ink-500">:</span>
            <Stepper value={g.b} onChange={(by) => bump(i, 'b', by)} />
          </div>
        ))}
      </div>
      <p className="text-ink-500 mt-2 text-caption">
        {t(
          `现在记的是 ${scoreText(match.games)}`,
          `Currently recorded as ${scoreText(match.games)}`,
        )}
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1"
          variant="primary"
          disabled={unchanged}
          onClick={() => onSubmit(games)}
        >
          {t('就是这个', 'That’s the score')}
        </Button>
        <Button className="flex-1" variant="soft" onClick={onCancel}>
          {t('算了', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}

/** 一个数 + 加减。数字用等宽，按的时候不会整行跳 */
function Stepper({ value, onChange }: { value: number; onChange: (by: number) => void }) {
  return (
    <div className="border-line flex items-center gap-1 rounded-lg border px-1">
      <button
        className="text-ink-700 size-8 text-title"
        onClick={() => onChange(-1)}
        aria-label="-1"
      >
        −
      </button>
      <span className="text-ink-900 tnum w-7 text-center text-label font-semibold">{value}</span>
      <button
        className="text-ink-700 size-8 text-title"
        onClick={() => onChange(1)}
        aria-label="+1"
      >
        +
      </button>
    </div>
  )
}
