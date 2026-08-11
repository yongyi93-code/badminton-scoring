import { useState } from 'react'
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
  TopBar,
  inputClass,
} from '@/components/ui'
import { LevelDots, PlayerRow } from '@/components/PlayerBits'
import type { Gender, Level, Player } from '@/types'

const LEVEL_LABELS: Record<Level, string> = {
  1: '新手',
  2: '入门',
  3: '中级',
  4: '进阶',
  5: '高手',
}

export function LevelPicker({
  value,
  onChange,
}: {
  value: Level
  onChange: (v: Level) => void
}) {
  return (
    <div className="flex gap-1.5">
      {([1, 2, 3, 4, 5] as Level[]).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`h-12 flex-1 rounded-xl border text-xs font-medium ${
            value === l
              ? 'border-lime-glow bg-lime-glow/15 text-lime-glow'
              : 'border-ink-700 bg-ink-800 text-ink-300'
          }`}
        >
          <span className="block text-base font-bold">{l}</span>
          {LEVEL_LABELS[l]}
        </button>
      ))}
    </div>
  )
}

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
  const [level, setLevel] = useState<Level>(player?.level ?? 3)
  const [gender, setGender] = useState<Gender>(player?.gender ?? '-')

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (player) updatePlayer(player.id, { name: trimmed, level, gender })
    else addPlayer(trimmed, level, gender)
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

        <Field label="水平" hint="配对时会尽量让两队水平和接近">
          <LevelPicker value={level} onChange={setLevel} />
        </Field>

        <Field label="性别" hint="混双模式需要，才能强制每队一男一女">
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

export function Players() {
  const players = useApp((s) => s.players)
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const [editing, setEditing] = useState<Player | null>(null)
  const [open, setOpen] = useState(false)

  const active = players.filter((p) => !p.archived)
  const archived = players.filter((p) => p.archived)

  const openEditor = (p: Player | null) => {
    setEditing(p)
    setOpen(true)
  }

  return (
    <Screen>
      <TopBar
        title="球员库"
        subtitle={`${active.length} 人`}
        onBack={back}
        right={
          <Button size="sm" variant="primary" onClick={() => openEditor(null)}>
            + 新增
          </Button>
        }
      />
      <Body>
        {active.length === 0 ? (
          <EmptyState
            icon="👥"
            title="球员库是空的"
            hint="先把常来打球的人加进来，之后每次开局直接勾选就行"
          />
        ) : (
          <div className="space-y-2">
            {active.map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                onClick={() => openEditor(p)}
                right={
                  <button
                    onClick={() => push({ name: 'profile', playerId: p.id })}
                    className="shrink-0 rounded-lg px-2 py-2 text-xs text-ink-400 active:bg-ink-700"
                  >
                    战绩 ›
                  </button>
                }
              />
            ))}
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
                  onClick={() => openEditor(p)}
                  right={<LevelDots level={p.level} />}
                />
              ))}
            </div>
          </>
        )}
      </Body>

      <PlayerEditor
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        player={editing}
      />
    </Screen>
  )
}
