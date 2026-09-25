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
import { useTournament } from '@/store/useTournament'
import { drawSize, type DrawMode, type Entrant } from '@/lib/bracket'
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

export function TournamentSetup() {
  const t = useT()
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)
  const create = useTournament((s) => s.create)

  const [name, setName] = useState('')
  const [date, setDate] = useState(todayISO())
  const [doubles, setDoubles] = useState(true)
  const [mode, setMode] = useState<Exclude<DrawMode, 'manual'>>('seeded')
  const [rows, setRows] = useState<{ a: string; b: string; seed: string }[]>([
    { a: '', b: '', seed: '' },
  ])

  /* 填了名字的那几行才算报名。空行是给人继续打字用的，不该算进人数 */
  const filled = useMemo(
    () => rows.filter((r) => r.a.trim() || (doubles && r.b.trim())),
    [rows, doubles],
  )
  const size = drawSize(filled.length)
  const byes = Math.max(0, size - filled.length)

  const setRow = (i: number, patch: Partial<{ a: string; b: string; seed: string }>) =>
    setRows((old) => old.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  /*
   * 打到最后一行就自动多给一行。
   *
   * 报名是「一口气录二十个人」那种活，每录一个还要先点一下「加一行」
   * 的话，二十次点击全是白费的。
   */
  const ensureTail = (i: number) =>
    setRows((old) => (i === old.length - 1 ? [...old, { a: '', b: '', seed: '' }] : old))

  const drop = (i: number) =>
    setRows((old) => (old.length === 1 ? old : old.filter((_, k) => k !== i)))

  const entrants: Entrant[] = filled.map((r, i) => {
    const names = [r.a.trim(), doubles ? r.b.trim() : ''].filter(Boolean)
    const seed = Number(r.seed)
    return {
      id: `e${i}`,
      names: names.length ? names : [t('（没填名字）', '(no name)')],
      seed: Number.isInteger(seed) && seed > 0 ? seed : undefined,
    }
  })

  /*
   * 两个人以上才排得出表。一个人的比赛不是比赛 ——
   * 这一条挡在按钮上，而不是等他点下去再弹一句话。
   */
  const ready = filled.length >= 2 && name.trim().length > 0

  const start = () => {
    const made = create({ name, date, doubles, entrants, mode })
    replace({ name: 'bracket', tournamentId: made.id })
  }

  return (
    <Screen>
      <TopBar title={t('开一场比赛', 'New tournament')} onBack={back} />
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
            ]}
          />
          <p className="text-ink-500 mt-2 text-caption">
            {mode === 'seeded'
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
                      doubles ? t(`第 ${i + 1} 队 · 队员一`, `Team ${i + 1} · player 1`) : t(`第 ${i + 1} 人`, `Player ${i + 1}`)
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
                */}
                <input
                  className={cx(inputClass, 'w-16 shrink-0 text-center')}
                  value={r.seed}
                  inputMode="numeric"
                  onChange={(e) => setRow(i, { seed: e.target.value.replace(/\D/g, '') })}
                  placeholder={t('种子', 'Seed')}
                  aria-label={t(`第 ${i + 1} 个的种子号`, `Seed for entry ${i + 1}`)}
                />
                <button
                  onClick={() => drop(i)}
                  aria-label={t('去掉这一个', 'Remove')}
                  className="text-ink-500 active:text-danger-600 shrink-0 px-2 py-2.5 text-caption"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

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
                  `，${byes} 个轮空（优先给种子）`,
                  `, ${byes} byes (given to the top seeds)`,
                )}
            </p>
          </div>
        )}

        <Button block variant="primary" size="lg" disabled={!ready} onClick={start}>
          {t('抽签，生成赛表', 'Draw and build the bracket')}
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
