import { useT } from '@/lib/i18n'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Body, Card, Screen, SectionTitle, cx } from '@/components/ui'
import { hasLocation, venueByKey, venueSummaries } from '@/lib/venues'
import { AddressSheet } from '@/components/VenueAddress'
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
  const allVenues = useApp((s) => s.venues)
  /** 正在给哪个球馆填地址。null = 没开着 */
  const [pinning, setPinning] = useState<string | null>(null)
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
            {venues.map((v) => {
              const saved = venueByKey(allVenues, v.key)
              const located = hasLocation(saved)
              return (
                /*
                  不再整张卡一个点击目标：这一条上现在有两件事可做 ——
                  看那个馆的排名，和给它定位。一张卡包一个 <button> 的话，
                  「定个位」那个按钮就得嵌在按钮里，HTML 上不合法，
                  实际表现是点哪儿都跳排名。所以拆成两个明确的目标。
                */
                <Card key={v.key} className="!p-0">
                  {/*
                    主体：点进去是那个馆的排名，不是球馆详情页。
                    传的是 key 不是 label：排行榜按归一化后的 key 归组，
                    传 label 会让「城中羽球馆」和「城中 羽球馆」算成两个馆。
                  */}
                  <button
                    onClick={() => push({ name: 'leaderboard', venue: v.key })}
                    className="active:bg-fill flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
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
                  </button>

                  {/* ------------------------------------------------------ *
                    定位那一行。

                    这一行补的是一个很具体的空缺：填地址的入口一直只在
                    「球局看板」和「球馆页」上 —— 也就是只有你**正在**打球、
                    或者特意点进某个馆的时候才看得见。于是它成了一件
                    「到了球馆才想起来、而到了球馆又忙着打球」的事。

                    摆在这儿就不一样了：这一屏是所有去过的球馆排成一列，
                    一眼看得出还差哪几个，坐在沙发上两分钟能填完。
                    而地址搜索只要打几个字就能连坐标一起带回来，
                    根本不用人在现场。

                    没地址的球馆卡在两个功能前面：地区排行榜（靠地址认州）
                    和以后的「附近球局」（靠坐标）。
                  * ------------------------------------------------------ */}
                  <button
                    onClick={() => setPinning(v.label)}
                    className={cx(
                      'border-line active:bg-fill flex w-full items-center gap-2 border-t px-4 py-2.5 text-left',
                      located ? 'text-ink-500' : 'text-brand-600',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-caption">
                      {located
                        ? saved?.address || t('已标位置', 'Pinned on the map')
                        : t('还没有地址 —— 地区排名和附近球局都要用它', 'No address yet — regional rankings need it')}
                    </span>
                    <span className="shrink-0 text-caption font-semibold">
                      {located ? t('改', 'Edit') : t('顺手填一下', 'Add it')}
                    </span>
                  </button>
                </Card>
              )
            })}
          </div>
        )}

        {/*
          填地址那一屏，就地弹出来 —— 不跳走。
          填完回到列表，刚填的那个馆当场从「还没有地址」变成地址本身，
          能一眼看出还剩几个。跳出去再跳回来的话，这个反馈就断了。
        */}
        {pinning && (
          <AddressSheet venue={pinning} open onClose={() => setPinning(null)} />
        )}
      </Body>
    </Screen>
  )
}
