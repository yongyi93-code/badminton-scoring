import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@/lib/i18n'
import {
  formatTime,
  nextHalfHour,
  shiftDays,
  toISODate,
  weekOf,
} from '@/lib/format'

/*
 * 球局有了「几点开打」，球局页有了一条按周走的日历。
 * 这两件事全靠下面这几个函数，而日期算错是那种界面上看不出来、
 * 到了月底才炸的错，所以钉死。
 */

afterEach(() => setLang('zh'))

describe('几点开打', () => {
  it('中文分早上晚上 —— 「8:30」在中文里天然有歧义', () => {
    setLang('zh')
    expect(formatTime('08:30')).toBe('早上 8:30')
    expect(formatTime('20:30')).toBe('晚上 8:30')
    expect(formatTime('12:15')).toBe('中午 12:15')
    expect(formatTime('14:00')).toBe('下午 2:00')
    expect(formatTime('01:05')).toBe('凌晨 1:05')
  })

  it('英文用 am/pm', () => {
    setLang('en')
    expect(formatTime('08:30')).toBe('8:30 am')
    expect(formatTime('20:30')).toBe('8:30 pm')
    expect(formatTime('00:00')).toBe('12:00 am')
    expect(formatTime('12:00')).toBe('12:00 pm')
  })

  it('拿不准的一律返回 null，让调用方自己决定不显示', () => {
    // 老球局没有这个字段，页面上不该冒出「undefined」之类的东西
    expect(formatTime(undefined)).toBeNull()
    expect(formatTime('')).toBeNull()
    expect(formatTime('晚上八点')).toBeNull()
    expect(formatTime('25:00')).toBeNull()
    expect(formatTime('12:99')).toBeNull()
  })

  it('默认时间取整到下一个半点 —— 球局本来就按半小时约', () => {
    expect(nextHalfHour(new Date(2026, 8, 10, 19, 0))).toBe('19:30')
    expect(nextHalfHour(new Date(2026, 8, 10, 19, 12))).toBe('19:30')
    expect(nextHalfHour(new Date(2026, 8, 10, 19, 30))).toBe('19:30')
    expect(nextHalfHour(new Date(2026, 8, 10, 19, 31))).toBe('20:00')
    // 跨零点也要对
    expect(nextHalfHour(new Date(2026, 8, 10, 23, 45))).toBe('00:00')
  })
})

describe('球局页那条日历', () => {
  it('一周从周一起头，到周日', () => {
    // 2026-09-10 是周四
    expect(weekOf('2026-09-10')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ])
  })

  it('周日属于它前面那一周，不是后面那一周', () => {
    /*
     * 这是这个函数最容易写错的地方：getDay() 里周日是 0，
     * 直接拿来当偏移量的话，周日会算成「这一周的第一天」，
     * 于是点周日看到的是下一周的七天 —— 而周日正是打球最多的一天。
     */
    expect(weekOf('2026-09-13')[0]).toBe('2026-09-07')
    expect(weekOf('2026-09-13')[6]).toBe('2026-09-13')
  })

  it('跨月跨年都连得上', () => {
    expect(weekOf('2026-10-01')).toContain('2026-09-28')
    expect(weekOf('2027-01-01')).toContain('2026-12-28')
  })

  it('往前往后翻', () => {
    expect(shiftDays('2026-09-10', 7)).toBe('2026-09-17')
    expect(shiftDays('2026-09-10', -7)).toBe('2026-09-03')
    expect(shiftDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('转成 ISO 用本地时区，不是 UTC', () => {
    /*
     * 用 toISOString().slice(0, 10) 的话，马来西亚（UTC+8）晚上八点开的局
     * 会被记成前一天 —— 而那正是羽球局最常见的时间。
     */
    expect(toISODate(new Date(2026, 8, 10, 20, 0))).toBe('2026-09-10')
    expect(toISODate(new Date(2026, 8, 10, 0, 30))).toBe('2026-09-10')
    expect(toISODate(new Date(2026, 8, 10, 23, 59))).toBe('2026-09-10')
  })
})
