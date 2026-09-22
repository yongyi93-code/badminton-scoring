import { useCallback, useEffect, useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { useSocial, friendUids } from '@/store/useSocial'
import { feedChanged, useFeed } from '@/store/useFeed'
import { Body, Button, Card, EmptyState, Screen, TopBar, cx } from '@/components/ui'
import { PhotoAvatar, PhotoViewer } from '@/components/Photo'
import { PostSheet } from '@/components/PostSheet'
import { StoryStrip } from '@/components/StoryStrip'
import { BanNotice, useMyBan } from '@/components/BanNotice'
import { Comments } from '@/components/Comments'
import { fetchComments, type Comment } from '@/lib/comments'
import { setPostHidden } from '@/lib/ban'
import { isVideo } from '@/lib/media'
import { fetchCards, nameOf, type Card as NameCard } from '@/lib/profile'
import {
  deletePost,
  fetchMoments,
  gridCols,
  toggleLike,
  type FeedItem,
} from '@/lib/moments'
import { relativeTime } from '@/lib/format'

/* ------------------------------------------------------------------ *
 * 朋友圈
 *
 * 一屏两种用法，同一份代码：
 *
 *   不带 uid   整个朋友圈：我的 + 好友的，按时间倒着排
 *   带 uid     只看一个人的（从他的个人主页点进来）
 *
 * 合成一屏不是为了省代码，是为了**两处的规矩必然一样**：什么时候
 * 显示删除、点赞怎么算、图怎么摆。两份实现迟早有一份忘了改。
 *
 * -------------------------------------------------------------------
 * 这一版只有好友看得到
 *
 * 所以空的时候要说清楚是哪一种空：一条都没有，还是**你还没有好友**。
 * 后一种情况下写「还没有人发动态」是在骗人 —— 有人发了，只是你
 * 一个好友都没加，所以一条都看不到。
 * ------------------------------------------------------------------ */

export function Moments({ uid }: { uid?: string }) {
  const t = useT()
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const social = useSocial()
  const players = useApp((s) => s.players)
  const avatars = useApp((s) => s.avatars)

  const [items, setItems] = useState<FeedItem[] | null>(null)
  const [cards, setCards] = useState<Map<string, NameCard>>(new Map())
  const [comments, setComments] = useState<Map<string, Comment[]>>(new Map())
  const [composing, setComposing] = useState(false)
  const [big, setBig] = useState<{ url: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /*
   * 我被封了没有。
   *
   * 拿它只为一件事：**别让人白写一段字**。真正挡住发不出去的是
   * 数据库那边的触发器（025），这一道只是事前说清楚。
   */
  const { ban: myBan } = useMyBan()

  const meUid = social.meUid
  const friends = useMemo(() => friendUids(social), [social])
  /* 别处发了或删了一条也要跟着刷（那一条可能该出现在这条时间线上） */
  const bump = useFeed((s) => s.n)

  const byUid = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>()
    for (const p of players) if (p.ownerId) map.set(p.ownerId, p)
    return map
  }, [players])
  const avatarsById = useMemo(() => new Map(avatars.map((a) => [a.playerId, a])), [avatars])

  const load = useCallback(async () => {
    /*
     * 主时间线只拉「我 + 我的好友」。
     *
     * 026 之后公开的动态谁都读得到 —— 不收窄的话这一屏会变成一个
     * 所有人的广场，而朋友圈不是广场。收窄放在这一层，不放在策略里：
     * 策略管「读不读得到」，这一屏管「想显示谁」。
     */
    const [rows, cs] = await Promise.all([
      fetchMoments(uid ? { uid, meUid } : { authors: [meUid ?? '', ...friends], meUid }),
      fetchCards(),
    ])
    setItems(rows)
    setCards(cs)
    /*
     * 评论要等动态回来才知道问哪几条，所以是第二趟，不能塞进上面那个
     * Promise.all。一次问一屏（不是一条一次）—— 二十条动态各查一次
     * 就是二十个请求。
     */
    setComments(await fetchComments(rows.map((r) => r.id)))
  }, [uid, meUid, friends, bump])

  useEffect(() => {
    void load()
  }, [load])

  const who = (author: string) => {
    const p = byUid.get(author)
    const card = cards.get(author)
    const name = nameOf({ club: p?.name, card: card?.name })
    return {
      name: name ?? t('不认识的人', 'Unknown'),
      photo: card?.photo,
      avatar: p ? avatarsById.get(p.id) : undefined,
    }
  }

  const like = async (item: FeedItem) => {
    /*
     * 先在界面上翻过去，再发请求。
     *
     * 点赞是这一屏上按得最随手的东西，等一个来回（球馆的 4G 上
     * 半秒起）会让人以为没点上，于是再点一下 —— 那就变成了取消。
     * 失败了再翻回来，并且说一声。
     */
    const before = item.liked
    setItems((old) =>
      (old ?? []).map((x) =>
        x.id === item.id
          ? { ...x, liked: !before, likes: x.likes + (before ? -1 : 1) }
          : x,
      ),
    )
    const r = await toggleLike(item.id, before)
    if (!r.ok) {
      setItems((old) =>
        (old ?? []).map((x) =>
          x.id === item.id ? { ...x, liked: before, likes: x.likes + (before ? 1 : -1) } : x,
        ),
      )
      setNote(r.error)
    }
  }

  const hide = async (item: FeedItem, hidden: boolean) => {
    setBusy(true)
    const r = await setPostHidden(item.id, hidden)
    setBusy(false)
    if (!r.ok) {
      setNote(r.error)
      return
    }
    setItems((old) =>
      (old ?? []).map((x) =>
        x.id === item.id ? { ...x, hidden_at: hidden ? new Date().toISOString() : null } : x,
      ),
    )
  }

  const remove = async (item: FeedItem) => {
    setBusy(true)
    const r = await deletePost(item)
    setBusy(false)
    if (!r.ok) {
      setNote(r.error)
      return
    }
    setItems((old) => (old ?? []).filter((x) => x.id !== item.id))
  }

  const mine = uid && uid === meUid
  const title = uid
    ? mine
      ? t('我的动态', 'My posts')
      : t(`${who(uid).name} 的动态`, `${who(uid).name}’s posts`)
    : t('朋友圈', 'Moments')

  if (!meUid) {
    return (
      <Screen>
        <TopBar title={title} onBack={back} />
        <Body>
          <EmptyState
            icon="👋"
            title={t('先登录', 'Sign in first')}
            hint={t(
              '动态存在云端，不在这台手机上 —— 所以得先知道你是谁。',
              'Posts live in the cloud, not on this phone — so we need to know who you are.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  return (
    <Screen>
      <TopBar title={title} onBack={back} />
      <Body>
        {/*
          会消失的那些摆在最上面一排。

          摆在「发一条」上面：它们过期就没了，所以先看到的该是
          快没了的那些，而不是一个永远都在的按钮。
        */}
        {!uid && <StoryStrip />}

        {/* 只在整个朋友圈那一屏上给「发」—— 别人的动态页上发东西没道理 */}
        {!uid &&
          (myBan ? (
            /* 被封着就别给那个按钮：写完一段再被拒，比一开始就说清楚糟 */
            <BanNotice ban={myBan} compact />
          ) : (
            <Button block variant="primary" onClick={() => setComposing(true)}>
              {t('发一条', 'New post')}
            </Button>
          ))}

        {items === null ? (
          <p className="text-ink-500 text-caption">{t('正在拿…', 'Loading…')}</p>
        ) : items.length === 0 ? (
          /*
            空的有两种，说错了是在骗人：一条都没有，还是你根本
            没有好友所以看不到。
          */
          !uid && friends.length === 0 ? (
            <EmptyState
              icon="🤝"
              title={t('先加几个好友', 'Add a few friends first')}
              hint={t(
                '动态只有好友看得到 —— 你现在一个好友都没有，所以这里是空的。在排行榜或者球局里点开一个人，他的主页上就有「加好友」。',
                'Posts are visible to friends only — you have none yet, so this is empty. Open someone from a leaderboard or a session and tap “Add friend” on their profile.',
              )}
            />
          ) : (
            <EmptyState
              icon="🏸"
              title={
                uid
                  ? mine || friends.includes(uid)
                    ? t('他还没发过', 'Nothing posted yet')
                    : /*
                        不是好友的时候空着，多半不是「他没发过」，而是
                        「他发的都只给好友」。说成前者是在猜，而且猜的
                        那一种会让人以为这个人不玩这个 App。
                      */
                      t('他没有公开的动态', 'No public posts')
                  : t('还没有人发', 'Nothing here yet')
              }
              hint={
                uid
                  ? mine || friends.includes(uid)
                    ? undefined
                    : t('加了好友才看得到只给好友的那些。', 'Add them as a friend to see friends-only posts.')
                  : t('打完一场发一条，好友就看得到。', 'Post after a session — your friends will see it.')
              }
            />
          )
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const w = who(item.author)
              return (
                <Card key={item.id}>
                  <div className="flex items-center gap-3">
                    <PhotoAvatar url={w.photo} name={w.name} avatar={w.avatar} />
                    <button
                      onClick={() => push({ name: 'person', uid: item.author, hint: w.name })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-medium">{w.name}</span>
                      <span className="text-ink-500 block text-caption">
                        {relativeTime(Date.parse(item.created_at))}
                      </span>
                    </button>
                  </div>

                  {/*
                    公开那一条标出来。
                    
                    只对作者自己标：别人看到的每一条对他来说都一样
                    （他看得到就是看得到），而作者需要一眼认出
                    「哪几条是全世界看得到的」——尤其是想删的时候。
                  */}
                  {item.visibility === 'public' && item.author === meUid && (
                    <p className="text-brand-600 mt-2 text-caption font-medium">
                      {t('公开 · 陌生人也看得到', 'Public · strangers can see this')}
                    </p>
                  )}

                  {/*
                    被下架了。只有作者自己和管理员看得到这条动态，
                    所以这一行只对他们出现 —— 而作者**必须**看到它：
                    一条悄悄消失的动态，他只会以为 App 坏了，然后再发一遍。
                  */}
                  {item.hidden_at && (
                    <p className="border-danger-600/30 bg-danger-50 text-danger-600 mt-2.5 rounded-lg border px-3 py-2 text-caption">
                      {item.author === meUid
                        ? t(
                            '这条被管理员下架了，别人看不到。',
                            'An admin took this down — nobody else can see it.',
                          )
                        : t('已下架', 'Taken down')}
                    </p>
                  )}

                  {item.body && (
                    <p className="mt-2.5 whitespace-pre-wrap break-words text-label">{item.body}</p>
                  )}

                  {item.urls.length > 0 && (
                    <div
                      className="mt-2.5 grid gap-1.5"
                      style={{
                        gridTemplateColumns: `repeat(${gridCols(item.urls.length)}, minmax(0, 1fr))`,
                      }}
                    >
                      {item.urls.map((url) =>
                        /*
                         * 视频在时间线上就地播，不点进大图那一层：
                         * 那一层是给照片放大用的，视频放大没有意义。
                         *
                         * preload="metadata" —— 只拉够画出第一帧的那点
                         * 数据，不整段下下来。一屏十条动态各二十兆的话，
                         * 光是滑过去就把一个月的流量用掉了。
                         * controls 交给人自己点：自动播十条视频同样是流量。
                         */
                        isVideo(url) ? (
                          <video
                            key={url}
                            src={url}
                            controls
                            playsInline
                            preload="metadata"
                            className={cx(
                              'bg-fill w-full rounded-lg',
                              item.urls.length === 1 ? 'max-h-80' : 'aspect-square object-cover',
                            )}
                          />
                        ) : (
                          <button key={url} onClick={() => setBig({ url, name: w.name })}>
                            <img
                              src={url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className={cx(
                                'bg-fill w-full rounded-lg object-cover',
                                /* 一张的时候不裁成方的 —— 竖图裁掉一半就不是那张照片了 */
                                item.urls.length === 1 ? 'max-h-80 object-contain' : 'aspect-square',
                              )}
                            />
                          </button>
                        ),
                      )}
                    </div>
                  )}

                  {/*
                    评论摆在点赞那一行**下面**，不是上面：那一行是这条
                    动态的操作条，而评论是内容 —— 内容该挨着内容。
                  */}
                  <div className="border-line mt-3 flex items-center gap-4 border-t pt-2.5">
                    {/*
                      被禁言的人点不动这个心。
                      
                      点赞也在挡住的名单里（025），所以不关掉的话：他一点，
                      心先亮了（乐观更新），半秒后弹一句错、心又灭回去 ——
                      看着像 App 抽风。上面那张卡已经说过不能点赞了，
                      这里跟着关掉才对得上。
                    */}
                    <button
                      onClick={() => void like(item)}
                      disabled={Boolean(myBan)}
                      className={cx(
                        'flex items-center gap-1.5 text-caption',
                        myBan
                          ? 'text-ink-300'
                          : item.liked
                            ? 'text-brand-600 font-medium'
                            : 'text-ink-500',
                      )}
                      aria-label={item.liked ? t('收回赞', 'Unlike') : t('点赞', 'Like')}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill={item.liked ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                      >
                        <path d="M12 20s-7-4.5-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.5 12 20 12 20z" />
                      </svg>
                      {item.likes > 0 ? item.likes : t('赞', 'Like')}
                    </button>
                    {/*
                      管理员下架。摆在最右边，和作者的「删掉」同一个位置 ——
                      同一行里最多只会出现其中一个（管理员看自己的动态时
                      两个都有，那是对的：他既是作者也是管理员）。
                    */}
                    {social.isAdmin && (
                      <button
                        disabled={busy}
                        onClick={() => void hide(item, !item.hidden_at)}
                        className="text-ink-500 active:text-danger-600 ml-auto text-caption"
                      >
                        {item.hidden_at ? t('恢复', 'Restore') : t('下架', 'Take down')}
                      </button>
                    )}
                    {item.author === meUid && (
                      <button
                        disabled={busy}
                        onClick={() => void remove(item)}
                        className={cx(
                          'text-ink-500 active:text-danger-600 text-caption',
                          social.isAdmin ? '' : 'ml-auto',
                        )}
                      >
                        {t('删掉', 'Delete')}
                      </button>
                    )}
                  </div>

                  <Comments
                    postId={item.id}
                    rows={comments.get(item.id) ?? []}
                    meUid={meUid}
                    postAuthor={item.author}
                    isAdmin={social.isAdmin}
                    silenced={Boolean(myBan)}
                    nameOf={(u) => who(u).name}
                    onChanged={() => void load()}
                    onError={setNote}
                  />
                </Card>
              )
            })}
          </div>
        )}

        {note && <p className="text-danger-600 text-caption">{note}</p>}

        <p className="text-ink-500 pb-2 text-caption">
          {t(
            '动态默认只有好友看得到，同一个球群但没加好友的人也看不到 —— 球群是打球的事，好友是自己选的。发的时候可以单独把某一条设成公开，也可以选「24 小时后消失」—— 那一条会摆在最上面那一排，时间到了连你自己都看不到，照片也真删掉。发出去之后改不了（包括「谁看得到」和「留多久」），只能删了重发。',
            'Posts are friends-only by default — not visible to clubmates who are not friends. A club is who you play with; friends are who you choose. A single post can be set public when you write it, or set to vanish in 24 hours — those show in the ring row on top, and once the time is up even you cannot see them and the photos are really deleted. Nothing can be edited afterwards, including who can see it and how long it stays — delete and repost instead.',
          )}
        </p>
      </Body>

      <PostSheet
        open={composing}
        onClose={() => setComposing(false)}
        /*
         * 只报一声「有人发了一条」，不自己去刷。
         *
         * 发完不知道它落在哪一边 —— 那张纸上的「留多久」一改，本该
         * 进时间线的就变成了那一排圈圈里的一个。两边各刷各的会漏，
         * 所以统一由那个信号来（store/useFeed.ts）。
         */
        onDone={feedChanged}
      />
      {/* 点开看大图。挂在最外层，不然会被卡片裁掉 */}
      <PhotoViewer url={big?.url ?? null} name={big?.name ?? ''} onClose={() => setBig(null)} />
    </Screen>
  )
}
