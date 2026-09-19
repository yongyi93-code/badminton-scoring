import type { Player } from '@/types'

/* ------------------------------------------------------------------ *
 * 球群成员名单
 *
 * 「收起来」这件事的两条规矩，拎出来是因为它们**错了不会报错**：
 * 名单上少一个人、或者多一个本该消失的人，都只能靠人眼发现。
 * ------------------------------------------------------------------ */

/**
 * 分成「在打」和「不打了」两堆，各自按名字排。
 *
 * 按名字排不是随手挑的：这一屏是用来**找某一个人**的（「阿伟去哪了」），
 * 而按加入时间排的话，找人要从头扫到尾。排行榜那种按强弱排的地方
 * 回答的是另一个问题。
 */
export function splitRoster(players: Player[]): { active: Player[]; archived: Player[] } {
  const by = (a: Player, b: Player) => a.name.localeCompare(b.name, 'zh')
  return {
    active: players.filter((p) => !p.archived).sort(by),
    archived: players.filter((p) => p.archived).sort(by),
  }
}

/** 收不了的理由。null = 收得了 */
export type Blocker = 'self' | 'on-court'

/**
 * 现在能不能把这个人收起来。
 *
 * 只挡两种**按了会立刻出乱子**的，别的一概放行 —— 同群的人本来就能
 * 改彼此的比分（supabase/006-who-can-delete.sql），在这儿摆一道
 * 更严的门只是自欺。
 *
 * 1. **自己。** 把自己收起来，你会从自己球群的每一个名单里消失，
 *    而账号、球局、比分全都还在 —— 那不是任何人想要的结果。
 *    要离开有别的路（换球群、注销账号），这一条只是拦住误会。
 *
 * 2. **还在进行中的球局里。** 球局记的是 playerIds，不看这个标记，
 *    所以人照样在场上 —— 而名单里已经找不到他了。那一屏会变成
 *    「场上有个查不到的人」，比留着他难解释得多。
 */
export function archiveBlocker(
  player: Player,
  ctx: { meId: string | null; onCourt: Set<string> },
): Blocker | null {
  if (player.id === ctx.meId) return 'self'
  if (ctx.onCourt.has(player.id)) return 'on-court'
  return null
}
