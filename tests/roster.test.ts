import { describe, expect, it } from 'vitest'
import { archiveBlocker, splitRoster } from '@/lib/roster'
import type { Player } from '@/types'

/*
 * 「把不打了的人收起来」这两条规矩。
 *
 * 它们错了都**不会报错**：名单上少一个人、或者多一个本该消失的人，
 * 只能靠人眼发现 —— 而这一屏正是用来不靠人眼的。
 */

const player = (id: string, name: string, archived = false): Player => ({
  id,
  name,
  level: 3,
  gender: 'M',
  archived,
  createdAt: 0,
})

describe('分成两堆', () => {
  const list = [
    player('p3', '小林'),
    player('p1', '阿伟'),
    player('p2', '走了的', true),
    player('p4', 'Victor'),
  ]

  it('在打的和不打了的分开', () => {
    const { active, archived } = splitRoster(list)
    expect(active.map((p) => p.id).sort()).toEqual(['p1', 'p3', 'p4'])
    expect(archived.map((p) => p.id)).toEqual(['p2'])
  })

  /*
   * 按名字排，不按加入时间。
   *
   * 这一屏的用法是「阿伟去哪了」—— 找一个具体的人。按时间排的话
   * 每次都得从头扫到尾，而人数正是这一屏存在的原因。
   *
   * 断言的是**中文按拼音**（阿 在 小 前面），不是整串顺序：
   *   · 拼音才是中文名找人的排法。按码位排的话 小 在 阿 前面，
   *     所以这一条真的分得出「排了」和「没排」
   *   · 中文和拉丁字母谁在前，不同 Node / 浏览器的 ICU 可能不一样。
   *     钉死整串顺序的话，哪天 CI 换个版本就无缘无故变红，
   *     而那和这个功能一点关系都没有
   */
  it('中文名按拼音排，不是按码位', () => {
    const { active } = splitRoster(list)
    const names = active.map((p) => p.name)
    expect(names.indexOf('阿伟')).toBeLessThan(names.indexOf('小林'))
  })

  it('一个人都没有也不会炸', () => {
    expect(splitRoster([])).toEqual({ active: [], archived: [] })
  })

  /* 原来那份不能被改动：store 里那个数组是共享的 */
  it('不动传进来的那一份', () => {
    const before = list.map((p) => p.id)
    splitRoster(list)
    expect(list.map((p) => p.id)).toEqual(before)
  })
})

describe('什么时候收不了', () => {
  const ctx = (meId: string | null, onCourt: string[] = []) => ({
    meId,
    onCourt: new Set(onCourt),
  })

  it('一般情况收得了', () => {
    expect(archiveBlocker(player('p1', '阿伟'), ctx('p9'))).toBeNull()
  })

  /*
   * 把自己收起来，你会从自己球群的每一个名单里消失，而账号、球局、
   * 比分全都还在 —— 那不是任何人想要的结果。要离开有别的路。
   */
  it('自己收不了自己', () => {
    expect(archiveBlocker(player('p1', '我'), ctx('p1'))).toBe('self')
  })

  /*
   * 球局记的是 playerIds，不看这个标记 —— 收起来之后人照样在场上，
   * 而名单里已经查不到他了。那一屏会变成「场上有个查不到的人」。
   */
  it('还在进行中的球局里，收不了', () => {
    expect(archiveBlocker(player('p1', '阿伟'), ctx('p9', ['p1']))).toBe('on-court')
  })

  /* 打完的球局不算 —— 不然打过球的人永远收不起来，这个按钮等于没有 */
  it('只看进行中的局，打完的不算', () => {
    expect(archiveBlocker(player('p1', '阿伟'), ctx('p9', ['p2', 'p3']))).toBeNull()
  })

  /* 两条同时成立时先说「这是你自己」—— 那一条更根本，也更好懂 */
  it('既是自己又在场上，先说是自己', () => {
    expect(archiveBlocker(player('p1', '我'), ctx('p1', ['p1']))).toBe('self')
  })

  /* 没认领球员身份的设备上 meId 是空的，那时谁都不是「自己」 */
  it('没选过「我是谁」的时候不会把别人当成自己', () => {
    expect(archiveBlocker(player('p1', '阿伟'), ctx(null))).toBeNull()
  })
})
