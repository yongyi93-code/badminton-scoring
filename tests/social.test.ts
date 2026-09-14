import { describe, expect, it } from 'vitest'
import {
  friendUids,
  incomingRequests,
  otherSide,
  outgoingRequests,
  socialBadge,
  standingWith,
  threadWith,
  threads,
  unreadCount,
  type SocialState,
} from '@/store/useSocial'
import type { Friendship, Message } from '@/lib/social'

/*
 * 这一份钉的全是「从平铺的行里算出关系」——
 * 谁是好友、谁在等谁、哪一段对话有几条没读。
 *
 * 这类算错不会崩，只会在界面上悄悄说反：把「他等我同意」显示成
 * 「我等他同意」，然后两个人都在等对方。所以值得一条条钉死。
 *
 * 规则本身（谁读得到谁的私信、非好友发不出去）不在这里 ——
 * 那些在数据库的策略里，见 supabase/009-friends-and-chat.sql。
 * 前端这一层一条都不该负责挡，它挡不住任何一个会按 F12 的人。
 */

const ME = 'me-uid'
const A = 'a-uid'
const B = 'b-uid'

const state = (patch: Partial<SocialState> = {}): SocialState => ({
  ready: true,
  friendships: [],
  messages: [],
  blocked: [],
  meUid: ME,
  ...patch,
})

const friendship = (
  requester: string,
  addressee: string,
  status: 'pending' | 'accepted',
  id = `${requester}->${addressee}`,
): Friendship => ({
  id,
  requester,
  addressee,
  status,
  created_at: '2026-09-14T10:00:00Z',
})

const message = (
  sender: string,
  recipient: string,
  body: string,
  at: string,
  read = false,
): Message => ({
  id: `${sender}-${at}`,
  sender,
  recipient,
  body,
  created_at: at,
  read_at: read ? at : null,
})

describe('一段关系里对方是谁', () => {
  it('我是发起的那一方，对方就是被申请的', () => {
    expect(otherSide(friendship(ME, A, 'accepted'), ME)).toBe(A)
  })

  it('我是被申请的那一方，对方就是发起的', () => {
    expect(otherSide(friendship(A, ME, 'accepted'), ME)).toBe(A)
  })
})

describe('好友、申请，各归各的', () => {
  const s = state({
    friendships: [
      friendship(ME, A, 'accepted'),
      friendship(B, ME, 'pending'), // 别人加我
      friendship(ME, 'c-uid', 'pending'), // 我加别人
    ],
  })

  it('好友只算已经同意的', () => {
    expect(friendUids(s)).toEqual([A])
  })

  /*
   * 方向弄反的后果不是少一行，是两个人都在等对方点头 ——
   * 一个在「等对方同意」里看着，一个在「好友申请」里看着，
   * 而实际上该动的只有一个人。
   */
  it('别人发来的算「等我处理」', () => {
    expect(incomingRequests(s).map((f) => f.requester)).toEqual([B])
  })

  it('我发出去的算「等对方」', () => {
    expect(outgoingRequests(s).map((f) => f.addressee)).toEqual(['c-uid'])
  })

  it('没登录的时候一律是空的，不是报错', () => {
    const anon = state({ meUid: null, friendships: s.friendships })
    expect(friendUids(anon)).toEqual([])
    expect(incomingRequests(anon)).toEqual([])
    expect(outgoingRequests(anon)).toEqual([])
  })
})

describe('我和某个人现在是什么关系', () => {
  it('没有任何一行就是「还不认识」', () => {
    expect(standingWith(state(), A)).toEqual({ kind: 'none' })
  })

  it('已经同意了就是好友', () => {
    const s = state({ friendships: [friendship(ME, A, 'accepted', 'f1')] })
    expect(standingWith(s, A)).toEqual({ kind: 'friends', id: 'f1' })
  })

  it('我发的还没回 —— 界面上该显示「等他同意」', () => {
    const s = state({ friendships: [friendship(ME, A, 'pending', 'f1')] })
    expect(standingWith(s, A)).toEqual({ kind: 'sent', id: 'f1' })
  })

  it('他发给我的 —— 界面上该显示「同意」', () => {
    const s = state({ friendships: [friendship(A, ME, 'pending', 'f1')] })
    expect(standingWith(s, A)).toEqual({ kind: 'received', id: 'f1' })
  })

  /*
   * 拉黑压过一切。哪怕那一行 friendships 还在 —— 数据库那边
   * are_friends 也是这么算的，两边口径必须一样，否则界面上
   * 显示着「私聊」，点进去发一句就被拒。
   */
  it('拉黑了就是拉黑，哪怕好友关系还在', () => {
    const s = state({
      friendships: [friendship(ME, A, 'accepted', 'f1')],
      blocked: [A],
    })
    expect(standingWith(s, A)).toEqual({ kind: 'blocked' })
  })

  it('自己跟自己没有关系可言', () => {
    expect(standingWith(state(), ME)).toEqual({ kind: 'none' })
  })

  it('uid 是空的（代建的球员，没有账号）也不能崩', () => {
    expect(standingWith(state(), null)).toEqual({ kind: 'none' })
    expect(standingWith(state(), undefined)).toEqual({ kind: 'none' })
  })
})

describe('一段对话里有哪些消息', () => {
  const s = state({
    messages: [
      message(ME, A, '今晚来吗', '2026-09-14T10:00:00Z'),
      message(A, ME, '来', '2026-09-14T10:01:00Z'),
      message(B, ME, '这是另一个人说的', '2026-09-14T10:02:00Z'),
    ],
  })

  it('只取我和他之间的，两个方向都要', () => {
    expect(threadWith(s, A).map((m) => m.body)).toEqual(['今晚来吗', '来'])
  })

  it('别人和我的对话不会串进来', () => {
    expect(threadWith(s, B).map((m) => m.body)).toEqual(['这是另一个人说的'])
  })
})

describe('会话列表', () => {
  const s = state({
    messages: [
      message(ME, A, '早的', '2026-09-14T10:00:00Z'),
      message(A, ME, '没读的一条', '2026-09-14T10:01:00Z'),
      message(A, ME, '没读的第二条', '2026-09-14T10:02:00Z'),
      message(B, ME, '更晚的', '2026-09-14T11:00:00Z'),
    ],
  })

  it('一个人一行，按最后一条的时间倒着排', () => {
    expect(threads(s).map((x) => x.uid)).toEqual([B, A])
  })

  it('每行显示的是那一段最后说的那句', () => {
    expect(threads(s).find((x) => x.uid === A)!.last.body).toBe('没读的第二条')
  })

  it('未读只数别人发给我、而且还没读的', () => {
    expect(threads(s).find((x) => x.uid === A)!.unread).toBe(2)
    expect(threads(s).find((x) => x.uid === B)!.unread).toBe(1)
  })

  /*
   * 自己发的永远不算未读。这条看着显然，但 read_at 在自己发的
   * 消息上本来就是 null（对方没读），只判 read_at 就会把自己
   * 说过的每一句都数成未读。
   */
  it('自己发的不算未读，哪怕对方还没读', () => {
    const mineOnly = state({
      messages: [message(ME, A, '我说的', '2026-09-14T10:00:00Z')],
    })
    expect(unreadCount(mineOnly)).toBe(0)
    expect(threads(mineOnly)[0].unread).toBe(0)
  })

  it('读过的那条不再计数', () => {
    const readOne = state({
      messages: [message(A, ME, '读过了', '2026-09-14T10:00:00Z', true)],
    })
    expect(unreadCount(readOne)).toBe(0)
  })
})

describe('小红点上那个数', () => {
  it('未读私信和好友申请加在一起', () => {
    const s = state({
      friendships: [friendship(A, ME, 'pending'), friendship(B, ME, 'pending', 'f2')],
      messages: [message(A, ME, '一条没读的', '2026-09-14T10:00:00Z')],
    })
    expect(socialBadge(s)).toBe(3)
  })

  it('什么都没有就是 0 —— 不显示，不是显示一个 0', () => {
    expect(socialBadge(state())).toBe(0)
  })
})
