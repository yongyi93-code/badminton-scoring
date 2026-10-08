import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '@/lib/profile'

/* ------------------------------------------------------------------ *
 * 名片表那个缓存
 *
 * lib/cardLoad 管「该不该拉」，这里管**拉回来之后怎么记账** ——
 * 而整件事的关键就一句：**失败不记账**。
 *
 * 记了的话，地铁里开一次 App 拉失败，这一整次使用里所有人的头像
 * 都是卡通的，直到他彻底关掉重开。而那一次失败没有红框、没有日志，
 * 和「大家都没设过照片」长得一模一样。
 * ------------------------------------------------------------------ */

/* 本机缓存那层（zustand persist）在 node 里没有 window，垫一个假的 */
const fake = {
  store: new Map<string, string>(),
  getItem: (k: string) => fake.store.get(k) ?? null,
  setItem: (k: string, v: string) => void fake.store.set(k, v),
  removeItem: (k: string) => void fake.store.delete(k),
}
vi.stubGlobal('window', { localStorage: fake })
vi.stubGlobal('localStorage', fake)

/** 这一趟 loadCards 要回什么，由每条测试自己摆 */
let next: { ok: boolean; cards: Map<string, Card> } = { ok: true, cards: new Map() }
let calls = 0

vi.mock('@/lib/profile', () => ({
  loadCards: async () => {
    calls += 1
    return next
  },
}))

const { useCards } = await import('@/store/useCards')

const card = (uid: string, photo: string | null): Card => ({ uid, name: null, photo })
const table = (...cs: Card[]) => new Map(cs.map((c) => [c.uid, c]))

const 我 = 'uid-me'
const 别人 = 'uid-other'

beforeEach(() => {
  calls = 0
  next = { ok: true, cards: new Map() }
  useCards.setState({ cards: new Map(), loadedFor: undefined })
})

describe('拉失败不记账', () => {
  it('失败之后还会再拉 —— 这就是重试', async () => {
    next = { ok: false, cards: new Map() }
    await useCards.getState().load(我)
    expect(calls).toBe(1)

    /* 回前台那一下再问一次：记了账的话这里会直接返回，永远不重试 */
    await useCards.getState().load(我)
    expect(calls).toBe(2)
  })

  it('失败不许把手上那张表清空', async () => {
    /*
     * 先有一张好的，然后一次失败。
     * 清空的话，人正看着的那一屏，所有头像当场从照片变回卡通 ——
     * 而真正发生的只是一个请求没成。
     */
    next = { ok: true, cards: table(card(我, 'https://x/me.jpg')) }
    await useCards.getState().load(我)

    next = { ok: false, cards: new Map() }
    await useCards.getState().load(我, true)

    expect(useCards.getState().cards.get(我)?.photo).toBe('https://x/me.jpg')
  })
})

describe('成功了才记', () => {
  it('记下这张表是谁的', async () => {
    next = { ok: true, cards: table(card(我, 'https://x/me.jpg')) }
    await useCards.getState().load(我)
    expect(useCards.getState().loadedFor).toBe(我)
    expect(useCards.getState().cards.get(我)?.photo).toBe('https://x/me.jpg')
  })

  it('同一个人不再拉第二次', async () => {
    await useCards.getState().load(我)
    await useCards.getState().load(我)
    expect(calls).toBe(1)
  })

  it('换了人就重拉', async () => {
    /*
     * 今天真正坑到人的那一条：注册登录来回试了几趟，每退出再进来
     * 一次头像就没了一次 —— 因为登录前拉到的空表被当成数了。
     */
    await useCards.getState().load(null)
    expect(calls).toBe(1)

    next = { ok: true, cards: table(card(我, 'https://x/me.jpg')) }
    await useCards.getState().load(我)
    expect(calls).toBe(2)
    expect(useCards.getState().cards.get(我)?.photo).toBe('https://x/me.jpg')
  })

  it('登出也重拉 —— 不然下一个人看到上一个人的头像', async () => {
    next = { ok: true, cards: table(card(我, 'https://x/me.jpg')) }
    await useCards.getState().load(我)

    next = { ok: true, cards: table(card(别人, 'https://x/other.jpg')) }
    await useCards.getState().load(null)
    expect(calls).toBe(2)
    expect(useCards.getState().cards.get(我)).toBeUndefined()
  })
})

describe('换完头像那一下要强拉', () => {
  it('同一个人也照拉不误', async () => {
    /*
     * 不强拉的话，刚换完头像退回上一屏，看到的还是旧的那张 ——
     * 而人会以为没换上，再换一次。
     */
    next = { ok: true, cards: table(card(我, 'https://x/old.jpg')) }
    await useCards.getState().load(我)

    next = { ok: true, cards: table(card(我, 'https://x/new.jpg')) }
    await useCards.getState().load(我, true)
    expect(calls).toBe(2)
    expect(useCards.getState().cards.get(我)?.photo).toBe('https://x/new.jpg')
  })
})
