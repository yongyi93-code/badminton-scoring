import { useT } from '@/lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  SectionTitle,
  TopBar,
  Toast,
  cx,
  inputClass,
} from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import { PhotoAvatar, PhotoViewer } from '@/components/Photo'
import { fetchCards, nameOf, type Card as NameCard } from '@/lib/profile'
import {
  incomingRequests,
  otherSide,
  outgoingRequests,
  threads,
  useSocial,
  refreshSocial,
  friendUids,
} from '@/store/useSocial'
import {
  acceptFriendRequest,
  isVoice,
  removeFriendship,
  sendFriendRequest,
  unblockUser,
} from '@/lib/social'
import { relativeTime } from '@/lib/format'
import { fetchPlaying, playingLine, type Playing } from '@/lib/nowPlaying'
import { lang } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 好友
 *
 * 一屏四块，顺序按「谁在等我」排：
 *   1. 别人发来的申请   —— 有人在等我点头
 *   2. 聊天             —— 有人跟我说了话
 *   3. 好友             —— 我可以找谁
 *   4. 我发出去还没回的 —— 我在等别人，最不急
 *
 * 这个顺序和首页那张深绿卡是同一条道理：一屏里最上面的位置留给
 * 「别人在等我」，不留给「我在等别人」。
 * ------------------------------------------------------------------ */

export function Friends() {
  const t = useT()
  const social = useSocial()
  const players = useApp((s) => s.players)
  const back = useNav((s) => s.back)
  const push = useNav((s) => s.push)
  const [note, setNote] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  /*
   * uid → 球员。私聊那套按 auth uid 走，而界面上要显示的是名字和头像，
   * 那两样在球员身上。代建的球员（没装 App 的球友）没有 ownerId，
   * 自然也就进不了这张表 —— 他们本来就加不了好友。
   */
  const byUid = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>()
    for (const p of players) if (p.ownerId) map.set(p.ownerId, p)
    return map
  }, [players])

  const avatars = useApp((s) => s.avatars)
  const avatarsById = useMemo(
    () => new Map(avatars.map((a) => [a.playerId, a])),
    [avatars],
  )

  const incoming = useMemo(() => incomingRequests(social), [social])
  const outgoing = useMemo(() => outgoingRequests(social), [social])
  const friends = useMemo(() => friendUids(social), [social])
  const chats = useMemo(() => threads(social), [social])

  /*
   * 谁在打球。
   *
   * 单独拉一次，不进 useSocial —— 那个 store 是 realtime 订阅着的，
   * 而「正在打」变化得慢（一晚上一两次），为它多挂一个订阅不值。
   * 进这一屏拉一次就够：人来看好友列表，看到的就是那一刻的样子。
   *
   * 拉不到（没跑过 021、离线）就是一行都不显示 —— 这一块是锦上添花，
   * 不该因为它挂了就让整屏出错。
   */
  /*
   * 名片（照片 + 对外的名字）。和「正在打」一样进这一屏拉一次 ——
   * 这两样换得比球局还少，为它们挂个订阅不值。拿不到（没跑过
   * 022/023、离线）就退回球群里那个名字和换装角色。
   */
  const [cards, setCards] = useState<Map<string, NameCard>>(new Map())
  const [big, setBig] = useState<{ url: string; name: string } | null>(null)
  useEffect(() => {
    let alive = true
    void fetchCards().then((m) => {
      if (alive) setCards(m)
    })
    return () => {
      alive = false
    }
  }, [])

  const [playing, setPlaying] = useState<Map<string, Playing>>(new Map())
  useEffect(() => {
    let alive = true
    void fetchPlaying().then((rows) => {
      if (alive) setPlaying(new Map(rows.map((r) => [r.uid, r])))
    })
    return () => {
      alive = false
    }
  }, [])

  /**
   * 一行人：头像 + 名字。
   *
   * 名字有三个来源，顺序在 lib/profile.ts 里（球群里的 → 他自己填的 →
   * 没有）。三个都没有才说「不认识的人」—— 而在有了名片之后，
   * 那只剩下一种情形：他还没填，你们也不同群。
   *
   * `inButton`：这一行**外面套着一个整块可点的卡片**（聊天那一段）。
   * 那种情况下里面一个按钮都不能有 —— 按钮套按钮 HTML 不合法，
   * 浏览器会把外层拆掉，两个点击一起乱。排名那一屏踩过同一个坑。
   */
  const person = (uid: string, inButton = false) => {
    const p = byUid.get(uid)
    const card = cards.get(uid)
    const name = nameOf({ club: p?.name, card: card?.name })
    const shown = name ?? t('不认识的人', 'Unknown')
    const open = () => push({ name: 'person', uid, hint: name ?? undefined })
    const label = (
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-medium">{shown}</span>
        {/*
          「不在你的球群里」只在人名单上说，聊天那一段不说：
          那一行要放的是最后一句话，挤进来会把名字压成一条缝
          （真在浏览器里看出来的 —— 这句话不 truncate，是它在撑宽度）。
        */}
        {!p && !inButton && (
          <span className="text-ink-500 block truncate text-caption">
            {t('不在你的球群里 · 看主页', 'Not in your club · see profile')}
          </span>
        )}
      </span>
    )
    return {
      name: shown,
      node: (
        <>
          {/*
            社交这几屏用照片，球场那一侧（看板、排队、排行榜）照旧用角色 ——
            那里问的是「这个人球打得怎么样」，一张自拍回答不了。
            没设照片的人自动退回 Avatar，所以这里不用判断。

            点头像看照片，点名字进主页 —— 两件不同的事，所以是两个
            点击区，不是一个。
          */}
          <PhotoAvatar
            url={card?.photo}
            name={shown}
            avatar={p ? avatarsById.get(p.id) : undefined}
            onOpen={
              !inButton && card?.photo
                ? () => setBig({ url: card.photo!, name: shown })
                : undefined
            }
          />
          {inButton ? (
            label
          ) : (
            <button onClick={open} className="flex min-w-0 flex-1">
              {label}
            </button>
          )}
        </>
      ),
      player: p,
    }
  }

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setNote(r.error ?? null)
    else await refreshSocial()
  }

  /*
   * 加好友是从别人的战绩页点的，不是在这里搜名字 ——
   * 加一个人之前总要先看看他是谁。所以这里只做「在我球群里找人」，
   * 点进去还是他的战绩页，加不加在那儿决定。
   */
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const known = new Set([...friends, ...incoming.map((f) => f.requester), ...outgoing.map((f) => f.addressee)])
    return players
      .filter(
        (p) =>
          p.ownerId &&
          p.ownerId !== social.meUid &&
          !known.has(p.ownerId) &&
          !p.archived &&
          p.name.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [players, query, friends, incoming, outgoing, social.meUid])

  if (!social.meUid) {
    return (
      <Screen>
        <TopBar title={t('好友', 'Friends')} onBack={back} />
        <Body>
          <EmptyState
            icon="👋"
            title={t('先登录', 'Sign in first')}
            hint={t(
              '好友和私聊都存在云端，不在这台手机上 —— 所以得先知道你是谁。',
              'Friends and chats live in the cloud, not on this phone — so we need to know who you are.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  return (
    <Screen>
      <TopBar title={t('好友', 'Friends')} onBack={back} />
      <Body>
        {/* 1. 有人在等我点头 */}
        {incoming.length > 0 && (
          <>
            <SectionTitle>{t(`好友申请（${incoming.length}）`, `Requests (${incoming.length})`)}</SectionTitle>
            <div className="space-y-2">
              {incoming.map((f) => {
                const who = person(f.requester)
                return (
                  <Card key={f.id} className="border-brand-500/40">
                    <div className="flex items-center gap-3">
                      {who.node}
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => void run(() => removeFriendship(f.id))}
                      >
                        {t('不了', 'No')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => void run(() => acceptFriendRequest(f.id))}
                      >
                        {t('同意', 'Accept')}
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </>
        )}

        {/* 2. 聊过的那几段 */}
        {chats.length > 0 && (
          <>
            <SectionTitle>{t('聊天', 'Chats')}</SectionTitle>
            <div className="space-y-2">
              {chats.map((th) => {
                /* 整张卡是一个按钮 —— 里面不能再有按钮，所以传 true */
                const who = person(th.uid, true)
                const mine = th.last.sender === social.meUid
                return (
                  <Card key={th.uid} onClick={() => push({ name: 'chat', uid: th.uid })}>
                    <div className="flex items-center gap-3">
                      {who.node}
                      <span className="min-w-0 flex-[2]">
                        <span
                          className={cx(
                            'block truncate text-label',
                            th.unread > 0 ? 'text-ink-900 font-medium' : 'text-ink-500',
                          )}
                        >
                          {mine && t('我：', 'You: ')}
                          {/* 语音那条没有文字，列表里给一个认得出来的标记 */}
                          {isVoice(th.last)
                            ? t('[语音]', '[Voice]')
                            : th.last.body}
                        </span>
                        <span className="text-ink-500 block text-caption">
                          {relativeTime(Date.parse(th.last.created_at))}
                        </span>
                      </span>
                      {th.unread > 0 && (
                        <Pill tone="brand" className="shrink-0">
                          {th.unread}
                        </Pill>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </>
        )}

        {/* 3. 我可以找谁 */}
        <SectionTitle>{t(`好友（${friends.length}）`, `Friends (${friends.length})`)}</SectionTitle>
        {friends.length === 0 ? (
          <EmptyState
            icon="🤝"
            title={t('还没有好友', 'No friends yet')}
            hint={t(
              '在排行榜或者球局里点开一个人，他的战绩页上就有「加好友」。加上之后才能私聊 —— 陌生人发不了消息给你。',
              'Open someone from a leaderboard or a session and tap “Add friend” on their profile. Chat only opens between friends — strangers cannot message you.',
            )}
          />
        ) : (
          <div className="space-y-2">
            {friends.map((uid) => {
              const who = person(uid)
              const f = social.friendships.find(
                (x) => x.status === 'accepted' && otherSide(x, social.meUid!) === uid,
              )
              return (
                <Card key={uid}>
                  <div className="flex items-center gap-3">
                    {/*
                      原来这里还有一个「战绩」按钮，去掉了：它只对同一个
                      球群的好友有意义，而点名字进去的那张主页上，段位、
                      MMR、胜率就摆在第一屏，再点一下才是完整战绩。
                      少一个按钮，而且对串场的好友也说得通。
                    */}
                    {who.node}
                    <Button
                      size="sm"
                      variant="primary"
                      className="shrink-0"
                      onClick={() => push({ name: 'chat', uid })}
                    >
                      {t('私聊', 'Chat')}
                    </Button>
                  </div>
                  {/*
                    正在打球。
                    
                    这一行是这一屏上唯一「此刻」的东西，所以给它品牌色 ——
                    别的都是静态的名字和按钮，它是活的。
                    
                    它对**不在你球群里**的好友照样显示，那正是它的意义：
                    球局读不到（RLS 拦着），但「他在哪打球」读得到。
                  */}
                  {playing.has(uid) && (
                    <p className="text-brand-600 mt-2 text-caption font-medium">
                      {playingLine(playing.get(uid)!, lang() === 'zh')}
                    </p>
                  )}
                  {f && (
                    <button
                      className="text-ink-500 active:text-danger-600 mt-2 text-caption"
                      disabled={busy}
                      onClick={() => void run(() => removeFriendship(f.id))}
                    >
                      {t('删掉这个好友', 'Remove friend')}
                    </button>
                  )}
                </Card>
              )
            })}
          </div>
        )}

        {/* 找人。只在自己球群里找 —— 加不加在他的战绩页上决定 */}
        <div>
          <input
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('按名字找人加好友', 'Find someone by name')}
            aria-label={t('找人', 'Find someone')}
          />
          {query.trim() && candidates.length === 0 && (
            <p className="text-ink-500 mt-2 text-caption">
              {t(
                '没找到。只找得到装了 App、自己建过账号的人 —— 帮别人代记的那些球员加不了好友。',
                'Nobody found. Only people with their own account can be added — players created on someone else’s behalf cannot.',
              )}
            </p>
          )}
          <div className="mt-2 space-y-2">
            {candidates.map((p) => (
              <Card key={p.id}>
                <div className="flex items-center gap-3">
                  <Avatar name={p.name} avatar={avatarsById.get(p.id)} />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={() => push({ name: 'profile', playerId: p.id })}
                  >
                    {t('看战绩', 'Record')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => void run(() => sendFriendRequest(p.ownerId!))}
                  >
                    {t('加好友', 'Add')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* 4. 我在等别人 */}
        {outgoing.length > 0 && (
          <>
            <SectionTitle>{t('等对方同意', 'Waiting on them')}</SectionTitle>
            <div className="space-y-2">
              {outgoing.map((f) => {
                const who = person(f.addressee)
                return (
                  <Card key={f.id}>
                    <div className="flex items-center gap-3">
                      {who.node}
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => void run(() => removeFriendship(f.id))}
                      >
                        {t('撤回', 'Cancel')}
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </>
        )}

        {/* 拉黑的人。平时不该占地方，所以只在真有的时候出现 */}
        {social.blocked.length > 0 && (
          <>
            <SectionTitle>{t(`拉黑的人（${social.blocked.length}）`, `Blocked (${social.blocked.length})`)}</SectionTitle>
            <div className="space-y-2">
              {social.blocked.map((uid) => {
                const who = person(uid)
                return (
                  <Card key={uid}>
                    <div className="flex items-center gap-3">
                      {who.node}
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => void run(() => unblockUser(uid))}
                      >
                        {t('解除', 'Unblock')}
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
            <p className="text-ink-500 text-caption">
              {t(
                '拉黑的人发不了消息给你，也发不了好友申请。他那边只看到「发不出去」，不知道被拉黑了。',
                'Blocked people cannot message you or send a friend request. On their side it just fails — they are not told.',
              )}
            </p>
          </>
        )}

        <p className="text-ink-500 pb-2 text-caption">
          {t(
            '好友和私聊只存在云端，不留在这台手机上 —— 球馆里一台手机轮流记分是常事，私信留在本机，下一个拿手机的人就翻得到。所以断网的时候这一屏是空的。',
            'Friends and chats live only in the cloud, never on this phone — one phone gets passed around a court all night. So this screen is empty when you are offline.',
          )}
        </p>
      </Body>

      <Toast message={note} tone="error" onClose={() => setNote(null)} />
      {/* 点头像看大图。挂在最外层，不然会被卡片裁掉 */}
      <PhotoViewer url={big?.url ?? null} name={big?.name ?? ''} onClose={() => setBig(null)} />
    </Screen>
  )
}
