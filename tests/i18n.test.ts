import { afterEach, describe, expect, it } from 'vitest'
import { lang, pick, setLang } from '@/lib/i18n'
import {
  itemName,
  PET_LEVELS,
  SHOP_ITEMS,
  SLOT_LABELS,
  tierName,
  AVATAR_SEXES,
} from '@/lib/avatar'
import { DRESS_ITEMS } from '@/lib/dressup'
import { STAGES, stageName } from '@/lib/avatarArt'
import { formatDate, formatMonth, streakLabel } from '@/lib/format'
import { FORMAT_LABELS, PAIRING_MODE_HINTS, PAIRING_MODE_LABELS } from '@/types'
import { PERIOD_LABELS } from '@/lib/ranking'

afterEach(() => setLang('zh'))

/*
 * 这一组测的是同一个坑：文案表是模块级常量，求值发生在 initLang() 之前。
 * 表里要是直接写 pick('中文', 'English')，那一刻语言还是默认值，
 * 名字就被冻成中文了 —— 界面切成英文也不会变，而且 TypeScript 不会报。
 * 所以表里只许存 [中文, English] 两元组，取的时候才挑。
 */
describe('文案表不能在模块加载时就把语言定死', () => {
  const bilingual = (get: () => string) => {
    setLang('zh')
    const zh = get()
    setLang('en')
    const en = get()
    return { zh, en }
  }

  it('商店的每一件都能跟着语言变', () => {
    for (const item of SHOP_ITEMS) {
      const { zh, en } = bilingual(() => itemName(item))
      expect(zh, `${item.id} 中文名是空的`).toBeTruthy()
      expect(en, `${item.id} 英文名是空的`).toBeTruthy()
      expect(en, `${item.id} 切成英文之后还是中文`).not.toMatch(/[一-鿿]/)
    }
  })

  it('分层换装那 88 件也一样', () => {
    expect(DRESS_ITEMS.length).toBeGreaterThan(0)
    for (const item of DRESS_ITEMS) {
      const { zh, en } = bilingual(() => itemName(item))
      expect(zh, `${item.id} 中文名是空的`).toBeTruthy()
      expect(en, `${item.id} 切成英文之后还是中文`).not.toMatch(/[一-鿿]/)
    }
  })

  it('段位：中文界面「Herald 先锋」，英文界面只留 Herald', () => {
    const { zh, en } = bilingual(() => tierName(PET_LEVELS[0]))
    expect(zh).toBe('Herald 先锋')
    expect(en).toBe('Herald')
    // 英文名和中文叫法同字的时候，不能拼成 Herald Herald
    for (const tier of PET_LEVELS) {
      setLang('en')
      expect(tierName(tier)).toBe(tier.name)
    }
  })

  it('成长阶段同理', () => {
    const { zh, en } = bilingual(() => stageName(STAGES[0]))
    expect(zh).toBe('新手 Rookie')
    expect(en).toBe('Rookie')
  })

  it('槽位、性别、赛制、配对、榜单周期这几张表都是两元组', () => {
    const tables: Record<string, [string, string][]> = {
      SLOT_LABELS: Object.values(SLOT_LABELS),
      AVATAR_SEXES: AVATAR_SEXES.map((s) => s.label),
      FORMAT_LABELS: Object.values(FORMAT_LABELS),
      PAIRING_MODE_LABELS: Object.values(PAIRING_MODE_LABELS),
      PAIRING_MODE_HINTS: Object.values(PAIRING_MODE_HINTS),
      PERIOD_LABELS: Object.values(PERIOD_LABELS),
      PET_LEVELS: PET_LEVELS.map((t) => t.label),
    }
    for (const [name, rows] of Object.entries(tables)) {
      for (const row of rows) {
        expect(row, `${name} 里有一行不是 [中文, English]`).toHaveLength(2)
        expect(row[0], `${name} 缺中文`).toBeTruthy()
        expect(row[1], `${name} 缺英文`).toBeTruthy()
        expect(row[1], `${name} 的英文那格还是中文`).not.toMatch(/[一-鿿]/)
      }
    }
  })
})

describe('lib/format 跟着语言走', () => {
  it('日期两种语言各按各的习惯排', () => {
    setLang('zh')
    expect(formatDate('2026-08-10')).toBe('8月10日 周一')
    expect(formatMonth('2026-08')).toBe('2026 年 8 月')
    setLang('en')
    expect(formatDate('2026-08-10')).toBe('10 Aug, Mon')
    expect(formatMonth('2026-08')).toBe('Aug 2026')
  })

  it('连胜标签在英文里用 W3 / L3 这种战绩表写法', () => {
    setLang('zh')
    expect(streakLabel(3)).toBe('3 连胜')
    expect(streakLabel(-3)).toBe('3 连败')
    setLang('en')
    expect(streakLabel(3)).toBe('W3')
    expect(streakLabel(-3)).toBe('L3')
    // 2 场以下不算「连」，两种语言都不显示
    expect(streakLabel(1)).toBeNull()
    expect(streakLabel(-1)).toBeNull()
  })
})

describe('切换本身', () => {
  it('setLang 之后 lang() 和 pick() 立刻就是新的', () => {
    setLang('en')
    expect(lang()).toBe('en')
    expect(pick('中文', 'English')).toBe('English')
    setLang('zh')
    expect(lang()).toBe('zh')
    expect(pick('中文', 'English')).toBe('中文')
  })
})
