import { useState } from 'react'
import { useT, lang } from '@/lib/i18n'
import { useNav } from '@/store/useNav'
import { Body, Button, Card, EmptyState, Screen, SectionTitle, Sheet, TopBar } from '@/components/ui'
import {
  canManage,
  canScore,
  entrantMap,
  useTournament,
  type Tournament,
} from '@/store/useTournament'
import { useAuth } from '@/store/useAuth'
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
  const me = useAuth().session?.user.id ?? null
  /*
   * 分两堆：我开的 / 我能记分的放上面，别人的（只能看）放下面。
   * 登录的人都看得到所有比赛，全混在一起的话，自己那场会被淹掉。
   */
  const mine = list.filter((x) => canScore(x, me))
  const others = list.filter((x) => !canScore(x, me))

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
          <>
            {mine.length > 0 && (
              <div className="space-y-3">
                {mine.map((tr) => (
                  <Row
                    key={tr.id}
                    tour={tr}
                    me={me}
                    onOpen={() => push({ name: 'bracket', tournamentId: tr.id })}
                    onDelete={canManage(tr, me) ? () => setConfirming(tr) : undefined}
                  />
                ))}
              </div>
            )}
            {others.length > 0 && (
              <div className="space-y-3">
                <SectionTitle>{t('其他人的比赛（只能看）', 'Other tournaments (view only)')}</SectionTitle>
                {others.map((tr) => (
                  <Row
                    key={tr.id}
                    tour={tr}
                    me={me}
                    onOpen={() => push({ name: 'bracket', tournamentId: tr.id })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/*
          存在哪儿，要说在前面，不是等出事了才说。
        */}
        <p className="text-ink-500 text-caption">
          {me
            ? t(
                '比赛存在云端，登录的人都看得到，比分实时更新。只有开比赛的人和他加的记分员能填分。',
                'Tournaments are saved online: anyone signed in can watch, and scores update live. Only the host and the scorers they add can enter scores.',
              )
            : t(
                '还没登录，比赛只存在这台手机上 —— 清了浏览器数据就没了。登录之后会自动传上云端，别人也能看。',
                'You’re signed out, so tournaments stay on this phone only. Sign in and they upload automatically for others to watch.',
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
              `「${confirming?.name}」整张赛表和所有比分都会没了，找不回来 —— 记分员和看的人那边也一起没了。`,
              `“${confirming?.name}” — the whole bracket and every score goes, for good, for scorers and viewers too.`,
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
  me,
  onOpen,
  onDelete,
}: {
  tour: Tournament
  me: string | null
  onOpen: () => void
  /** 没有 = 不是开比赛的人，不给删 */
  onDelete?: () => void
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
          {tour.hostUid && tour.hostUid !== me && (
            <p className="text-ink-500 mt-0.5 text-caption">
              {canScore(tour, me)
                ? t(`${tour.hostName ?? '别人'} 开的 · 你是记分员`, `Hosted by ${tour.hostName ?? 'someone'} · you’re a scorer`)
                : t(`${tour.hostName ?? '别人'} 开的`, `Hosted by ${tour.hostName ?? 'someone'}`)}
            </p>
          )}
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
        {onDelete && (
          <button
            onClick={onDelete}
            aria-label={t('删掉这场比赛', 'Delete')}
            className="text-ink-500 active:text-danger-600 shrink-0 px-2 py-1 text-caption"
          >
            ✕
          </button>
        )}
      </div>
    </Card>
  )
}
