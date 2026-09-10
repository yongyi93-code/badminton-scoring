import { lang, pick } from './i18n'

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export const todayISO = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 2026-08-10 → 「8月10日 周一」 / 「10 Aug, Mon」
 *
 * 没用 Intl.DateTimeFormat：它的输出跟着手机的地区设置走，
 * 同一个 App 里会一半中式一半美式。日期在这个 App 里是用来对暗号的
 * （「上周三那场」），格式必须两个人看到的一模一样。
 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const day = new Date(y, m - 1, d).getDay()
  return lang() === 'zh'
    ? `${m}月${d}日 ${WEEKDAYS_ZH[day]}`
    : `${d} ${MONTHS_EN[m - 1]}, ${WEEKDAYS_EN[day]}`
}

/** 一天的毫秒数 */
const DAY = 24 * 60 * 60 * 1000

/** Date → "yyyy-mm-dd"，按本地时区。不能用 toISOString()，那是 UTC */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "yyyy-mm-dd" → Date（本地当天零点） */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/**
 * 含某一天的那一周，周一到周日七个 "yyyy-mm-dd"。
 *
 * 从周一起头而不是周日：马来西亚和国内都是这么看日历的，
 * 而且羽球局大多在周中到周末，周一起头能把「这周还剩几天」看得更顺。
 */
export function weekOf(iso: string): string[] {
  const d = fromISODate(iso)
  // getDay() 周日是 0，换算成「周一是 0」
  const offset = (d.getDay() + 6) % 7
  const monday = new Date(d.getTime() - offset * DAY)
  return Array.from({ length: 7 }, (_, i) =>
    toISODate(new Date(monday.getTime() + i * DAY)),
  )
}

/** 往前 / 往后挪几天 */
export const shiftDays = (iso: string, days: number): string =>
  toISODate(new Date(fromISODate(iso).getTime() + days * DAY))

/** 星期几的短名，给日历那一条用 */
export function weekdayShort(iso: string): string {
  const day = fromISODate(iso).getDay()
  return lang() === 'zh' ? WEEKDAYS_ZH[day] : WEEKDAYS_EN[day].slice(0, 3).toUpperCase()
}

/**
 * 往后取整到下一个半点，"HH:mm"。
 *
 * 开局默认值用它：绝大多数时候开局就是「现在就开打」，那这一栏不用动。
 * 取整到半点而不是用当前的分钟数，是因为球局本来就是按半小时约的 ——
 * 「七点四十三分的局」不是一个人会写的东西。
 */
export function nextHalfHour(now = new Date()): string {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() <= 30 ? 30 : 60)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 几点：24 小时制的 "20:30" → 中文「晚上 8:30」/ 英文 "8:30 pm"。
 *
 * 中文分早上／中午／下午／晚上，因为「8:30」在中文里天然有歧义 ——
 * 羽球局早上八点半和晚上八点半都有人打。英文用 am/pm 就够，
 * 硬翻成 "evening 8:30" 反而没人这么说。
 *
 * 拿不准的输入（空的、格式不对）返回 null，让调用方自己决定不显示 ——
 * 返回原样字符串的话，页面上会冒出一个「undefined」之类的东西。
 */
export function formatTime(hhmm: string | undefined): string | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  const mm = String(m).padStart(2, '0')
  if (lang() !== 'zh') {
    const ampm = h < 12 ? 'am' : 'pm'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${mm} ${ampm}`
  }
  const part = h < 6 ? '凌晨' : h < 12 ? '早上' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${part} ${h12}:${mm}`
}

/** 带年份的完整日期 */
export function formatDateFull(iso: string): string {
  const [y] = iso.split('-').map(Number)
  if (!y) return iso
  return lang() === 'zh' ? `${y}年${formatDate(iso)}` : `${formatDate(iso)} ${y}`
}

/** 年月：2026-08 → 「2026 年 8 月」 / 「Aug 2026」 */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return lang() === 'zh' ? `${y} 年 ${m} 月` : `${MONTHS_EN[m - 1]} ${y}`
}

export const percent = (v: number) => `${Math.round(v * 100)}%`

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** 时长：毫秒 → 「23 分钟」 / 「23 min」 */
export function duration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 1) return pick('不到 1 分钟', 'under a minute')
  if (min < 60) return lang() === 'zh' ? `${min} 分钟` : `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return lang() === 'zh' ? `${h} 小时 ${rest} 分` : `${h}h ${rest}m`
}

/**
 * 连胜连败。2 场以下不算「连」，返回 null 让调用方别显示。
 *
 * 英文用 W3 / L3 这种战绩表写法，不是 3 in a row —— 这个标签永远
 * 挤在名字旁边的小胶囊里，写成一句话会把名字压到只剩一个字。
 */
export const streakLabel = (streak: number) => {
  if (streak >= 2) return lang() === 'zh' ? `${streak} 连胜` : `W${streak}`
  if (streak <= -2) return lang() === 'zh' ? `${-streak} 连败` : `L${-streak}`
  return null
}
