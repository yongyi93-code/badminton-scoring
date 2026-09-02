import { beforeEach, describe, expect, it } from 'vitest'
import { useApp, avatarOf } from '@/store/useApp'

/*
 * store 的行为大多是「改一个字段，另一个字段得跟着动」，
 * 这种跨字段的联动最容易在改动别处时悄悄断掉，值得钉死。
 */

beforeEach(() => {
  useApp.getState().resetAll()
})

describe('角色的男女跟着球员资料走', () => {
  it('把性别从男改成女，角色也跟着换成女', () => {
    const p = useApp.getState().addPlayer('阿伟', 'M')
    useApp.getState().setAvatarSex(p.id, 'm')
    expect(avatarOf(useApp.getState().avatars, p.id)?.sex).toBe('m')

    useApp.getState().updatePlayer(p.id, { gender: 'F' })
    expect(avatarOf(useApp.getState().avatars, p.id)?.sex).toBe('f')
  })

  it('换过去之后，买过的东西和花掉的钱一件不少', () => {
    const p = useApp.getState().addPlayer('阿May', 'F')
    useApp.getState().setAvatarSex(p.id, 'f')
    // 手动塞一件「买过的」和一笔花销，模拟已经攒了家当
    useApp.setState((s) => ({
      avatars: s.avatars.map((a) =>
        a.playerId === p.id
          ? { ...a, owned: [...a.owned, 'ring-gold'], spent: 450 }
          : a,
      ),
    }))

    useApp.getState().updatePlayer(p.id, { gender: 'M' })
    const after = avatarOf(useApp.getState().avatars, p.id)!
    expect(after.sex).toBe('m')
    expect(after.owned).toContain('ring-gold')
    expect(after.spent).toBe(450)
  })

  it('只改名字不碰性别，角色不动', () => {
    const p = useApp.getState().addPlayer('小林', 'M')
    useApp.getState().setAvatarSex(p.id, 'm')
    const before = avatarOf(useApp.getState().avatars, p.id)

    useApp.getState().updatePlayer(p.id, { name: '小林子' })
    expect(avatarOf(useApp.getState().avatars, p.id)).toBe(before)
  })

  it('性别改成「不填」时角色保持原样 —— 没得推，不该乱换', () => {
    const p = useApp.getState().addPlayer('Kelly', 'F')
    useApp.getState().setAvatarSex(p.id, 'f')
    useApp.getState().updatePlayer(p.id, { gender: '-' })
    expect(avatarOf(useApp.getState().avatars, p.id)?.sex).toBe('f')
  })

  it('还没建角色的人改性别不会凭空造一个出来', () => {
    const p = useApp.getState().addPlayer('文杰', 'M')
    useApp.getState().updatePlayer(p.id, { gender: 'F' })
    expect(avatarOf(useApp.getState().avatars, p.id)).toBeUndefined()
  })
})

describe('本机绑定的「我是谁」', () => {
  it('不进备份 —— 备份恢复到别人手机上不该带着「我是谁」', () => {
    const p = useApp.getState().addPlayer('Yy', 'M')
    useApp.getState().setMeId(p.id)
    expect('meId' in useApp.getState().exportBackup()).toBe(false)
  })

  it('清空数据时一起解绑，不留下指着空气的绑定', () => {
    const p = useApp.getState().addPlayer('Yy', 'M')
    useApp.getState().setMeId(p.id)
    useApp.getState().resetAll()
    expect(useApp.getState().meId).toBeNull()
  })
})

describe('认领身份', () => {
  it('认领之后，球员身上记着是谁，meId 也跟着指过去', () => {
    const s = useApp.getState()
    const a = s.addPlayer('阿伟', 'M')
    useApp.getState().claimPlayer(a.id, 'uid-1')

    const after = useApp.getState()
    expect(after.players.find((p) => p.id === a.id)?.ownerId).toBe('uid-1')
    expect(after.meId).toBe(a.id)
  })

  /*
   * 一个账号只能是一个人。不松开旧的话，同一个账号会同时挂在
   * 两个球员身上，别人手机上看过去分不出哪个才是他。
   */
  it('同一个账号认领第二个人时，第一个自动松开', () => {
    const s = useApp.getState()
    const a = s.addPlayer('阿伟', 'M')
    const b = s.addPlayer('小林', 'M')
    useApp.getState().claimPlayer(a.id, 'uid-1')
    useApp.getState().claimPlayer(b.id, 'uid-1')

    const after = useApp.getState()
    expect(after.players.find((p) => p.id === a.id)?.ownerId).toBeNull()
    expect(after.players.find((p) => p.id === b.id)?.ownerId).toBe('uid-1')
    expect(after.meId).toBe(b.id)
  })

  it('别人认领的不受影响', () => {
    const s = useApp.getState()
    const a = s.addPlayer('阿伟', 'M')
    const b = s.addPlayer('小林', 'M')
    useApp.getState().claimPlayer(a.id, 'uid-1')
    useApp.getState().claimPlayer(b.id, 'uid-2')

    const after = useApp.getState()
    expect(after.players.find((p) => p.id === a.id)?.ownerId).toBe('uid-1')
    expect(after.players.find((p) => p.id === b.id)?.ownerId).toBe('uid-2')
  })

  it('代建的球员没有主，谁都能帮他记分', () => {
    const a = useApp.getState().addPlayer('不装 App 的球友', 'M')
    expect(useApp.getState().players.find((p) => p.id === a.id)?.ownerId).toBeUndefined()
  })
})

/*
 * 球局公开之后，加入是每个人自己点的 —— 而「自己点」意味着两台手机
 * 可能同时点、同步也会把同一条改动送回来。加两遍的后果不是多一行，
 * 是排场时这个人占两个位置。
 */
describe('自己加入别人开的球局', () => {
  const openOne = () => {
    const host = useApp.getState().addPlayer('阿伟', 'M')
    const s = useApp.getState().createSession({
      date: '2026-09-02',
      venue: '中央球馆',
      courtCount: 2,
      playerIds: [host.id],
      defaultType: 'doubles',
      createdBy: host.id,
    })
    return { host, s }
  }

  it('加进去之后就在名单里，而且记得是谁开的', () => {
    const { host, s } = openOne()
    const me = useApp.getState().addPlayer('小林', 'F')
    useApp.getState().joinSession(s.id, me.id)

    const after = useApp.getState().sessions.find((x) => x.id === s.id)!
    expect(after.playerIds).toEqual([host.id, me.id])
    expect(after.createdBy).toBe(host.id)
  })

  it('点两次只算一次', () => {
    const { s } = openOne()
    const me = useApp.getState().addPlayer('小林', 'F')
    useApp.getState().joinSession(s.id, me.id)
    useApp.getState().joinSession(s.id, me.id)

    const after = useApp.getState().sessions.find((x) => x.id === s.id)!
    expect(after.playerIds.filter((id) => id === me.id)).toHaveLength(1)
  })

  it('还没打过就能退出', () => {
    const { s } = openOne()
    const me = useApp.getState().addPlayer('小林', 'F')
    useApp.getState().joinSession(s.id, me.id)
    useApp.getState().leaveSession(s.id, me.id)

    expect(
      useApp.getState().sessions.find((x) => x.id === s.id)!.playerIds,
    ).not.toContain(me.id)
  })

  /*
   * 打过的人退不掉：他那几场比赛还在，退了之后那些记录就挂着一个
   * 不在名单里的人，排行榜和结算都会对不上。
   */
  it('已经打过球的人退不掉', () => {
    const { host, s } = openOne()
    const me = useApp.getState().addPlayer('小林', 'F')
    const c = useApp.getState().addPlayer('阿May', 'F')
    const d = useApp.getState().addPlayer('老陈', 'M')
    useApp.getState().joinSession(s.id, me.id)

    useApp.getState().addMatch({
      sessionId: s.id,
      type: 'doubles',
      teamA: [host.id, me.id],
      teamB: [c.id, d.id],
      games: [{ a: 21, b: 15, points: null, serveInit: null }],
      status: 'done',
      courtIndex: 0,
    })

    useApp.getState().leaveSession(s.id, me.id)
    expect(
      useApp.getState().sessions.find((x) => x.id === s.id)!.playerIds,
    ).toContain(me.id)
  })
})

/*
 * 人数上限必须在 store 里挡，不能只在界面上挡：界面那份是同步过来的
 * 数据算出来的，随时可能过时 —— 两台手机都看到「还剩 1 个位置」是常态。
 */
describe('球局的人数上限', () => {
  const openWithCap = (cap?: number) => {
    const host = useApp.getState().addPlayer('阿伟', 'M')
    const s = useApp.getState().createSession({
      date: '2026-09-02',
      venue: '中央球馆',
      courtCount: 1,
      playerIds: [host.id],
      defaultType: 'doubles',
      createdBy: host.id,
      maxPlayers: cap,
    })
    return s
  }
  const someone = (name: string) => useApp.getState().addPlayer(name, 'M').id

  it('没设上限就是不限，加多少个都行', () => {
    const s = openWithCap()
    for (const n of ['a', 'b', 'c', 'd', 'e']) {
      expect(useApp.getState().joinSession(s.id, someone(n))).toBe(true)
    }
    expect(useApp.getState().sessions[0].playerIds).toHaveLength(6)
  })

  it('满了就加不进来，而且明确返回 false', () => {
    const s = openWithCap(3)
    expect(useApp.getState().joinSession(s.id, someone('b'))).toBe(true)
    expect(useApp.getState().joinSession(s.id, someone('c'))).toBe(true)
    // 第 4 个人：满了
    expect(useApp.getState().joinSession(s.id, someone('d'))).toBe(false)
    expect(useApp.getState().sessions[0].playerIds).toHaveLength(3)
  })

  /*
   * 已经在里面的人再点一次不该被上限挡掉 —— 同步会把同一条改动
   * 送回来，那时候人数正好是满的，挡掉就等于报一次假的「已满」。
   */
  it('满了之后，已经在里面的人再加一次仍然算成功', () => {
    const s = openWithCap(2)
    const me = someone('b')
    expect(useApp.getState().joinSession(s.id, me)).toBe(true)
    expect(useApp.getState().joinSession(s.id, me)).toBe(true)
    expect(useApp.getState().sessions[0].playerIds).toHaveLength(2)
  })

  /*
   * 上限调小不该把人踢出去：他可能已经打了几场，
   * 踢出去那些记录就挂着一个不在名单里的人。
   */
  it('上限调小，已经在里面的人一个都不会掉', () => {
    const s = openWithCap(6)
    const ids = ['b', 'c', 'd'].map(someone)
    for (const id of ids) useApp.getState().joinSession(s.id, id)
    expect(useApp.getState().sessions[0].playerIds).toHaveLength(4)

    useApp.getState().updateSession(s.id, { maxPlayers: 2 })
    expect(useApp.getState().sessions[0].playerIds).toHaveLength(4)
    // 但新人再也进不来了
    expect(useApp.getState().joinSession(s.id, someone('e'))).toBe(false)
  })

  it('有人退出之后位置就空出来了', () => {
    const s = openWithCap(2)
    const b = someone('b')
    expect(useApp.getState().joinSession(s.id, b)).toBe(true)
    expect(useApp.getState().joinSession(s.id, someone('c'))).toBe(false)

    useApp.getState().leaveSession(s.id, b)
    expect(useApp.getState().joinSession(s.id, someone('d'))).toBe(true)
  })
})

/*
 * 这一组钉的是一个真实发生过的 bug：
 *
 * 在浏览器里注册、建了角色、加入了球局；换到主屏幕图标打开（iOS 上
 * 那是另一份存储）重新登录之后，自己的角色不见了 —— 球局里那个人
 * 明明还在。于是又建了一个，排名里出现两个同名的人，场次各算各的。
 *
 * 根因：meId 只存在设备本地，从云端拉回来的球员没有任何东西把它
 * 重新接上。ownerId 一直在球员身上、也一直同步着，只是没人读。
 */
describe('换设备之后认回自己', () => {
  /** 模拟「云端拉下来一批球员，本机的 meId 是空的」 */
  const arriveFromCloud = (players: ReturnType<typeof useApp.getState>['players']) =>
    useApp.setState({ players, meId: null })

  it('认得出挂着这个账号的那个人', () => {
    const me = useApp.getState().addPlayer('Yy1', 'M')
    useApp.getState().claimPlayer(me.id, 'uid-1')
    const cloud = useApp.getState().players

    arriveFromCloud(cloud)
    expect(useApp.getState().meId).toBeNull()

    useApp.getState().adoptMe('uid-1')
    expect(useApp.getState().meId).toBe(me.id)
  })

  it('没登录就认不出来，也不会乱认一个', () => {
    const me = useApp.getState().addPlayer('Yy1', 'M')
    useApp.getState().claimPlayer(me.id, 'uid-1')
    arriveFromCloud(useApp.getState().players)

    useApp.getState().adoptMe(null)
    expect(useApp.getState().meId).toBeNull()
  })

  it('别人的账号不会把我认走', () => {
    const a = useApp.getState().addPlayer('阿伟', 'M')
    useApp.getState().claimPlayer(a.id, 'uid-1')
    arriveFromCloud(useApp.getState().players)

    useApp.getState().adoptMe('uid-2')
    expect(useApp.getState().meId).toBeNull()
  })

  it('先建角色后登录的，顺手盖上章 —— 否则下次换设备照样认不回来', () => {
    const me = useApp.getState().addPlayer('Yy1', 'M')
    useApp.getState().setMeId(me.id)   // 没登录，只有本机标记
    expect(useApp.getState().players[0]?.ownerId).toBeUndefined()

    useApp.getState().adoptMe('uid-1')
    expect(useApp.getState().players[0]?.ownerId).toBe('uid-1')
    expect(useApp.getState().meId).toBe(me.id)
  })

  it('不抢别人已经盖过章的人', () => {
    const a = useApp.getState().addPlayer('阿伟', 'M')
    useApp.getState().claimPlayer(a.id, 'uid-1')
    useApp.setState({ meId: a.id })

    useApp.getState().adoptMe('uid-2')
    expect(useApp.getState().players.find((p) => p.id === a.id)?.ownerId).toBe('uid-1')
  })

  it('指着一个云端已经没有的人，就清掉 —— 别让界面拿着空指针', () => {
    useApp.setState({ players: [], meId: 'player-已经删了' })
    useApp.getState().adoptMe('uid-1')
    expect(useApp.getState().meId).toBeNull()
  })

  it('已经认对了就不动，重复拉云端不会来回改', () => {
    const me = useApp.getState().addPlayer('Yy1', 'M')
    useApp.getState().claimPlayer(me.id, 'uid-1')
    const before = useApp.getState().players

    useApp.getState().adoptMe('uid-1')
    expect(useApp.getState().meId).toBe(me.id)
    // 没有产生新的 players 数组 —— 不然每次拉云端都会推一次没意义的改动
    expect(useApp.getState().players).toBe(before)
  })
})
