import { useMemo, useRef, useState } from 'react'
import { useApp, type Backup } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Button, Card, EmptyState, Pill, Screen, SectionTitle, Sheet } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { decidedMatches } from '@/lib/ranking'
import { BUILD_ID, buildStamp, forceUpdate } from '@/lib/update'

export function Home() {
  const { players, sessions, matches } = useApp()
  const exportBackup = useApp((s) => s.exportBackup)
  const importBackup = useApp((s) => s.importBackup)
  const push = useNav((s) => s.push)
  const [backupOpen, setBackupOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const active = sessions.find((s) => s.status === 'active')
  const past = sessions.filter((s) => s.status === 'ended')
  const activePlayers = players.filter((p) => !p.archived)

  const countsBySession = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of matches) {
      if (m.status !== 'done') continue
      map.set(m.sessionId, (map.get(m.sessionId) ?? 0) + 1)
    }
    return map
  }, [matches])

  const totalPlayed = decidedMatches(matches).length

  function download() {
    const data = exportBackup()
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `羽球记分备份-${data.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage('备份文件已导出')
  }

  async function upload(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Backup
      importBackup(parsed)
      setMessage('已恢复备份')
    } catch (err) {
      setMessage(err instanceof Error ? `导入失败：${err.message}` : '导入失败')
    }
  }

  return (
    <Screen>
      <div className="safe-top px-4 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs tracking-[0.2em] text-lime-glow uppercase">Badminton</p>
            <h1 className="text-2xl font-bold">羽球记分</h1>
          </div>
          <span className="text-3xl">🏸</span>
        </div>
      </div>

      <Body>
        {active ? (
          <Card
            className="border-lime-glow/40 bg-lime-glow/5"
            onClick={() => push({ name: 'board', sessionId: active.id })}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Pill tone="lime">进行中</Pill>
                <p className="mt-2 truncate text-lg font-semibold">
                  {active.venue || '未填球馆'}
                </p>
                <p className="mt-0.5 text-sm text-ink-400">
                  {formatDate(active.date)} · {active.playerIds.length} 人 ·{' '}
                  {active.courtCount} 片场 · 已打 {countsBySession.get(active.id) ?? 0} 场
                </p>
              </div>
              <span className="shrink-0 text-lime-glow">继续 →</span>
            </div>
          </Card>
        ) : (
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => push({ name: 'setup' })}
          >
            开始新球局
          </Button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Card onClick={() => push({ name: 'leaderboard' })}>
            <p className="text-sm text-ink-400">累计排行榜</p>
            <p className="tnum mt-1 text-xl font-bold">{totalPlayed}</p>
            <p className="text-xs text-ink-400">场已记录</p>
          </Card>
          <Card onClick={() => push({ name: 'players' })}>
            <p className="text-sm text-ink-400">球员库</p>
            <p className="tnum mt-1 text-xl font-bold">{activePlayers.length}</p>
            <p className="text-xs text-ink-400">人</p>
          </Card>
        </div>

        <SectionTitle
          right={
            active ? (
              <span className="text-xs text-ink-400">进行中的不列在这里</span>
            ) : undefined
          }
        >
          历史球局
        </SectionTitle>

        {past.length === 0 ? (
          <EmptyState
            title="还没有打过球"
            hint="开一个球局，勾选今晚到场的人，就可以开始排场记分了"
          />
        ) : (
          <div className="space-y-2">
            {past.map((s) => (
              <Card key={s.id} onClick={() => push({ name: 'summary', sessionId: s.id })}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.venue || '未填球馆'}</p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {formatDate(s.date)} · {s.playerIds.length} 人 · {countsBySession.get(s.id) ?? 0} 场
                    </p>
                  </div>
                  <span className="shrink-0 text-ink-400">›</span>
                </div>
              </Card>
            ))}
          </div>
        )}

        {active && (
          <Button block variant="ghost" onClick={() => push({ name: 'setup' })}>
            另开一个球局
          </Button>
        )}

        <button
          onClick={() => setBackupOpen(true)}
          className="w-full pt-2 text-center text-sm text-ink-400 underline decoration-ink-700 underline-offset-4"
        >
          数据备份与恢复
        </button>

        {/*
          装成 PWA 之后旧缓存会一直顶着，界面看不出更没更新。
          把版本印出来，再给个一键清缓存的按钮，省得靠反复划掉 App 碰运气。
        */}
        <div className="flex items-center justify-center gap-3 pb-4 text-xs text-ink-500">
          <span className="tnum">
            版本 {BUILD_ID} · {buildStamp()}
          </span>
          <button
            onClick={() => {
              setUpdating(true)
              void forceUpdate()
            }}
            disabled={updating}
            className="underline decoration-ink-700 underline-offset-4 disabled:opacity-60"
          >
            {updating ? '更新中…' : '检查更新'}
          </button>
        </div>
      </Body>

      <Sheet open={backupOpen} onClose={() => setBackupOpen(false)} title="数据备份">
        <p className="text-sm text-ink-300">
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
          <p className="text-xs text-amber-300">
            恢复会覆盖当前所有数据，请先导出一次再恢复。
          </p>
        </div>
        {message && <p className="mt-3 text-sm text-lime-glow">{message}</p>}
      </Sheet>
    </Screen>
  )
}
