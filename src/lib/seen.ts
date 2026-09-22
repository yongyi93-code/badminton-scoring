/* ------------------------------------------------------------------ *
 * Story 看过没看过
 *
 * 那一圈绿边说的是「这里有你还没看过的东西」。看完了就该灭掉 ——
 * 不灭的话那一排永远是满的，于是它什么都不说了，而「这一排在说什么」
 * 正是它唯一的价值。
 *
 * -------------------------------------------------------------------
 * 存在这台手机上，不存云端
 *
 * 云端存的话要另起一张表（谁看过哪一条）、一套策略、以及**每看一条
 * 就是一次写请求**。换来的好处只有一个：换台手机接着看，已经看过的
 * 还是灰的。
 *
 * 这个 App 里绝大多数人只有一台手机，而这件事错了的代价是「一个圈
 * 多亮了一会儿」—— 赔得起。所以这一版就放 localStorage。
 *
 * 代价写在明面上：换台手机，所有圈又都是亮的。以后真有人抱怨再说。
 *
 * -------------------------------------------------------------------
 * 退出登录要清掉
 *
 * 和签好的照片链接同一条理由（lib/moments 的 clearSignCache）：
 * 换一个人登录这台手机之后，他不该看到一排「已经看过」的圈 ——
 * 那是上一个人看的。
 * ------------------------------------------------------------------ */

export const SEEN_KEY = 'rally.stories.seen'

/**
 * 记多久。
 *
 * Story 本身 24 小时就没了，所以超过这个数的记录一定对应着一条
 * 早就不存在的动态 —— 留着只是占地方。给 48 小时的余量是因为
 * 手机的钟可能偏，而**多记一会儿没有坏处，少记会让圈重新亮起来**。
 */
export const SEEN_TTL_MS = 48 * 60 * 60 * 1000

/** 最多记多少条。上面那条已经够用了，这个是防手滑的第二道 */
export const SEEN_MAX = 500

/** 看过的那些：动态 id → 什么时候看的 */
export type SeenMap = Record<string, number>

/**
 * 扔掉过期的和多出来的。
 *
 * 纯函数，所以测得了 —— 这一块出错的样子是「记录越积越多，
 * 有一天 localStorage 满了，于是**整个存取都开始抛**」，
 * 而那会连带把别的功能一起带下水。
 */
export function prune(map: SeenMap, now: number, ttl = SEEN_TTL_MS, max = SEEN_MAX): SeenMap {
  const alive = Object.entries(map).filter(([, at]) => now - at < ttl)
  /* 还是太多就只留最近看的那几百条 */
  const kept = alive.length > max ? alive.sort((a, b) => b[1] - a[1]).slice(0, max) : alive
  return Object.fromEntries(kept)
}

/**
 * 这个人的那几条**是不是都看过了**。
 *
 * 全看过才算看过 —— 他今晚发了三条，你只看了第一条，那一圈还该亮着。
 * 这一条是 Instagram 的规矩，也是唯一说得通的：圈说的是「还有没看过
 * 的」，不是「你来过没有」。
 *
 * 一条都没有的时候返回 true（没有未读）—— 那种圈本来就不该出现。
 */
export function allSeen(items: { id: string }[], seen: SeenMap): boolean {
  return items.every((i) => i.id in seen)
}

/* ------------------------------------------------------------------ *
 * 存取那一层
 *
 * 每一处都包在 try 里：无痕窗口、关掉了站点数据、存满了，读和写都可能
 * 直接抛 —— 而这只是个「圈是绿的还是灰的」，挂了应该退回「都当没看过」，
 * 不是让整屏白掉。
 * ------------------------------------------------------------------ */

export function readSeen(now = Date.now()): SeenMap {
  try {
    const raw = globalThis.localStorage?.getItem(SEEN_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as SeenMap
    /* 读的时候顺手清一次：那是唯一保证它不会无限长的时机 */
    return prune(obj, now)
  } catch {
    return {}
  }
}

export function writeSeen(map: SeenMap): void {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(map))
  } catch {
    /* 存不下就算了 —— 下次进来那几个圈还是亮的，仅此而已 */
  }
}

/** 退出登录 / 注销账号时清掉（理由见文件开头） */
export function clearSeen(): void {
  try {
    globalThis.localStorage?.removeItem(SEEN_KEY)
  } catch {
    /* 清不掉也不拦着退出登录 */
  }
}
