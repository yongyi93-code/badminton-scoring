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
 * 所以这一屏不再是「上传 / 下载」两个方向让人选。
 *
 * 而且它现在是一屏「出事了才进得来」的工具：平时同步自己跑，
 * 「我的」上根本不会出现入口。摆一个「同步状态」在那，只会让人
 * 点进来，然后对着「手动推送」「从云端刷新」发愣 —— 那两个按钮
 * 是卡住时才用的，不是日常功能。
 *
 * 「全部清空」也搬走了，挪进了「数据备份与恢复」：清之前必须先导
 * 一份备份，而导出就在那一屏上面一格。
 * ------------------------------------------------------------------ */

function CloudSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const matches = useApp((s) => s.matches)
  const status = useSyncStatus()
  const { session } = useAuth()
  const [busy, setBusy] = useState<'pull' | 'push' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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
          {/*
            登录没登录得摆在最显眼的地方。同步出问题时第一个要问的就是
            这个 —— 之前排查一次卡了很久，就是因为界面上看不出来。
          */}
          <p className="text-ink-500 mt-1 text-caption">
            {session
              ? t(`已登录：${session.user.email ?? ''}`, `Signed in: ${session.user.email ?? ''}`)
              : session === null
                ? t('没登录 —— 云端不认这台手机', 'Not signed in — the cloud does not know this phone')
                : t('正在确认登录状态…', 'Checking sign-in…')}
          </p>
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
  const { theme, setTheme } = useTheme()

  const [picking, setPicking] = useState(false)
  const [selfName, setSelfName] = useState('')
  const [selfGender, setSelfGender] = useState<Gender>('-')
  const addPlayer = useApp((s) => s.addPlayer)
  const claimPlayer = useApp((s) => s.claimPlayer)
  const updatePlayer = useApp((s) => s.updatePlayer)
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
  /*
   * 出事了才把那一行摆出来。
   * 「同步中」不算出事 —— 那是一闪而过的正常状态，为它冒出一行
   * 再消失，只会让人以为出了什么问题。
   */
  const needsAttention =
    sync.state === 'error' || (sync.state === 'idle' && sync.pending > 0)
  const { session } = useAuth()
  /** 登录账号 id。没登录就是 null，那时选人只是本机标记 */
  const uid = session?.user.id ?? null
  const [backupOpen, setBackupOpen] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const resetAll = useApp((s) => s.resetAll)
  const [updating, setUpdating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const names = useMemo(() => playerMap(players), [players])
  const me = meId ? names.get(meId) : undefined

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
                <Button
                  size="sm"
                  variant="tertiary"
                  onClick={() => {
                    setSelfName(me.name)
                    setSelfGender(me.gender)
                    setPicking(true)
                  }}
                >
                  {t('改名字', 'Edit')}
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
            <p className="text-title">{t('先建一个你自己', 'Create yourself first')}</p>
            <p className="text-ink-500 mt-1 text-label">
              {t(
                '填个名字就好。建完这一页会显示你的段位、战绩和角色，开新球局时你也自动在场上。',
                'Just a name. After that this page shows your rank, record and character, and you are put on court automatically when you start a session.',
              )}
            </p>
            <div className="mt-4">
              <Button block variant="primary" onClick={() => setPicking(true)}>
                {t('建一个你自己', 'Create yourself')}
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
              {/*
                同步好好的时候不显示这一行。
                
                同步是背景里的事，正常运转时用户什么都不用知道 ——
                而摆一个「同步状态」在那，只会让人点进去，然后对着
                「手动推送」「从云端刷新」「全部清空」发愣。那三个按钮
                是出事时才用的工具，不是日常功能。
                
                出事了才冒出来：这时候它恰恰是最该被看见的一行。
              */}
              {session && needsAttention && (
                <MenuRow
                  title={t('同步遇到问题', 'Sync needs attention')}
                  hint={syncHint}
                  onClick={() => setCloudOpen(true)}
                />
              )}
            </div>
            <p className="text-ink-500 px-1 text-caption">
              {session
                ? syncHint
                : t(
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

      {/*
        没有「从名单里挑一个」这回事了 —— 谁建的就是谁的。
        
        原来这里列出所有球员让你认领自己，是名册时代的做法：
        那时候是一个人把大家都建好，你再去里面找自己。现在每个人
        自己注册、自己建自己，这份名单就只剩「让你看见别人」这一个
        作用了，而那正是要去掉的东西。
        
        同一张表单也用来改自己的名字 —— 球员库拿掉之后，
        这是全 App 唯一能改自己名字的地方，没有它打错一个字就永远错着。
      */}
      <Sheet
        open={picking}
        onClose={() => setPicking(false)}
        title={me ? t('改我的名字', 'Edit my name') : t('建一个你自己', 'Create yourself')}
      >
        <div className="space-y-4">
          {!me && (
            <p className="text-ink-500 text-caption">
              {t(
                '填你自己的名字，别人在排行榜和对阵表上看到的就是它。建完就是你的，别人认领不走。',
                'Use your own name — this is what everyone sees in rankings and line-ups. Once created it is yours; nobody else can take it.',
              )}
            </p>
          )}
          <Field label={t('你的名字', 'Your name')}>
            <input
              className={inputClass}
              value={selfName}
              onChange={(e) => setSelfName(e.target.value)}
              placeholder={t('例如 阿明', 'e.g. Alvin')}
              autoFocus={!me}
            />
          </Field>
          <Field
            label={t('性别', 'Gender')}
            hint={t('混双排场要用，也决定角色是男是女', 'Used for mixed doubles, and it decides your character')}
          >
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
              const name = selfName.trim()
              if (me) {
                updatePlayer(me.id, { name, gender: selfGender })
              } else {
                const created = addPlayer(name, selfGender)
                // 登录着就把账号写进去：跟着同步出去，别人手机上就知道这个人有主
                if (uid) claimPlayer(created.id, uid)
                else setMeId(created.id)
              }
              setPicking(false)
            }}
          >
            {me ? t('保存', 'Save') : t('就是我', "That's me")}
          </Button>
        </div>
      </Sheet>

      <AuthSheet open={authOpen} onClose={() => setAuthOpen(false)} />

      <CloudSheet open={cloudOpen} onClose={() => setCloudOpen(false)} />

      <Sheet open={backupOpen} onClose={() => setBackupOpen(false)} title={t('数据备份', 'Backup')}>
        <p className="text-ink-700 text-label">
          {t(
            '登录之后云端有一份，换手机登录回来就能拿到。但备份文件是另一层保险 —— 万一云端那份被谁清掉了，只有它能把历史找回来。',
            'Once you are signed in there is a copy in the cloud, so a new phone gets everything back when you sign in. A backup file is the second layer: if the cloud copy ever gets wiped, this is the only way back.',
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

        {/*
          全队重新开始。放在这一屏最底下，而不是同步那一屏 ——
          理由有两个：清之前必须先导一份备份，而导出就在上面一格；
          而且这是全 App 唯一一个能一键抹掉所有人战绩的按钮，
          不该出现在任何人日常会点开的地方。仍然要点两下。
        */}
        <div className="border-line mt-6 space-y-2 border-t pt-4">
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
            <Button block variant="dangerSoft" onClick={() => setConfirmWipe(true)}>
              {t('全部清空，重新开始', 'Clear everything and start over')}
            </Button>
          )}
        </div>
        {message && <p className="text-brand-600 mt-3 text-label">{message}</p>}
      </Sheet>
    </Screen>
  )
}
