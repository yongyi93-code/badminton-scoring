import { describe, expect, it } from 'vitest'
import {
  BODY_MAX,
  MAX_PHOTOS,
  SIGN_MARGIN_MS,
  SIGN_SECONDS,
  VISIBILITIES,
  checkDraft,
  composerSummary,
  defaultVisibility,
  gridCols,
  pickCached,
  tallyLikes,
  trimCache,
} from '@/lib/moments'
import { setLang } from '@/lib/i18n'

/*
 * 朋友圈里纯逻辑的那几块。
 *
 * 真正把门的（谁看得到谁的动态、照片只能传进自己那个文件夹、拿别人的
 * 图当跳板）在 supabase/024-moments.sql 的策略和触发器上，那些在本机
 * 跑真 Postgres 撞过（23 条），不在这儿。
 *
 * 这个文件钉的是三件会静悄悄出错的事：
 *   · 一条既没字也没图的动态被放出去（界面上是一张空白卡片）
 *   · 点赞算错 —— 尤其是「我点没点」，算错了心会一直是空的
 *   · 图的摆法：四张摆成三列，第二行会剩一个尴尬的空位
 */

setLang('zh')

describe('这条能不能发', () => {
  it('有字就行', () => {
    expect(checkDraft({ body: '今晚城中，三缺一', count: 0 })).toBeNull()
  })

  it('只有图也行 —— 发照片不写字是常态', () => {
    expect(checkDraft({ body: '', count: 3 })).toBeNull()
  })

  /*
   * 这一条最要紧。放过去的话，数据库那条 check 会把它挡下来，
   * 但人看到的是一句数据库错误 —— 而他只是手滑点了「发出去」。
   */
  it('既没字也没图，拦住', () => {
    expect(checkDraft({ body: '', count: 0 })).not.toBeNull()
  })

  it('全是空格不算有字', () => {
    expect(checkDraft({ body: '   \n  ', count: 0 })).not.toBeNull()
    /* 但配上一张图就行了 —— 空白正文会被存成 null */
    expect(checkDraft({ body: '   ', count: 1 })).toBeNull()
  })

  it('超过上限的字数拦住', () => {
    expect(checkDraft({ body: 'あ'.repeat(BODY_MAX), count: 0 })).toBeNull()
    expect(checkDraft({ body: 'あ'.repeat(BODY_MAX + 1), count: 0 })).not.toBeNull()
  })

  it('超过上限的张数拦住', () => {
    expect(checkDraft({ body: '', count: MAX_PHOTOS })).toBeNull()
    expect(checkDraft({ body: '', count: MAX_PHOTOS + 1 })).not.toBeNull()
  })

  /* 数的是 trim 之后的：前后一堆空格不该把一条正常的动态顶出上限 */
  it('字数按 trim 之后算', () => {
    expect(checkDraft({ body: '  ' + 'あ'.repeat(BODY_MAX) + '  ', count: 0 })).toBeNull()
  })
})

describe('几张图摆成几列', () => {
  it('一张铺满', () => {
    expect(gridCols(1)).toBe(1)
  })

  /*
   * 四张是特例。按「三列」摆的话第二行只剩一张，右边两个空位 ——
   * 微信就是为这个把四张单独摆成 2×2 的。
   */
  it('两张和四张是两列', () => {
    expect(gridCols(2)).toBe(2)
    expect(gridCols(4)).toBe(2)
  })

  it('三张、五张到九张都是三列', () => {
    for (const n of [3, 5, 6, 7, 8, 9]) expect(gridCols(n)).toBe(3)
  })

  it('零张也算得出来，不会是 0 列（0 列的 grid 整个塌掉）', () => {
    expect(gridCols(0)).toBeGreaterThanOrEqual(1)
  })
})

describe('算赞', () => {
  const ME = 'uid-me'
  const rows = [
    { post_id: 'p1', uid: 'uid-a' },
    { post_id: 'p1', uid: ME },
    { post_id: 'p2', uid: 'uid-b' },
  ]

  it('数对了', () => {
    const t = tallyLikes(rows, ME)
    expect(t.get('p1')?.likes).toBe(2)
    expect(t.get('p2')?.likes).toBe(1)
  })

  /*
   * 「我点没点」算错的话，心一直是空的 —— 人会再点一下，
   * 而那一下发出去的是「收回赞」。
   */
  it('认得出哪一条是我点的', () => {
    const t = tallyLikes(rows, ME)
    expect(t.get('p1')?.liked).toBe(true)
    expect(t.get('p2')?.liked).toBe(false)
  })

  it('没登录的时候一条都不算「我点的」', () => {
    const t = tallyLikes(rows, null)
    expect(t.get('p1')?.liked).toBe(false)
  })

  it('一个赞都没有的动态查出来是空，不是抛错', () => {
    expect(tallyLikes([], ME).get('p1')).toBeUndefined()
  })
})

describe('两个上限要和数据库对得上', () => {
  /*
   * 024 里写死的是 1000 字、9 张。这边比它松的话，写下去会被服务端
   * 拒掉，而那个错发生在图已经传上去之后 —— 流量花了，人白等了。
   */
  it('字数上限是 1000', () => {
    expect(BODY_MAX).toBe(1000)
  })
  it('张数上限是 9', () => {
    expect(MAX_PHOTOS).toBe(9)
  })
})

/* ------------------------------------------------------------------ *
 * 公开那一档（026）
 * ------------------------------------------------------------------ */

describe('谁看得到', () => {
  /*
   * 默认必须是「只有好友」。
   *
   * 这一条看着像废话，但它是这一整块里最危险的一个默认值：
   * 反过来的话，每一条不去点的动态都发给了全世界，而发的人
   * 以为自己只是在跟球友说话。
   */
  it('不说的时候就是只给好友', () => {
    expect(defaultVisibility).toBe('friends')
  })

  it('只有这两种', () => {
    expect([...VISIBILITIES].sort()).toEqual(['friends', 'public'])
  })
})

/* ------------------------------------------------------------------ *
 * 签好的链接留着重用
 *
 * 私有桶没有固定地址，每次都签一个新的 —— 而浏览器按完整网址缓存，
 * 所以不留着重用的话，每刷一次朋友圈所有图都会重下一遍。
 *
 * 这一块出错的样子不是报错，是**一屏裂图**（过期的链接被当成好的），
 * 或者**账单**（好的链接被当成过期的）。两个方向都要钉住。
 * ------------------------------------------------------------------ */

describe('缓存里哪几条还能用', () => {
  const NOW = 1_000_000_000_000
  const cache = new Map([
    ['a.webp', { url: 'URL-A', expires: NOW + 60 * 60 * 1000 }],
    ['快过期.webp', { url: 'URL-B', expires: NOW + 60 * 1000 }],
    ['过期了.webp', { url: 'URL-C', expires: NOW - 1000 }],
  ])

  it('还早的接着用，不重签', () => {
    const { hits, misses } = pickCached(cache, ['a.webp'], NOW)
    expect(hits.get('a.webp')).toBe('URL-A')
    expect(misses).toEqual([])
  })

  it('过期的要重签', () => {
    const { hits, misses } = pickCached(cache, ['过期了.webp'], NOW)
    expect(hits.size).toBe(0)
    expect(misses).toEqual(['过期了.webp'])
  })

  /*
   * 这一条是留余量的理由：一个还剩一分钟的链接，人慢慢往下翻的时候
   * 会在半路失效 —— 翻到一半突然一屏裂图，而他什么都没做错。
   */
  it('快到期的当成没有 —— 不然翻到一半图会失效', () => {
    const { misses } = pickCached(cache, ['快过期.webp'], NOW)
    expect(misses).toEqual(['快过期.webp'])
  })

  it('没见过的路径直接进重签那一堆', () => {
    const { misses } = pickCached(cache, ['新的.webp'], NOW)
    expect(misses).toEqual(['新的.webp'])
  })

  it('一次能分出两堆来', () => {
    const { hits, misses } = pickCached(cache, ['a.webp', '过期了.webp', '新的.webp'], NOW)
    expect([...hits.keys()]).toEqual(['a.webp'])
    expect(misses).toEqual(['过期了.webp', '新的.webp'])
  })
})

describe('缓存不会无限长', () => {
  const NOW = 1_000_000_000_000
  const big = new Map(
    Array.from({ length: 10 }, (_, i) => [`p${i}`, { url: `u${i}`, expires: NOW + i * 1000 }]),
  )

  it('没超上限就原样不动', () => {
    expect(trimCache(big, 20)).toBe(big)
  })

  it('超了就只留最晚到期的那几条', () => {
    const cut = trimCache(big, 3)
    expect(cut.size).toBe(3)
    /* 到期最晚 = 最近签的，也就是最可能还在屏幕上的那几张 */
    expect([...cut.keys()].sort()).toEqual(['p7', 'p8', 'p9'])
  })
})

describe('签多久', () => {
  /*
   * 短不等于安全：短了只会让同一张图在一天里被重新签、重新下好几遍，
   * 而每一遍都是流量。余量必须比有效期小得多，否则缓存等于没有。
   */
  it('有效期比余量长得多', () => {
    expect(SIGN_SECONDS * 1000).toBeGreaterThan(SIGN_MARGIN_MS * 10)
  })
})

/* ------------------------------------------------------------------ *
 * 设置收起来之后，外面那一行
 *
 * 「谁看得到」和「留多久」收进折叠里之后，这一行是它们**唯一**还
 * 看得见的地方 —— 而这两件事发出去之后都改不了。这一行说错，等于
 * 把一条本想只给球友看的动态发成了公开，而人以为自己看过了。
 * ------------------------------------------------------------------ */

describe('发布设置那一行摘要', () => {
  it('默认那一档：只有好友、一直在', () => {
    setLang('zh')
    expect(composerSummary('friends', false)).toBe('只有好友 · 一直在')
  })

  it('Story 那一档说得出会消失', () => {
    setLang('zh')
    expect(composerSummary('friends', true)).toBe('只有好友 · 24 小时后消失')
  })

  /*
   * 公开必须出现在这一行里。
   *
   * 它是这两组设置里唯一一个**读错了会后悔**的方向 —— 收起来之后
   * 人看不到那两个按钮，就只剩这一行告诉他刚才点过什么。
   */
  it('公开那一档说得出是公开', () => {
    setLang('zh')
    expect(composerSummary('public', false)).toContain('公开')
    expect(composerSummary('public', true)).toBe('公开 · 24 小时后消失')
  })

  /* 「谁看得到」排在前面：它读错的代价大得多 */
  it('谁看得到排在留多久前面', () => {
    setLang('zh')
    const s = composerSummary('public', true)
    expect(s.indexOf('公开')).toBeLessThan(s.indexOf('24 小时'))
  })

  it('英文也说得出来', () => {
    setLang('en')
    expect(composerSummary('friends', false)).toBe('Friends only · Stays')
    expect(composerSummary('public', true)).toBe('Public · Gone in 24h')
    setLang('zh')
  })

  /* 四种组合两两不同 —— 有一对撞了的话，这一行就分不出那两档 */
  it('四种组合各不相同', () => {
    setLang('zh')
    const all = [
      composerSummary('friends', false),
      composerSummary('friends', true),
      composerSummary('public', false),
      composerSummary('public', true),
    ]
    expect(new Set(all).size).toBe(4)
  })
})
