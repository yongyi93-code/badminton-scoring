import { useT } from '@/lib/i18n'
import { useMemo } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Card, EmptyState, Screen, TopBar, cx } from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import { RankMedal } from '@/components/RankMedal'
import { progressByPlayer, emptyProgress } from '@/lib/avatar'
import { homeVenues } from '@/lib/venues'

/* ------------------------------------------------------------------ *
 * 全体排行榜
 *
 * 和球局榜、场馆榜的区别在口径：那两个按胜率排、只算那个范围里的比赛；
 * 这一屏按 MMR 排、算所有比赛。
 *
 * 为什么这里可以按 MMR 而别处不行：MMR 本来就是跨场馆累计的一个数
 * （赢 +10 输 −10，爆冷翻倍，最低 0），它不属于任何一个范围。而胜率
 * 离开范围就没意义 —— 在强队里打的五成和在弱队里打的五成不是一回事。
 * 所以「全体」这一屏只能按 MMR 排，不能按胜率。
 *
 * 每一行还标出主场：MMR 跨馆累计，光看名次不知道这个人平时在哪儿打。
 * 点进去就是那个馆自己的排行榜 —— 那里按胜率排，是另一个口径，
 * 所以这里不显示「他在那个馆第几」，避免两个地方给出两个名次。
 * ------------------------------------------------------------------ */

export function GlobalRanking() {
  const t = useT()
  const { players, sessions, matches, avatars, meId } = useApp()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)

  const avatarsById = useMemo(
    () => new Map(avatars.map((a) => [a.playerId, a])),
    [avatars],
  )
  const progressById = useMemo(() => progressByPlayer(matches), [matches])
  const homeById = useMemo(() => homeVenues(sessions, matches), [sessions, matches])

  const ranked = useMemo(() => {
    return players
      .filter((p) => !p.archived)
      .map((p) => ({
        player: p,
        progress: progressById.get(p.id) ?? emptyProgress(),
        home: homeById.get(p.id),
      }))
      .sort(
        (x, y) =>
          y.progress.mmr - x.progress.mmr ||
          y.progress.wins - x.progress.wins ||
          // 最后按 id 兜底：并列时顺序必须稳定，不然每次渲染都在跳
          x.player.id.localeCompare(y.player.id),
      )
  }, [players, progressById, homeById])

  return (
    <Screen>
      <TopBar
        title={t('全体排名', 'Everyone')}
        subtitle={t(
          `${ranked.length} 人 · 按 MMR 排，算上所有球馆`,
          `${ranked.length} players · by MMR, across every venue`,
        )}
        onBack={back}
      />

      <Body>
        {ranked.length === 0 ? (
          <EmptyState
            title={t('还没有人', 'Nobody yet')}
            hint={t('等大家注册、打完第一场就会出现在这里。', 'Players show up here once they sign up and play.')}
          />
        ) : (
          <div className="space-y-2">
            {ranked.map((r, i) => {
              const played = r.progress.wins + r.progress.losses
              const isMe = r.player.id === meId
              return (
                <div
                  key={r.player.id}
                  className={cx(
                    'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                    isMe ? 'border-brand-500 bg-brand-100' : 'border-line bg-surface',
                  )}
                >
                  <span className="tnum w-7 shrink-0 text-center text-sm font-semibold text-ink-500">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <Avatar name={r.player.name} avatar={avatarsById.get(r.player.id)} />
                  <span className="w-7 shrink-0">
                    <RankMedal level={r.progress.level} className="size-7" compact />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {r.player.name}
                      {isMe && t('（你）', ' (you)')}
                    </span>
                    <span className="flex items-baseline gap-1.5 text-xs">
                      <span
                        className="font-semibold"
                        style={{ color: r.progress.level.tier.color }}
                      >
                        {r.progress.level.display}
                        {r.progress.level.star !== null && ` ${r.progress.level.star}★`}
                      </span>
                      <span className="tnum text-ink-500">MMR {r.progress.mmr}</span>
                    </span>
                    {/*
                      主场。点得动 —— 「他是哪个馆的」下一个问题必然是
                      「那个馆的排名长什么样」，让人自己找入口是多此一举。
                    */}
                    {r.home ? (
                      <button
                        className="text-brand-600 mt-0.5 block max-w-full truncate text-caption"
                        onClick={() => push({ name: 'leaderboard', venue: r.home!.label })}
                      >
                        {t(
                          `${r.home.label} · 在这儿打了 ${r.home.matches} 场`,
                          `${r.home.label} · ${r.home.matches} played there`,
                        )}
                      </button>
                    ) : (
                      <span className="text-ink-500 mt-0.5 block text-caption">
                        {t('还没打过球', 'Has not played yet')}
                      </span>
                    )}
                  </span>

                  <span className="tnum shrink-0 text-right">
                    <span className="block text-sm font-semibold">
                      {r.progress.wins}
                      <span className="text-ink-500">
                        {t('胜', 'W')}
                      </span>
                    </span>
                    <span className="block text-xs text-ink-500">
                      {t(`${played} 场`, `${played} played`)}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <Card>
          <p className="text-ink-500 text-caption">
            {t(
              'MMR 是跨场馆累计的：赢一场 +10，输一场 −10，最低到 0 不会变成负数，赢比自己强的算爆冷、加倍。换个球馆不影响它 —— 所以这一屏是唯一一个「所有人放在一起」的名次。点主场可以看那个馆自己的排行榜，那边按胜率排，名次会不一样。',
              'MMR accumulates across venues: +10 a win, −10 a loss, floored at 0, doubled for an upset. Switching venue does not change it — which is why this is the one list that puts everyone together. Tapping a venue opens its own leaderboard, which ranks by win rate, so the order there differs.',
            )}
          </p>
        </Card>
      </Body>
    </Screen>
  )
}
