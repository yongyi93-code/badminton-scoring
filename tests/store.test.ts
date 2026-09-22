import { beforeEach, describe, expect, it } from 'vitest'
import { useApp, avatarOf, activeSessionOf, lastActivityAt } from '@/store/useApp'
import type { SessionDraft } from '@/store/useApp'
import { shouldPublish } from '@/lib/openBoard'
import type { Session } from '@/types'

/** 一份能用的开局草稿，只写这一条测试关心的那几项 */
const draft = (patch: Partial<SessionDraft> = {}): SessionDraft => ({
  date: '2026-09-10',
  venue: '城中羽球馆',
  courtCount: 2,
  playerIds: [],
  defaultType: 'doubles',
  ...patch,
})

/*
 * store 的行为大多是「改一个字段，另一个字段得跟着动」，
 * 这种跨字段的联动最容易在改动别处时悄悄断掉，值得钉死。
 */

/**
 * 开一个球局，并且断言它真的开出来了。
 *
 * createSession 现在可能返回 null（一个人同一时间只能在一场里）。
 * 绝大多数用例不关心那条规矩，只是需要一个球局 —— 与其每处写一个 `!`，
 * 不如在这里一次说清楚：走这个口子的，就是「这一场一定开得出来」。
 * 真要测那条规矩的用例直接调 createSession，看它返不返回 null。
 */
const newSession = (
  draft: Parameters<ReturnType<typeof useApp.getState>['createSession']>[0],
) => {
  const s = useApp.getState().createSession(draft)
  if (!s) throw new Error('球局没开出来 —— 多半是这台设备已经在另一场里了')
  return s
}

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
    const s = newSession({
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
    const s = newSession({
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
      expect(useApp.getState().joinSession(s.id, someone(n))).toBe('joined')
    }
    expect(useApp.getState().sessions[0].playerIds).toHaveLength(6)
  })

  it('满了就加不进来，而且说得出是因为满了', () => {
    const s = openWithCap(3)
    expect(useApp.getState().joinSession(s.id, someone('b'))).toBe('joined')
    expect(useApp.getState().joinSession(s.id, someone('c'))).toBe('joined')
    // 第 4 个人：满了
    expect(useApp.getState().joinSession(s.id, someone('d'))).toBe('full')
    expect(useApp.getState().sessions[0].playerIds).toHaveLength(3)
  })

  /*
   * 已经在里面的人再点一次不该被上限挡掉 —— 同步会把同一条改动
   * 送回来，那时候人数正好是满的，挡掉就等于报一次假的「已满」。
   */
  it('满了之后，已经在里面的人再加一次仍然算成功', () => {
    const s = openWithCap(2)
    const me = someone('b')
    expect(useApp.getState().joinSession(s.id, me)).toBe('joined')
    expect(useApp.getState().joinSession(s.id, me)).toBe('joined')
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
    expect(useApp.getState().joinSession(s.id, someone('e'))).toBe('full')
  })

  it('有人退出之后位置就空出来了', () => {
    const s = openWithCap(2)
    const b = someone('b')
    expect(useApp.getState().joinSession(s.id, b)).toBe('joined')
    expect(useApp.getState().joinSession(s.id, someone('c'))).toBe('full')

    useApp.getState().leaveSession(s.id, b)
    expect(useApp.getState().joinSession(s.id, someone('d'))).toBe('joined')
  })
})

/*
 * 审批制：开局的人点头，别人才进得来。
 *
 * 这一套最要紧的一条是「队列不是名单」—— 排场、休息轮次、AA 分账
 * 全都读 playerIds，一个还没被批准的人只要漏进了那一栏，
 * 他当晚就会被排上场。
 */
describe('要开局的人通过才能加入', () => {
  const someone = (name: string) => useApp.getState().addPlayer(name, 'M').id
  const openApproved = (patch: Partial<SessionDraft> = {}) => {
    const host = useApp.getState().addPlayer('阿伟', 'M')
    const s = newSession(
      draft({ playerIds: [host.id], createdBy: host.id, approval: true, ...patch }),
    )
    return { host, s }
  }

  it('点加入只是递申请，人没进名单', () => {
    const { host, s } = openApproved()
    const me = someone('小林')
    expect(useApp.getState().joinSession(s.id, me)).toBe('requested')

    const after = useApp.getState().sessions.find((x) => x.id === s.id)!
    expect(after.playerIds).toEqual([host.id])
    expect(after.pendingIds).toEqual([me])
  })

  it('还在队列里的人不算「在一场球局里」—— 他还能去加别的局', () => {
    const { s } = openApproved()
    const me = someone('小林')
    useApp.getState().joinSession(s.id, me)

    const other = newSession(draft({ venue: '另一个馆', playerIds: [] }))
    expect(useApp.getState().joinSession(other.id, me)).toBe('joined')
  })

  it('再点一次不会排两遍，返回的是「还在等」', () => {
    const { s } = openApproved()
    const me = someone('小林')
    useApp.getState().joinSession(s.id, me)
    expect(useApp.getState().joinSession(s.id, me)).toBe('waiting')
    expect(useApp.getState().sessions.find((x) => x.id === s.id)!.pendingIds).toEqual([me])
  })

  it('通过之后进名单，队列里也就没他了', () => {
    const { host, s } = openApproved()
    const me = someone('小林')
    useApp.getState().joinSession(s.id, me)
    expect(useApp.getState().approveJoin(s.id, me)).toBe('joined')

    const after = useApp.getState().sessions.find((x) => x.id === s.id)!
    expect(after.playerIds).toEqual([host.id, me])
    expect(after.pendingIds).toEqual([])
  })

  it('不通过就是从队列里拿掉，名单一个字不动', () => {
    const { host, s } = openApproved()
    const me = someone('小林')
    useApp.getState().joinSession(s.id, me)
    useApp.getState().rejectJoin(s.id, me)

    const after = useApp.getState().sessions.find((x) => x.id === s.id)!
    expect(after.playerIds).toEqual([host.id])
    expect(after.pendingIds).toEqual([])
  })

  /*
   * 队列里的人可能排了半小时 —— 这中间位置被别人占满了。
   * 批准那一刻不重判的话，开局的人点一下「通过」就超员了。
   */
  it('等的时候位置被占满了，通过不了', () => {
    const { s } = openApproved({ maxPlayers: 2 })
    const me = someone('小林')
    useApp.getState().joinSession(s.id, me)

    const other = someone('阿May')
    useApp.getState().approveJoin(s.id, other) // 直接放行，把最后一个位置占掉
    expect(useApp.getState().approveJoin(s.id, me)).toBe('full')
    expect(useApp.getState().sessions.find((x) => x.id === s.id)!.playerIds).toHaveLength(2)
  })

  it('等的时候他自己进了别的局，通过不了', () => {
    const { s } = openApproved()
    const me = someone('小林')
    useApp.getState().joinSession(s.id, me)

    const other = newSession(draft({ venue: '另一个馆', playerIds: [] }))
    useApp.getState().joinSession(other.id, me)

    expect(useApp.getState().approveJoin(s.id, me)).toBe('busy')
    expect(useApp.getState().sessions.find((x) => x.id === s.id)!.playerIds).not.toContain(me)
  })

  /*
   * 开局的人不用批自己。他可能开完局才把自己加进名单
   * （先替朋友开的那种），排队等自己点头就很荒唐。
   */
  it('开局的人自己不用排队', () => {
    const host = useApp.getState().addPlayer('阿伟', 'M')
    const s = newSession(draft({ playerIds: [], createdBy: host.id, approval: true }))
    expect(useApp.getState().joinSession(s.id, host.id)).toBe('joined')
  })

  it('没开审批的局照旧点了就进', () => {
    const host = useApp.getState().addPlayer('阿伟', 'M')
    const s = newSession(draft({ playerIds: [host.id], createdBy: host.id }))
    const me = someone('小林')
    expect(useApp.getState().joinSession(s.id, me)).toBe('joined')
    expect(useApp.getState().sessions.find((x) => x.id === s.id)!.pendingIds).toBeUndefined()
  })
})

describe('开局的人把人请出去', () => {
  const someone = (name: string) => useApp.getState().addPlayer(name, 'M').id
  const openOne = () => {
    const host = useApp.getState().addPlayer('阿伟', 'M')
    const s = newSession(draft({ playerIds: [host.id], createdBy: host.id }))
    return { host, s }
  }

  it('还没打过球的人踢得掉', () => {
    const { host, s } = openOne()
    const me = someone('小林')
    useApp.getState().joinSession(s.id, me)

    expect(useApp.getState().kickPlayer(s.id, me)).toBe(true)
    expect(useApp.getState().sessions.find((x) => x.id === s.id)!.playerIds).toEqual([host.id])
  })

  /*
   * 打过球的踢不掉，和「自己退出」同一条规矩：他那几场比赛还在，
   * 人从名单上没了，排行榜和 AA 分账就会挂着一个不在名单里的人。
   */
  it('打过球的人踢不掉', () => {
    const { host, s } = openOne()
    const me = someone('小林')
    const c = someone('阿May')
    const d = someone('老陈')
    useApp.getState().joinSession(s.id, me)
    useApp.getState().addMatch({
      sessionId: s.id,
      type: 'doubles',
      teamA: [host.id, me],
      teamB: [c, d],
      games: [{ a: 21, b: 15, points: null, serveInit: null }],
      status: 'done',
      courtIndex: 0,
    })

    expect(useApp.getState().kickPlayer(s.id, me)).toBe(false)
    expect(useApp.getState().sessions.find((x) => x.id === s.id)!.playerIds).toContain(me)
  })

  /*
   * 开局的人踢不掉自己。要走得用「退出」那条路 —— 那条会把局
   * 一并处理掉，而这条不会，结果是一场没有主的局挂在所有人首页上。
   */
  it('开局的人踢不掉自己', () => {
    const { host, s } = openOne()
    expect(useApp.getState().kickPlayer(s.id, host.id)).toBe(false)
    expect(useApp.getState().sessions.find((x) => x.id === s.id)!.playerIds).toContain(host.id)
  })

  it('踢掉的人身上的「先休息」标记也一起清掉', () => {
    const { s } = openOne()
    const me = someone('小林')
    useApp.getState().joinSession(s.id, me)
    useApp.getState().updateSession(s.id, { restingIds: [me] })

    useApp.getState().kickPlayer(s.id, me)
    expect(useApp.getState().sessions.find((x) => x.id === s.id)!.restingIds).not.toContain(me)
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

/*
 * 一个人同一时间只能在一场球局里。
 *
 * 真实发生过的样子：在首页加入了 A 局，又看到 B 局也加了进去。首页
 * 只显示「我不在里面的局」，所以那一屏上看不出他已经在 A 里；而
 * 「我的」那页的最近球局把两场都列了出来。两个界面各说各话，根子在
 * store 从来没挡过这件事。
 */
describe('同一时间只能在一场球局里', () => {
  const openAt = (venue: string, host: string) =>
    newSession({
      date: '2026-09-03',
      venue,
      courtCount: 1,
      playerIds: [host],
      defaultType: 'doubles',
      createdBy: host,
    })

  it('已经在一场里，就加不进另一场', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const a = openAt('城中羽球馆', 'host-a')
    const b = openAt('力天羽球馆', 'host-b')

    expect(useApp.getState().joinSession(a.id, me.id)).toBe('joined')
    expect(useApp.getState().joinSession(b.id, me.id)).toBe('busy')

    const after = useApp.getState().sessions
    expect(after.find((s) => s.id === a.id)!.playerIds).toContain(me.id)
    expect(after.find((s) => s.id === b.id)!.playerIds).not.toContain(me.id)
  })

  it('退出之后就能加另一场了', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const a = openAt('城中羽球馆', 'host-a')
    const b = openAt('力天羽球馆', 'host-b')

    useApp.getState().joinSession(a.id, me.id)
    useApp.getState().leaveSession(a.id, me.id)
    expect(useApp.getState().joinSession(b.id, me.id)).toBe('joined')
  })

  it('上一场结束了也能加新的', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const a = openAt('城中羽球馆', 'host-a')
    const b = openAt('力天羽球馆', 'host-b')

    useApp.getState().joinSession(a.id, me.id)
    useApp.getState().endSession(a.id)
    expect(useApp.getState().joinSession(b.id, me.id)).toBe('joined')
  })

  /* 幂等不能被这条挡掉：同步把同一条改动送回来时会再调一次 */
  it('重复加入自己已经在的那一场，仍然算成功', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const a = openAt('城中羽球馆', 'host-a')

    expect(useApp.getState().joinSession(a.id, me.id)).toBe('joined')
    expect(useApp.getState().joinSession(a.id, me.id)).toBe('joined')
  })

  it('activeSessionOf 找得出他在哪一场', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const a = openAt('城中羽球馆', 'host-a')
    useApp.getState().joinSession(a.id, me.id)

    expect(activeSessionOf(useApp.getState().sessions, me.id)?.id).toBe(a.id)
    expect(activeSessionOf(useApp.getState().sessions, '不存在的人')).toBeUndefined()
    expect(activeSessionOf(useApp.getState().sessions, null)).toBeUndefined()
  })
})

/*
 * 消息是「有人说的」那一半 —— 六点半改去力天、我迟到十分钟，这类事
 * 算不出来，只能有人发。它跟着球局走：在局内发，只有这一局的人看得见。
 */
describe('局内消息', () => {
  it('发出去之后带着作者、时间和球局', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const s = newSession(draft({ playerIds: [me.id] }))
    const a = useApp.getState().postAnnouncement('我迟到十分钟', me.id, s.id)

    expect(a).not.toBeNull()
    expect(a!.authorId).toBe(me.id)
    expect(a!.text).toBe('我迟到十分钟')
    expect(a!.sessionId).toBe(s.id)
    expect(useApp.getState().announcements).toHaveLength(1)
  })

  it('没有球局就发不出去 —— 那样的消息没有收信人', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    expect(useApp.getState().postAnnouncement('随便说说', me.id, '')).toBeNull()
    expect(useApp.getState().announcements).toHaveLength(0)
  })

  it('空白的不发 —— 否则手滑就会冒出一条空消息', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const s = newSession(draft({ playerIds: [me.id] }))
    expect(useApp.getState().postAnnouncement('   ', me.id, s.id)).toBeNull()
    expect(useApp.getState().announcements).toHaveLength(0)
  })

  it('前后空白去掉', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const s = newSession(draft({ playerIds: [me.id] }))
    expect(
      useApp.getState().postAnnouncement('  记得带球  ', me.id, s.id)!.text,
    ).toBe('记得带球')
  })

  it('两场球局的消息各归各的', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const s1 = newSession(draft({ playerIds: [me.id] }))
    useApp.getState().endSession(s1.id)
    const s2 = newSession(draft({ playerIds: [me.id] }))
    useApp.getState().postAnnouncement('一号局的事', me.id, s1.id)
    useApp.getState().postAnnouncement('二号局的事', me.id, s2.id)

    const all = useApp.getState().announcements
    expect(all.filter((a) => a.sessionId === s1.id).map((a) => a.text)).toEqual(['一号局的事'])
    expect(all.filter((a) => a.sessionId === s2.id).map((a) => a.text)).toEqual(['二号局的事'])
  })

  it('撤得掉', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const s = newSession(draft({ playerIds: [me.id] }))
    const a = useApp.getState().postAnnouncement('下周暂停', me.id, s.id)!
    useApp.getState().deleteAnnouncement(a.id)
    expect(useApp.getState().announcements).toHaveLength(0)
  })

  it('清空数据时一起清掉', () => {
    const me = useApp.getState().addPlayer('Yy', 'M')
    const s = newSession(draft({ playerIds: [me.id] }))
    useApp.getState().postAnnouncement('测试', me.id, s.id)
    useApp.getState().resetAll()
    expect(useApp.getState().announcements).toEqual([])
  })
})

/*
 * 一个人同一时间只能在一场球局里。
 *
 * 加入别人的局早就是这条规矩了，开自己的局却一直没拦 —— 于是同一个人
 * 能挂着五个「进行中」，首页上五条都在，别人根本分不出该进哪个。
 */
describe('一个人只能开一个局', () => {
  it('已经在一场里就开不了新的', () => {
    const me = useApp.getState().addPlayer('阿明', 'M')
    useApp.getState().setMeId(me.id)
    const first = useApp.getState().createSession(draft({ playerIds: [me.id] }))
    expect(first).not.toBeNull()

    const second = useApp.getState().createSession(draft({ playerIds: [me.id] }))
    expect(second).toBeNull()
    expect(useApp.getState().sessions).toHaveLength(1)
  })

  it('把手上那一场结束了就能开新的', () => {
    const me = useApp.getState().addPlayer('阿明', 'M')
    useApp.getState().setMeId(me.id)
    const first = useApp.getState().createSession(draft({ playerIds: [me.id] }))!
    useApp.getState().endSession(first.id)

    expect(useApp.getState().createSession(draft({ playerIds: [me.id] }))).not.toBeNull()
    expect(useApp.getState().sessions).toHaveLength(2)
  })

  it('被人拉进别人的局里也算「在一场里」', () => {
    /*
     * 按 meId 判，不是按「我建的局」：他被拉进别人的局之后再开一个新的，
     * 同样是两头顾不上，首页上照样两条都在。
     */
    const host = useApp.getState().addPlayer('阿伟', 'M')
    const me = useApp.getState().addPlayer('阿明', 'M')
    useApp.getState().setMeId(me.id)
    useApp.getState().createSession(draft({ playerIds: [host.id] }))
    // 我不是开局的人，但我在里面
    const theirs = useApp.getState().sessions[0]
    useApp.getState().joinSession(theirs.id, me.id)

    expect(useApp.getState().createSession(draft({ playerIds: [me.id] }))).toBeNull()
  })

  it('还没建自己的球员时不拦 —— 那时候「我」是谁都不知道', () => {
    /*
     * meId 是空的（刚进群、还没填名字）。这时候拦不住也不该拦：
     * 拦了的话第一个进群的人连第一场球局都开不了。
     */
    const other = useApp.getState().addPlayer('阿伟', 'M')
    useApp.getState().createSession(draft({ playerIds: [other.id] }))
    expect(useApp.getState().createSession(draft({ playerIds: [other.id] }))).not.toBeNull()
  })
})

describe('球局几点开打', () => {
  it('开局时填的时间存了下来', () => {
    const s = newSession(draft({ time: '20:30' }))
    expect(s.time).toBe('20:30')
  })

  it('没填时间也开得了局 —— 老球局就是这样的', () => {
    const s = newSession(draft({}))
    expect(s.time).toBeUndefined()
    expect(s.status).toBe('active')
  })
})

/*
 * 首页要判断「这一局是不是已经散了」—— 球局要靠人按「结束」才收摊，
 * 而没人记得按。
 *
 * 关键是从哪儿开始算：第一版按开局时间算，后果是一场从傍晚打到第二天
 * 早上的长局，会在还在打的时候从首页消失 —— 而首页正是别人找它加入
 * 的地方。改成按最后一场比赛算。
 */
describe('一局最后一次有动静', () => {
  const HOUR = 3600_000
  const T0 = 1_700_000_000_000

  const sess = (over: Partial<import('@/types').Session> = {}) =>
    ({
      id: 's1',
      date: '2026-09-03',
      venue: '力天',
      courtCount: 1,
      playerIds: [],
      defaultType: 'doubles' as const,
      rules: { pointsToWin: 21, winBy2: true, cap: 30, bestOf: 1 as const },
      fee: { courtFee: 0, shuttleCount: 0, shuttleUnitPrice: 0, paidPlayerIds: [] },
      status: 'active' as const,
      createdAt: T0,
      ...over,
    }) as import('@/types').Session

  const m = (over: Partial<import('@/types').Match>) =>
    ({
      id: 'm1',
      sessionId: 's1',
      courtIndex: 0,
      type: 'doubles' as const,
      teamA: ['a'],
      teamB: ['b'],
      games: [],
      status: 'done' as const,
      seq: 1,
      ...over,
    }) as import('@/types').Match

  it('一场比赛都没有，就是开局时间', () => {
    expect(lastActivityAt(sess(), [])).toBe(T0)
  })

  it('取最后打完的那一场', () => {
    const ms = [
      m({ id: 'm1', endedAt: T0 + 2 * HOUR }),
      m({ id: 'm2', endedAt: T0 + 5 * HOUR }),
    ]
    expect(lastActivityAt(sess(), ms)).toBe(T0 + 5 * HOUR)
  })

  /*
   * 还在打的场次没有 endedAt。只看 endedAt 的话，一场正打得火热的
   * 球局会被算成「从开局起就没动静」，然后从首页消失。
   */
  it('正在打的场次也算动静（它没有 endedAt）', () => {
    const ms = [m({ id: 'm1', status: 'playing', startedAt: T0 + 9 * HOUR, endedAt: undefined })]
    expect(lastActivityAt(sess(), ms)).toBe(T0 + 9 * HOUR)
  })

  it('别的球局的比赛不算数', () => {
    const ms = [m({ id: 'm1', sessionId: '别的局', endedAt: T0 + 99 * HOUR })]
    expect(lastActivityAt(sess(), ms)).toBe(T0)
  })

  /* 这条就是那个 bug：按开局算它会被判死，按最后活动算它还活着 */
  it('打了 14 小时的长局，最后一场刚打完，仍然算活的', () => {
    const ms = [m({ id: 'm1', endedAt: T0 + 14 * HOUR })]
    const last = lastActivityAt(sess(), ms)
    const cutoff = T0 + 14 * HOUR - 12 * HOUR
    expect(last).toBeGreaterThanOrEqual(cutoff)
    // 而按开局时间算的话，早就被判成散了
    expect(T0).toBeLessThan(cutoff)
  })
})

/* ------------------------------------------------------------------ *
 * 私人局：勾了就不该出现在全 App 那张公开列表上
 *
 * 这一段钉的是**整条链**，不是某一个函数：开局那一屏那个开关
 * （SessionSetup 里的 isPrivate）→ 草稿上的 private → 存进 store 的
 * Session.private → shouldPublish 的答案。
 *
 * 分开测的话，每一节都绿，而链子在任何一个接头断掉都表现成同一件事：
 * **一场本想只给自己人看的局出现在了所有人的列表上**。那是这个功能
 * 里唯一一种赔不起的错 —— 公开出去就收不回来了（别人已经看到了）。
 * ------------------------------------------------------------------ */
describe('私人局不发布', () => {
  const now = Date.parse('2026-09-22T20:00:00Z')
  /* 「刚刚还有人在打」的那个样子。私人那一条要单独扛得住，所以其余两条都给成「该发布」 */
  const fresh = { lastActivity: now - 60_000, now }

  it('勾了「私人局」的，一场都不发布', () => {
    /* SessionSetup 传的正是这个形状：private: isPrivate || undefined */
    const s = newSession(draft({ private: true }))
    expect(s.private).toBe(true)
    expect(shouldPublish(s, fresh)).toBe(false)
  })

  /*
   * 没勾的时候传的是 undefined，不是 false —— 那是 `isPrivate || undefined`
   * 的结果。这一条钉住「字段不在」和「字段是 false」在这里是同一个意思，
   * 不然改成 `?? false` 之类的写法会让默认值悄悄翻面。
   */
  it('没勾的照常发布，而且字段根本不写进去', () => {
    const s = newSession(draft({ private: undefined }))
    expect(s.private).toBeUndefined()
    expect(shouldPublish(s, fresh)).toBe(true)
  })

  /* 老球局（这个字段出现之前开的）也是公开 —— 和上面那条是同一件事 */
  it('压根没提过这个字段的，当公开', () => {
    const s = newSession(draft())
    expect('private' in s ? s.private : undefined).toBeUndefined()
    expect(shouldPublish(s, fresh)).toBe(true)
  })

  /*
   * 私人 + 已结束 + 早就没动静，三条都不满足也还是不发布 ——
   * 这条防的是「三个条件写成 or」那种改法：那样任何一条成立就发布，
   * 而私人局会跟着漏出去。
   */
  it('私人这一条单独就够把它挡下来', () => {
    const s = newSession(draft({ private: true }))
    /* 其余两条全是「该发布」的样子 */
    expect(s.status).toBe('active')
    expect(shouldPublish(s, { lastActivity: now, now })).toBe(false)
  })

  /* 结束了的局也不发布，私人不私人都一样 */
  it('结束了就不发布', () => {
    const s = newSession(draft())
    useApp.getState().endSession(s.id)
    const ended = useApp.getState().sessions.find((x) => x.id === s.id)!
    expect(shouldPublish(ended, fresh)).toBe(false)
  })

  /*
   * 私人这件事**同步之后还得是私人**。
   *
   * 球局是整个对象存进云端那张 records 表的 JSONB 里的，所以理论上
   * 每个字段都在。但「理论上都在」正是最该验一次的那种话：漏掉这一个
   * 字段的后果是，换一台手机登录之后那场私人局被当成公开的发出去。
   */
  it('转成同步用的那份再读回来，还是私人的', () => {
    const s = newSession(draft({ private: true }))
    const roundTripped = JSON.parse(JSON.stringify(s)) as Session
    expect(roundTripped.private).toBe(true)
    expect(shouldPublish(roundTripped, fresh)).toBe(false)
  })
})
