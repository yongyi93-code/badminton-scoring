import { useT } from '@/lib/i18n'
import { lazy, Suspense, useMemo } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Card, Screen, SectionTitle } from '@/components/ui'
import { venueByKey, venueSummaries } from '@/lib/venues'
import { formatDate } from '@/lib/format'
import type { MapPin } from '@/components/VenueMap'

/*
 * 地图按需加载。
 *
 * 地图库 + 它的样式表，压缩完还有 45 KB —— 而这一屏十次里有九次
 * 是来看排名和球馆列表的，地图那一块很多人根本不会往下滚到。
 * 打进主包等于让每个人第一次打开 App 都多下 45 KB，在马来西亚的
 * 移动网络上那不是可以忽略的数字。
 *
 * 拆出去之后：真的有点要画时才去取那一块。
 */
const VenueMap = lazy(() =>
  import('@/components/VenueMap').then((m) => ({ default: m.VenueMap })),
)

/*
 * 排名。
 *
 * 这一屏原来叫「发现」，里面摆着全体排名、地图和一份球馆列表 ——
 * 「发现」是个什么都能往里塞的名字，而实际上人点进来只为一件事：
 * 看排名。所以改叫排名，内容也按这个收紧。
 *
 * 两种排名：
 *   全体排名   所有人按 MMR 排。MMR 跨场馆累计，换个馆不会变。
 *   球馆排名   只算在那个馆打的比赛，所以同一个人在不同馆名次不一样。
 *              这才是「今晚去城中，谁最能打」的答案。
 *
 * 底下那份球馆列表点进去就是那个馆的排名，不再是球馆详情页 ——
 * 地址和怎么去从地图上的点、以及球局看板里的「怎么去」进。
 *
 * 「球员库」那个入口去掉了就没再回来：翻一遍所有人的名册除了让人
 * 互相打量之外没有用途。
 */

export function Discover() {
  const t = useT()
  const { sessions, matches } = useApp()
  const push = useNav((s) => s.push)

  const venues = useMemo(() => venueSummaries(sessions, matches), [sessions, matches])

  /*
   * 地图上只放标过位置的球馆。
   *
   * 没标位置的不出现 —— 猜一个点放上去，比不放糟得多：人会照着它开车。
   * 所以列表和地图的条数常常对不上，那是对的，不是漏了。
   */
  const savedVenues = useApp((s) => s.venues)
  const pins = useMemo<MapPin[]>(
    () =>
      venues.flatMap((v) => {
        const saved = venueByKey(savedVenues, v.key)
        if (saved?.lat == null || saved?.lng == null) return []
        return [{ key: v.key, label: v.label, lat: saved.lat, lng: saved.lng, address: saved.address }]
      }),
    [venues, savedVenues],
  )
  /** 有几个馆还没标位置 —— 说出来才有人去补 */
  const unpinned = venues.length - pins.length

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-3">
        <h1 className="text-h1">{t('排名', 'Rankings')}</h1>
        <p className="text-ink-500 mt-1 text-label">
          {t('全体排名，和每个球馆各自的排名', 'Overall, and per-venue')}
        </p>
      </header>

      <Body>
        <Card onClick={() => push({ name: 'ranking' })}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-title">{t('全体排名', 'Everyone')}</p>
              <p className="text-ink-500 mt-0.5 text-label">
                {t(
                  '所有人放在一起按 MMR 排，看得到段位和各自的主场',
                  'Everyone ranked together by MMR, with their tier and home venue',
                )}
              </p>
            </div>
            <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </div>
        </Card>

        {/*
          地图。一个点都没有的时候不画一张空图 ——
          那只会让人以为地图坏了。改成一句话告诉他怎么让点出现。
        */}
        {venues.length > 0 && (
          <>
            <SectionTitle
              right={
                unpinned > 0 ? (
                  <span className="text-ink-500 text-caption">
                    {t(`${unpinned} 个还没标位置`, `${unpinned} not pinned yet`)}
                  </span>
                ) : undefined
              }
            >
              {t('地图', 'Map')}
            </SectionTitle>
            {pins.length > 0 ? (
              <Suspense
                fallback={
                  <div className="border-line bg-fill rounded-card h-[280px] animate-pulse border" />
                }
              >
                <VenueMap
                  pins={pins}
                  onPick={(pin) => push({ name: 'venue', venue: pin.label })}
                />
              </Suspense>
            ) : (
              <Card>
                <p className="text-ink-500 text-label">
                  {t(
                    '还没有球馆标过位置。开局那一步、或者球馆页里点「顺手定个位」，人在场上按一下就好 —— 标过的馆会出现在这张图上。',
                    'No venue has been pinned yet. Tap “Pin it” when starting a session or on a venue page — one tap while you are there, and it shows up on this map.',
                  )}
                </p>
              </Card>
            )}
          </>
        )}

        <SectionTitle>{t('球馆排名', 'By venue')}</SectionTitle>
        {venues.length === 0 ? (
          <Card>
            <p className="text-ink-500 text-label">
              {t(
                '打完第一场球之后，去过的球馆会自动出现在这里，点进去看那个馆的排名。',
                'Venues show up here once you have played at one — tap for that venue’s ranking.',
              )}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {venues.map((v) => (
              /*
                点进去是那个馆的排名，不是球馆详情页。
                这一屏叫排名，列表里的每一条就该通向一份排名 ——
                地址和怎么去走地图上的点，以及球局看板里那行「怎么去」。
                传的是 key 不是 label：排行榜按归一化后的 key 归组，
                传 label 会让「城中羽球馆」和「城中 羽球馆」算成两个馆。
              */
              <Card key={v.key} onClick={() => push({ name: 'leaderboard', venue: v.key })}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-title">{v.label}</p>
                    <p className="text-ink-500 mt-0.5 text-label">
                      {t(
                        `${v.sessionCount} 次球局 · ${v.matchCount} 场 · ${v.playerCount} 人`,
                        `${v.sessionCount} sessions · ${v.matchCount} matches · ${v.playerCount} players`,
                      )}
                    </p>
                    <p className="text-ink-500 mt-0.5 text-caption">
                      {t('最近：', 'Last played ')}
                      {formatDate(new Date(v.lastPlayedAt).toISOString().slice(0, 10))}
                    </p>
                  </div>
                  <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Body>
    </Screen>
  )
}
