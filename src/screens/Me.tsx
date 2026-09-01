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
  Pill,
  Screen,
  SectionTitle,
  Sheet,
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

const ARROW = (
  <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
)

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
