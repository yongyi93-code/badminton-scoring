import { useEffect, useMemo, useState } from 'react'
import { useT, lang } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { Body, Button, Card, EmptyState, Pill, Segmented, Toast, cx } from '@/components/ui'
import { emptyProgress, progressByPlayer } from '@/lib/avatar'
import { homeVenues } from '@/lib/venues'
import { stateName } from '@/lib/region'
import {
  fetchLeaderboard,
  fetchMyRow,
  leaveLeaderboard,
  myTally,
  publishMe,
  type LeaderRow,
} from '@/lib/leaderboard'

/* ------------------------------------------------------------------ *
 * 全国榜 / 地区榜
 *
 * 和「本群」那一栏的区别不只是范围，是**数据从哪来**：
 * 本群那份是从本机的比赛记录当场算出来的；这一份是别人各自报上来的。
 *
 * 为什么只能这样：records 那张表的读策略是「只读得到自己在的球群」，
 * 那是这个 App 权限的地基，不会为了一个排行榜掀开。所以换成
 * 「各自报各自的结果」—— 比赛记录一行都不出自己的群。
 * 细节在 supabase/017-leaderboard.sql 开头。
 *
 * -------------------------------------------------------------------
 * 榜上那个「✓ N」是这一屏最要紧的东西
 *
 * MMR 是自己报的，理论上能编。但「有多少场被对手确认过」编不了多少 ——
 * 那要求对面的人在自己手机上点过头。
 *
 * 所以它和 MMR 并排显示，而不是藏起来。一个 MMR 很高、确认数是 0 的人，
 * 和一个 MMR 一般、确认了四十场的人，看榜的人自己会做判断。
 * 假装这个榜是权威的，比把它的底细摊开更糟。
 * ------------------------------------------------------------------ */

export function NationalBoard() {
  const t = useT()
  const zh = lang() === 'zh'
  const { players, sessions, matches, venues, meId } = useApp()

  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [me, setMe] = useState<LeaderRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  /* 我该报上去的那几个数。和「我的」那页显示的是同一份计算 */
  const mine = useMemo(() => {
    if (!meId) return null
    const p = players.find((x) => x.id === meId)
    if (!p) return null
    const progress = progressByPlayer(matches).get(meId) ?? emptyProgress()
    const tally = myTally(matches, meId)
    /*
     * 州跟着主场球馆走 —— 一个人可能在三个馆打过，但总有一个是常去的。
     * 认不出来就是空，那种情况只上全国榜。
     */
    const home = homeVenues(sessions, matches).get(meId)
    const venue = home ? venues.find((v) => v.key === home.key) : undefined
    return {
      name: p.name,
      mmr: progress.mmr,
      wins: tally.wins,
      losses: tally.losses,
      confirmed: tally.confirmed,
      state: venue?.state ?? null,
    }
  }, [meId, players, matches, sessions, venues])

  const myState = me?.state ?? mine?.state ?? null

  const load = async () => {
    const [list, row] = await Promise.all([
      fetchLeaderboard(scope === 'mine' ? myState : null),
      fetchMyRow(),
    ])
    setRows(list)
    setMe(row)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, myState])

  const join = async () => {
    if (!mine) return
    setBusy(true)
    const r = await publishMe(mine)
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setNote(t('上榜了', 'You are on the board'))
    await load()
  }

  const leave = async () => {
    setBusy(true)
    const r = await leaveLeaderboard()
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setNote(t('已经下榜了', 'You are off the board'))
    await load()
  }

  /** 报上去的数和现在算出来的对不对得上。对不上说明打完新的了 */
  const stale =
    me != null &&
    mine != null &&
    (me.mmr !== mine.mmr || me.wins !== mine.wins || me.losses !== mine.losses)

  return (
    <Body>
      {myState && (
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: t('全国', 'Malaysia') },
            { value: 'mine', label: stateName(myState, zh) },
          ]}
        />
      )}

      {/* ------------------------------------------------------------ *
        上榜 / 下榜。

        默认不在榜上，而且这一条不折叠：把名字挂到一个全国范围的
        公开榜上，是该由本人点头的事，不是装了 App 就默认同意的。
      * ------------------------------------------------------------ */}
      {me === null ? (
        <Card>
          <p className="text-ink-900 text-label font-medium">
            {t('要上全国榜吗？', 'Join the national board?')}
          </p>
          <p className="text-ink-500 mt-1 text-caption">
            {t(
              '上了之后，全马来西亚用这个 App 的人都看得到你的名字、MMR、胜负场次和州。看不到你的比赛记录、球局和对手是谁。随时可以下榜。',
              'Everyone using the app in Malaysia will see your name, MMR, win-loss and state. They cannot see your matches, sessions or who you played. You can leave any time.',
            )}
          </p>
          <Button
            className="mt-3"
            variant="primary"
            block
            disabled={busy || !mine}
            onClick={() => void join()}
          >
            {mine ? t('上榜', 'Join') : t('先在球群里认领自己', 'Claim yourself in a club first')}
          </Button>
        </Card>
      ) : (
        <Card className="border-brand-500/40">
          <div className="flex items-center gap-2">
            <p className="text-ink-900 min-w-0 flex-1 text-label font-medium">
              {t('你在榜上', 'You are on the board')}
            </p>
            <Pill tone="brand" className="tnum shrink-0">
              MMR {me.mmr}
            </Pill>
          </div>
          {stale && (
            <p className="text-ink-500 mt-1 text-caption">
              {t(
                `榜上是 MMR ${me.mmr}，你现在是 ${mine!.mmr} —— 重报一次就更新了。`,
                `The board says ${me.mmr}, you are now ${mine!.mmr} — publish again to update.`,
              )}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={stale ? 'primary' : 'soft'}
              disabled={busy}
              onClick={() => void join()}
            >
              {t('更新我的成绩', 'Update my score')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void leave()}>
              {t('下榜', 'Leave')}
            </Button>
          </div>
        </Card>
      )}

      {rows === null ? (
        <p className="text-ink-500 text-caption">{t('正在拿…', 'Loading…')}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🇲🇾"
          title={t('榜上还没有人', 'Nobody on the board yet')}
          hint={t(
            '上榜是自愿的，所以一开始是空的。第一个上去的就是第一名。',
            'Joining is opt-in, so it starts empty. Whoever joins first is number one.',
          )}
        />
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div
              key={r.uid}
              className={cx(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5',
                r.uid === me?.uid ? 'bg-brand-100' : 'bg-surface',
              )}
            >
              <span className="text-ink-500 tnum w-6 shrink-0 text-center font-bold">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ink-900 truncate text-label font-medium">{r.name}</p>
                <p className="text-ink-500 tnum text-caption">
                  {[
                    stateName(r.state, zh),
                    t(`${r.wins}胜${r.losses}负`, `${r.wins}W ${r.losses}L`),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {/*
                「✓ N」= 有多少场被对手确认过。摆在 MMR 旁边而不是藏起来 ——
                MMR 是自己报的，这个数才是能看出深浅的那个。
              */}
              <span
                className={cx(
                  'tnum shrink-0 text-caption',
                  r.confirmed > 0 ? 'text-brand-600' : 'text-ink-300',
                )}
                title={t('对手确认过的场次', 'Matches the opponent confirmed')}
              >
                ✓{r.confirmed}
              </span>
              <span className="text-ink-900 tnum w-12 shrink-0 text-right text-label font-bold">
                {r.mmr}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-ink-500 text-caption">
        {t(
          'MMR 是各自的手机报上来的，所以「✓」那个数更值得看 —— 它要对手在自己手机上点过头才加得上去。',
          'MMR is self-reported, so the ✓ count is the one worth reading — it only goes up when an opponent confirms on their own phone.',
        )}
      </p>

      <Toast message={note} onClose={() => setNote(null)} />
      <Toast message={err} tone="error" onClose={() => setErr(null)} />
    </Body>
  )
}
