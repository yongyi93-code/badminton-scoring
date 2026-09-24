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
export type Blocker = 'self' | 'on-court' | 'not-admin'

/**
 * 现在能不能把这个人收起来。
 *
 * 1. **不是管理员。** 收人是「改别人在这个群里的样子」，不是自己的事。
 *    原来谁都按得动 —— 一个群里十几个人，谁手滑都能把另一个人从
 *    所有名单里抹掉，而被抹掉的那个人不会收到任何通知。
 *
 *    **这一道拦的是手滑，不是坏人。** 同群的人本来就能改彼此的比分
 *    （supabase/006-who-can-delete.sql 那句「不是在删东西：随便改」），
 *    所以一个改过的客户端照样收得动 —— 真要拦死，要收紧的是整张
 *    records 的写入策略，不是这一个字段。这一点必须说在明处，
 *    不然它看起来像一道安全门，而它不是。
 *
 * 2. **自己。** 把自己收起来，你会从自己球群的每一个名单里消失，
 *    而账号、球局、比分全都还在 —— 那不是任何人想要的结果。
 *    要离开有别的路（换球群、注销账号），这一条只是拦住误会。
 *
 * 3. **还在进行中的球局里。** 球局记的是 playerIds，不看这个标记，
 *    所以人照样在场上 —— 而名单里已经找不到他了。那一屏会变成
 *    「场上有个查不到的人」，比留着他难解释得多。
 *
 * 顺序：先问「你有没有资格」，再问「这个人能不能收」。反过来的话，
 * 一个根本没资格的人会先被告知「他还在场上」—— 那句话对他毫无意义，
 * 而且泄露了一件他不该从这儿知道的事。
 */
export function archiveBlocker(
  player: Player,
  ctx: { meId: string | null; onCourt: Set<string>; isAdmin: boolean },
): Blocker | null {
  if (!ctx.isAdmin) return 'not-admin'
  if (player.id === ctx.meId) return 'self'
  if (ctx.onCourt.has(player.id)) return 'on-court'
  return null
}
