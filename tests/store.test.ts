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

  it('松开之后变成无主，别人可以认领', () => {
    const s = useApp.getState()
    const a = s.addPlayer('阿伟', 'M')
    useApp.getState().claimPlayer(a.id, 'uid-1')
    useApp.getState().releasePlayer('uid-1')

    expect(useApp.getState().players.find((p) => p.id === a.id)?.ownerId).toBeNull()
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
