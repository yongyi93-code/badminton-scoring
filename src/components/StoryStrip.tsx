import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useCards } from '@/store/useCards'
import { useSocial, friendUids } from '@/store/useSocial'
import { feedChanged, useFeed } from '@/store/useFeed'
import { Toast } from '@/components/ui'
import { PostSheet } from '@/components/PostSheet'
import { StoryRow, StoryViewer, tellers } from '@/components/Stories'
import { useMyBan } from '@/components/BanNotice'
import { nameOf } from '@/lib/profile'
import { deletePost, fetchMoments, type FeedItem } from '@/lib/moments'
import { MEDIA_ACCEPT } from '@/lib/media'
import { useT } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 那一排圈圈，连着它自己的数据
 *
 * 原来这一整套（拉 Story、按人分堆、全屏看、发一条、删一条）摊在
 * 朋友圈那一屏里。摊在那儿只有一个问题：**别的屏想要就得抄一遍**，
 * 而抄出来的第二份迟早和第一份不一样 —— 比如一边筛掉了过期的、
 * 另一边没有（2026-09-21 撞过的正是这一类）。
 *
 * 所以它自己管自己：自己拉数据、自己认人、自己发、自己删。
 * 外面只要写一行 <StoryStrip />。
 *
 * -------------------------------------------------------------------
 * 没东西的时候整个不出现
 *
 * 一个都没有、而且自己也发不了（被禁言、没登录）的时候返回 null ——
 * 首页上挂一排空圈圈是在占地方，而首页每一块都在抢那一屏。
 * 自己发得了就留一个「＋」：那是发 Story 唯一的入口。
 * ------------------------------------------------------------------ */

export function StoryStrip() {
  const t = useT()
  const social = useSocial()
  const players = useApp((s) => s.players)
  const avatars = useApp((s) => s.avatars)
  /*
   * 名片表用全 App 共享的那一份，不自己再拉一趟。
   *
   * 这一排现在同时出现在首页和朋友圈 —— 各拉各的话切一次 tab 就是
   * 一个新请求，而这张表一小时也变不了一次。
   */
  const cards = useCards((s) => s.cards)
  const { ban: myBan } = useMyBan()
  /* 别处发了或删了一条也要跟着刷 —— 那一条可能正好该出现在这一排 */
  const bump = useFeed((s) => s.n)

  const [stories, setStories] = useState<FeedItem[]>([])
  const [watching, setWatching] = useState<number | null>(null)
  const [composing, setComposing] = useState(false)
  /** 点「＋」那一下就选好的照片，跟着弹层一起递进去 */
  const [picked, setPicked] = useState<File[]>([])
  const [note, setNote] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const meUid = social.meUid
  const friends = useMemo(() => friendUids(social), [social])

  const byUid = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>()
    for (const p of players) if (p.ownerId) map.set(p.ownerId, p)
    return map
  }, [players])
  const avatarsById = useMemo(() => new Map(avatars.map((a) => [a.playerId, a])), [avatars])

  const load = useCallback(async () => {
    if (!meUid) {
      setStories([])
      return
    }
    /*
     * 拿得比时间线多：这里是按**人**合并的，二十条可能就三个人，
     * 而那一排本来就该显示得下十几个人。
     */
    setStories(
      await fetchMoments({ kind: 'stories', authors: [meUid, ...friends], meUid, limit: 60 }),
    )
  }, [meUid, friends, bump])

  useEffect(() => {
    void load()
  }, [load])

  const who = (author: string) => {
    const p = byUid.get(author)
    const card = cards.get(author)
    return {
      name: nameOf({ club: p?.name, card: card?.name }) ?? t('不认识的人', 'Unknown'),
      photo: card?.photo,
      avatar: p ? avatarsById.get(p.id) : undefined,
    }
  }

  const rings = tellers(stories, meUid, who)

  const remove = async (item: FeedItem) => {
    const r = await deletePost(item)
    if (!r.ok) {
      setNote(r.error)
      return
    }
    /*
     * 从手上这份里拿掉就行，不用重新拉一趟。
     *
     * 全屏那一层会自己发现「手上这条没了」然后退出来 —— 这里不去
     * 关它，因为删的可能是他那几条里的一条，剩下的还该接着看。
     */
    setStories((old) => old.filter((x) => x.id !== item.id))
    /* 删的那条也可能挂在别的屏上（比如朋友圈的时间线） */
    feedChanged()
  }

  /*
   * 点「＋」= **直接开相机**，和 Instagram 一样。这一下只做一件事。
   *
   * -------------------------------------------------------------------
   * 上一版这里同时把弹层也打开了，那是错的
   *
   * 当时的想法是「相册是系统盖上来的一层，取消掉就正好露出这张纸」，
   * 省掉一次判断。但人看到的是：点一下「＋」，底下先窜出一张纸，
   * 上面再盖一个相机 —— 取消相机之后还得再关一次那张纸。
   * IG 上点一下就是相机，没有别的东西。
   *
   * 现在弹层等**拍完了**才开（在下面那个 onChange 里）。取消相机
   * 就什么都不会发生 —— 这正是人期待的：他取消了。
   *
   * input.click() 还是必须留在这个点击事件里：Safari 只认用户手势
   * 那一下，放到 effect 里会被静悄悄挡掉，表现是「点了没反应」。
   * 而这一版它是这个函数里唯一的一句，不会再被别的事情带偏。
   *
   * 代价说清楚：从这个入口发不了**纯文字**的 Story 了（不拍就没有
   * 下一步）。那条路还在朋友圈那边 —— 发动态的时候把「留多久」
   * 点成「24 小时后消失」，一样是一条 Story。
   */
  const newStory = () => {
    setPicked([])
    picker.current?.click()
  }

  const canPost = Boolean(meUid) && !myBan
  if (rings.length === 0 && !canPost) return null

  return (
    <>
      <StoryRow
        tellers={rings}
        meUid={meUid}
        canPost={canPost}
        onOpen={setWatching}
        onNew={newStory}
      />

      {/*
        这个 input 摆在 StoryStrip 里而不是弹层里，就为了上面那条：
        点下去的那一刻弹层还没挂出来，而手势不等人。

        capture 是「直接开相机」那一下的全部机密：带上它，手机不再弹
        「照片图库 / 拍照 / 选取文件」那个框，直接就是取景器。
        accept 里同时写了 video/*，所以取景器上有「照片 / 视频」两档 ——
        少了那一半，相机只拍得了照片，录不了像。

        没有 multiple：相机一次就出一个文件，写了也是白写。
      */}
      <input
        ref={picker}
        type="file"
        accept={MEDIA_ACCEPT}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          /*
           * 先把 FileList 摊成数组，**再**清空 value —— input.files
           * 是活的引用，顺序反过来一张都拿不到（PostSheet 里那段
           * 注释写了是怎么撞出来的）。
           */
          const files = e.target.files ? [...e.target.files] : []
          e.target.value = ''
          /*
           * 拍到了才开那张纸。取消相机不发这个事件，所以「取消了什么
           * 都不发生」是白拿的 —— 不用去判断人有没有取消（iOS 上也
           * 根本判不出来）。
           */
          if (files.length) {
            setPicked(files)
            setComposing(true)
          }
        }}
      />

      <PostSheet
        open={composing}
        story
        initialFiles={picked}
        onClose={() => setComposing(false)}
        /* 自己不用刷：bump 变了 load 会跟着变，effect 自己再跑一遍 */
        onDone={feedChanged}
      />

      {watching !== null && (
        <StoryViewer
          tellers={rings}
          start={watching}
          meUid={meUid}
          onClose={() => setWatching(null)}
          onDelete={(item) => void remove(item)}
        />
      )}

      <Toast message={note} tone="error" onClose={() => setNote(null)} />
    </>
  )
}
