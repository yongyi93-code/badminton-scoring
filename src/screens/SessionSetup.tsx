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
import { buildSchedule, matchInput } from '@/lib/sessionFormat'
import { recentVenues, venueKey } from '@/lib/venues'
import {
  DEFAULT_ROTATION_PER_PLAYER,
  DEFAULT_RULES,
  DEFAULT_STREAK_CAP,
  type EndCondition,
  type MatchType,
  type SessionFormat,
} from '@/types'

export function SessionSetup() {
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const createSession = useApp((s) => s.createSession)
  const addMatches = useApp((s) => s.addMatches)
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)

  const lastVenue = sessions[0]?.venue ?? ''
  const knownVenues = useMemo(() => recentVenues(sessions).slice(0, 6), [sessions])
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

  const [format, setFormat] = useState<SessionFormat>('free')
  const [streakCap, setStreakCap] = useState(DEFAULT_STREAK_CAP)
  const [perPlayer, setPerPlayer] = useState(DEFAULT_ROTATION_PER_PLAYER)
  // 0 表示不限
  const [capMatches, setCapMatches] = useState(0)
  const [capMinutes, setCapMinutes] = useState(0)
  const [floorPerPlayer, setFloorPerPlayer] = useState(0)

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

  // 轮转赛的赛程预览：人一勾就重算，让人开局前就知道要打多少场
  const chosenPlayers = useMemo(
    () => roster.filter((p) => selected.includes(p.id)),
    [roster, selected],
  )
  const preview = useMemo(() => {
    if (format !== 'rotation') return null
    return buildSchedule({
      attending: chosenPlayers,
      courtCount,
      type: defaultType,
      perPlayer,
    })
  }, [format, chosenPlayers, courtCount, defaultType, perPlayer])

  function start() {
    const endCondition: EndCondition = {}
    if (capMatches > 0) endCondition.totalMatches = capMatches
    if (capMinutes > 0) endCondition.durationMinutes = capMinutes
    if (floorPerPlayer > 0) endCondition.perPlayerMatches = floorPerPlayer

    const session = createSession({
      date,
      venue,
      courtCount,
      playerIds: selected,
      defaultType,
      rules: { pointsToWin, winBy2, bestOf, cap: Math.max(30, pointsToWin + 9) },
      format,
      endCondition: Object.keys(endCondition).length ? endCondition : undefined,
      kingStreakCap: format === 'king' ? streakCap : undefined,
      rotationPerPlayer: format === 'rotation' ? perPlayer : undefined,
    })

    // 轮转赛开局就把整份赛程写成排队中的比赛，之后「排下一场」直接顶上去
    if (format === 'rotation') {
      const schedule = buildSchedule({
        attending: chosenPlayers,
        courtCount,
        type: defaultType,
        perPlayer,
      })
      if (schedule.pairings.length) {
        addMatches(
          schedule.pairings.map((p) => matchInput(p, session.id, null)),
        )
      }
    }

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

          <Field
            label="球馆"
            hint="排行榜可以按球馆分开看，所以同一个场馆尽量用同一个名字"
          >
            <input
              className={inputClass}
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="例如 城中羽球馆"
            />
            {knownVenues.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {knownVenues.map((v) => (
                  <button
                    key={v}
                    onClick={() => setVenue(v)}
                    className={
                      venueKey(venue) === venueKey(v)
                        ? "rounded-full border border-lime-glow bg-lime-glow/15 px-3 py-1.5 text-xs text-lime-glow"
                        : "rounded-full border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-300 active:bg-ink-800"
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
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

        <Card className="space-y-4">
          <Field label="打法模式">
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'free', label: '自由' },
                { value: 'king', label: '车轮赛' },
                { value: 'rotation', label: '轮转赛' },
              ]}
            />
          </Field>

          <p className="text-sm leading-relaxed text-ink-400">
            {format === 'free' &&
              '照顾公平自动配对，边打边排。想打多久打多久，也可以在下面设个上限。'}
            {format === 'king' &&
              '打上打落：赢的两人留在场上，输的两人下场排到队尾，队头两人组队上来挑战。'}
            {format === 'rotation' &&
              '开局就把整份赛程排好，每人场数均等、搭档尽量不重复，打完自动结算。'}
          </p>

          {format === 'king' && (
            <Field
              label="连胜上限"
              hint={
                streakCap === 0
                  ? '不限：赢到底才下场。强弱差距大时会有人整晚打不到几场'
                  : `连赢 ${streakCap} 场就强制下场休息，防止高手组合霸场一整晚`
              }
            >
              <Stepper
                value={streakCap}
                onChange={setStreakCap}
                min={0}
                max={10}
                suffix={streakCap === 0 ? '（不限）' : '连胜'}
              />
            </Field>
          )}

          {format === 'rotation' && (
            <>
              <Field label="每人打几场">
                <Stepper
                  value={perPlayer}
                  onChange={setPerPlayer}
                  min={1}
                  max={20}
                  suffix="场"
                />
              </Field>
              <div className="rounded-xl border border-ink-700 bg-ink-800/50 px-3.5 py-3">
                {preview && preview.pairings.length > 0 ? (
                  <>
                    <p className="text-sm">
                      <span className="text-ink-300">
                        {selected.length} 人 · {courtCount} 片场 ·{' '}
                      </span>
                      <span className="font-semibold text-lime-glow">
                        共 {preview.pairings.length} 场
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-ink-400">
                      {preview.perPlayerMin === preview.perPlayerMax
                        ? `每人正好 ${preview.perPlayerMin} 场`
                        : `每人 ${preview.perPlayerMin}–${preview.perPlayerMax} 场`}
                      {preview.matchesPerRound > 1 &&
                        ` · 每轮同时开 ${preview.matchesPerRound} 片场`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-ink-400">
                    {preview?.reason ?? '先在下面勾选今晚到场的人'}
                  </p>
                )}
              </div>
            </>
          )}

          <div className="space-y-3 border-t border-ink-800 pt-3">
            <p className="text-sm text-ink-300">
              结束条件
              <span className="ml-1 text-xs text-ink-400">
                （留 0 = 不限；到点只提示，不会自动结束）
              </span>
            </p>
            {format !== 'rotation' && (
              <Field label="打满几场">
                <Stepper
                  value={capMatches}
                  onChange={setCapMatches}
                  min={0}
                  max={60}
                  suffix={capMatches === 0 ? '（不限）' : '场'}
                />
              </Field>
            )}
            <Field label="打多久" hint="按小时租场的话填这个，看板会显示还够打几场">
              <Stepper
                value={capMinutes}
                onChange={setCapMinutes}
                min={0}
                max={360}
                step={30}
                suffix={capMinutes === 0 ? '（不限）' : '分钟'}
              />
            </Field>
            <Field label="每人至少打">
              <Stepper
                value={floorPerPlayer}
                onChange={setFloorPerPlayer}
                min={0}
                max={20}
                suffix={floorPerPlayer === 0 ? '（不限）' : '场'}
              />
            </Field>
          </div>
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
