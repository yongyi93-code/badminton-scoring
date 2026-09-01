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
