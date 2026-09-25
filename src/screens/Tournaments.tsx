import { useState } from 'react'
import { useT, lang } from '@/lib/i18n'
import { useNav } from '@/store/useNav'
import { Body, Button, Card, EmptyState, Screen, Sheet, TopBar } from '@/components/ui'
import { entrantMap, useTournament, type Tournament } from '@/store/useTournament'
import { champion, roundCount, slotLabel } from '@/lib/bracket'

/* ------------------------------------------------------------------ *
 * 比赛列表
 *
 * 一场比赛办完了不会再动，但它得留着 —— 主办方下个月还要翻出来看
 * 去年是谁拿的冠军，参赛的人也会回来问。所以这一屏是个存档架，
 * 不是待办列表。
 * ------------------------------------------------------------------ */

export function Tournaments() {
  const t = useT()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const list = useTournament((s) => s.list)
  const remove = useTournament((s) => s.remove)
  const [confirming, setConfirming] = useState<Tournament | null>(null)

  return (
    <Screen>
      <TopBar
        title={t('比赛', 'Tournaments')}
        onBack={back}
        right={
          <Button size="sm" variant="primary" onClick={() => push({ name: 'tournamentSetup' })}>
            {t('开一场', 'New')}
          </Button>
        }
      />
      <Body>
        {list.length === 0 ? (
          <EmptyState
            icon="🏆"
            title={t('还没办过比赛', 'No tournaments yet')}
            hint={t(
              '填一份名单，它会帮你抽签排好整张表 —— 单打双打都行，种子按公开赛的规矩落位。',
              'Type in the entries and it draws the whole bracket — singles or doubles, with seeds placed the standard way.',
            )}
            action={
              <Button variant="primary" onClick={() => push({ name: 'tournamentSetup' })}>
                {t('开一场比赛', 'New tournament')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {list.map((tr) => (
              <Row key={tr.id} tour={tr} onOpen={() => push({ name: 'bracket', tournamentId: tr.id })} onDelete={() => setConfirming(tr)} />
            ))}
          </div>
        )}

        {/*
          比赛只存在这台手机上，所以这句话要说在前面，不是等出事了才说。
        */}
        <p className="text-ink-500 text-caption">
          {t(
            '比赛存在这台手机上，不上云 —— 清了浏览器数据就没了。办完记得把赛表导成图存一份。',
            'Tournaments are stored on this phone only. Clearing browser data removes them, so export the bracket as an image when you’re done.',
          )}
        </p>
      </Body>

      <Sheet
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={t('删掉这场比赛？', 'Delete this tournament?')}
      >
        <div className="space-y-3">
          <p className="text-ink-700 text-[15px]">
            {t(
              `「${confirming?.name}」整张赛表和所有比分都会没了，找不回来。`,
              `“${confirming?.name}” — the whole bracket and every score goes, for good.`,
            )}
          </p>
          <Button
            block
            variant="danger"
            size="lg"
            onClick={() => {
              if (confirming) remove(confirming.id)
              setConfirming(null)
            }}
          >
            {t('删掉', 'Delete')}
          </Button>
          <Button block onClick={() => setConfirming(null)}>
            {t('算了', 'Cancel')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  )
}

function Row({
  tour,
  onOpen,
  onDelete,
}: {
  tour: Tournament
  onOpen: () => void
  onDelete: () => void
}) {
  const t = useT()
  const zh = lang() === 'zh'
  const champ = champion(tour.matches)
  const played = tour.matches.filter((m) => m.scoreA !== undefined).length
  const real = tour.matches.filter((m) => m.a && m.b).length

  return (
    <Card>
      <div className="flex items-start gap-3">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="text-ink-900 truncate font-medium">{tour.name}</p>
          <p className="text-ink-500 mt-0.5 text-caption">
            {t(
              `${tour.date} · ${tour.entrants.length} ${tour.doubles ? '队' : '人'} · ${roundCount(tour.size)} 轮`,
              `${tour.date} · ${tour.entrants.length} ${tour.doubles ? 'teams' : 'players'} · ${roundCount(tour.size)} rounds`,
            )}
          </p>
          <p className="mt-1 text-caption">
            {champ ? (
              <span className="text-brand-700 font-semibold">
                {t(`冠军 ${slotLabel(entrantMap(tour).get(champ), zh)}`, `Champion: ${slotLabel(entrantMap(tour).get(champ), zh)}`)}
              </span>
            ) : (
              <span className="text-ink-500">
                {t(`打了 ${played} / ${real} 场`, `${played} of ${real} matches played`)}
              </span>
            )}
          </p>
        </button>
        <button
          onClick={onDelete}
          aria-label={t('删掉这场比赛', 'Delete')}
          className="text-ink-500 active:text-danger-600 shrink-0 px-2 py-1 text-caption"
        >
          ✕
        </button>
      </div>
    </Card>
  )
}
