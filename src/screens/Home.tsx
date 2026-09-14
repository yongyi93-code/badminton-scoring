import { useT } from '@/lib/i18n'
import { useMemo } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { OpenSessions } from '@/components/OpenSessions'
import { InstallCard } from '@/components/InstallCard'
import { Body, Card, Screen, cx } from '@/components/ui'
import { RallyLogo, RallyMark } from '@/components/Brand'
import { NoticeBoard } from '@/components/NoticeBoard'
import { formatDate, formatTime, percent, todayISO, weekOf } from '@/lib/format'
import { buildFeed, type FeedItem } from '@/lib/feed'
import { scoreLine } from '@/lib/scoring'
import { computeStats } from '@/lib/ranking'
import { venueLabel } from '@/lib/venues'
import { TeamNames } from '@/components/PlayerBits'

/* ------------------------------------------------------------------ *
 * 首页
 *
 * 一屏回答三件事，顺序就是它们的轻重：
 *   1. 我现在该去哪（那张深绿的大卡）
 *   2. 我能开一局 / 能加一局（两块入口）
 *   3. 我这周打得怎么样（三个数）
 *
 * 深绿那张卡是全屏唯一的重色块，别的都是白卡 —— 一屏只有一个
 * 「最要紧」，它得一眼就被认出来，而不是和别的卡比谁的边框更亮。
 * ------------------------------------------------------------------ */

export function Home() {
  const t = useT()
  const { players, sessions, matches, meId } = useApp()
  const push = useNav((s) => s.push)
  const switchTab = useNav((s) => s.switchTab)

  const nameOf = useMemo(
    () => new Map(players.map((p) => [p.id, p.name])),
    [players],
  )

  /*
   * 主行动卡只认「我在里面的那一场」。
   * 球局公开之后，同一时间可能有好几场在开 —— 拿第一场当「你的球局」
   * 会把别人的局显示成「继续 →」，点进去一脸茫然。
   */
  const active = sessions.find(
    (s) => s.status === 'active' && (!meId || s.playerIds.includes(meId)),
  )

  /* 进行中的那几场，首页直接把实时比分摆出来 —— 规格 §A 的主行动卡 */
  const liveMatches = useMemo(
    () =>
      active
        ? matches
            .filter((m) => m.sessionId === active.id && m.status === 'playing')
            .sort((a, b) => (a.courtIndex ?? 0) - (b.courtIndex ?? 0))
        : [],
    [matches, active],
  )

  const playedIn = (sessionId: string) =>
    matches.filter((m) => m.sessionId === sessionId && m.status === 'done').length

  /*
   * 本周三个数。
   *
   * 按「球局那天」算，不按比赛落库的时间 —— 一场从周日晚上打到
   * 周一凌晨的球局，是周日那一场，不该被劈成两周。
   */
  const week = useMemo(() => {
    if (!meId) return null
    const days = new Set(weekOf(todayISO()))
    const ids = new Set(
      sessions.filter((s) => days.has(s.date)).map((s) => s.id),
    )
    if (ids.size === 0) return null
    const mine = matches.filter((m) => ids.has(m.sessionId))
    const [stat] = computeStats(mine, [meId], 0)
    return stat.games > 0 ? stat : null
  }, [sessions, matches, meId])

  /* 快讯全部从比赛记录现算，所以删掉一场比赛消息会跟着变，不会留下旧账 */
  const feed = useMemo(
    () => buildFeed(players, sessions, matches),
    [players, sessions, matches],
  )

  const openFeed = (item: FeedItem) => {
    const l = item.link
    if (!l) return
    if (l.kind === 'leaderboard') push({ name: 'leaderboard', venue: l.venue })
    else if (l.kind === 'player') push({ name: 'profile', playerId: l.playerId })
    else push({ name: 'summary', sessionId: l.sessionId })
  }

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-1">
        <RallyLogo className="text-[26px]" tagline={false} />
      </header>

      <Body className="pt-3">
        {/*
          一句话把这个 App 是干什么的说完。
          下面那张卡说的是「今晚这一场」，这两行说的是「为什么要有今晚」——
          第一次打开的人只看得到这两行，那就得是人话，不是功能列表。
        */}
        <div className="pt-1">
          <h1 className="text-h1">{t('今晚，来一局。', 'Play tonight.')}</h1>
          <p className="text-ink-500 mt-1 text-label">
            {t('好球友 · 好场地 · 好状态', 'Good people · good courts · great rallies')}
          </p>
        </div>

        {/*
          最上面一排：公告，横着划。
          原来这里是一条细细的滚动快讯（Ticker），内容和现在这排是同一份 ——
          两个都放就是把同一件事说两遍，所以留看得清的那个。
        */}
        <NoticeBoard feed={feed} onOpen={openFeed} />

        {/*
          「装到手机上」。放在主行动卡上面，因为对一个还没装的人来说，
          这是这一屏最要紧的一件事 —— 不装的话他下次根本找不回来。
          装过、或者他划掉过，这块自己不出现。
        */}
        <InstallCard />

        {/* 主行动卡：任何时候都能一次点击回到当前球局 */}
        {active ? (
          <HeroCard
            eyebrow={t('下一场球局', 'Your session')}
            title={venueLabel(active.venue)}
            lines={[
              `${formatDate(active.date)}${formatTime(active.time) ? ` · ${formatTime(active.time)}` : ''}`,
              t(
                `${active.playerIds.length} 人 · ${active.courtCount} 片场地 · 已打 ${playedIn(active.id)} 场`,
                `${active.playerIds.length} players · ${active.courtCount} courts · ${playedIn(active.id)} played`,
              ),
            ]}
            cta={t('进入球局 →', 'Enter session →')}
            onClick={() => push({ name: 'board', sessionId: active.id })}
          >
            {liveMatches.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-white/20 pt-3">
                {liveMatches.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-label text-white/90">
                    <span className="shrink-0 text-white/60">
                      {t(`${(m.courtIndex ?? 0) + 1} 号场`, `Court ${(m.courtIndex ?? 0) + 1}`)}
                    </span>
                    <TeamNames ids={m.teamA} names={nameOf} className="min-w-0 flex-1 text-right" />
                    <span className="tnum text-accent shrink-0 font-semibold">
                      {scoreLine(m.games)}
                    </span>
                    <TeamNames ids={m.teamB} names={nameOf} className="min-w-0 flex-1" />
                  </div>
                ))}
              </div>
            )}
          </HeroCard>
        ) : (
          <HeroCard
            eyebrow={t('还没有球局', 'Nothing on yet')}
            title={t('今晚去打球？', 'Playing tonight?')}
            lines={[
              t(
                '开一个局，装了 App 的球友自己就能加进来',
                'Start one — everyone with the app can join it themselves',
              ),
              t(
                'RALLY 负责公平排场、记分和算排名',
                'RALLY handles fair rotation, scoring and rankings',
              ),
            ]}
            cta={t('开新球局 →', 'New session →')}
            onClick={() => push({ name: 'setup' })}
          />
        )}

        {/*
          两块入口。开局和加局是两件事，放成两块比塞进一个按钮里说得清：
          开局的人知道自己要开，加局的人是来找的。
        */}
        <div className="grid grid-cols-2 gap-3">
          <ActionTile
            title={t('发起球局', 'Start a session')}
            hint={t('约球从这里开始', 'Where a night begins')}
            onClick={() => push({ name: 'setup' })}
            icon={
              <path
                d="M12 6v12M6 12h12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            }
          />
          <ActionTile
            title={t('加入球局', 'Join a session')}
            hint={t('找到合适的球局', 'Find one near you')}
            onClick={() => switchTab('sessions')}
            icon={
              <>
                <circle cx="9" cy="9" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M3.8 19a5.2 5.2 0 0 1 10.4 0M16 6.4a3 3 0 0 1 0 5.2M17.6 19a5.4 5.4 0 0 0-2.2-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </>
            }
          />
        </div>

        {/* 本周表现。一场都没打的那一周不显示 —— 三个 0 不是信息，是打击 */}
        {week && (
          <Card>
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="text-brand-600 size-4" aria-hidden>
                <path
                  d="M4 20V12M10 20V5M16 20v-6M22 20H2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <h2 className="text-title">{t('本周表现', 'This week')}</h2>
            </div>
            <div className="mt-3 grid grid-cols-3">
              <Stat value={String(week.games)} label={t('比赛', 'Matches')} />
              <Stat value={String(week.wins)} label={t('胜场', 'Wins')} />
              <Stat value={percent(week.winRate)} label={t('胜率', 'Win rate')} />
            </div>
          </Card>
        )}

        <OpenSessions />

        {/*
          首页到此为止。
          「最近球局」原来摆在这下面，现在没了 —— 它回答的是「我们打过什么」，
          而这一屏要回答的是「现在有什么可以参加」。翻旧账去「球局」那个 tab，
          那里本来就有全部历史。
        */}
      </Body>
    </Screen>
  )
}

/* ------------------------------------------------------------------ *
 * 首页自己的几块
 * ------------------------------------------------------------------ */

/**
 * 深绿主卡。
 *
 * 背景里那枚很淡的 R 和几条球场线不是装饰得好看 —— 一整块纯色
 * 在手机上会显得像一个没加载完的占位块。给它一点纹理，它才像一张卡。
 * 都压到 8% 以下的不透明度，压在上面的字不受影响。
 */
function HeroCard({
  eyebrow,
  title,
  lines,
  cta,
  onClick,
  children,
}: {
  eyebrow: string
  title: string
  lines: string[]
  cta: string
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <div
      className="bg-brand-solid shadow-card relative overflow-hidden rounded-card p-5 text-white"
    >
      {/*
        一片羽球场，从上方斜着看下去。画的是真的那几条线 ——
        外框、单打边线、前后发球线、中线 —— 不是随手的网格：
        打球的人一眼认得出自己站在哪，认不出来的图案就只是噪点。
      */}
      <svg
        viewBox="0 0 160 120"
        className="pointer-events-none absolute -right-6 -bottom-7 h-36 w-auto opacity-[0.14]"
        aria-hidden
      >
        <g
          fill="none"
          stroke="#fff"
          strokeWidth="1.2"
          transform="translate(80 60) rotate(-8) translate(-80 -60)"
        >
          <rect x="26" y="10" width="108" height="100" />
          <rect x="34" y="10" width="92" height="100" />
          <path d="M26 60h108" strokeWidth="2" />
          <path d="M26 36h108M26 84h108M80 10v26M80 84v26" />
        </g>
      </svg>
      {/* 右上角那一枚小小的 R —— 卡片的落款 */}
      <RallyMark
        tone="onDark"
        className="pointer-events-none absolute top-4 right-4 h-7 w-auto opacity-25"
      />

      <div className="relative">
        <p className="text-caption tracking-[0.18em] text-white/60 uppercase">{eyebrow}</p>
        <p className="mt-1.5 text-h2">{title}</p>
        {lines.map((l) => (
          <p key={l} className="mt-1 text-label text-white/80">
            {l}
          </p>
        ))}

        {children}

        {/*
          柠檬绿的那一枚。深绿底上再放一个深绿按钮是看不出来的，
          白按钮又和卡里的白字混在一起 —— 所以这里用整套里唯一的暖色。
        */}
        <button
          onClick={onClick}
          className="bg-accent text-on-accent active:bg-accent-press mt-4 inline-flex h-11 items-center rounded-full px-5 text-title"
        >
          {cta}
        </button>
      </div>
    </div>
  )
}

function ActionTile({
  title,
  hint,
  icon,
  onClick,
}: {
  title: string
  hint: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <Card onClick={onClick} className="text-center">
      <span className="bg-brand-solid text-on-brand mx-auto flex size-11 items-center justify-center rounded-full">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          {icon}
        </svg>
      </span>
      <p className="mt-2.5 text-title">{title}</p>
      <p className="text-ink-500 mt-0.5 text-caption">{hint}</p>
    </Card>
  )
}

function Stat({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <div className={cx('text-center', className)}>
      <p className="tnum text-brand-600 text-h1">{value}</p>
      <p className="text-ink-500 mt-0.5 text-caption">{label}</p>
    </div>
  )
}
