import { useT } from '@/lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  BottomBar,
  Button,
  Card,
  Field,
  Screen,
  SectionTitle,
  Segmented,
  Stepper,
  Toggle,
  TopBar,
  cx,
  inputClass,
} from '@/components/ui'
import { PlayerRow } from '@/components/PlayerBits'
import { PlayerEditor } from './Players'
import { todayISO } from '@/lib/format'
import { buildSchedule, matchInput } from '@/lib/sessionFormat'
import { progressByPlayer } from '@/lib/avatar'
import { recentVenues, venueKey } from '@/lib/venues'
import {
  capFor,
  DEFAULT_ROTATION_PER_PLAYER,
  DEFAULT_RULES,
  DEFAULT_STREAK_CAP,
  POINTS_OPTIONS,
  type EndCondition,
  type MatchType,
  type SessionFormat,
  GUEST_PREFIX,
  type Gender,
  type GuestPlayer,
  PAIRING_MODE_HINTS,
  PAIRING_MODE_LABELS,
  type PairingMode,
} from '@/types'

/*
 * 开局分四步（规格 §C）。
 *
 * 原来是一长条表单，一屏塞满日期、球馆、赛制、配对、分数、打法、
 * 结束条件、选人 —— 每次开局都要从头滚到尾，而实际上除了「谁来了」，
 * 其余大多沿用上次。拆成四步之后每一步只问一件事，
 * 想改哪一步就点哪一步，不用一路滚过去。
 */
const STEPS: { key: string; label: [string, string] }[] = [
  { key: 'where', label: ['在哪打', 'Where'] },
  { key: 'how', label: ['怎么打', 'How'] },
  { key: 'rules', label: ['规矩', 'Rules'] },
  { key: 'who', label: ['谁来了', 'Who'] },
]

const LAST_STEP = STEPS.length - 1

export function SessionSetup() {
  const t = useT()
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const matches = useApp((s) => s.matches)
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
  const [pairingMode, setPairingMode] = useState<PairingMode>('balanced')
  const [pointsToWin, setPointsToWin] = useState(DEFAULT_RULES.pointsToWin)
  const [winBy2, setWinBy2] = useState(DEFAULT_RULES.winBy2)
  const [bestOf, setBestOf] = useState<1 | 3>(DEFAULT_RULES.bestOf)
  const [showRules, setShowRules] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [step, setStep] = useState(0)

  const [format, setFormat] = useState<SessionFormat>('free')
  const [homeName, setHomeName] = useState('')
  const [awayName, setAwayName] = useState('')
  const [awayPlayers, setAwayPlayers] = useState<GuestPlayer[]>([])
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

  /* 换一步就回到顶上，不然新的一步一进来是停在上一步滚到的位置 */
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const needed = defaultType === 'singles' ? 2 : 4
  /*
   * 友谊赛是两队各出一半人，所以两边都要够，不是加起来够就行 ——
   * 主队 6 人客队 1 人加起来 7 个，一场双打照样排不出来。
   */
  const namedAway = awayPlayers.filter((g) => g.name.trim())
  const isFriendly = format === 'friendly'
  const half = needed / 2
  const enough = isFriendly
    ? selected.length >= half && namedAway.length >= half
    : selected.length >= needed
  const startHint = isFriendly
    ? enough
      ? t(`开始友谊赛（${selected.length} 打 ${namedAway.length}）`, `Start friendly (${selected.length} v ${namedAway.length})`)
      : t(`两队各至少 ${half} 人：主队 ${selected.length}、客队 ${namedAway.length}`, `Each side needs ${half}: home ${selected.length}, away ${namedAway.length}`)
    : enough
      ? t(`开始球局（${selected.length} 人）`, `Start session (${selected.length} players)`)
      : t(`至少选 ${needed} 人`, `Pick at least ${needed} players`)

  const genderWarning =
    defaultType === 'mixed' &&
    (() => {
      const chosen = roster.filter((p) => selected.includes(p.id))
      const males = chosen.filter((p) => p.gender === 'M').length
      const females = chosen.filter((p) => p.gender === 'F').length
      const unknown = chosen.filter((p) => p.gender === '-').length
      if (unknown > 0) return t(`有 ${unknown} 人没填性别，混双排场会跳过他们`, `${unknown} players have no gender set — mixed doubles will skip them`)
      if (males < 2 || females < 2) return t('混双需要至少 2 男 2 女', 'Mixed doubles needs at least 2 men and 2 women')
      return null
    })()

  // 轮转赛的赛程预览：人一勾就重算，让人开局前就知道要打多少场
  const chosenPlayers = useMemo(
    () => roster.filter((p) => selected.includes(p.id)),
    [roster, selected],
  )
  /** 配对的实力平衡看 MMR，用所有球局的战绩算 */
  const mmrById = useMemo(() => {
    const map = new Map<string, number>()
    for (const [id, prog] of progressByPlayer(matches)) map.set(id, prog.mmr)
    return map
  }, [matches])

  const preview = useMemo(() => {
    if (format !== 'rotation') return null
    return buildSchedule({
      attending: chosenPlayers,
      courtCount,
      type: defaultType,
      perPlayer,
      mmrById,
      pairingMode,
    })
  }, [format, chosenPlayers, courtCount, defaultType, perPlayer, mmrById, pairingMode])

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
      rules: { pointsToWin, winBy2, bestOf, cap: capFor(pointsToWin) },
      format,
      endCondition: Object.keys(endCondition).length ? endCondition : undefined,
      kingStreakCap: format === 'king' ? streakCap : undefined,
      rotationPerPlayer: format === 'rotation' ? perPlayer : undefined,
      pairingMode,
      friendly: isFriendly
        ? {
            homeName: homeName.trim() || t('主队', 'Home'),
            awayName: awayName.trim() || t('客队', 'Away'),
            // 没填名字的那几行直接丢掉，别把空名字带进球局
            awayPlayers: namedAway.map((g) => ({ ...g, name: g.name.trim() })),
          }
        : undefined,
    })

    // 轮转赛开局就把整份赛程写成排队中的比赛，之后「排下一场」直接顶上去
    if (format === 'rotation') {
      const schedule = buildSchedule({
        attending: chosenPlayers,
        courtCount,
        type: defaultType,
        perPlayer,
        mmrById,
        pairingMode,
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
      <TopBar
        title={t('开新球局', 'New session')}
        subtitle={t(
          `第 ${step + 1} 步，共 ${STEPS.length} 步 · ${t(...STEPS[step].label)}`,
          `Step ${step + 1} of ${STEPS.length} · ${t(...STEPS[step].label)}`,
        )}
        /* 返回先退一步，退到头了才离开这个流程 */
        onBack={step > 0 ? () => setStep(step - 1) : back}
      />

      {/* 四步都点得动 —— 只想改个场地数的时候不用一路「下一步」过去 */}
      <nav aria-label={t('开局步骤', 'Setup steps')} className="flex gap-1.5 px-5 pb-3">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setStep(i)}
            aria-current={i === step ? 'step' : undefined}
            className={cx(
              'flex-1 rounded-lg border py-1.5 text-caption transition-colors',
              i === step
                ? 'border-brand-solid bg-brand-solid text-on-brand font-semibold'
                : i < step
                  ? 'border-brand-500/40 bg-brand-50 text-brand-600'
                  : 'border-line bg-surface text-ink-500',
            )}
          >
            {t(...s.label)}
          </button>
        ))}
      </nav>

      <Body>
        {step === 0 && (
        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('日期', 'Date')}>
              <input
                type="date"
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label={t('场地数', 'Courts')}>
              <Stepper value={courtCount} onChange={setCourtCount} min={1} max={8} />
            </Field>
          </div>

          <Field
            label={t('球馆', 'Venue')}
            hint={t('排行榜可以按球馆分开看，所以同一个场馆尽量用同一个名字', 'The leaderboard can be filtered by venue, so spell the same place the same way')}
          >
            <input
              className={inputClass}
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder={t('例如 城中羽球馆', 'e.g. Twin Ark')}
            />
            {knownVenues.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {knownVenues.map((v) => (
                  <button
                    key={v}
                    onClick={() => setVenue(v)}
                    className={
                      venueKey(venue) === venueKey(v)
                        ? "rounded-full border border-brand-600 bg-brand-100 px-3 py-1.5 text-xs text-brand-600"
                        : "rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-700 active:bg-fill"
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
          </Field>
        </Card>
        )}

        {step === 2 && (
        <Card className="space-y-4">
          <Field label={t('默认赛制', 'Default format')} hint={t('自动排场时用这个，单场也可以临时改', 'Used when auto-arranging; a single match can still be changed')}>
            <Segmented
              value={defaultType}
              onChange={setDefaultType}
              options={[
                { value: 'doubles', label: t('双打', 'Doubles') },
                { value: 'singles', label: t('单打', 'Singles') },
                { value: 'mixed', label: t('混双', 'Mixed') },
              ]}
            />
          </Field>

          <Field label={t('怎么配对', 'Pairing')} hint={t(...PAIRING_MODE_HINTS[pairingMode])}>
            <Segmented
              value={pairingMode}
              onChange={setPairingMode}
              options={(
                Object.keys(PAIRING_MODE_LABELS) as PairingMode[]
              ).map((m) => ({ value: m, label: t(...PAIRING_MODE_LABELS[m]) }))}
            />
          </Field>

          <Field
            label={t('每局分数', 'Points per game')}
            hint={
              winBy2
                ? t(`${pointsToWin - 1} 平后要净胜 2 分，${capFor(pointsToWin)} 分封顶`, `From ${pointsToWin - 1} all you must lead by 2, capped at ${capFor(pointsToWin)}`)
                : t(`先到 ${pointsToWin} 分即胜`, `First to ${pointsToWin} wins`)
            }
          >
            <Segmented
              value={String(pointsToWin)}
              onChange={(v) => setPointsToWin(Number(v))}
              options={POINTS_OPTIONS.map((p) => ({
                value: String(p),
                label: t(`${p} 分`, `${p}`),
              }))}
            />
          </Field>

          <button
            onClick={() => setShowRules((v) => !v)}
            className="text-sm text-ink-500 underline decoration-line underline-offset-4"
          >
            {showRules ? t('收起更多规则', 'Hide more rules') : t(`更多规则：${winBy2 ? '净胜2' : '不用净胜2'}${bestOf === 3 ? '·三局两胜' : '·一局定胜负'}`, `More rules: ${winBy2 ? 'win by 2' : 'no win-by-2'} · ${bestOf === 3 ? 'best of 3' : 'single game'}`)}
          </button>

          {showRules && (
            <div className="space-y-4 rounded-xl border border-line bg-fill/50 p-3">
              <Toggle
                checked={winBy2}
                onChange={setWinBy2}
                label={t(`打到 ${pointsToWin - 1} 平后要净胜 2 分`, `From ${pointsToWin - 1} all, win by 2`)}
              />
              <Field label={t('局数', 'Games')}>
                <Segmented
                  value={String(bestOf)}
                  onChange={(v) => setBestOf(Number(v) as 1 | 3)}
                  options={[
                    { value: '1', label: t('一局定胜负', 'Single game') },
                    { value: '3', label: t('三局两胜', 'Best of 3') },
                  ]}
                />
              </Field>
            </div>
          )}
        </Card>
        )}

        {step === 1 && (
        <Card className="space-y-4">
          <Field label={t('打法模式', 'Play mode')}>
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'free', label: t('自由', 'Free') },
                { value: 'king', label: t('车轮赛', 'King') },
                { value: 'rotation', label: t('轮转赛', 'Robin') },
                { value: 'friendly', label: t('友谊赛', 'Friendly') },
              ]}
            />
          </Field>

          <p className="text-sm leading-relaxed text-ink-500">
            {format === 'free' &&
              t('照顾公平自动配对，边打边排。想打多久打多久，也可以在下面设个上限。', 'Fair auto-pairing, arranged as you go. Play as long as you like, or set a limit below.')}
            {format === 'king' &&
              t('打上打落：赢的两人留在场上，输的两人下场排到队尾，队头两人组队上来挑战。', 'Winners stay on, losers go to the back of the queue, and the next two up take the court.')}
            {format === 'rotation' &&
              t('开局就把整份赛程排好，每人场数均等、搭档尽量不重复，打完自动结算。', 'The whole schedule is drawn up front — equal matches each, partners rarely repeat, results settle automatically.')}
            {format === 'friendly' &&
              t('两个俱乐部对打：每一场都是主队 vs 客队，客队球员只在这场输名字，不进球员名单。成绩单独记，不算进 MMR 和累计排行榜。', 'Two clubs play each other. Every match is home vs away; away players are typed in for this session only and never join your roster. Results are kept separately and do not count towards MMR or the all-time leaderboard.')}
          </p>

          {format === 'friendly' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('主队（我们）', 'Home (us)')}>
                  <input
                    className={inputClass}
                    value={homeName}
                    onChange={(e) => setHomeName(e.target.value)}
                    placeholder={t('例如 城中羽队', 'e.g. Twin Ark Club')}
                  />
                </Field>
                <Field label={t('客队（对手）', 'Away (them)')}>
                  <input
                    className={inputClass}
                    value={awayName}
                    onChange={(e) => setAwayName(e.target.value)}
                    placeholder={t('例如 北区羽会', 'e.g. Northside Club')}
                  />
                </Field>
              </div>

              <Field
                label={t(`客队球员（${awayPlayers.length} 人）`, `Away players (${awayPlayers.length})`)}
                hint={t('打对方球员的名字，一行一个。他们只属于这场球局，不会进你的球员名单，也不会上排行榜', 'Type their names, one each. They belong to this session only — never added to your roster and never on the leaderboard')}
              >
                <div className="space-y-2">
                  {awayPlayers.map((g, i) => (
                    <div key={g.id} className="flex items-center gap-2">
                      <input
                        className={inputClass}
                        value={g.name}
                        onChange={(e) =>
                          setAwayPlayers((xs) =>
                            xs.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder={t(`客队球员 ${i + 1}`, `Away player ${i + 1}`)}
                      />
                      <Segmented
                        value={g.gender}
                        onChange={(v: Gender) =>
                          setAwayPlayers((xs) =>
                            xs.map((x, j) => (j === i ? { ...x, gender: v } : x)),
                          )
                        }
                        options={[
                          { value: 'M', label: t('男', 'M') },
                          { value: 'F', label: t('女', 'F') },
                        ]}
                      />
                      <button
                        onClick={() =>
                          setAwayPlayers((xs) => xs.filter((_, j) => j !== i))
                        }
                        aria-label={t('删掉这个客队球员', 'Remove this away player')}
                        className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-ink-500 active:bg-fill"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setAwayPlayers((xs) => [
                        ...xs,
                        {
                          id: GUEST_PREFIX + Math.random().toString(36).slice(2),
                          name: '',
                          gender: 'M' as Gender,
                        },
                      ])
                    }
                  >
                    {t('+ 加一个客队球员', '+ Add away player')}
                  </Button>
                </div>
              </Field>
            </>
          )}

          {format === 'king' && (
            <Field
              label={t('连胜上限', 'Streak cap')}
              hint={
                streakCap === 0
                  ? t('不限：赢到底才下场。强弱差距大时会有人整晚打不到几场', 'No cap: winners stay until they lose. With a big skill gap some people barely get on')
                  : t(`连赢 ${streakCap} 场就强制下场休息，防止高手组合霸场一整晚`, `After ${streakCap} straight wins they must sit out, so one strong pair cannot hog the court all night`)
              }
            >
              <Stepper
                value={streakCap}
                onChange={setStreakCap}
                min={0}
                max={10}
                suffix={streakCap === 0 ? t('（不限）', '(no cap)') : t('连胜', 'wins')}
              />
            </Field>
          )}

          {format === 'rotation' && (
            <>
              <Field label={t('每人打几场', 'Matches each')}>
                <Stepper
                  value={perPlayer}
                  onChange={setPerPlayer}
                  min={1}
                  max={20}
                  suffix={t('场', 'matches')}
                />
              </Field>
            </>
          )}

          <div className="space-y-3 border-t border-line pt-3">
            <p className="text-sm text-ink-700">
              {t('结束条件', 'When to stop')}
              <span className="ml-1 text-xs text-ink-500">
                {t('（留 0 = 不限；到点只提示，不会自动结束）', '(0 means no limit; you get a nudge, nothing stops by itself)')}
              </span>
            </p>
            {format !== 'rotation' && (
              <Field label={t('打满几场', 'Total matches')}>
                <Stepper
                  value={capMatches}
                  onChange={setCapMatches}
                  min={0}
                  max={60}
                  suffix={capMatches === 0 ? t('（不限）', '(none)') : t('场', 'matches')}
                />
              </Field>
            )}
            <Field label={t('打多久', 'For how long')} hint={t('按小时租场的话填这个，看板会显示还够打几场', 'Fill this if the court is booked by the hour — the board shows how many matches still fit')}>
              <Stepper
                value={capMinutes}
                onChange={setCapMinutes}
                min={0}
                max={360}
                step={30}
                suffix={capMinutes === 0 ? t('（不限）', '(none)') : t('分钟', 'min')}
              />
            </Field>
            <Field label={t('每人至少打', 'Minimum each')}>
              <Stepper
                value={floorPerPlayer}
                onChange={setFloorPerPlayer}
                min={0}
                max={20}
                suffix={floorPerPlayer === 0 ? t('（不限）', '(none)') : t('场', 'matches')}
              />
            </Field>
          </div>
        </Card>
        )}

        {step === LAST_STEP && (
        <>
        {/*
          赛程预览挪到这一步来了 —— 它算的是「这些人 × 这些场地要打几场」，
          放在选人的旁边才会随着勾选实时变。留在「怎么打」那一步的话，
          人还没选，它永远是一句「先去勾人」。
        */}
        {format === 'rotation' && (
          <div className="rounded-xl border border-line bg-fill/50 px-3.5 py-3">
            {preview && preview.pairings.length > 0 ? (
              <>
                <p className="text-sm">
                  <span className="text-ink-700">
                    {t(`${selected.length} 人 · ${courtCount} 片场 · `, `${selected.length} players · ${courtCount} courts · `)}
                  </span>
                  <span className="font-semibold text-brand-600">
                    {t(`共 ${preview.pairings.length} 场`, `${preview.pairings.length} matches`)}
                  </span>
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  {preview.perPlayerMin === preview.perPlayerMax
                    ? t(`每人正好 ${preview.perPlayerMin} 场`, `exactly ${preview.perPlayerMin} each`)
                    : t(`每人 ${preview.perPlayerMin}–${preview.perPlayerMax} 场`, `${preview.perPlayerMin}–${preview.perPlayerMax} each`)}
                  {preview.matchesPerRound > 1 &&
                    t(` · 每轮同时开 ${preview.matchesPerRound} 片场`, ` · ${preview.matchesPerRound} courts per round`)}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-500">
                {preview?.reason ?? t('勾上今晚到场的人，这里就会算出要打几场', 'Tick who is here and the schedule shows up')}
              </p>
            )}
          </div>
        )}

        <SectionTitle
          right={
            <div className="flex gap-3 text-xs">
              <button
                className="text-brand-600"
                onClick={() =>
                  setSelected(
                    selected.length === roster.length ? [] : roster.map((p) => p.id),
                  )
                }
              >
                {selected.length === roster.length ? t('全不选', 'Clear all') : t('全选', 'Select all')}
              </button>
              <button className="text-brand-600" onClick={() => setAddOpen(true)}>
                {t('+ 新球员', '+ New')}
              </button>
            </div>
          }
        >
          {t(`今晚到场（已选 ${selected.length} 人）`, `Here tonight (${selected.length} selected)`)}
        </SectionTitle>

        {roster.length === 0 ? (
          <Card className="text-center">
            <p className="text-ink-700">{t('球员库还是空的', 'No players yet')}</p>
            <Button
              variant="primary"
              className="mt-3"
              onClick={() => setAddOpen(true)}
            >
              {t('加第一个球员', 'Add your first player')}
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
                    aria-label={selected.includes(p.id) ? t('取消到场', 'Mark as not here') : t('标记到场', 'Mark as here')}
                    className="flex size-11 shrink-0 items-center justify-center"
                  >
                    <span
                      className={`flex size-6 items-center justify-center rounded-full border text-xs ${
                        selected.includes(p.id)
                          ? 'border-brand-solid bg-brand-solid text-on-brand'
                          : 'border-ink-300 text-transparent'
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
        </>
        )}
      </Body>

      <BottomBar>
        {step === LAST_STEP ? (
          <>
            {genderWarning && (
              <p className="text-warning-600 mb-2 text-center text-caption">{genderWarning}</p>
            )}
            <Button variant="primary" size="lg" block disabled={!enough} onClick={start}>
              {startHint}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => setStep(step + 1)}
          >
            {t(`下一步：${t(...STEPS[step + 1].label)}`, `Next: ${t(...STEPS[step + 1].label)}`)}
          </Button>
        )}
      </BottomBar>

      <PlayerEditor open={addOpen} onClose={() => setAddOpen(false)} player={null} />
    </Screen>
  )
}
