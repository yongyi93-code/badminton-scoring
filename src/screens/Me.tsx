import { LANG_LABELS, type Lang, useLang, useT } from '@/lib/i18n'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { avatarOf, playerMap, useApp, type Backup } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  Card,
  EmptyState,
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
import { downloadAll, peekCloud, totalOf, uploadAll, type Counts } from '@/lib/cloud'

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
 * 云端备份与恢复
 *
 * 两个方向都是覆盖性的，所以都不给「一按就走」：
 * 上传前说清楚会推上去多少条，下载前先去云端数一遍再让人确认。
 * 这一屏最不该发生的事是「我只是好奇点一下，数据没了」。
 * ------------------------------------------------------------------ */

function CloudSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const matches = useApp((s) => s.matches)
  const [busy, setBusy] = useState<'up' | 'down' | 'peek' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 数过云端之后才给「确认恢复」，没数过不给按 */
  const [remote, setRemote] = useState<Counts | null>(null)

  const summary = (c: Counts) =>
    t(
      `${c.players} 位球员 · ${c.sessions} 场球局 · ${c.matches} 场比赛`,
      `${c.players} players · ${c.sessions} sessions · ${c.matches} matches`,
    )

  const reset = () => {
    setMessage(null)
    setError(null)
  }

  const doUpload = async () => {
    reset()
    setBusy('up')
    const res = await uploadAll()
    setBusy(null)
    if (res.ok) {
      setMessage(t(`已推上去：${summary(res.counts)}`, `Pushed: ${summary(res.counts)}`))
      setRemote(res.counts)
    } else setError(res.error)
  }

  const doPeek = async () => {
    reset()
    setBusy('peek')
    const res = await peekCloud()
    setBusy(null)
    if (res.ok) {
      setRemote(res.counts)
      if (totalOf(res.counts) === 0) {
        setError(
          t(
            '云端还是空的。先按上面那个「备份到云端」',
            'The cloud is still empty — press “Back up” above first',
          ),
        )
      }
    } else setError(res.error)
  }

  const doDownload = async () => {
    reset()
    setBusy('down')
    const res = await downloadAll()
    setBusy(null)
    if (res.ok) setMessage(t(`已拿回来：${summary(res.counts)}`, `Restored: ${summary(res.counts)}`))
    else setError(res.error)
  }

  const local: Counts = {
    players: players.length,
    sessions: sessions.length,
    matches: matches.length,
    avatars: 0,
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('云端备份与恢复', 'Back up and restore')}>
      <div className="space-y-4">
        <div className="bg-fill rounded-xl px-4 py-3">
          <p className="text-ink-500 text-caption">{t('这台手机上', 'On this phone')}</p>
          <p className="mt-0.5 font-semibold">{summary(local)}</p>
        </div>

        <div className="space-y-2">
          <Button
            variant="primary"
            size="lg"
            block
            disabled={busy !== null}
            onClick={() => void doUpload()}
          >
            {busy === 'up' ? t('上传中…', 'Uploading…') : t('备份到云端', 'Back up to the cloud')}
          </Button>
          <p className="text-ink-500 text-caption">
            {t(
              '把这台手机的数据整份推上去，让云端和这台手机一模一样 —— 云端多出来的会被删掉。所以别拿一台数据少的手机备份。',
              'Pushes this phone up so the cloud matches it exactly — anything extra in the cloud is removed. So do not back up from a phone with less data.',
            )}
          </p>
        </div>

        <div className="border-line space-y-2 border-t pt-4">
          {remote === null ? (
            <Button block variant="soft" disabled={busy !== null} onClick={() => void doPeek()}>
              {busy === 'peek' ? t('查看中…', 'Checking…') : t('看看云端有什么', 'See what is in the cloud')}
            </Button>
          ) : (
            <>
              <div className="bg-fill rounded-xl px-4 py-3">
                <p className="text-ink-500 text-caption">{t('云端现在有', 'In the cloud')}</p>
                <p className="mt-0.5 font-semibold">{summary(remote)}</p>
              </div>
              <Button
                block
                variant="danger"
                disabled={busy !== null || totalOf(remote) === 0}
                onClick={() => void doDownload()}
              >
                {busy === 'down'
                  ? t('恢复中…', 'Restoring…')
                  : t('用云端的覆盖这台手机', 'Overwrite this phone with the cloud')}
              </Button>
              <p className="text-warning-600 text-caption">
                {t(
                  '这会抹掉这台手机上云端没有的东西。不确定的话，先去下面「数据备份与恢复」导一份文件。',
                  'This wipes anything on this phone that is not in the cloud. Unsure? Export a file first, below.',
                )}
              </p>
            </>
          )}
        </div>

        {message && <p className="text-brand-600 text-label">{message}</p>}
        {error && <p className="text-danger-600 text-label">{error}</p>}
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
  const [authOpen, setAuthOpen] = useState(false)
  const [cloudOpen, setCloudOpen] = useState(false)
  const { session } = useAuth()
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
            <div className="mt-4">
              {roster.length === 0 ? (
                <Button block variant="primary" onClick={() => push({ name: 'players' })}>
                  {t('先去添加球员', 'Add players first')}
                </Button>
              ) : (
                <Button block variant="primary" onClick={() => setPicking(true)}>
                  {t('选一个', 'Pick one')}
                </Button>
              )}
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
                  title={t('备份与恢复', 'Back up and restore')}
                  hint={t('把这台手机的数据推上去，或者从云端拿回来', 'Push this phone up, or pull the cloud down')}
                  onClick={() => setCloudOpen(true)}
                />
              )}
            </div>
            <p className="text-ink-500 px-1 text-caption">
              {t(
                '现在是手动的：你按一下才动，方向自己选。自动双向同步等这一版验稳了再做。',
                'Manual for now — it only moves when you press a button, and you pick the direction. Automatic two-way sync comes once this is proven.',
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
            hint={t(
              '数据只存在这台手机上，每次打完球导一次',
              'Data lives only on this phone — export after every session',
            )}
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
        {roster.length === 0 ? (
          <EmptyState
            title={t('球员库是空的', 'No players yet')}
            hint={t('先去球员库添加人', 'Add someone in the players list first')}
          />
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {roster.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setMeId(p.id)
                  setPicking(false)
                }}
                className={
                  p.id === meId
                    ? 'border-brand-500 bg-brand-100 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left'
                    : 'border-line bg-surface active:bg-fill flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left'
                }
              >
                <Avatar name={p.name} avatar={avatarOf(avatars, p.id)} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.id === meId && <Pill tone="brand">{t('就是我', "That's me")}</Pill>}
              </button>
            ))}
          </div>
        )}
        {meId && (
          <Button block variant="soft" className="mt-3" onClick={() => {
            setMeId(null)
            setPicking(false)
          }}>
            {t('取消绑定', 'Unlink')}
          </Button>
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
