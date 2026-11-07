import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  Field,
  Screen,
  SectionTitle,
  Segmented,
  Toggle,
  TopBar,
  cx,
  inputClass,
} from '@/components/ui'
import { needsRedraw, playedCount, useTournament } from '@/store/useTournament'
import {
  drawSize,
  placeInSlot,
  reconcileSlots,
  roundName,
  roundCount,
  slotLabel,
  slotsOf,
  type DrawMode,
  type Entrant,
  type SlotIds,
} from '@/lib/bracket'
import {
  addRow,
  canRemove,
  dropRow,
  emptyRow,
  ensureTail as ensureTailOf,
  filledRows,
  type EntryRow,
} from '@/lib/entryRows'
import { todayISO } from '@/lib/format'

/* ------------------------------------------------------------------ *
 * 开一场比赛：报名 + 排签
 *
 * -------------------------------------------------------------------
 * 参赛者只填名字
 *
 * 来打公开赛的人绝大多数**没装这个 App**，更没有球员行。要求他们先
 * 注册、先进群，这个功能就没人用得上了 —— 主办方要的是一张能贴出来
 * 的表，不是一个会员系统。
 *
 * 所以这一屏上的「人」只是一个名字（双打两个），和球群里那些球员
 * 完全无关。
 *
 * -------------------------------------------------------------------
 * 种子号在这一屏上标，不在排签那一步
 *
 * 主办方心里早就有数谁是种子（报名时就知道），而排签是当众做的一件
 * 事 —— 那时候再回头翻名单标种子，是把两件事搅在一起。
 * ------------------------------------------------------------------ */

export function TournamentSetup({ tournamentId }: { tournamentId?: string }) {
  const t = useT()
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)
  const create = useTournament((s) => s.create)
  const update = useTournament((s) => s.update)
  /*
   * 带了 tournamentId 就是「回去改」，不带就是「开一场新的」。
   *
   * 同一屏两种用法，因为要改的东西和当初要填的东西**是同一批**。
   * 另做一个「编辑」屏的话，两边迟早会长得不一样 —— 而不一样的那处
   * 正好是人回头要改的那处。
   */
  const editing = useTournament((s) =>
    tournamentId ? s.list.find((x) => x.id === tournamentId) : undefined,
  )

  const [name, setName] = useState(editing?.name ?? '')
  const [date, setDate] = useState(editing?.date ?? todayISO())
  const [doubles, setDoubles] = useState(editing?.doubles ?? true)
  const [mode, setMode] = useState<DrawMode>(editing?.mode ?? 'seeded')
  /*
   * 手动排时第一轮每一格是谁（参赛者 id，null = 轮空）。
   * 回去改一场手动排的比赛，从现成的表上读回来。
   */
  const [slotState, setSlots] = useState<SlotIds>(() =>
    editing?.mode === 'manual' ? slotsOf(editing.matches) : [],
  )
  const [rows, setRows] = useState<EntryRow[]>(() =>
    editing
      ? [
          ...editing.entrants.map((e) => ({
            /* id 原样带回来：只改名字的话，赛表和比分一个都不用动 */
            id: e.id,
            a: e.names[0] ?? '',
            b: e.names[1] ?? '',
            seed: e.seed ? String(e.seed) : '',
          })),
          emptyRow(),
        ]
      : [emptyRow()],
  )

  /* 填了名字的那几行才算报名 */
  const filled = useMemo(() => filledRows(rows, doubles), [rows, doubles])
  const size = drawSize(filled.length)
  const byes = Math.max(0, size - filled.length)

  const setRow = (i: number, patch: Partial<EntryRow>) =>
    setRows((old) => old.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  /*
   * 加一行、删一行、自动续行的规矩都在 lib/entryRows 里，
   * 连同那句要紧的话：**底下永远有一行空的等着填**。
   * 搬出去是因为这块已经把人卡住过两次，而那句话在这一屏里测不动。
   */
  const ensureTail = (i: number) => setRows((old) => ensureTailOf(old, i))
  const add = () => setRows(addRow)
  const drop = (i: number) => setRows((old) => dropRow(old, i))

  const entrants: Entrant[] = filled.map((r) => {
    const names = [r.a.trim(), doubles ? r.b.trim() : ''].filter(Boolean)
    const seed = Number(r.seed)
    return {
      /* 用行自己的 id，不用下标 —— 下标会随着删人整体前移，那等于集体换了身份 */
      id: r.id,
      names: names.length ? names : [t('（没填名字）', '(no name)')],
      seed: Number.isInteger(seed) && seed > 0 ? seed : undefined,
    }
  })

  /*
   * 名单随时在变（边填边加人），摆好的格子每次都跟着名单对一遍：
   * 留着的人不动，删掉的人让出位置，新来的人填进空格。
   */
  const byId = new Map(entrants.map((e) => [e.id, e]))
  const slots = useMemo(
    () =>
      reconcileSlots(
        slotState,
        entrants.map((e) => e.id),
        size,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotState, entrants.map((e) => e.id).join('|'), size],
  )
  const manual = mode === 'manual'
  const manualSlots = manual ? slots.map((id) => (id ? (byId.get(id) ?? null) : null)) : undefined
  const place = (i: number, id: string | null) => setSlots(placeInSlot(slots, i, id))

  /*
   * 改完之后这张表还是不是原来那张。
   *
   * 只改了名字 → 不用重排，比分全留着。
   * 加了人、删了人、动了种子、换了排签方式 → 抽出来的签就不是原来那副，
   * 只能重排，已经填的比分跟着作废 —— 这句话要在按钮上说清楚，
   * 不能等人点完了才发现。
   */
  const willRedraw =
    !!editing && needsRedraw(editing, { entrants, mode, slots: manual ? slots : undefined })
  const losing = editing && willRedraw ? playedCount(editing) : 0

  /*
   * 两个人以上才排得出表。一个人的比赛不是比赛 ——
   * 这一条挡在按钮上，而不是等他点下去再弹一句话。
   */
  const ready = filled.length >= 2 && name.trim().length > 0

  const start = () => {
    if (editing) {
      update(editing.id, {
        name,
        date,
        doubles,
        entrants,
        mode,
        slots: manualSlots,
      })
      back()
      return
    }
    const made = create({
      name,
      date,
      doubles,
      entrants,
      mode,
      slots: manualSlots,
    })
    replace({ name: 'bracket', tournamentId: made.id })
  }

  return (
    <Screen>
      <TopBar
        title={editing ? t('改名单', 'Edit entries') : t('开一场比赛', 'New tournament')}
        onBack={back}
      />
      <Body>
        <Field label={t('比赛名字', 'Name')}>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('城中公开赛 男双', 'City Open — Men’s doubles')}
          />
        </Field>

        <Field label={t('日期', 'Date')}>
          <input
            className={inputClass}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        <Toggle
          checked={doubles}
          onChange={setDoubles}
          label={t('双打（一格两个人）', 'Doubles (two names per slot)')}
        />

        {/* ---------------------------------------------------------- *
          排签怎么排。

          「按种子排」是公开赛的标准做法，也是用户要的那一条：
          标了种子的按号入座，1 号和 2 号数学上只可能在决赛碰面，
          1 号最早在半决赛碰 3/4 号。所以它是默认。
        * ---------------------------------------------------------- */}
        <div>
          <SectionTitle>{t('怎么排签', 'How to draw')}</SectionTitle>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'seeded', label: t('按种子排', 'Seeded') },
              { value: 'random', label: t('全随机', 'Random') },
              { value: 'manual', label: t('自己安排', 'Manual') },
            ]}
          />
          <p className="text-ink-500 mt-2 text-caption">
            {manual
              ? t(
                  '第一轮谁打谁由你来定。先在下面填好报名名单，再到「第一轮对阵」里给每一格选人 —— 选了别人那格的人，两个会对调。',
                  'You decide who plays whom in round one. Fill in the entries, then pick a name for each slot under “First-round matches” — picking someone already placed swaps the two.',
                )
              : mode === 'seeded'
                ? t(
                    '标了种子的按号入座 —— 1 号和 2 号只可能在决赛碰面，1 号最早在半决赛碰 3/4 号。其余的人随机填空。轮空优先给高种子。',
                    'Seeds take their standard positions — 1 and 2 can only meet in the final, and 1 meets 3 or 4 no earlier than the semis. Everyone else fills in at random, and byes go to the top seeds.',
                  )
                : t(
                    '所有人一起抽，种子那一列当不存在。',
                    'Everyone drawn together — the seed column is ignored.',
                  )}
          </p>
        </div>

        <div>
          <SectionTitle>
            {t(`报名（${filled.length} ${doubles ? '队' : '人'}）`, `Entries (${filled.length})`)}
          </SectionTitle>

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <input
                    className={inputClass}
                    value={r.a}
                    onChange={(e) => {
                      setRow(i, { a: e.target.value })
                      ensureTail(i)
                    }}
                    placeholder={
                      doubles
                        ? t(`第 ${i + 1} 队 · 队员一`, `Team ${i + 1} · player 1`)
                        : t(`第 ${i + 1} 人`, `Player ${i + 1}`)
                    }
                  />
                  {doubles && (
                    <input
                      className={inputClass}
                      value={r.b}
                      onChange={(e) => {
                        setRow(i, { b: e.target.value })
                        ensureTail(i)
                      }}
                      placeholder={t('队员二', 'player 2')}
                    />
                  )}
                </div>
                {/*
                  种子号。空着就不是种子 —— 绝大多数行都空着，
                  所以这个框窄，不抢名字的地方。

                  宽度写在外面这层 div 上，不写在 input 上：inputClass
                  里已经有 w-full，再往同一个 input 上加 w-16 是两条
                  同权重的 width 规则打架，谁赢由样式表的先后决定 ——
                  而 w-full 排在后面。实测这个框会撑成整行 350px 盖在
                  名字框上，名字框被挤到 30px：人点下去其实点中的是种子框，
                  敲进去的字被那个「只留数字」的过滤全吃掉，
                  看起来就是「名字填下去没显示」。
                */}
                <div className={cx('w-20 shrink-0', manual && 'hidden')}>
                  <input
                    className={cx(inputClass, 'text-center')}
                    value={r.seed}
                    inputMode="numeric"
                    onChange={(e) => setRow(i, { seed: e.target.value.replace(/\D/g, '') })}
                    placeholder={t('种子', 'Seed')}
                    aria-label={t(`第 ${i + 1} 个的种子号`, `Seed for entry ${i + 1}`)}
                  />
                </div>
                {/*
                  空行不给 ✕。

                  空行本来就不算一队，删不删都一样；而它偏偏是最后那一行
                  ——「自动多给的那一行」。把它删掉，人就再也加不了人了：
                  自动续行只在「打到最后一行」时触发，而剩下的行全填满了，
                  没有哪一下打字会再触发它。这个死角是真踩到的。

                  现在就算删了也不要紧（下面有按钮），但一个删了等于给自己
                  挖坑的按钮，本来就不该摆在那儿。
                */}
                {canRemove(rows, i) ? (
                  <button
                    onClick={() => drop(i)}
                    aria-label={t('去掉这一个', 'Remove')}
                    className="text-ink-500 active:text-danger-600 shrink-0 px-2 py-2.5 text-caption"
                  >
                    ✕
                  </button>
                ) : (
                  <span className="shrink-0 px-2 py-2.5 text-caption" aria-hidden />
                )}
              </div>
            ))}
          </div>

          {/*
            明摆着的「加一队」。

            自动续行省事，可它是**看不见的**：人不知道有这回事，
            也就没法指望它。真出了岔子（比如上面那个空行被删掉），
            屏幕上就一个出口都没有了 —— 人盯着一张填满的名单，
            没有任何东西告诉他还能再加。

            所以这个按钮不是「也加一个吧」，它是那条正路；
            自动续行只是替熟手省下点击。
          */}
          <Button block className="mt-2" onClick={add}>
            {t(doubles ? '＋ 加一队' : '＋ 加一人', '+ Add entry')}
          </Button>
        </div>

        {/* ---------------------------------------------------------- *
          手动排：第一轮每一场两个下拉框。

          每个人在表上恰好一格 —— 选一个已经摆了的人，是和他对调，
          不是复制。所以不用另外查「有没有人摆了两次、有没有人漏了」，
          这种表根本摆不出来。
        * ---------------------------------------------------------- */}
        {manual && filled.length >= 2 && (
          <div>
            <SectionTitle>
              {t('第一轮对阵', 'First-round matches')} ·{' '}
              {roundName(0, roundCount(size), t('zh', 'en') === 'zh')}
            </SectionTitle>
            <div className="space-y-2">
              {Array.from({ length: size / 2 }, (_, m) => (
                <div key={m} className="border-line bg-surface rounded-card border p-3">
                  <p className="text-ink-500 mb-2 text-caption">
                    {t(`第 ${m + 1} 场`, `Match ${m + 1}`)}
                  </p>
                  <div className="flex items-center gap-2">
                    {[m * 2, m * 2 + 1].map((i, k) => (
                      <div key={i} className="contents">
                        {k === 1 && <span className="text-ink-500 shrink-0 text-caption">vs</span>}
                        <div className="min-w-0 flex-1">
                          <select
                            className={inputClass}
                            value={slots[i] ?? ''}
                            onChange={(e) => place(i, e.target.value || null)}
                            aria-label={t(
                              `第 ${m + 1} 场 ${k === 0 ? '上' : '下'}方`,
                              `Match ${m + 1}, side ${k === 0 ? 'A' : 'B'}`,
                            )}
                          >
                            {(byes > 0 || slots[i] === null) && (
                              <option value="">{t('（轮空）', '(Bye)')}</option>
                            )}
                            {entrants.map((e) => (
                              <option key={e.id} value={e.id}>
                                {slotLabel(e, true)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {slots.some((x, i) => i % 2 === 0 && x === null && slots[i + 1] === null) && (
              <p className="text-ink-500 mt-2 text-caption">
                {t(
                  '有一场两边都是轮空 —— 这一枝整个是空的，下一轮对面的人会直接晋级。想让每个轮空都对着一个人，就把人挪过去。',
                  'One match has a bye on both sides — that branch is empty and the player across from it in the next round goes straight through. Move someone in if you want every bye paired with a player.',
                )}
              </p>
            )}
          </div>
        )}

        {/*
          排之前就把表的样子说出来。

          「23 队要用 32 人表，9 个轮空」是主办方最先想知道的事 ——
          等排完再看出来就晚了，他可能还想再拉两个人凑一凑。
        */}
        {filled.length >= 2 && (
          <div className="border-line bg-fill rounded-card border p-3.5">
            <p className="text-ink-700 text-caption">
              {t(
                `${filled.length} ${doubles ? '队' : '人'} → ${size} 人表`,
                `${filled.length} → draw of ${size}`,
              )}
              {byes > 0 &&
                t(
                  manual ? `，${byes} 个轮空` : `，${byes} 个轮空（优先给种子）`,
                  manual
                    ? `, ${byes} ${byes === 1 ? 'bye' : 'byes'}`
                    : `, ${byes} ${byes === 1 ? 'bye' : 'byes'} (given to the top seeds)`,
                )}
            </p>
          </div>
        )}

        {losing > 0 && (
          <div className="border-danger-600/30 bg-danger-50 rounded-card border p-3.5">
            <p className="text-danger-600 text-caption">
              {t(
                `名单动了，整张表要重排 —— 已经填的 ${losing} 场比分会没了。只改名字的话不会。`,
                `The entries changed, so the bracket is redrawn — the ${losing} score${losing > 1 ? 's' : ''} already entered will be lost. Fixing a name alone does not do this.`,
              )}
            </p>
          </div>
        )}

        <Button block variant="primary" size="lg" disabled={!ready} onClick={start}>
          {editing
            ? willRedraw
              ? t('存下来，重新排签', 'Save and redraw')
              : t('存下来', 'Save')
            : t('抽签，生成赛表', 'Draw and build the bracket')}
        </Button>
        {!ready && (
          <p className="text-ink-500 text-caption">
            {t('填个比赛名字，至少两队，才排得出表。', 'Give it a name and at least two entries.')}
          </p>
        )}
      </Body>
    </Screen>
  )
}
