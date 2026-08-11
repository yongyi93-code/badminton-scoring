const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export const todayISO = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 2026-08-10 → 8月10日 周一 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(y, m - 1, d)
  return `${m}月${d}日 ${WEEKDAYS[date.getDay()]}`
}

/** 2026-08-10 → 2026年8月10日 周一 */
export function formatDateFull(iso: string): string {
  const [y] = iso.split('-').map(Number)
  return `${y}年${formatDate(iso)}`
}

export const percent = (v: number) => `${Math.round(v * 100)}%`

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** 时长：毫秒 → "23 分钟" */
export function duration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 1) return '不到 1 分钟'
  if (min < 60) return `${min} 分钟`
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`
}

export const streakLabel = (streak: number) => {
  if (streak >= 2) return `${streak} 连胜`
  if (streak <= -2) return `${-streak} 连败`
  return null
}
