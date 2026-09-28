/* ------------------------------------------------------------------ *
 * 报名名单上的那些行
 *
 * 就是一堆输入框，本来不值得单开一个文件。开了是因为这里已经出过
 * 两次错，而两次都不是「写错一个字」那种，是**人被卡住了**：
 *
 *   第一次：种子框盖住名字框，打字看不见
 *   第二次：删掉底下那行空的之后，再也加不了人
 *
 * 第二次那个尤其阴：屏幕上一切正常，一张填得好好的名单，
 * 只是**没有任何东西告诉你还能再加**，而那条路真的已经没了。
 *
 * 所以这里把规矩写成一句能测的话：
 *
 *   **底下永远有一行空的等着填。**
 *
 * 下面每个函数都只为这一句服务，而测试直接钉这一句 ——
 * 不管怎么加、怎么删、怎么点，最后总有地方写下一个名字。
 * ------------------------------------------------------------------ */

export type EntryRow = {
  /**
   * 这一行的身份，从生出来那一刻就定了，改名字不会变。
   *
   * 有了它，「把名字打错了回去改」才不用把整张赛表推倒重排：
   * 赛表上每一格记的是这个 id，名字只是贴在上面的标签。
   */
  id: string
  /** 单打就这一个名字；双打是队员一 */
  a: string
  /** 双打的队员二。单打时一直是空的 */
  b: string
  /** 种子号，没标就是空字符串 */
  seed: string
}

const newRowId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/**
 * 一行新的。
 *
 * 每叫一次都是一个新 id —— 这一处是有意不纯的，因为「这一行是谁」
 * 必须在它出现的那一刻就定下来，不能等到读的时候再算（那样每次
 * 重绘都会换一个身份，改个名字就成了换个人）。
 */
export const emptyRow = (): EntryRow => ({ id: newRowId(), a: '', b: '', seed: '' })

/** 这一行一个字都没有 —— 它不算一队 */
export const isBlank = (r: EntryRow): boolean => !r.a && !r.b && !r.seed

const lastOf = (rows: EntryRow[]) => rows[rows.length - 1]

/** 底下有没有一行空的等着填。这个文件存在的全部意义 */
export const hasRoom = (rows: EntryRow[]): boolean =>
  rows.length > 0 && isBlank(lastOf(rows))

/**
 * 在第 i 行打了字之后，看要不要自动再给一行。
 *
 * 报名是「一口气录二十个人」那种活，每录一个还要先点一次「加一队」，
 * 那二十次点击全是白费的。所以打到最后一行就自动续 ——
 * 但这只是**省事的那条路**，不是唯一的路（见 addRow）。
 */
export function ensureTail(rows: EntryRow[], i: number): EntryRow[] {
  return i === rows.length - 1 ? [...rows, emptyRow()] : rows
}

/**
 * 明着加一行。
 *
 * 承诺的是「按完底下有地方填」，不是「行数加一」—— 所以底下already
 * 空着的时候什么都不做。再加一行只会在名单中间留下一串空行。
 */
export function addRow(rows: EntryRow[]): EntryRow[] {
  return hasRoom(rows) ? rows : [...rows, emptyRow()]
}

/**
 * 这一行能不能删。
 *
 * 最后那行空的不能删 —— 它就是「还能再加一个」这件事本身。
 * 删掉它，自动续行再也不会触发（那只在「打到最后一行」时发生，
 * 而剩下的行全填满了），人就被卡死在一张满名单上。
 *
 * 就算现在有了 addRow 兜底，一个删了等于给自己挖坑的按钮也不该摆出来。
 */
export function canRemove(rows: EntryRow[], i: number): boolean {
  if (rows.length <= 1) return false
  return !(isBlank(rows[i]) && i === rows.length - 1)
}

/** 删掉一行。删不得的那一行原样返回 —— 挡在这里，不指望调用方记得 */
export function dropRow(rows: EntryRow[], i: number): EntryRow[] {
  if (!canRemove(rows, i)) return rows
  return rows.filter((_, k) => k !== i)
}

/** 真正填了东西的那几行。空行是给人继续打字用的，不该算进人数 */
export function filledRows(rows: EntryRow[], doubles: boolean): EntryRow[] {
  return rows.filter((r) => r.a.trim() || (doubles && r.b.trim()))
}
