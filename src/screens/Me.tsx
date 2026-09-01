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
    a.download = `RALLY-备份-${data.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage('备份文件已导出')
  }

  async function upload(file: File) {
    try {
      importBackup(JSON.parse(await file.text()) as Backup)
      setMessage('已恢复备份')
    } catch (err) {
      setMessage(err instanceof Error ? `导入失败：${err.message}` : '导入失败')
    }
  }

  const streak = stats ? streakLabel(stats.streak) : ''

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-3">
        <h1 className="text-h1">我的</h1>
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
                  换人
                </Button>
              </div>

              <div className="border-line mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center">
                <div>
                  <p className="tnum text-h2">{thisMonth.games}</p>
                  <p className="text-ink-500 text-caption">本月场次</p>
                </div>
                <div>
                  <p className="tnum text-h2">{thisMonth.wins}</p>
                  <p className="text-ink-500 text-caption">本月胜场</p>
                </div>
                <div>
                  <p className="tnum text-h2">{percent(stats.winRate)}</p>
                  <p className="text-ink-500 text-caption">总胜率</p>
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
                  <span className="block text-title">我的角色</span>
                  <span className="text-ink-500 mt-0.5 block text-label">
                    {avatar ? `身上行头 ${progress.coins} 金币可花` : '还没建角色，去挑一个'}
                  </span>
                </span>
                {ARROW}
              </div>
            </Card>

            <SectionTitle>我的战绩</SectionTitle>
            <div className="border-line rounded-card overflow-hidden border">
              <MenuRow
                title="完整战绩与对手分析"
                hint={`${stats.games} 场 · ${stats.wins} 胜 ${stats.losses} 负`}
                onClick={() => push({ name: 'profile', playerId: me.id })}
              />
              <MenuRow
                title="累计排行榜"
                hint="按球馆分开算"
                onClick={() => push({ name: 'leaderboard' })}
              />
            </div>

            {recent.length > 0 && (
              <>
                <SectionTitle>最近球局</SectionTitle>
                <div className="border-line rounded-card overflow-hidden border">
                  {recent.map((s) => (
                    <MenuRow
                      key={s.id}
                      title={venueLabel(s.venue)}
                      hint={`${formatDate(s.date)} · ${s.status === 'active' ? '进行中' : '已结束'}`}
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
            <p className="text-title">你是哪一位？</p>
            <p className="text-ink-500 mt-1 text-label">
              选一个球员绑在这台手机上，这一页就会显示你自己的段位、战绩和角色。
              只是本机的一个标记，不是账号 —— 数据还是整份存在这台手机里。
            </p>
            <div className="mt-4">
              {roster.length === 0 ? (
                <Button block variant="primary" onClick={() => push({ name: 'players' })}>
                  先去添加球员
                </Button>
              ) : (
                <Button block variant="primary" onClick={() => setPicking(true)}>
                  选一个
                </Button>
              )}
            </div>
          </Card>
        )}

        <SectionTitle>设置</SectionTitle>
        <div className="border-line rounded-card overflow-hidden border">
          <MenuRow
            title="深色模式"
            hint={theme === 'dark' ? '现在是深色' : '现在是浅色'}
            right={
              <Button
                size="sm"
                variant="soft"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? '切成浅色' : '切成深色'}
              </Button>
            }
          />
          <MenuRow
            title="数据备份与恢复"
            hint="数据只存在这台手机上，每次打完球导一次"
            onClick={() => setBackupOpen(true)}
          />
          <MenuRow
            title="球员库"
            hint={`${roster.length} 位球友`}
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
            {updating ? '更新中…' : '检查更新'}
          </button>
        </div>
      </Body>

      <Sheet open={picking} onClose={() => setPicking(false)} title="你是哪一位？">
        {roster.length === 0 ? (
          <EmptyState title="球员库是空的" hint="先去球员库添加人" />
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
                {p.id === meId && <Pill tone="brand">就是我</Pill>}
              </button>
            ))}
          </div>
        )}
        {meId && (
          <Button block variant="soft" className="mt-3" onClick={() => {
            setMeId(null)
            setPicking(false)
          }}>
            取消绑定
          </Button>
        )}
      </Sheet>

      <Sheet open={backupOpen} onClose={() => setBackupOpen(false)} title="数据备份">
        <p className="text-ink-700 text-label">
          所有数据只存在这台手机的浏览器里。清掉浏览器数据或换手机就会丢，
          建议每次打完球导出一次备份。
        </p>
        <div className="mt-4 space-y-2">
          <Button block variant="primary" onClick={download}>
            导出备份文件
          </Button>
          <Button block variant="ghost" onClick={() => fileRef.current?.click()}>
            从备份文件恢复
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
            恢复会覆盖当前所有数据，请先导出一次再恢复。
          </p>
        </div>
        {message && <p className="text-brand-600 mt-3 text-label">{message}</p>}
      </Sheet>
    </Screen>
  )
}
