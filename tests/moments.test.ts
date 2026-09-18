import { describe, expect, it } from 'vitest'
import { BODY_MAX, MAX_PHOTOS, checkDraft, gridCols, tallyLikes } from '@/lib/moments'
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
