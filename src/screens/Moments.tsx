import { useCallback, useEffect, useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { useSocial, friendUids } from '@/store/useSocial'
import { Body, Button, Card, EmptyState, Screen, TopBar, cx } from '@/components/ui'
import { PhotoAvatar, PhotoViewer } from '@/components/Photo'
import { PostSheet } from '@/components/PostSheet'
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
  const [composing, setComposing] = useState(false)
  const [big, setBig] = useState<{ url: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const meUid = social.meUid
  const friends = useMemo(() => friendUids(social), [social])

  const byUid = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>()
    for (const p of players) if (p.ownerId) map.set(p.ownerId, p)
    return map
  }, [players])
  const avatarsById = useMemo(() => new Map(avatars.map((a) => [a.playerId, a])), [avatars])

  const load = useCallback(async () => {
    const [rows, cs] = await Promise.all([
      fetchMoments({ uid, meUid }),
      fetchCards(),
    ])
    setItems(rows)
    setCards(cs)
  }, [uid, meUid])

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
        {/* 只在整个朋友圈那一屏上给「发」—— 别人的动态页上发东西没道理 */}
        {!uid && (
          <Button block variant="primary" onClick={() => setComposing(true)}>
            {t('发一条', 'New post')}
          </Button>
        )}

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
              title={uid ? t('他还没发过', 'Nothing posted yet') : t('还没有人发', 'Nothing here yet')}
              hint={
                uid
                  ? undefined
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
                      {item.urls.map((url) => (
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
                      ))}
                    </div>
                  )}

                  <div className="border-line mt-3 flex items-center gap-4 border-t pt-2.5">
                    <button
                      onClick={() => void like(item)}
                      className={cx(
                        'flex items-center gap-1.5 text-caption',
                        item.liked ? 'text-brand-600 font-medium' : 'text-ink-500',
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
                    {item.author === meUid && (
                      <button
                        disabled={busy}
                        onClick={() => void remove(item)}
                        className="text-ink-500 active:text-danger-600 ml-auto text-caption"
                      >
                        {t('删掉', 'Delete')}
                      </button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {note && <p className="text-danger-600 text-caption">{note}</p>}

        <p className="text-ink-500 pb-2 text-caption">
          {t(
            '动态只有好友看得到，同一个球群但没加好友的人也看不到 —— 球群是打球的事，好友是自己选的。发出去之后改不了，只能删了重发。',
            'Posts are visible to friends only — not to clubmates who are not friends. A club is who you play with; friends are who you choose. Posts cannot be edited, only deleted.',
          )}
        </p>
      </Body>

      <PostSheet open={composing} onClose={() => setComposing(false)} onDone={() => void load()} />
      {/* 点开看大图。挂在最外层，不然会被卡片裁掉 */}
      <PhotoViewer url={big?.url ?? null} name={big?.name ?? ''} onClose={() => setBig(null)} />
    </Screen>
  )
}
