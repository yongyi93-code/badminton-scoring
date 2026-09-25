import { useMemo, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  EmptyState,
  Screen,
  Sheet,
  Toast,
  TopBar,
  cx,
  inputClass,
} from '@/components/ui'
import { entrantMap, useTournament } from '@/store/useTournament'
import {
  champion,
  roundCount,
  roundName,
  isDead,
  slotLabel,
  type BracketMatch,
  type Entrant,
} from '@/lib/bracket'
import { shareNodeAsImage } from '@/lib/shareImage'
import { lang } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 赛表
 *
 * -------------------------------------------------------------------
 * 一轮一列，横着滚
 *
 * 赛表本来就是横着长的：32 强在最左，决赛在最右。手机屏塞不下五列，
 * 所以这一屏横向滚动 —— 这是为数不多值得横滚的界面，因为**用户心里
 * 那张图就是横的**，竖着堆反而要重新认。
 *
 * 每一列自己纵向均分：第二轮的一场正好落在它上游那两场中间。这不是
 * 装饰，是「谁打谁」那条线本身 —— 对不齐的话，人得靠数数才知道半决赛
 * 那一场是哪两个人打上来的。
 *
 * -------------------------------------------------------------------
 * 点一场就填分，不另开一屏
 *
 * 现场记分是「打完一场立刻记一笔」，一场接一场。跳屏的话每记一次要
 * 进出两回，而赛表那张图一离开视线，主办方就得重新找自己刚才看到哪儿。
 * ------------------------------------------------------------------ */

export function Bracket({ tournamentId }: { tournamentId: string }) {
  const t = useT()
  const zh = lang() === 'zh'
  const back = useNav((s) => s.back)
  const tour = useTournament((s) => s.list.find((x) => x.id === tournamentId))
  const score = useTournament((s) => s.score)

  const [editing, setEditing] = useState<{ round: number; index: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => (tour ? entrantMap(tour) : new Map<string, Entrant>()), [tour])

  if (!tour) {
    return (
      <Screen>
        <TopBar title={t('赛表', 'Bracket')} onBack={back} />
        <Body>
          <EmptyState
            icon="🗂"
            title={t('这场比赛不在了', 'That tournament is gone')}
            hint={t(
              '比赛存在这台手机上 —— 清过浏览器数据的话就没了。',
              'Tournaments live on this phone, so clearing browser data removes them.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  const rounds = roundCount(tour.size)
  const champ = champion(tour.matches)
  const live = editing
    ? tour.matches.find((m) => m.round === editing.round && m.index === editing.index)
    : undefined

  async function share() {
    if (!shareRef.current || !tour) return
    setSharing(true)
    setToast(t('正在出图…', 'Making the image…'))
    try {
      const outcome = await shareNodeAsImage(
        shareRef.current,
        t(`赛表-${tour.date}.png`, `bracket-${tour.date}.png`),
        tour.name,
      )
      setToast(
        outcome === 'shared'
          ? t('已打开分享面板', 'Share sheet opened')
          : outcome === 'downloaded'
            ? t('图片已下载，可以发到群里', 'Image saved — send it to the group')
            : outcome === 'maybe-blocked'
              ? t(
                  '可能没存上 —— 从 WhatsApp、FB 里打开的页面，下载常常被吞掉。用手机自己的浏览器打开这一页再试。',
                  'It may not have saved — pages opened inside WhatsApp or Facebook often swallow downloads. Try your phone’s own browser.',
                )
              : t('生成图片失败', 'Could not make the image'),
      )
    } catch (err) {
      setToast(err instanceof Error ? err.message : t('生成图片失败', 'Could not make the image'))
    } finally {
      setSharing(false)
    }
  }

  return (
    <Screen>
      <TopBar
        title={tour.name}
        subtitle={t(
          `${tour.date} · ${tour.size} 人表 · ${tour.doubles ? '双打' : '单打'}`,
          `${tour.date} · draw of ${tour.size} · ${tour.doubles ? 'doubles' : 'singles'}`,
        )}
        onBack={back}
        right={
          <Button size="sm" onClick={share} disabled={sharing}>
            {sharing ? t('出图中…', 'Working…') : t('分享', 'Share')}
          </Button>
        }
      />

      <Body>
        {/*
          横滚的是外面这层，要导出去的是里面那层。

          这个分工不是随便定的：出图是按节点自己的宽高画的，而
          overflow-x-auto 那一层只有屏幕那么宽 —— 把 ref 挂在它身上的话，
          手机上分享出去的是一张**被裁到只剩前两轮**的图，而且在这台
          排得下的电脑上看不出来。里面那层是 min-w-max，它有多宽，
          导出来就有多宽。

          顺带：抬头和冠军都放进这一层，所以贴到群里的是一张自带
          「什么比赛、哪天、谁拿的冠军」的完整图，不是一堆光秃秃的格子。
        */}
        <div className="-mx-5 overflow-x-auto px-5 pb-2">
          {/*
            这一块不做圆角。

            出图那一步先用深色铺满画布，再把节点画上去（shareImage.ts）——
            圆角会让那四个角漏出深色，贴到群里就是一张白表配四个黑角。
          */}
          <div ref={shareRef} className="bg-surface min-w-max p-4">
            <div className="mb-3">
              <p className="text-ink-900 text-title font-semibold">{tour.name}</p>
              <p className="text-ink-500 text-caption">
                {t(
                  `${tour.date} · ${tour.size} 人表 · ${tour.doubles ? '双打' : '单打'} · ${tour.entrants.length} ${tour.doubles ? '队' : '人'}`,
                  `${tour.date} · draw of ${tour.size} · ${tour.doubles ? 'doubles' : 'singles'} · ${tour.entrants.length} entries`,
                )}
              </p>
              {champ && (
                <p className="text-brand-700 mt-1 font-semibold">
                  {t(`冠军 ${slotLabel(byId.get(champ), zh)}`, `Champion: ${slotLabel(byId.get(champ), zh)}`)}
                </p>
              )}
            </div>

            {/*
              对齐靠的是「每一场平分这一列的高度」，不是算出来的间距。

              各列一样高（items-stretch），列里每一场 flex-1 平分，然后
              把卡片在自己那一格里垂直居中。第一轮 16 格、第二轮 8 格，
              所以第二轮那一格正好罩住上游两格，居中就落在它们中间 ——
              **不管卡片本身多高**。

              换成「每场给个固定间距」的话，只要有一张卡比别的高一行，
              从它往下整列就全错开了，而那正是最容易看错「谁打谁」的地方。
            */}
            <div className="flex items-stretch gap-3">
              {Array.from({ length: rounds }, (_, r) => {
                const list = tour.matches
                  .filter((m) => m.round === r)
                  .sort((a, b) => a.index - b.index)
                return (
                  <div key={r} className="flex w-40 shrink-0 flex-col">
                    <p className="text-ink-500 mb-2 text-center text-caption">
                      {roundName(r, rounds, zh)}
                    </p>
                    <div className="flex flex-1 flex-col">
                      {list.map((m) => (
                        <div key={m.index} className="flex flex-1 items-center py-1">
                          <MatchCard
                            match={m}
                            byId={byId}
                            zh={zh}
                            dead={isDead(tour.matches, m.round, m.index)}
                            onTap={() => setEditing({ round: m.round, index: m.index })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <p className="text-ink-500 text-caption">
          {t(
            '点一场比赛填比分。上游改了结果，后面几轮会跟着重算 —— 那几场原来的比分也就作废了。',
            'Tap a match to enter the score. Changing an earlier result re-flows the rounds after it, and clears the scores that no longer apply.',
          )}
        </p>
      </Body>

      <ScoreSheet
        open={!!live}
        match={live}
        byId={byId}
        zh={zh}
        onClose={() => setEditing(null)}
        onSave={(a, b) => {
          if (!live) return
          score(tour.id, live.round, live.index, a, b)
          setEditing(null)
        }}
      />

      <Toast message={toast} onClose={() => setToast(null)} />
    </Screen>
  )
}

/* ------------------------------------------------------------------ */

function MatchCard({
  match,
  byId,
  zh,
  dead,
  onTap,
}: {
  match: BracketMatch
  byId: Map<string, Entrant>
  zh: boolean
  /** 这一格永远不会有人（空枝），不是「还没打到」。见 bracket.isDead */
  dead: boolean
  onTap: () => void
}) {
  /* 空枝：点它没有任何意义，所以它不是按钮 */
  if (dead) {
    return (
      <div className="border-line rounded-card text-ink-300 w-full border border-dashed px-2.5 py-3.5 text-center text-caption">
        {zh ? '空' : '—'}
      </div>
    )
  }

  /* 人会来，只是上一轮还没打完 */
  if (!match.a && !match.b) {
    return (
      <div className="border-line rounded-card text-ink-500 w-full border border-dashed px-2.5 py-3.5 text-center text-caption">
        {zh ? '等上一轮' : 'TBD'}
      </div>
    )
  }

  /* 有一边是空的 = 轮空。已经晋级，没什么可填 */
  const bye = (!!match.a && !match.b) || (!match.a && !!match.b)
  const done = match.scoreA !== undefined && match.scoreB !== undefined

  /*
   * 一格两行，永远两行。
   *
   * 轮空那一行显示「轮空」就够了 —— 之前底下还另外挂了一句「轮空」，
   * 同一件事说两遍，而且把卡片撑高了一行。高度不齐会连累对齐
   * （见上面那段），所以这不只是啰嗦的问题。
   */
  const row = (id: string | null, sc: number | undefined) => {
    const won = !!id && match.winner === id
    return (
      <div className="flex h-5 items-center gap-2">
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-caption',
            !id ? 'text-ink-300' : won ? 'text-ink-900 font-semibold' : 'text-ink-700',
            /* 输了的划掉：一眼扫过整张表时，看的是「谁还在」 */
            done && !won && 'text-ink-500 line-through',
          )}
        >
          {slotLabel(id ? byId.get(id) : null, zh)}
        </span>
        <span className={cx('text-caption tabular-nums', won ? 'text-ink-900' : 'text-ink-500')}>
          {sc ?? ''}
        </span>
      </div>
    )
  }

  return (
    <button
      onClick={bye ? undefined : onTap}
      disabled={bye}
      className={cx(
        'border-line bg-surface rounded-card w-full space-y-1 border px-2.5 py-2 text-left',
        !bye && 'active:bg-fill',
        done && 'border-brand-600/40',
      )}
    >
      {row(match.a, match.scoreA)}
      <div className="bg-line h-px" />
      {row(match.b, match.scoreB)}
    </button>
  )
}

/* ------------------------------------------------------------------ */

function ScoreSheet({
  open,
  match,
  byId,
  zh,
  onClose,
  onSave,
}: {
  open: boolean
  match: BracketMatch | undefined
  byId: Map<string, Entrant>
  zh: boolean
  onClose: () => void
  onSave: (a: number, b: number) => void
}) {
  const t = useT()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  /*
   * 换了一场就把框清空。
   *
   * 不清的话，填完第一场再点第二场，上一场的比分还在框里 ——
   * 而它看起来完全像是「这一场已经填过了」。现场记分最容易在这里错。
   */
  const key = match ? `${match.round}:${match.index}` : ''
  const [shown, setShown] = useState(key)
  if (key !== shown) {
    setShown(key)
    setA(match?.scoreA !== undefined ? String(match.scoreA) : '')
    setB(match?.scoreB !== undefined ? String(match.scoreB) : '')
  }

  if (!match) return null

  const na = Number(a)
  const nb = Number(b)
  const filled = a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)
  /* 羽毛球不会平局。平分一定是敲错了，所以这里不收 */
  const ok = filled && na !== nb

  const name = (id: string | null) => slotLabel(id ? byId.get(id) : null, zh)

  return (
    <Sheet open={open} onClose={onClose} title={t('填比分', 'Enter the score')}>
      <div className="space-y-3">
        <ScoreRow label={name(match.a)} value={a} onChange={setA} />
        <ScoreRow label={name(match.b)} value={b} onChange={setB} />

        {filled && !ok && (
          <p className="text-danger-600 text-caption">
            {t('两边一样分 —— 羽毛球不会平，检查一下。', 'A tie isn’t possible in badminton — check the numbers.')}
          </p>
        )}

        <Button block variant="primary" size="lg" disabled={!ok} onClick={() => onSave(na, nb)}>
          {t('存下来', 'Save')}
        </Button>
      </div>
    </Sheet>
  )
}

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-ink-900 min-w-0 flex-1 truncate text-[15px]">{label}</span>
      <input
        className={cx(inputClass, 'w-20 shrink-0 text-center')}
        value={value}
        inputMode="numeric"
        aria-label={label}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
      />
    </div>
  )
}
