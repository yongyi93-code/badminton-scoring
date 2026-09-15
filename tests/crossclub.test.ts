import { describe, expect, it } from 'vitest'
import { mergePeople, scopeKey, type LeaderRow } from '@/lib/leaderboard'

/*
 * 串场：一个人在几个球群打球。
 *
 * 手机只装得下当前那个群的数据，所以它报上去的永远只是「我在这个群
 * 的成绩」。第一版拿 uid 当主键，于是在第二个群按一次「更新我的成绩」
 * 就把第一个群那一份**悄悄盖掉了** —— 没有报错，20 场就没了。
 *
 * 现在一个群一行，看榜的时候在这儿合并。这个文件钉的是两件事：
 *
 *   1. 合并不能少算，也不能把两个人算成一个人
 *   2. scope 那把钥匙要稳（同一个人同一个群，换台手机也算得出同一个值）
 *      而且不能让人按群把榜上的人分堆 —— 那就成了花名册
 */

const r = (patch: Partial<LeaderRow> = {}): LeaderRow => ({
  uid: 'u1',
  scope: 'aaaaaaaaaaaa',
  name: '阿伟',
  mmr: 100,
  wins: 10,
  losses: 5,
  confirmed: 3,
  state: 'selangor',
  updated_at: '2026-09-01T00:00:00Z',
  ...patch,
})

describe('一个人一个群一行，榜上合成一个人', () => {
  it('只有一个群的时候，合并等于原样', () => {
    expect(mergePeople([r()])).toEqual([
      {
        uid: 'u1',
        name: '阿伟',
        mmr: 100,
        wins: 10,
        losses: 5,
        confirmed: 3,
        state: 'selangor',
        clubs: 1,
        updated_at: '2026-09-01T00:00:00Z',
      },
    ])
  })

  it('两个群的数相加 —— 这就是第一版丢掉的那一半', () => {
    const [p] = mergePeople([
      r({ scope: 'A', mmr: 150, wins: 30, losses: 12, confirmed: 8 }),
      r({ scope: 'B', mmr: 50, wins: 10, losses: 4, confirmed: 2 }),
    ])
    expect(p).toMatchObject({ mmr: 200, wins: 40, losses: 16, confirmed: 10, clubs: 2 })
  })

  it('两个人不会被合成一个 —— 按 uid 分，不是按名字', () => {
    const out = mergePeople([
      r({ uid: 'u1', mmr: 100 }),
      r({ uid: 'u2', scope: 'B', mmr: 80 }),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.uid)).toEqual(['u1', 'u2'])
  })

  it('同名的两个人也不合并 —— 「阿伟」在马来西亚不止一个', () => {
    const out = mergePeople([r({ uid: 'u1' }), r({ uid: 'u2', scope: 'B' })])
    expect(out).toHaveLength(2)
  })

  it('一行都没有就是空榜，不会炸', () => {
    expect(mergePeople([])).toEqual([])
  })
})

describe('名字和州取「打得最多的那个群」', () => {
  /*
   * 一个人在不同群里可能用的不是同一个名字（「阿伟」和「Wei」），
   * 州也可能不一样（他在两个州各有一个常去的馆）。总得挑一个，
   * 挑他打得最多的地方那个最像他。
   */
  it('场次多的那一行说了算', () => {
    const [p] = mergePeople([
      r({ scope: 'A', name: '少打的那个', state: 'penang', wins: 2, losses: 1 }),
      r({ scope: 'B', name: '常打的那个', state: 'selangor', wins: 40, losses: 20 }),
    ])
    expect(p.name).toBe('常打的那个')
    expect(p.state).toBe('selangor')
  })

  it('场次一样多就看 MMR', () => {
    const [p] = mergePeople([
      r({ scope: 'A', name: '低的', mmr: 30, wins: 5, losses: 5 }),
      r({ scope: 'B', name: '高的', mmr: 90, wins: 5, losses: 5 }),
    ])
    expect(p.name).toBe('高的')
  })

  it('场次和 MMR 都一样就看谁报得晚', () => {
    const [p] = mergePeople([
      r({ scope: 'A', name: '旧的', updated_at: '2026-01-01T00:00:00Z' }),
      r({ scope: 'B', name: '新的', updated_at: '2026-09-09T00:00:00Z' }),
    ])
    expect(p.name).toBe('新的')
  })

  /*
   * 顺序不能影响结果。同一份数据从数据库拿两次顺序可能不同
   * （只按 mmr 排，同分的行之间没有定序），画出来的名字要是会跳，
   * 没人会相信这一屏。
   */
  it('输入顺序反过来，结果一样', () => {
    const rows = [
      r({ scope: 'A', name: '少打的', wins: 2, losses: 1 }),
      r({ scope: 'B', name: '常打的', wins: 40, losses: 20 }),
      r({ scope: 'C', name: '中间的', wins: 10, losses: 10 }),
    ]
    expect(mergePeople(rows)).toEqual(mergePeople([...rows].reverse()))
  })

  it('最后报的时间取最晚的那个', () => {
    const [p] = mergePeople([
      r({ scope: 'A', updated_at: '2026-01-01T00:00:00Z' }),
      r({ scope: 'B', updated_at: '2026-09-09T00:00:00Z' }),
    ])
    expect(p.updated_at).toBe('2026-09-09T00:00:00Z')
  })
})

describe('榜的顺序', () => {
  it('按合计排，不是按单个群排', () => {
    /*
     * 这一条是整件事的重点：两个群各 90 的人，排在只有一个群 150
     * 的人前面。数据库那边按行的 mmr 倒序给，那个顺序不是最终顺序 ——
     * 直接拿来画的话，串场的人永远排在后面。
     */
    const out = mergePeople([
      r({ uid: 'solo', scope: 'S', mmr: 150 }),
      r({ uid: 'both', scope: 'A', mmr: 90 }),
      r({ uid: 'both', scope: 'B', mmr: 90 }),
    ])
    expect(out.map((p) => p.uid)).toEqual(['both', 'solo'])
  })

  it('同分按名字排，不看输入顺序', () => {
    const out = mergePeople([
      r({ uid: 'u2', name: 'B仔', mmr: 100 }),
      r({ uid: 'u1', name: 'A仔', mmr: 100 }),
    ])
    expect(out.map((p) => p.name)).toEqual(['A仔', 'B仔'])
  })
})

describe('scope —— 「这一行是哪个群的」', () => {
  const UID = '11111111-2222-3333-4444-555555555555'

  it('同一个人同一个群，每次算出来都一样（换台手机也改得动那一行）', async () => {
    expect(await scopeKey(UID, 'club_aaa')).toBe(await scopeKey(UID, 'club_aaa'))
  })

  it('同一个人的两个群，值不一样 —— 不然第二个群还是会盖掉第一个', async () => {
    expect(await scopeKey(UID, 'club_aaa')).not.toBe(await scopeKey(UID, 'club_bbb'))
  })

  /*
   * 这一条是隐私那一半：两个人在**同一个群**，算出来也必须不一样。
   *
   * 一样的话，任何人都能把榜上的行按这个值分堆，每一堆就是一个球群的
   * 花名册 —— 而 records 那张表拦了一整年的正是这个。
   */
  it('两个人的同一个群，值也不一样 —— 拼不出花名册', async () => {
    const other = '99999999-8888-7777-6666-555555555555'
    expect(await scopeKey(UID, 'club_aaa')).not.toBe(await scopeKey(other, 'club_aaa'))
  })

  it('看不出球群 id —— 那串字不出现在结果里', async () => {
    const key = await scopeKey(UID, 'club_5a01d65c98e8')
    expect(key).not.toContain('5a01d65c98e8')
    expect(key).not.toContain(UID.slice(0, 8))
  })

  /* 数据库那条 check 是 char_length(scope) between 8 and 64 */
  it('长度落在数据库认的范围里，而且只有十六进制', async () => {
    const key = await scopeKey(UID, 'club_aaa')
    expect(key).toMatch(/^[0-9a-f]{8,64}$/)
  })

  /* ----------------------------------------------------------------- *
   * 跑不了 SubtleCrypto 的那条退路
   *
   * 非安全上下文、或者太老的浏览器。这条分支平时一次都不会走到，
   * 所以更要钉住 —— 真走到的时候要是算出个空串或者两个人一样的值，
   * 那一刻没有任何人会发现。
   * ----------------------------------------------------------------- */
  describe('没有 SubtleCrypto 的时候', () => {
    /** 把 crypto.subtle 摘掉跑一段，跑完装回去 */
    const withoutSubtle = async <T>(fn: () => Promise<T>): Promise<T> => {
      const real = globalThis.crypto
      Object.defineProperty(globalThis, 'crypto', {
        value: { ...real, subtle: undefined },
        configurable: true,
      })
      try {
        return await fn()
      } finally {
        Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true })
      }
    }

    it('照样算得出来，而且还是那个格式', async () => {
      const key = await withoutSubtle(() => scopeKey(UID, 'club_aaa'))
      expect(key).toMatch(/^[0-9a-f]{8,64}$/)
    })

    it('同一个人同一个群还是稳的', async () => {
      const [a, b] = await withoutSubtle(async () => [
        await scopeKey(UID, 'club_aaa'),
        await scopeKey(UID, 'club_aaa'),
      ])
      expect(a).toBe(b)
    })

    it('两个群分得开', async () => {
      const [a, b] = await withoutSubtle(async () => [
        await scopeKey(UID, 'club_aaa'),
        await scopeKey(UID, 'club_bbb'),
      ])
      expect(a).not.toBe(b)
    })

    it('两个人的同一个群也分得开 —— 花名册这条底线退路上也要守住', async () => {
      const other = '99999999-8888-7777-6666-555555555555'
      const [a, b] = await withoutSubtle(async () => [
        await scopeKey(UID, 'club_aaa'),
        await scopeKey(other, 'club_aaa'),
      ])
      expect(a).not.toBe(b)
    })

    /*
     * 一群人在同一个球群里，谁都不能和谁撞上 —— 撞了的话，两个人的
     * 成绩会在榜上被当成同一行的两次上报（后写的盖掉先写的）。
     */
    it('一百个人在同一个群里，一个都不撞', async () => {
      const keys = await withoutSubtle(async () => {
        const out: string[] = []
        for (let i = 0; i < 100; i++) {
          out.push(await scopeKey(`uid-${i}-${i * 7919}`, 'club_aaa'))
        }
        return out
      })
      expect(new Set(keys).size).toBe(100)
    })
  })
})
