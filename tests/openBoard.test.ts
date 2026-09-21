import { describe, expect, it } from 'vitest'
import {
  STALE_MS,
  openDiff,
  openRow,
  shouldPublish,
  sortOpen,
  spotsLeftOn,
  type OpenRow,
} from '@/lib/openBoard'
import type { Session } from '@/types'

/* ------------------------------------------------------------------ *
 * 公开球局：哪一场该被全世界看到
 *
 * 这一组盯的是一件**错了没人会报错**的事：多公开了一场不该公开的，
 * 或者少公开了一场该公开的。前者是把一群人每周几在哪打球摊给了陌生人，
 * 后者只是没人来 —— 两个方向都不会抛异常，也不会变红，
 * 只会在某一天被人发现。
 *
 * 真正把门的那一半（只能发布自己的、别人改不动、管理员摘得掉）在
 * supabase/030-open-sessions.sql 的策略上，那些在本机跑真 Postgres
 * 撞过了（冒名那一条是明确报错，不是静悄悄 0 行）。
 * ------------------------------------------------------------------ */

const NOW = 1_700_000_000_000

const session = (p: Partial<Session> = {}): Session => ({
  id: 's1',
  date: '2026-09-22',
  time: '20:00',
  venue: '城中羽球馆 Cheras, Selangor',
  courtCount: 3,
  playerIds: ['p1', 'p2', 'p3', 'p4'],
  defaultType: 'doubles',
  rules: { pointsToWin: 21, winBy2: true, bestOf: 1, cap: 30 },
  fee: { courtFee: 0, shuttleCount: 0, shuttleUnitPrice: 0, paidPlayerIds: [] },
  status: 'active',
  createdAt: NOW - 60_000,
  ...p,
})

describe('哪一场该公开', () => {
  const fresh = { lastActivity: NOW - 60_000, now: NOW }

  it('正在进行、没勾私人、还新鲜的 —— 公开', () => {
    expect(shouldPublish(session(), fresh)).toBe(true)
  })

  /* 打完了的局别人来不了，挂在列表上只会让人白跑一趟 */
  it('已经结束的不公开', () => {
    expect(shouldPublish(session({ status: 'ended' }), fresh)).toBe(false)
  })

  it('勾了私人局的不公开', () => {
    expect(shouldPublish(session({ private: true }), fresh)).toBe(false)
  })

  /*
   * 这一条是升级那一刻最要紧的。
   *
   * 球局要靠人按「结束」才收摊，而没人记得按 —— 本机那些还标着
   * active、其实几个月前就打完的老局，不挡的话会在升级的**那一秒**
   * 被一次性摊到全网。而那是收不回来的。
   */
  it('十二小时没动静的老局不公开 —— 哪怕它还标着「进行中」', () => {
    const old = session({ createdAt: NOW - 90 * 24 * 60 * 60 * 1000 })
    expect(shouldPublish(old, { lastActivity: NOW - STALE_MS - 1, now: NOW })).toBe(false)
  })

  it('刚好卡在十二小时那一刻算旧的', () => {
    expect(shouldPublish(session(), { lastActivity: NOW - STALE_MS, now: NOW })).toBe(false)
  })

  it('差一毫秒到十二小时的还算新鲜', () => {
    expect(shouldPublish(session(), { lastActivity: NOW - STALE_MS + 1, now: NOW })).toBe(true)
  })
})

describe('公开出去的那一行', () => {
  const row = openRow(session(), { hostUid: 'u-1', clubCode: 'ABC123', hostName: '阿伟' })

  it('该带的都带上了', () => {
    expect(row.session_id).toBe('s1')
    expect(row.host_uid).toBe('u-1')
    expect(row.club_code).toBe('ABC123')
    expect(row.venue).toBe('城中羽球馆 Cheras, Selangor')
    expect(row.date).toBe('2026-09-22')
    expect(row.time).toBe('20:00')
    expect(row.courts).toBe(3)
    expect(row.joined).toBe(4)
    expect(row.host_name).toBe('阿伟')
  })

  /*
   * 这一条是这一组里最该有的。
   *
   * 公开列表是全 App 可见的。哪天有人往 openRow 里多塞一栏
   * （「顺手把名单也带上吧，显示头像好看」），那一刻就是把 18 个人的
   * 名字推给了所有陌生人 —— 而它不会报任何错。
   *
   * 所以这里钉死**栏目本身**，多一栏都算红。
   */
  it('只有这几栏，一栏都不许多', () => {
    expect(Object.keys(row).sort()).toEqual(
      [
        'club_code',
        'courts',
        'date',
        'host_name',
        'host_uid',
        'joined',
        'max_players',
        'session_id',
        'state',
        'time',
        'venue',
      ].sort(),
    )
  })

  it('比分和球员名单不在里面', () => {
    const json = JSON.stringify(row)
    expect(json).not.toContain('playerIds')
    expect(json).not.toContain('p1')
  })

  /* 州从球馆那串地址里认出来，认不出来就是空 —— 不猜 */
  it('州认得出来就带上', () => {
    expect(row.state).toBe('selangor')
  })

  it('认不出州就是空，不瞎填', () => {
    const r = openRow(session({ venue: '楼下那个球场' }), {
      hostUid: 'u-1',
      clubCode: null,
      hostName: null,
    })
    expect(r.state).toBeNull()
  })

  it('没设上限就是 null，不是 0', () => {
    expect(row.max_players).toBeNull()
    expect(openRow(session({ maxPlayers: 8 }), { hostUid: 'u', clubCode: null, hostName: null })
      .max_players).toBe(8)
  })
})

describe('和云端对齐', () => {
  const mk = (id: string, joined = 4): OpenRow => ({
    session_id: id,
    host_uid: 'u-1',
    club_code: 'ABC123',
    venue: '城中',
    state: 'Selangor',
    date: '2026-09-22',
    time: '20:00',
    courts: 3,
    joined,
    max_players: 8,
    host_name: '阿伟',
  })

  it('云端没有的要写上去', () => {
    const { upsert, remove } = openDiff([mk('a')], [])
    expect(upsert.map((r) => r.session_id)).toEqual(['a'])
    expect(remove).toEqual([])
  })

  /*
   * 内容一样就什么都不做。
   *
   * 这一条是为了省请求：这段代码跟着比赛记录跑，一晚上几十次。
   * 不挡的话就是几十次写同样的内容 —— 而每一次都是一次可能失败的
   * 网络请求，在球馆的 4G 上尤其。
   */
  it('内容没变就不写', () => {
    const { upsert, remove } = openDiff([mk('a')], [mk('a')])
    expect(upsert).toEqual([])
    expect(remove).toEqual([])
  })

  it('人数变了要写', () => {
    const { upsert } = openDiff([mk('a', 6)], [mk('a', 4)])
    expect(upsert.map((r) => r.joined)).toEqual([6])
  })

  /* 打完了、或者改成私人局了 —— 都表现为「本机不想公开它了」 */
  it('本机不要了就从云端撤掉', () => {
    const { upsert, remove } = openDiff([], [mk('a')])
    expect(upsert).toEqual([])
    expect(remove).toEqual(['a'])
  })

  it('一边加一边撤，互不影响', () => {
    const { upsert, remove } = openDiff([mk('b')], [mk('a')])
    expect(upsert.map((r) => r.session_id)).toEqual(['b'])
    expect(remove).toEqual(['a'])
  })

  /*
   * 云端那行上有本机没有的字段（updated_at 是数据库盖的）。
   * 拿整个对象比 JSON 的话永远不相等，diff 就等于没做 ——
   * 而那要等到「每次都在写」被人发现才会暴露。
   */
  it('云端多一个 updated_at 不算变化', () => {
    const cloud = { ...mk('a'), updated_at: '2026-09-22T12:00:00Z' } as OpenRow
    expect(openDiff([mk('a')], [cloud]).upsert).toEqual([])
  })
})

describe('怎么排、还差几个', () => {
  const at = (date: string, time: string | null): OpenRow => ({
    session_id: `${date}-${time}`,
    host_uid: 'u',
    club_code: null,
    venue: 'v',
    state: null,
    date,
    time,
    courts: 1,
    joined: 0,
    max_players: null,
    host_name: null,
  })

  /* 翻这张列表是为了找「今晚去哪打」，所以按日期时间排，不按谁刚开的 */
  it('先按日期，同一天按时间', () => {
    const out = sortOpen([at('2026-09-23', '20:00'), at('2026-09-22', '21:00'), at('2026-09-22', '19:00')])
    expect(out.map((r) => r.session_id)).toEqual([
      '2026-09-22-19:00',
      '2026-09-22-21:00',
      '2026-09-23-20:00',
    ])
  })

  /* 没写时间的排同一天的最后：信息少的往后站 */
  it('没写时间的排在同一天最后', () => {
    const out = sortOpen([at('2026-09-22', null), at('2026-09-22', '19:00')])
    expect(out.map((r) => r.time)).toEqual(['19:00', null])
  })

  it('不动传进来的那一份', () => {
    const list = [at('2026-09-23', '20:00'), at('2026-09-22', '19:00')]
    const before = list.map((r) => r.session_id)
    sortOpen(list)
    expect(list.map((r) => r.session_id)).toEqual(before)
  })

  it('没设上限就不说「还差几个」', () => {
    expect(spotsLeftOn(at('2026-09-22', '20:00'))).toBeNull()
  })

  it('满了是 0，不是负数', () => {
    const full = { ...at('2026-09-22', '20:00'), joined: 10, max_players: 8 }
    expect(spotsLeftOn(full)).toBe(0)
  })

  it('还差几个就说几个', () => {
    const half = { ...at('2026-09-22', '20:00'), joined: 4, max_players: 8 }
    expect(spotsLeftOn(half)).toBe(4)
  })
})
