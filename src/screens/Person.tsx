import { useEffect, useMemo, useState } from 'react'
import { lang, useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { useSocial } from '@/store/useSocial'
import { Body, Button, Card, Screen, TopBar } from '@/components/ui'
import { Avatar, GenderTag } from '@/components/PlayerBits'
import { AvatarView } from '@/components/Avatar'
import { RankChip } from '@/components/RankMedal'
import { FriendActions } from '@/components/FriendActions'
import { PhotoSheet, PhotoViewer } from '@/components/Photo'
import { fetchCard, nameOf, type Card as NameCard } from '@/lib/profile'
import { fetchPlaying, playingLine, type Playing } from '@/lib/nowPlaying'
import { computeStats } from '@/lib/ranking'
import { progressOf } from '@/lib/avatar'
import { stageOf } from '@/lib/avatarArt'
import { percent } from '@/lib/format'

/* ------------------------------------------------------------------ *
 * 个人主页 —— 账号那一层的「这个人是谁」
 *
 * 和战绩页（PlayerProfile）分开，不是因为放不下，是因为**两半的可见
 * 范围不一样**，而这件事必须在界面上说出来：
 *
 *   照片、名字、正在哪打球   好友看得到，跨球群
 *   段位、MMR、战绩          **只有和他同一个球群的人**
 *
 * 下半截那条线不是这一屏画的，是 records 那条
 * `is_club_member(club_id)` 画的 —— 这个 App 权限的地基。所以一个
 * 别的球群的好友点进来，看得到你这个人，看不到你的战绩。
 *
 * **这不是坏了，是对的**：战绩属于球群，不属于一个人。但人不会自己
 * 想到这一层，所以那半边空着的时候要写一句实话，而不是留一片白。
 *
 * -------------------------------------------------------------------
 * 三种人会走到这一屏，长得不一样
 *
 *   同群的球友     上下两半都有
 *   串场的好友     只有上半截，下半截一句解释
 *   榜上的陌生人   名字来自路由带过来的那个（他的名片我读不到），
 *                  能做的只有「加好友」—— 而那正是这一屏的用处
 * ------------------------------------------------------------------ */

export function Person({ uid, hint }: { uid: string; hint?: string }) {
  const t = useT()
  const zh = lang() === 'zh'
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const social = useSocial()
  const { players, matches, avatars, meId } = useApp()

  const [card, setCard] = useState<NameCard | null>(null)
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [big, setBig] = useState(false)
  const [editing, setEditing] = useState(false)

  /*
   * 他在我这个球群里那条球员记录。找得到才有下半截。
   *
   * 归档的不算：那是「已经不在这个群了」，他的战绩不该还挂在主页上。
   */
  const player = useMemo(
    () => players.find((p) => p.ownerId === uid && !p.archived) ?? null,
    [players, uid],
  )

  /*
   * editing 也进依赖：自己改完名片关掉那一层之后要重新拉一次，
   * 不然这一页上还是改之前那张脸 —— 而这一页正是「别人看到的样子」，
   * 显示旧的比不显示更糟。
   */
  useEffect(() => {
    if (editing) return
    let alive = true
    void fetchCard(uid).then((c) => {
      if (alive) setCard(c)
    })
    return () => {
      alive = false
    }
  }, [uid, editing])

  /*
   * 「正在打」单独拉一次。策略那边只给好友，所以不是好友的人这里
   * 永远是空 —— 不用在这一层再判一次。
   */
  useEffect(() => {
    let alive = true
    void fetchPlaying().then((rows) => {
      if (alive) setPlaying(rows.find((r) => r.uid === uid) ?? null)
    })
    return () => {
      alive = false
    }
  }, [uid])

  const name = nameOf({ club: player?.name, card: card?.name, hint })
  const isMe = social.meUid === uid

  const avatar = useMemo(
    () => (player ? (avatars.find((a) => a.playerId === player.id) ?? undefined) : undefined),
    [avatars, player],
  )
  const progress = useMemo(
    () => (player ? progressOf(player.id, matches) : null),
    [player, matches],
  )
  const stats = useMemo(
    () => (player ? computeStats(matches, [player.id])[0] : null),
    [player, matches],
  )

  return (
    <Screen>
      <TopBar title={name ?? t('个人主页', 'Profile')} onBack={back} />
      <Body>
        {/* ---------------------------------------------------------- *
          上半截：跨球群的那一半。

          照片放大一点（96px），因为这一屏就是来看「他是谁」的 ——
          好友列表上那个 40px 的小圆看不清脸。没设照片的人退回换装
          角色或者名字首字，不留一个空框。
        * ---------------------------------------------------------- */}
        <Card className="bg-brand-50 border-brand-500/30">
          <div className="flex items-center gap-4">
            {card?.photo ? (
              <button onClick={() => setBig(true)} className="shrink-0">
                <img
                  src={card.photo}
                  alt={name ?? ''}
                  className="size-24 shrink-0 rounded-full object-cover"
                />
              </button>
            ) : (
              <Avatar name={name ?? '?'} avatar={avatar} size="lg" className="shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-h2">
                  {name ?? t('不认识的人', 'Unknown')}
                  {isMe && t('（你）', ' (you)')}
                </h2>
                {player && <GenderTag gender={player.gender} />}
              </div>
              {/*
                这一行是这一屏上唯一「此刻」的东西，所以给它品牌色。
                它对不在我球群里的好友照样显示 —— 那正是它的意义。
              */}
              {playing ? (
                <p className="text-brand-600 mt-1 text-caption font-medium">
                  {playingLine(playing, zh)}
                </p>
              ) : (
                name === null && (
                  <p className="text-ink-500 mt-1 text-caption">
                    {/*
                      说「读不到」，不说「他没填」—— 这一屏分不出这两件事
                      （策略挡住和他真没填，回来的都是空），而猜错的那一种
                      是在替一个陌生人辩解。
                    */}
                    {t(
                      '看不到他的名字 —— 你们还不是好友，也不在同一个球群。加了好友就看得到。',
                      'Their name is not visible — you are not friends and share no club. Add them to see it.',
                    )}
                  </p>
                )
              )}
            </div>
          </div>

          <FriendActions
            uid={uid}
            name={name ?? t('这个人', 'this person')}
            className="border-brand-500/20 mt-3 border-t pt-3"
          />
        </Card>

        {/* ---------------------------------------------------------- *
          下半截：球群里的那一半。

          有没有这一半，取决于「他在不在我这个球群里」—— 而那是
          records 那条 RLS 决定的，不是这一屏决定的。
        * ---------------------------------------------------------- */}
        {player && progress && stats ? (
          <Card onClick={() => push({ name: 'profile', playerId: player.id })}>
            <div className="flex items-center gap-4">
              {/*
                这里放**换装角色**，不放照片 —— 两张脸分工不同：
                照片回答「你是谁」，角色回答「你有多强」。
                段位和那一身行头本来就是打出来的（docs/社交化.md）。
              */}
              <span className="bg-fill size-16 shrink-0 overflow-hidden rounded-2xl">
                {avatar ? (
                  <AvatarView
                    sex={avatar.sex}
                    skin={avatar.skin}
                    equipped={avatar.equipped}
                    stage={stageOf(progress.level)}
                    className="h-full w-full"
                    title={name ?? ''}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl">
                    🏸
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <RankChip level={progress.level} />
                  <span className="tnum text-ink-500 text-caption">MMR {progress.mmr}</span>
                </div>
                <p className="tnum text-ink-500 mt-1 text-caption">
                  {t(
                    `${stats.games} 场 · ${stats.wins} 胜 · ${percent(stats.winRate)}`,
                    `${stats.games} played · ${stats.wins} won · ${percent(stats.winRate)}`,
                  )}
                </p>
              </div>
              <span className="text-ink-500 shrink-0">›</span>
            </div>
            <p className="text-ink-500 mt-2 text-caption">
              {t('点开看完整战绩：走势、搭档、苦主、最近比赛', 'Open the full record: trend, partners, rivals, recent matches')}
            </p>
          </Card>
        ) : (
          /*
            空着的那一半要说实话。
            不说的话，一个别的球群的好友会盯着一个只有头像的页面，
            以为是没加载出来 —— 而它已经加载完了，那些数据本来就
            不该跨群。
          */
          <Card>
            <p className="text-label font-medium">{t('看不到战绩', 'No record to show')}</p>
            <p className="text-ink-500 mt-1 text-caption">
              {/*
                说的是「他在你这个群里没有记录」，不是「你们不在同一个群」——
                后者这一屏判不出来：一个刚进群、还没认领自己那条球员记录的人，
                也是这个样子。说一句确定的，比说一句听起来更确定的好。
              */}
              {t(
                '他没在你这个球群里打过球（多半是你们不在同一个群）。段位、MMR 和比赛记录只在球群里面看得到 —— 它们属于那个群，不属于一个人。',
                'They have no record in your club — most likely you share no club. Rank, MMR and match history only exist inside a club: they belong to the club, not to a person.',
              )}
            </p>
            <p className="text-ink-500 mt-2 text-caption">
              {t(
                '想看的话，去「排名 → 全国」那一栏：在那儿上榜的人，自己报的 MMR 和胜负是公开的。',
                'For a cross-club number, see Rankings → Malaysia: people who opt in publish their own MMR and win-loss there.',
              )}
            </p>
          </Card>
        )}

        {/*
          自己看自己的时候，下一个念头必然是「那我改一下」——
          让他改就在这儿改，不用记住「在我的那一屏里」。
          改完这一页立刻就是新的样子（重新拉一次名片）。
        */}
        {isMe && (
          <>
            <Button block variant="ghost" onClick={() => setEditing(true)}>
              {t('改我的名片', 'Edit my card')}
            </Button>
            <p className="text-ink-500 pb-2 text-caption">
              {t(
                '这就是别人点进来看到的样子。',
                'This is exactly how others see you.',
              )}
            </p>
          </>
        )}
        {!isMe && meId && (
          <p className="text-ink-500 pb-2 text-caption">
            {t(
              '照片和名字跟着账号走，跨球群；段位和战绩跟着球群走。所以换个球群打球，上半截不变，下半截会变。',
              'Photo and name follow the account across clubs; rank and record follow the club. Play in another club and the top half stays, the bottom half changes.',
            )}
          </p>
        )}
      </Body>

      {/* 点头像看大图。挂在最外层，不然会被卡片裁掉 */}
      <PhotoViewer
        url={big ? (card?.photo ?? null) : null}
        name={name ?? ''}
        onClose={() => setBig(false)}
      />
      {isMe && <PhotoSheet open={editing} onClose={() => setEditing(false)} />}
    </Screen>
  )
}
