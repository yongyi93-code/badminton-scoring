import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/store/useApp'
import { useCards } from '@/store/useCards'
import { useSocial, friendUids } from '@/store/useSocial'
import { feedChanged, useFeed } from '@/store/useFeed'
import { Toast } from '@/components/ui'
import { PostSheet } from '@/components/PostSheet'
import { Camera } from '@/components/Camera'
import { StoryRow, StoryViewer, tellers } from '@/components/Stories'
import { useMyBan } from '@/components/BanNotice'
import { nameOf } from '@/lib/profile'
import { deletePost, fetchMoments, type FeedItem } from '@/lib/moments'
import { MEDIA_ACCEPT } from '@/lib/media'
import { allSeen } from '@/lib/seen'
import { useSeen } from '@/store/useSeen'
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
  /* 看过哪几条。全 App 共用一份 —— 这一排同时挂在首页和朋友圈 */
  const seen = useSeen((s) => s.seen)
  const markSeen = useSeen((s) => s.mark)

  const [stories, setStories] = useState<FeedItem[]>([])
  const [watching, setWatching] = useState<number | null>(null)
  const [composing, setComposing] = useState(false)
  /** 相机开着没有。点「＋」开它，拍完或者取消就收 */
  const [shooting, setShooting] = useState(false)
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

  /*
   * 哪几个人的圈该是灰的：他那几条**都看过了**才算。
   *
   * 他今晚发了三条你只看了一条，圈还该亮着 —— 圈说的是「还有没看过
   * 的」，不是「你来过没有」。
   *
   * 这里只算不写。写是在全屏那边（onSeen），因为那才是真的看到了的
   * 时刻；在这儿写等于「圈出现在屏幕上就算看过」。
   */
  const seenUids = useMemo(
    () => new Set(rings.filter((r) => allSeen(r.items, seen)).map((r) => r.uid)),
    [rings, seen],
  )

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
   * 点「＋」= **开我们自己那个相机**（components/Camera）。
   *
   * -------------------------------------------------------------------
   * 为什么不是系统那个 input capture
   *
   * 上一版用的是 `<input type="file" capture>`。iOS 上它直接开取景器，
   * 可是 **Android Chrome 只有 accept 是单一一类时才认** —— 我们
   * accept 里图片和视频都要，Chrome 不知道该开照相还是摄像，于是
   * 当没看见，退回相册。用户报的正是这个：「点加后直接出album，
   * 没有跳出camera」。
   *
   * accept 二选一的话要么拍不了照、要么录不了像，所以只剩自己做。
   *
   * -------------------------------------------------------------------
   * 相机开不起来就回相册
   *
   * 没给权限、没有摄像头、浏览器太老 —— Camera 会调 onAlbum，
   * 由这里去开那个**不带 capture** 的 input。相机是更好的那条路，
   * 不是唯一那条路。
   *
   * 代价还是那条：从这个入口发不了纯文字的 Story。那条路在朋友圈那边
   * （发动态时把「留多久」点成「24 小时后消失」）。
   */
  const newStory = () => {
    setPicked([])
    setShooting(true)
  }

  /* 相机让位给相册：先把相机收了，再开那个系统框 */
  const toAlbum = () => {
    setShooting(false)
    picker.current?.click()
  }

  /* 拍好了：收起相机，把那一个文件递给弹层 */
  const shot = (f: File) => {
    setShooting(false)
    setPicked([f])
    setComposing(true)
  }

  const canPost = Boolean(meUid) && !myBan
  if (rings.length === 0 && !canPost) return null

  return (
    <>
      <StoryRow
        tellers={rings}
        meUid={meUid}
        canPost={canPost}
        seenUids={seenUids}
        onOpen={setWatching}
        onNew={newStory}
      />

      <Camera open={shooting} onClose={() => setShooting(false)} onShot={shot} onAlbum={toAlbum} />

      {/*
        这一个是**相册**那条路：相机开不起来，或者人自己点了「相册」。

        没有 capture —— 上一版加了它，结果 Android Chrome 因为 accept
        里有两类而整个忽略，反倒变成「点了直接出相册」。现在相机由
        我们自己那个组件管，这个 input 只干它本来该干的事。
      */}
      <input
        ref={picker}
        type="file"
        accept={MEDIA_ACCEPT}
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
           * 挑了才开那张纸。取消相册不发这个事件，所以「取消了什么
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
          onSeen={markSeen}
        />
      )}

      <Toast message={note} tone="error" onClose={() => setNote(null)} />
    </>
  )
}
