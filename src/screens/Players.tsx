import { useMemo, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  EmptyState,
  Field,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  Toast,
  TopBar,
  inputClass,
} from '@/components/ui'
import { PlayerRow } from '@/components/PlayerBits'
import { progressByPlayer } from '@/lib/avatar'
import type { Gender, Player } from '@/types'

export function PlayerEditor({
  open,
  onClose,
  player,
}: {
  open: boolean
  onClose: () => void
  player: Player | null
}) {
  const addPlayer = useApp((s) => s.addPlayer)
  const updatePlayer = useApp((s) => s.updatePlayer)
  const setArchived = useApp((s) => s.setPlayerArchived)

  // 表单靠调用方传 key 来重置（切换编辑对象时整块重新挂载）
  const [name, setName] = useState(player?.name ?? '')
  const [gender, setGender] = useState<Gender>(player?.gender ?? '-')

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (player) updatePlayer(player.id, { name: trimmed, gender })
    else addPlayer(trimmed, gender)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={player ? '编辑球员' : '新增球员'}>
      <div className="space-y-4">
        <Field label="名字">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 阿明"
            autoFocus={!player}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </Field>

        <Field
          label="性别"
          hint="混双模式需要，才能强制每队一男一女；也决定角色是男是女，填了就不用再选一次"
        >
          <Segmented
            value={gender}
            onChange={setGender}
            options={[
              { value: 'M', label: '男' },
              { value: 'F', label: '女' },
              { value: '-', label: '不填' },
            ]}
          />
        </Field>

        <Button variant="primary" block onClick={save} disabled={!name.trim()}>
          保存
        </Button>

        {player && (
          <Button
            variant="danger"
            block
            onClick={() => {
              setArchived(player.id, !player.archived)
              onClose()
            }}
          >
            {player.archived ? '恢复到球员库' : '移出球员库（保留历史战绩）'}
          </Button>
        )}
      </div>
    </Sheet>
  )
}

type Tab = 'all' | 'together' | 'recent'

export function Players() {
  const players = useApp((s) => s.players)
  const matches = useApp((s) => s.matches)
  const avatars = useApp((s) => s.avatars)
  const sessions = useApp((s) => s.sessions)
  const meId = useApp((s) => s.meId)
  const updateSession = useApp((s) => s.updateSession)
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const [editing, setEditing] = useState<Player | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [toast, setToast] = useState<string | null>(null)

  /** 头像用角色，名字下面显示段位 —— 取代了原来手填的水平星级 */
  const avatarsById = useMemo(
    () => new Map(avatars.map((a) => [a.playerId, a])),
    [avatars],
  )
  const progressById = useMemo(() => progressByPlayer(matches), [matches])

  /** 和我同场打过多少次 —— 「常一起打」就按这个排 */
  const togetherCount = useMemo(() => {
    const map = new Map<string, number>()
    if (!meId) return map
    for (const m of matches) {
      const all = [...m.teamA, ...m.teamB]
      if (!all.includes(meId)) continue
      for (const id of all) {
        if (id === meId) continue
        map.set(id, (map.get(id) ?? 0) + 1)
      }
    }
    return map
  }, [matches, meId])

  const active = players.filter((p) => !p.archived)
  const archived = players.filter((p) => p.archived)

  const liveSession = sessions.find((s) => s.status === 'active')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = q
      ? active.filter((p) => p.name.toLowerCase().includes(q))
      : [...active]
    if (tab === 'together') {
      list = list
        .filter((p) => (togetherCount.get(p.id) ?? 0) > 0)
        .sort((a, b) => (togetherCount.get(b.id) ?? 0) - (togetherCount.get(a.id) ?? 0))
    } else if (tab === 'recent') {
      list = list.sort((a, b) => b.createdAt - a.createdAt)
    }
    return list
  }, [active, query, tab, togetherCount])

  const openEditor = (p: Player | null) => {
    setEditing(p)
    setOpen(true)
  }

  /** 迟到的人来了，不用回球局设置，在这里直接塞进今晚的名单 */
  const joinLive = (p: Player) => {
    if (!liveSession) return
    const now = useApp.getState().sessions.find((x) => x.id === liveSession.id)
    if (!now || now.playerIds.includes(p.id)) return
    updateSession(liveSession.id, { playerIds: [...now.playerIds, p.id] })
    setToast(`${p.name} 已加入今晚的球局`)
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'all', label: '全部' },
    ...(meId ? [{ value: 'together' as Tab, label: '常一起打' }] : []),
    { value: 'recent', label: '最近加入' },
  ]

  return (
    <Screen>
      <TopBar
        title="球员库"
        subtitle={`${active.length} 人`}
        onBack={back}
        right={
          <Button size="sm" variant="primary" onClick={() => openEditor(null)}>
            + 新球员
          </Button>
        }
      />
      <Body>
        {/* 搜索固定在顶上 —— 人多了之后，翻列表找人是最慢的一条路 */}
        <input
          className={inputClass}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜名字"
          type="search"
          aria-label="搜索球员"
        />

        {active.length > 0 && (
          <Segmented value={tab} onChange={setTab} options={tabs} />
        )}

        {active.length === 0 ? (
          <EmptyState
            icon="👥"
            title="球员库是空的"
            hint="先把常来打球的人加进来，之后每次开局直接勾选就行"
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={query ? `没有叫「${query}」的人` : '这一档还没有人'}
            hint={
              query
                ? '换个字试试，或者直接新增一个'
                : tab === 'together'
                  ? '和你同场打过的人才会出现在这里'
                  : undefined
            }
          />
        ) : (
          <div className="space-y-2">
            {shown.map((p) => {
              const inLive = liveSession?.playerIds.includes(p.id)
              const met = togetherCount.get(p.id) ?? 0
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  avatar={avatarsById.get(p.id)}
                  level={progressById.get(p.id)?.level}
                  onClick={() => push({ name: 'profile', playerId: p.id })}
                  right={
                    <span className="flex shrink-0 items-center gap-1">
                      {tab === 'together' && met > 0 && (
                        <span className="tnum text-ink-500 text-caption">
                          同场 {met}
                        </span>
                      )}
                      {liveSession &&
                        (inLive ? (
                          <span className="text-ink-500 px-2 text-caption">今晚在</span>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => joinLive(p)}>
                            加入球局
                          </Button>
                        ))}
                      <button
                        onClick={() => openEditor(p)}
                        aria-label={`编辑 ${p.name}`}
                        className="text-ink-500 active:bg-fill-strong shrink-0 rounded-lg px-2 py-2 text-caption"
                      >
                        编辑
                      </button>
                    </span>
                  }
                />
              )
            })}
          </div>
        )}

        {archived.length > 0 && (
          <>
            <SectionTitle>已移出（历史战绩仍保留）</SectionTitle>
            <div className="space-y-2 opacity-60">
              {archived.map((p) => (
                <PlayerRow
                  key={p.id}
                  player={p}
                  avatar={avatarsById.get(p.id)}
                  level={progressById.get(p.id)?.level}
                  onClick={() => openEditor(p)}
                />
              ))}
            </div>
          </>
        )}
      </Body>

      <Toast message={toast} onClose={() => setToast(null)} />

      <PlayerEditor
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        player={editing}
      />
    </Screen>
  )
}
