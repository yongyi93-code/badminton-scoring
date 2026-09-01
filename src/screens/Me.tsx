import { LANG_LABELS, type Lang, useLang, useT } from '@/lib/i18n'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { avatarOf, playerMap, useApp, type Backup } from '@/store/useApp'
import type { Gender } from '@/types'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  Card,
  Field,
  Pill,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  inputClass,
} from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import { RankChip } from '@/components/RankMedal'
import { AvatarView } from '@/components/Avatar'
import { stageOf } from '@/lib/avatarArt'
import { progressOf } from '@/lib/avatar'
import { computeStats, decidedMatches, sideOf } from '@/lib/ranking'
import { formatDate, percent, streakLabel } from '@/lib/format'
import { venueLabel } from '@/lib/venues'
import { BUILD_ID, buildStamp, forceUpdate } from '@/lib/update'
import { useTheme } from '@/store/useTheme'
import { cloudReady } from '@/lib/supabase'
import { signIn, signOut, signUp, useAuth } from '@/store/useAuth'
import { pullAll, pushAll, useSyncStatus } from '@/lib/sync'

const ARROW = (
  <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
)

/* ------------------------------------------------------------------ *
 * 登录 / 注册
 *
 * 同一个弹层两用，靠一个 Segmented 切 —— 分成两屏的话，
 * 「我到底注册过没有」这个最常见的困惑还得让人自己退出去重选。
 * ------------------------------------------------------------------ */

function AuthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const run = mode === 'in' ? signIn : signUp
    const res = await run(email, password)
    setBusy(false)
    if (res.ok) {
      setPassword('')
      onClose()
    } else {
      setError(res.error)
    }
  }

  const ready = email.trim().length > 3 && password.length >= 6

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'in' ? t('登录', 'Sign in') : t('注册', 'Create an account')}
    >
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={(v: 'in' | 'up') => {
            setMode(v)
            setError(null)
          }}
          options={[
            { value: 'in', label: t('登录', 'Sign in') },
            { value: 'up', label: t('注册', 'Sign up') },
          ]}
        />

        <Field label={t('邮箱', 'Email')}>
          <input
            className={inputClass}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Field
          label={t('密码', 'Password')}
          hint={mode === 'up' ? t('至少 6 位', 'At least 6 characters') : undefined}
        >
          <input
            className={inputClass}
            type="password"
            /* 注册和登录用不同的 autocomplete，密码管理器才知道是存还是填 */
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ready && !busy && void submit()}
          />
        </Field>

        {error && <p className="text-danger-600 text-label">{error}</p>}

        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          {busy
            ? t('稍等…', 'Working…')
            : mode === 'in'
              ? t('登录', 'Sign in')
              : t('注册并登录', 'Create account')}
        </Button>

        <p className="text-ink-500 text-caption">
          {t(
            '密码只用来登录同步，和球局数据没关系。忘了密码可以换个邮箱重新注册，本机数据不会丢。',
            'This password is only for syncing. Forget it and you can sign up with another email — nothing on this phone is lost.',
          )}
        </p>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ *
 * 云同步
 *
 * 云端为准：那张表是唯一的一份历史，这台手机是它的缓存。
 * 所以这一屏不再是「上传 / 下载」两个方向让人选 —— 平时它自己跑，
 * 这里只负责三件事：说清楚现在同步到哪了、卡住时能手动重来一次、
 * 以及全队重新开始时把东西清干净。
 * ------------------------------------------------------------------ */

function CloudSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const matches = useApp((s) => s.matches)
  const resetAll = useApp((s) => s.resetAll)
  const status = useSyncStatus()
  const [busy, setBusy] = useState<'pull' | 'push' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)

  const local = t(
    `${players.length} 位球员 · ${sessions.length} 场球局 · ${matches.length} 场比赛`,
    `${players.length} players · ${sessions.length} sessions · ${matches.length} matches`,
  )

  const line =
    status.state === 'syncing'
      ? t('同步中…', 'Syncing…')
      : status.state === 'error'
        ? status.message
        : status.state === 'idle'
          ? status.pending > 0
            ? t(`还有 ${status.pending} 条没推上去`, `${status.pending} changes still to push`)
            : t('已经和云端一致', 'Up to date with the cloud')
          : t('没在同步', 'Not syncing')

  const doPull = async () => {
    setMessage(null)
    setBusy('pull')
    const res = await pullAll()
    setBusy(null)
    if (!res.ok) setMessage(res.error)
    else if (res.empty)
      setMessage(t('云端还是空的', 'The cloud is still empty'))
    else setMessage(t('已经从云端刷新', 'Refreshed from the cloud'))
  }

  const doPush = async () => {
    setMessage(null)
    setBusy('push')
    const res = await pushAll()
    setBusy(null)
    setMessage(
      res.ok
        ? t(`已推上去 ${res.count} 条`, `Pushed ${res.count} rows`)
        : res.error,
    )
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('云同步', 'Cloud sync')}>
      <div className="space-y-4">
        <div className="bg-fill rounded-xl px-4 py-3">
          <p className="font-semibold">{local}</p>
          <p
            className={
              status.state === 'error'
                ? 'text-danger-600 mt-1 text-caption'
                : 'text-ink-500 mt-1 text-caption'
            }
          >
            {line}
          </p>
        </div>

        <p className="text-ink-500 text-caption">
          {t(
            '平时不用管它：记完分自己就推上去了，别人记的分也会自己出现。下面两个是卡住时才用的。',
            'It runs on its own — your scores go up and other people’s come down. The two below are only for when it gets stuck.',
          )}
        </p>

        <div className="space-y-2">
          <Button block variant="soft" disabled={busy !== null} onClick={() => void doPull()}>
            {busy === 'pull' ? t('刷新中…', 'Refreshing…') : t('从云端刷新一次', 'Refresh from the cloud')}
          </Button>
          <Button block variant="soft" disabled={busy !== null} onClick={() => void doPush()}>
            {busy === 'push' ? t('推送中…', 'Pushing…') : t('把这台手机的推上去', 'Push this phone up')}
          </Button>
        </div>

        {message && <p className="text-brand-600 text-label">{message}</p>}

        {/* 全队重新开始时用的。放在最下面，而且要点两下 */}
        <div className="border-line space-y-2 border-t pt-4">
          {confirmWipe ? (
            <>
              <p className="text-danger-600 text-label">
                {t(
                  '这会清掉所有球员、球局和比赛 —— 而且因为云端跟着这台手机走，云端那份也会一起没。每个人的手机都会变空。确定吗？',
                  'This clears every player, session and match — and because the cloud follows this phone, it goes too. Everyone’s phone ends up empty. Sure?',
                )}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => {
                    resetAll()
                    setConfirmWipe(false)
                    setMessage(t('已经清空，可以重新开始了', 'Cleared — fresh start'))
                  }}
                >
                  {t('确定清空', 'Clear it all')}
                </Button>
                <Button variant="ghost" className="flex-1" onClick={() => setConfirmWipe(false)}>
                  {t('算了', 'Never mind')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button block variant="dangerSoft" onClick={() => setConfirmWipe(true)}>
                {t('全部清空，重新开始', 'Clear everything and start over')}
              </Button>
              <p className="text-ink-500 text-caption">
                {t(
                  '清之前先去下面「数据备份与恢复」导一份文件 —— 那是唯一能把历史找回来的东西。',
                  'Export a file under “Backup” below first — that is the only way to get the history back.',
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </Sheet>
  )
}

function MenuRow({
  title,
  hint,
  right,
  onClick,
  danger,
}: {
  title: string
  hint?: string
  right?: ReactNode
  onClick?: () => void
  danger?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className="border-line bg-surface flex w-full items-center gap-3 border-b px-4 py-3.5 text-left last:border-b-0 active:bg-fill"
    >
      <span className="min-w-0 flex-1">
        <span className={danger ? 'text-danger-600 block' : 'block'}>{title}</span>
        {hint && <span className="text-ink-500 mt-0.5 block text-caption">{hint}</span>}
      </span>
      {right ?? (onClick ? ARROW : null)}
    </Tag>
  )
}

export function Me() {
  const t = useT()
  const { lang, setLang } = useLang()
  const { players, sessions, matches, avatars, meId } = useApp()
  const setMeId = useApp((s) => s.setMeId)
  const exportBackup = useApp((s) => s.exportBackup)
  const importBackup = useApp((s) => s.importBackup)
  const push = useNav((s) => s.push)
  const switchTab = useNav((s) => s.switchTab)
  const { theme, setTheme } = useTheme()

  const [picking, setPicking] = useState(false)
  const [newSelf, setNewSelf] = useState(false)
  const [selfName, setSelfName] = useState('')
  const [selfGender, setSelfGender] = useState<Gender>('-')
  const addPlayer = useApp((s) => s.addPlayer)
  const claimPlayer = useApp((s) => s.claimPlayer)
  const releasePlayer = useApp((s) => s.releasePlayer)
  const [authOpen, setAuthOpen] = useState(false)
  const [cloudOpen, setCloudOpen] = useState(false)
  const sync = useSyncStatus()
  const syncHint =
    sync.state === 'syncing'
      ? t('同步中…', 'Syncing…')
      : sync.state === 'error'
        ? sync.message
        : sync.state === 'idle' && sync.pending > 0
          ? t(`还有 ${sync.pending} 条没推上去`, `${sync.pending} still to push`)
          : t('已经和云端一致', 'Up to date')
  const { session } = useAuth()
  /** 登录账号 id。没登录就是 null，那时选人只是本机标记 */
  const uid = session?.user.id ?? null
  const [backupOpen, setBackupOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const names = useMemo(() => playerMap(players), [players])
  const me = meId ? names.get(meId) : undefined
  const roster = players.filter((p) => !p.archived)

  const progress = useMemo(
    () => (me ? progressOf(me.id, matches) : null),
    [me, matches],
  )
  const stats = useMemo(
    () => (me ? computeStats(matches, [me.id])[0] : null),
    [me, matches],
  )
  const mine = useMemo(
    () => (me ? decidedMatches(matches).filter((m) => sideOf(m, me.id) !== null) : []),
    [me, matches],
  )
  const avatar = me ? avatarOf(avatars, me.id) : undefined

  /* 本月战绩 —— 规格 §K 要的「本月概览」 */
  const thisMonth = useMemo(() => {
    const key = new Date().toISOString().slice(0, 7)
    const ids = new Set(
      sessions.filter((s) => s.date.startsWith(key)).map((s) => s.id),
    )
    const ms = mine.filter((m) => ids.has(m.sessionId))
    if (!me) return { games: 0, wins: 0 }
    const wins = ms.filter((m) => {
      const side = sideOf(m, me.id)
      const a = m.games.reduce((n, g) => n + (g.a > g.b ? 1 : 0), 0)
      const b = m.games.length - a
      return side === 'A' ? a > b : b > a
    }).length
    return { games: ms.length, wins }
  }, [mine, sessions, me])

  const recent = useMemo(
    () =>
      sessions
        .filter((s) => (me ? s.playerIds.includes(me.id) : false))
        .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))
        .slice(0, 3),
    [sessions, me],
  )

  function download() {
    const data = exportBackup()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `RALLY-${t('备份', 'backup')}-${data.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage(t('备份文件已导出', 'Backup file exported'))
  }

  async function upload(file: File) {
    try {
      importBackup(JSON.parse(await file.text()) as Backup)
      setMessage(t('已恢复备份', 'Backup restored'))
    } catch (err) {
      setMessage(
        err instanceof Error
          ? t(`导入失败：${err.message}`, `Import failed: ${err.message}`)
          : t('导入失败', 'Import failed'),
      )
    }
  }

  const streak = stats ? streakLabel(stats.streak) : ''

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-3">
        <h1 className="text-h1">{t('我的', 'Me')}</h1>
      </header>

      <Body>
        {me && progress && stats ? (
          <>
            <Card>
              <div className="flex items-center gap-4">
                <Avatar name={me.name} avatar={avatar} size="lg" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-h2">{me.name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <RankChip level={progress.level} />
                    <span className="tnum text-ink-500 text-caption">
                      MMR {progress.mmr}
                    </span>
                    {streak && (
                      <Pill tone={stats.streak > 0 ? 'success' : 'danger'}>{streak}</Pill>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="tertiary" onClick={() => setPicking(true)}>
                  {t('换人', 'Switch')}
                </Button>
              </div>

              <div className="border-line mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center">
                <div>
                  <p className="tnum text-h2">{thisMonth.games}</p>
                  <p className="text-ink-500 text-caption">{t('本月场次', 'This month')}</p>
                </div>
                <div>
                  <p className="tnum text-h2">{thisMonth.wins}</p>
                  <p className="text-ink-500 text-caption">{t('本月胜场', 'Wins')}</p>
                </div>
                <div>
                  <p className="tnum text-h2">{percent(stats.winRate)}</p>
                  <p className="text-ink-500 text-caption">{t('总胜率', 'Win rate')}</p>
                </div>
              </div>
            </Card>

            {/*
              角色换装。规格里整份都没提这一块，但它是 App 里唯一的养成线 ——
              赢球赚金币、金币换装备、装备穿在身上给别人看。
              没有入口等于把它删掉，所以放在「我的」第一屏。
            */}
            <Card onClick={() => push({ name: 'avatar', playerId: me.id })}>
              <div className="flex items-center gap-4">
                <span className="bg-fill size-16 shrink-0 overflow-hidden rounded-2xl">
                  {avatar ? (
                    <AvatarView
                      sex={avatar.sex}
                      skin={avatar.skin}
                      equipped={avatar.equipped}
                      stage={stageOf(progress.level)}
                      className="h-full w-full"
                      title={me.name}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-2xl">
                      👤
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-title">{t('我的角色', 'My character')}</span>
                  <span className="text-ink-500 mt-0.5 block text-label">
                    {avatar
                      ? t(`身上行头 ${progress.coins} 金币可花`, `${progress.coins} coins to spend`)
                      : t('还没建角色，去挑一个', 'No character yet — pick one')}
                  </span>
                </span>
                {ARROW}
              </div>
            </Card>

            <SectionTitle>{t('我的战绩', 'My record')}</SectionTitle>
            <div className="border-line rounded-card overflow-hidden border">
              <MenuRow
                title={t('完整战绩与对手分析', 'Full record and head-to-heads')}
                hint={t(
                  `${stats.games} 场 · ${stats.wins} 胜 ${stats.losses} 负`,
                  `${stats.games} played · ${stats.wins}W ${stats.losses}L`,
                )}
                onClick={() => push({ name: 'profile', playerId: me.id })}
              />
              <MenuRow
                title={t('累计排行榜', 'Leaderboard')}
                hint={t('按球馆分开算', 'Ranked per venue')}
                onClick={() => push({ name: 'leaderboard' })}
              />
            </div>

            {recent.length > 0 && (
              <>
                <SectionTitle>{t('最近球局', 'Recent sessions')}</SectionTitle>
                <div className="border-line rounded-card overflow-hidden border">
                  {recent.map((s) => (
                    <MenuRow
                      key={s.id}
                      title={venueLabel(s.venue)}
                      hint={`${formatDate(s.date)} · ${
                        s.status === 'active' ? t('进行中', 'Live') : t('已结束', 'Finished')
                      }`}
                      onClick={() =>
                        push(
                          s.status === 'active'
                            ? { name: 'board', sessionId: s.id }
                            : { name: 'summary', sessionId: s.id },
                        )
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <Card>
            <p className="text-title">{t('你是哪一位？', 'Which one are you?')}</p>
            <p className="text-ink-500 mt-1 text-label">
              {t(
                '选一个球员绑在这台手机上，这一页就会显示你自己的段位、战绩和角色。只是本机的一个标记，不是账号 —— 数据还是整份存在这台手机里。',
                'Pick a player to link to this phone and this page will show your own rank, record and character. It is just a marker on this device, not an account — all the data still lives on this phone.',
              )}
            </p>
            {/*
              球员库空着的时候也走同一个入口。原来这里是「先去添加球员」，
              把人丢到球员库自己想办法 —— 而一个刚注册的新人第一件该做的事
              是把自己建出来，不是去管理一份名单。
            */}
            <div className="mt-4">
              <Button block variant="primary" onClick={() => setPicking(true)}>
                {roster.length === 0
                  ? t('先建一个「我」', 'Create yourself first')
                  : t('选一个', 'Pick one')}
              </Button>
            </div>
          </Card>
        )}

        {/*
          云同步。没接云端（.env 里没配）时整块不显示 ——
          与其摆一个点了没反应的入口，不如干脆不出现。
        */}
        {cloudReady && (
          <>
            <SectionTitle>{t('云同步', 'Cloud sync')}</SectionTitle>
            <div className="border-line rounded-card overflow-hidden border">
              {session === undefined ? (
                <MenuRow title={t('正在检查登录状态…', 'Checking sign-in…')} />
              ) : session ? (
                <MenuRow
                  title={t('已登录', 'Signed in')}
                  hint={session.user.email ?? undefined}
                  right={
                    <Button size="sm" variant="soft" onClick={() => void signOut()}>
                      {t('退出', 'Sign out')}
                    </Button>
                  }
                />
              ) : (
                <MenuRow
                  title={t('登录', 'Sign in')}
                  hint={t(
                    '登录之后，数据就能备份到云端、换手机也拿得回来',
                    'Sign in to back your data up and get it back on another phone',
                  )}
                  onClick={() => setAuthOpen(true)}
                />
              )}
              {session && (
                <MenuRow
                  title={t('同步状态', 'Sync')}
                  hint={syncHint}
                  onClick={() => setCloudOpen(true)}
                />
              )}
            </div>
            <p className="text-ink-500 px-1 text-caption">
              {t(
                '登录之后自动同步：你记的分会推上去，别人记的会自己出现。',
                'Once signed in it syncs on its own — your scores go up, other people’s come down.',
              )}
            </p>
          </>
        )}

        <SectionTitle>{t('设置', 'Settings')}</SectionTitle>
        <div className="border-line rounded-card overflow-hidden border">
          <MenuRow
            title={t('语言', 'Language')}
            hint={LANG_LABELS[lang]}
            right={
              <div className="flex gap-1">
                {(['zh', 'en'] as Lang[]).map((l) => (
                  <Button
                    key={l}
                    size="sm"
                    variant={l === lang ? 'primary' : 'soft'}
                    onClick={() => setLang(l)}
                  >
                    {LANG_LABELS[l]}
                  </Button>
                ))}
              </div>
            }
          />
          <MenuRow
            title={t('深色模式', 'Dark mode')}
            hint={theme === 'dark' ? t('现在是深色', 'Currently dark') : t('现在是浅色', 'Currently light')}
            right={
              <Button
                size="sm"
                variant="soft"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? t('切成浅色', 'Go light') : t('切成深色', 'Go dark')}
              </Button>
            }
          />
          <MenuRow
            title={t('数据备份与恢复', 'Backup and restore')}
            /* 登录之后数据不再只在这台手机上了，这句话得跟着变 */
            hint={
              session
                ? t('导一份文件留底，清空重来之前尤其要导', 'Export a file to keep — especially before clearing everything')
                : t('数据只存在这台手机上，每次打完球导一次', 'Data lives only on this phone — export after every session')
            }
            onClick={() => setBackupOpen(true)}
          />
          <MenuRow
            title={t('球员库', 'Players')}
            hint={t(`${roster.length} 位球友`, `${roster.length} players`)}
            onClick={() => switchTab('discover')}
          />
        </div>

        {/*
          装成 PWA 之后旧缓存会一直顶着，界面看不出更没更新。
          把版本印出来，再给个一键清缓存的按钮，省得靠反复划掉 App 碰运气。
        */}
        <div className="text-ink-500 flex items-center justify-center gap-3 pt-2 pb-4 text-caption">
          <span className="tnum">
            RALLY {BUILD_ID} · {buildStamp()}
          </span>
          <button
            onClick={() => {
              setUpdating(true)
              void forceUpdate()
            }}
            disabled={updating}
            className="decoration-line underline underline-offset-4 disabled:opacity-60"
          >
            {updating ? t('更新中…', 'Updating…') : t('检查更新', 'Check for updates')}
          </button>
        </div>
      </Body>

      <Sheet open={picking} onClose={() => setPicking(false)} title={t('你是哪一位？', 'Which one are you?')}>
        {/*
          登录之后这一步不只是本机标记了，而是「认领」：
          账号会写进球员本身、跟着同步出去，别人手机上就知道
          那个人是有主的，不会再建一个重名的。
        */}
        {uid && (
          <p className="text-ink-500 mb-3 text-caption">
            {t(
              '认领之后，别人手机上也能看到这个球员是你，不会再有人重复建一个。',
              'Once claimed, everyone else sees that this player is you — nobody creates a duplicate.',
            )}
          </p>
        )}

        {newSelf ? (
          <div className="space-y-4">
            <Field label={t('你的名字', 'Your name')}>
              <input
                className={inputClass}
                value={selfName}
                onChange={(e) => setSelfName(e.target.value)}
                placeholder={t('例如 阿明', 'e.g. Alvin')}
                autoFocus
              />
            </Field>
            <Field label={t('性别', 'Gender')}>
              <Segmented
                value={selfGender}
                onChange={setSelfGender}
                options={[
                  { value: 'M', label: t('男', 'Male') },
                  { value: 'F', label: t('女', 'Female') },
                  { value: '-', label: t('不填', 'Skip') },
                ]}
              />
            </Field>
            <Button
              variant="primary"
              block
              disabled={!selfName.trim()}
              onClick={() => {
                const created = addPlayer(selfName.trim(), selfGender)
                if (uid) claimPlayer(created.id, uid)
                else setMeId(created.id)
                setSelfName('')
                setNewSelf(false)
                setPicking(false)
              }}
            >
              {t('就是我', "That's me")}
            </Button>
            <Button block variant="ghost" onClick={() => setNewSelf(false)}>
              {t('返回列表', 'Back to the list')}
            </Button>
          </div>
        ) : (
          <>
            {roster.length > 0 && (
              <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                {roster.map((p) => {
                  /* 已经被别人认领的不给点 —— 点了也只会把人家挤掉 */
                  const takenByOther = Boolean(p.ownerId) && p.ownerId !== uid
                  return (
                    <button
                      key={p.id}
                      disabled={takenByOther}
                      onClick={() => {
                        if (uid) claimPlayer(p.id, uid)
                        else setMeId(p.id)
                        setPicking(false)
                      }}
                      className={
                        p.id === meId
                          ? 'border-brand-500 bg-brand-100 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left'
                          : takenByOther
                            ? 'border-line bg-surface flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left opacity-40'
                            : 'border-line bg-surface active:bg-fill flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left'
                      }
                    >
                      <Avatar name={p.name} avatar={avatarOf(avatars, p.id)} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.id === meId ? (
                        <Pill tone="brand">{t('就是我', "That's me")}</Pill>
                      ) : takenByOther ? (
                        <Pill>{t('别人认领了', 'Taken')}</Pill>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}

            <Button
              block
              variant="primary"
              className="mt-3"
              onClick={() => setNewSelf(true)}
            >
              {roster.length === 0
                ? t('建一个球员，就是我', 'Create a player — that is me')
                : t('都不是，我是新来的', 'None of these — I am new')}
            </Button>

            {meId && (
              <Button
                block
                variant="soft"
                className="mt-2"
                onClick={() => {
                  if (uid) releasePlayer(uid)
                  setMeId(null)
                  setPicking(false)
                }}
              >
                {t('取消绑定', 'Unlink')}
              </Button>
            )}
          </>
        )}
      </Sheet>

      <AuthSheet open={authOpen} onClose={() => setAuthOpen(false)} />

      <CloudSheet open={cloudOpen} onClose={() => setCloudOpen(false)} />

      <Sheet open={backupOpen} onClose={() => setBackupOpen(false)} title={t('数据备份', 'Backup')}>
        <p className="text-ink-700 text-label">
          {t(
            '所有数据只存在这台手机的浏览器里。清掉浏览器数据或换手机就会丢，建议每次打完球导出一次备份。',
            'Everything is stored in this phone\u2019s browser only. Clearing browser data or switching phones loses it, so export a backup after every session.',
          )}
        </p>
        <div className="mt-4 space-y-2">
          <Button block variant="primary" onClick={download}>
            {t('导出备份文件', 'Export backup file')}
          </Button>
          <Button block variant="ghost" onClick={() => fileRef.current?.click()}>
            {t('从备份文件恢复', 'Restore from file')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
          <p className="text-warning-600 text-caption">
            {t(
              '恢复会覆盖当前所有数据，请先导出一次再恢复。',
              'Restoring overwrites everything currently on this phone. Export first.',
            )}
          </p>
        </div>
        {message && <p className="text-brand-600 mt-3 text-label">{message}</p>}
      </Sheet>
    </Screen>
  )
}
