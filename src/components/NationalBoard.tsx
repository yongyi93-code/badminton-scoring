import { useEffect, useMemo, useState } from 'react'
import { useT, lang } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Button, Card, EmptyState, Pill, Segmented, Toast, cx } from '@/components/ui'
import { emptyProgress, progressByPlayer } from '@/lib/avatar'
import { homeVenues } from '@/lib/venues'
import { stateName } from '@/lib/region'
import { useAuth } from '@/store/useAuth'
import {
  fetchLeaderboard,
  fetchMyRows,
  leaveLeaderboard,
  mergePeople,
  myTally,
  publishMe,
  scopeKey,
  type LeaderPerson,
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
 *
 * -------------------------------------------------------------------
 * 串场的人：一个球群报一次，榜上合成一个人
 *
 * 手机只装得下当前那个球群的数据，所以它报得出来的永远只是
 * 「我在这个群的成绩」。周末去别人的群打了一场，那一份要在那个群里
 * 报一次 —— 两份在榜上合并成一个人（mergePeople）。
 *
 * 所以这一屏会出现一种以前没有的状态：**人在榜上，但当前这个群
 * 还没报过**。那一刻最要紧的是把它说出来，而不是显示一个看起来
 * 正常、其实少了一半的合计。
 * ------------------------------------------------------------------ */

export function NationalBoard() {
  const t = useT()
  const zh = lang() === 'zh'
  const { players, sessions, matches, venues, meId, clubId, clubs } = useApp()
  const { session } = useAuth()
  const uid = session?.user.id ?? null
  const push = useNav((s) => s.push)

  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [rows, setRows] = useState<LeaderPerson[] | null>(null)
  const [myRows, setMyRows] = useState<LeaderRow[]>([])
  const [hereKey, setHereKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  /*
   * 「我在这个群」那一行的钥匙。算它要走一次 SubtleCrypto，是异步的，
   * 所以先算出来放着 —— 渲染里不能等。
   */
  useEffect(() => {
    let alive = true
    if (!uid || !clubId) {
      setHereKey(null)
      return
    }
    void scopeKey(uid, clubId).then((k) => {
      if (alive) setHereKey(k)
    })
    return () => {
      alive = false
    }
  }, [uid, clubId])

  /** 我在榜上的合计。一行都没有就是没上榜 */
  const me = useMemo(() => mergePeople(myRows)[0] ?? null, [myRows])
  /** 当前这个球群那一行。没有 = 这个群的成绩还没报上去 */
  const here = useMemo(
    () => (hereKey ? (myRows.find((r) => r.scope === hereKey) ?? null) : null),
    [myRows, hereKey],
  )
  const clubName = clubs.find((c) => c.id === clubId)?.name ?? ''

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
    const [list, my] = await Promise.all([
      fetchLeaderboard(scope === 'mine' ? myState : null),
      fetchMyRows(),
    ])
    setRows(list)
    setMyRows(my)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, myState])

  const join = async () => {
    if (!mine || !clubId) return
    setBusy(true)
    const r = await publishMe(mine, clubId)
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setNote(t('报上去了', 'Published'))
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

  /*
   * 报上去的数和现在算出来的对不对得上。
   *
   * 比的是**当前这个群那一行**，不是合计 —— 合计里还有别的群的成绩，
   * 拿它跟本机这个群算出来的数比，永远对不上，那个提示就会一直挂着。
   */
  const stale =
    here != null &&
    mine != null &&
    (here.mmr !== mine.mmr || here.wins !== mine.wins || here.losses !== mine.losses)

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
          <p className="text-ink-500 mt-1 text-caption">
            {t(
              '在几个球群打球的话，每个群里各报一次，榜上合成一个人 —— 看榜的人看不出你在哪几个群。',
              'If you play in more than one club, publish once inside each — the board adds them into one person, and nobody can tell which clubs they are.',
            )}
          </p>
          <Button
            className="mt-3"
            variant="primary"
            block
            disabled={busy || !mine || !clubId}
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

          {/*
            合计是几个群加起来的 —— 这一句只在真的不止一个群时出现。
            不说的话，一个刚串完场的人会盯着一个比本群高出一截的 MMR
            发愣，以为算错了。
          */}
          {me.clubs > 1 && (
            <p className="text-ink-500 mt-1 text-caption">
              {t(
                `合计的是你在 ${me.clubs} 个球群报过的成绩。`,
                `That total adds up what you published in ${me.clubs} clubs.`,
              )}
            </p>
          )}

          {/* ---------------------------------------------------------- *
            人在榜上，当前这个群还没报过 —— 串场之后最常见的一种。

            这一条要摆在「更新」前面：他此刻看到的合计是对的，
            只是**不包含他今晚打的这些**，而按「更新」才是解法。
          * ---------------------------------------------------------- */}
          {here === null ? (
            <p className="text-warning-600 mt-1 text-caption">
              {t(
                `${clubName ? `「${clubName}」` : '这个球群'}的成绩还没报上去 —— 榜上那个数里没有它。`,
                `What you did in ${clubName ? `“${clubName}”` : 'this club'} is not in that total yet.`,
              )}
            </p>
          ) : (
            stale &&
            /*
              对不上的可能是 MMR，也可能只是场次（赢一场输一场，MMR 回到原处）。
              原来这句话写死了只提 MMR，于是后一种情况显示成
              「报上去的是 20，你现在是 20 —— 重报一次就更新了」，看起来像坏了。
            */
            (here.mmr !== mine!.mmr ? (
              <p className="text-ink-500 mt-1 text-caption">
                {t(
                  `这个球群报上去的是 MMR ${here.mmr}，你现在是 ${mine!.mmr} —— 重报一次就更新了。`,
                  `This club’s row says MMR ${here.mmr}, you are now ${mine!.mmr} — publish again to update.`,
                )}
              </p>
            ) : (
              <p className="text-ink-500 mt-1 text-caption">
                {t(
                  `这个球群报上去之后又打了几场，榜上还是旧的场次 —— 重报一次就更新了。`,
                  `You have played more in this club since — publish again to update.`,
                )}
              </p>
            ))
          )}

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={stale || here === null ? 'primary' : 'soft'}
              disabled={busy || !mine || !clubId}
              onClick={() => void join()}
            >
              {here === null
                ? t('把这个群的也报上去', 'Add this club')
                : t('更新我的成绩', 'Update my score')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void leave()}>
              {t('下榜', 'Leave')}
            </Button>
          </div>

          {/* 下榜是一个决定，不是一个群一个开关 —— 按之前得知道它删的是全部 */}
          {me.clubs > 1 && (
            <p className="text-ink-500 mt-2 text-caption">
              {t(
                `「下榜」会把你在这 ${me.clubs} 个球群报过的都撤下来，不是只撤当前这个。`,
                `“Leave” takes down all ${me.clubs} of your published clubs, not just this one.`,
              )}
            </p>
          )}
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
              {/*
                点得动 —— 这是**全国榜唯一的出口**。
                在这儿看到一个人，下一个动作必然是「他是谁、能不能加」，
                而在有个人主页之前，这一屏是一张看得见摸不着的名单：
                串场认识的人在别的球群，好友那一屏按名字根本搜不到他。

                名字带过去（hint）：他的名片我多半读不到（不是好友、
                不同群），没有这个，主页上会显示「不认识的人」——
                而我明明刚在榜上看到他叫什么。
              */}
              <button
                onClick={() => push({ name: 'person', uid: r.uid, hint: r.name })}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-ink-900 truncate text-label font-medium">{r.name}</p>
                <p className="text-ink-500 tnum text-caption">
                  {[
                    stateName(r.state, zh),
                    t(`${r.wins}胜${r.losses}负`, `${r.wins}W ${r.losses}L`),
                    /*
                      不止一个群才显示。这个数说明的是「他这个合计是几份
                      加起来的」，不是「他在哪几个群」—— 后者这张表里
                      根本没有（见 018-cross-club.sql）。
                    */
                    r.clubs > 1 ? t(`${r.clubs} 个球群`, `${r.clubs} clubs`) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </button>
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
