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

/** 连胜连败。2 场以下不算「连」，返回 null 让调用方别显示 */
export const streakLabel = (streak: number) => {
  if (streak >= 2) return lang() === 'zh' ? `${streak} 连胜` : `${streak} in a row`
  if (streak <= -2) return lang() === 'zh' ? `${-streak} 连败` : `${-streak} losses`
  return null
}
