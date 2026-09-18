import { describe, expect, it } from 'vitest'
import { PLAY_WINDOW_MS, describeSession, playingLine } from '@/lib/nowPlaying'
import { setLang } from '@/lib/i18n'
import type { Session } from '@/types'

/*
 * 「正在打」。
 *
 * 真正把门的是数据库那四条策略（只有好友读得到、只能写自己那一行），
 * 它们在本机跑真 Postgres 撞过，不在这儿。
 *
 * 这个文件钉的是**那句话本身**：它是这个功能唯一被人看见的东西，
 * 而它有一个很容易出错的地方 —— 老球局没有赛制。
 */

const s = (patch: Partial<Session> = {}): Session =>
  ({
    id: 's1',
    date: '2026-09-18',
    venue: 'Twin ark',
    courtCount: 2,
    playerIds: ['p1'],
    defaultType: 'doubles',
    rules: { pointsToWin: 21, winBy: 2, cap: 30, bestOf: 1 },
    fee: { total: 0, payers: [] },
    status: 'active',
    createdAt: 0,
    format: 'rotation',
    ...patch,
  }) as Session

describe('从球局里取出要报的那两样', () => {
  /*
   * 报的是 key，不是译好的字。
   *
   * 第一版报的是当场译好的名字，在浏览器里一看就露馅了：中文界面的人
   * 开局，他英文界面的朋友看到「Playing 轮转赛 at Twin ark」——
   * 半句英文半句中文。报的人和看的人不是同一种语言，这是常态。
   */
  it('赛制报的是 key，不是译好的名字', () => {
    setLang('zh')
    expect(describeSession(s())).toEqual({ venue: 'Twin ark', format: 'rotation' })
  })

  it('报什么和界面语言无关 —— 换成英文界面，报的还是同一个 key', () => {
    setLang('en')
    expect(describeSession(s())).toEqual({ venue: 'Twin ark', format: 'rotation' })
  })

  /*
   * v1 那时候的球局没有 format 这个字段，而那些局照样打得开。
   * 编一个赛制出来是这一层最容易犯的错 —— 好友列表上会显示
   * 一个这场球局根本不是的玩法。
   */
  it('老球局没有赛制，就是 null —— 不编一个出来', () => {
    setLang('zh')
    expect(describeSession(s({ format: undefined })).format).toBeNull()
  })

  it('球馆名空着的时候退成「未填球馆」，不是空字符串', () => {
    setLang('zh')
    expect(describeSession(s({ venue: '   ' })).venue).toBe('未填球馆')
  })

  it('球馆名首尾空格和中间的连续空白会被压掉', () => {
    setLang('zh')
    expect(describeSession(s({ venue: '  Twin   ark ' })).venue).toBe('Twin ark')
  })
})

describe('好友列表上那一句', () => {
  it('中文', () => {
    setLang('zh')
    expect(playingLine({ venue: 'Twin ark', format: 'rotation' }, true)).toBe(
      '正在 Twin ark 开打轮转赛',
    )
  })

  /*
   * 同一个 key，看的人是英文界面就出英文 —— 这一条就是那个
   * 「半句英文半句中文」的反面，它才是这次改动的意义。
   */
  it('同一个 key，英文界面看到的是英文', () => {
    setLang('en')
    expect(playingLine({ venue: 'Twin ark', format: 'rotation' }, false)).toBe(
      'Playing Round robin at Twin ark',
    )
  })

  it('不认识的赛制原样显示，不吞掉也不编一个', () => {
    setLang('zh')
    expect(playingLine({ venue: 'X', format: 'beach' }, true)).toBe('正在 X 开打beach')
  })

  /* 没有赛制时句子要自己站得住，不能留个「开打」在那儿晃 */
  it('没有赛制时退成一句完整的话', () => {
    expect(playingLine({ venue: '力天', format: null }, true)).toBe('正在 力天 打球')
    expect(playingLine({ venue: 'Litian', format: null }, false)).toBe('Playing at Litian')
  })

  it('两种语言都不会漏掉球馆名', () => {
    for (const zh of [true, false]) {
      setLang(zh ? 'zh' : 'en')
      for (const format of ['rotation', null]) {
        expect(playingLine({ venue: '某某馆', format }, zh)).toContain('某某馆')
      }
    }
  })
})

describe('过期窗口', () => {
  /*
   * 数据库那边卡了 12 小时的上限（021 里那条 check）。这个常量要是
   * 被改大到超过它，每一次「我在打球」都会被数据库拒掉 ——
   * 而那是个静悄悄的失败：好友只会觉得这个功能不准。
   */
  it('比数据库那条 12 小时的上限短', () => {
    expect(PLAY_WINDOW_MS).toBeLessThan(12 * 60 * 60 * 1000)
  })

  /* 比任何一场球局都长 —— 通宵局也就五六个钟 */
  it('比一场通宵局还长', () => {
    expect(PLAY_WINDOW_MS).toBeGreaterThan(6 * 60 * 60 * 1000)
  })
})
