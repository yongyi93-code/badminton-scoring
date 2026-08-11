import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  Card,
  Field,
  Screen,
  SectionTitle,
  Segmented,
  Stepper,
  Toggle,
  TopBar,
  inputClass,
} from '@/components/ui'
import { PlayerRow } from '@/components/PlayerBits'
import { PlayerEditor } from './Players'
import { todayISO } from '@/lib/format'
import { DEFAULT_RULES, type MatchType } from '@/types'

export function SessionSetup() {
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const createSession = useApp((s) => s.createSession)
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)

  const lastVenue = sessions[0]?.venue ?? ''
  const lastCourts = sessions[0]?.courtCount ?? 2

  const [date, setDate] = useState(todayISO())
  const [venue, setVenue] = useState(lastVenue)
  const [courtCount, setCourtCount] = useState(lastCourts)
  const [defaultType, setDefaultType] = useState<MatchType>('doubles')
  const [pointsToWin, setPointsToWin] = useState(DEFAULT_RULES.pointsToWin)
  const [winBy2, setWinBy2] = useState(DEFAULT_RULES.winBy2)
  const [bestOf, setBestOf] = useState<1 | 3>(DEFAULT_RULES.bestOf)
  const [showRules, setShowRules] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [addOpen, setAddOpen] = useState(false)

  const roster = useMemo(
    () => players.filter((p) => !p.archived),
    [players],
  )

  // 开局时临时新增的球员，默认就算到场 —— 不然还要多点一次很容易漏
  const mountedAt = useRef(Date.now())
  useEffect(() => {
    const fresh = players
      .filter((p) => p.createdAt >= mountedAt.current)
      .map((p) => p.id)
    if (fresh.length === 0) return
    setSelected((s) => {
      const missing = fresh.filter((id) => !s.includes(id))
      return missing.length ? [...s, ...missing] : s
    })
  }, [players])

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const needed = defaultType === 'singles' ? 2 : 4
  const enough = selected.length >= needed

  const genderWarning =
    defaultType === 'mixed' &&
    (() => {
      const chosen = roster.filter((p) => selected.includes(p.id))
      const males = chosen.filter((p) => p.gender === 'M').length
      const females = chosen.filter((p) => p.gender === 'F').length
      const unknown = chosen.filter((p) => p.gender === '-').length
      if (unknown > 0) return `有 ${unknown} 人没填性别，混双排场会跳过他们`
      if (males < 2 || females < 2) return '混双需要至少 2 男 2 女'
      return null
    })()

  function start() {
    const session = createSession({
      date,
      venue,
      courtCount,
      playerIds: selected,
      defaultType,
      rules: { pointsToWin, winBy2, bestOf, cap: Math.max(30, pointsToWin + 9) },
    })
    replace({ name: 'board', sessionId: session.id })
  }

  return (
    <Screen>
      <TopBar title="开新球局" onBack={back} />
      <Body className="pb-40">
        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期">
              <input
                type="date"
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="场地数">
              <Stepper value={courtCount} onChange={setCourtCount} min={1} max={8} />
            </Field>
          </div>

          <Field label="球馆">
            <input
              className={inputClass}
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="例如 城中羽球馆"
            />
          </Field>

          <Field label="默认赛制" hint="自动排场时用这个，单场也可以临时改">
            <Segmented
              value={defaultType}
              onChange={setDefaultType}
              options={[
                { value: 'doubles', label: '双打' },
                { value: 'singles', label: '单打' },
                { value: 'mixed', label: '混双' },
              ]}
            />
          </Field>

          <button
            onClick={() => setShowRules((v) => !v)}
            className="text-sm text-ink-400 underline decoration-ink-700 underline-offset-4"
          >
            {showRules ? '收起计分规则' : `计分规则：${pointsToWin} 分${winBy2 ? '·净胜2' : ''}${bestOf === 3 ? '·三局两胜' : ''}`}
          </button>

          {showRules && (
            <div className="space-y-4 rounded-xl border border-ink-700 bg-ink-800/50 p-3">
              <Field label="每局分数">
                <Segmented
                  value={String(pointsToWin)}
                  onChange={(v) => setPointsToWin(Number(v))}
                  options={[
                    { value: '11', label: '11 分' },
                    { value: '15', label: '15 分' },
                    { value: '21', label: '21 分' },
                  ]}
                />
              </Field>
              <Toggle
                checked={winBy2}
                onChange={setWinBy2}
                label={`打到 ${pointsToWin - 1} 平后要净胜 2 分`}
              />
              <Field label="局数">
                <Segmented
                  value={String(bestOf)}
                  onChange={(v) => setBestOf(Number(v) as 1 | 3)}
                  options={[
                    { value: '1', label: '一局定胜负' },
                    { value: '3', label: '三局两胜' },
                  ]}
                />
              </Field>
            </div>
          )}
        </Card>

        <SectionTitle
          right={
            <div className="flex gap-3 text-xs">
              <button
                className="text-lime-glow"
                onClick={() =>
                  setSelected(
                    selected.length === roster.length ? [] : roster.map((p) => p.id),
                  )
                }
              >
                {selected.length === roster.length ? '全不选' : '全选'}
              </button>
              <button className="text-lime-glow" onClick={() => setAddOpen(true)}>
                + 新球员
              </button>
            </div>
          }
        >
          今晚到场（已选 {selected.length} 人）
        </SectionTitle>

        {roster.length === 0 ? (
          <Card className="text-center">
            <p className="text-ink-300">球员库还是空的</p>
            <Button
              variant="primary"
              className="mt-3"
              onClick={() => setAddOpen(true)}
            >
              加第一个球员
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {roster.map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                selected={selected.includes(p.id)}
                onClick={() => toggle(p.id)}
                right={
                  <button
                    onClick={() => toggle(p.id)}
                    aria-label={selected.includes(p.id) ? '取消到场' : '标记到场'}
                    className="flex size-11 shrink-0 items-center justify-center"
                  >
                    <span
                      className={`flex size-6 items-center justify-center rounded-full border text-xs ${
                        selected.includes(p.id)
                          ? 'border-lime-glow bg-lime-glow text-ink-950'
                          : 'border-ink-600 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                  </button>
                }
              />
            ))}
          </div>
        )}
      </Body>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-ink-800 bg-ink-900/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {genderWarning && (
            <p className="mb-2 text-center text-xs text-amber-300">{genderWarning}</p>
          )}
          <Button variant="primary" size="lg" block disabled={!enough} onClick={start}>
            {enough ? `开始球局（${selected.length} 人）` : `至少选 ${needed} 人`}
          </Button>
        </div>
      </div>

      <PlayerEditor open={addOpen} onClose={() => setAddOpen(false)} player={null} />
    </Screen>
  )
}
