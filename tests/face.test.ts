import { describe, expect, it } from 'vitest'
import { faceKind, photoFor } from '@/lib/face'

/*
 * 头像该显示哪一张脸。
 *
 * 这一块出错的样子**不是报错**，是安静地显示错的那张 —— 而且错得
 * 很难被发现：一个没设照片的人显示成角色，看着完全正常，直到有人问
 * 「为什么排行榜上是我，看板上不是我」。
 *
 * 界面测试这个仓库没有（全是纯逻辑的），所以把「挑哪一张」拎出来钉住。
 */

describe('用哪个地址', () => {
  /*
   * 绝大多数地方不给 photo，让头像自己去名片表里查 —— 十来处调用点
   * 不用各自接一次线。
   */
  it('没意见的时候用查出来的那个', () => {
    expect(photoFor(undefined, 'https://查到的')).toBe('https://查到的')
    expect(photoFor(undefined, null)).toBeNull()
  })

  it('给了地址就用给的', () => {
    expect(photoFor('https://给的', 'https://查到的')).toBe('https://给的')
  })

  /*
   * 这一条是整块里最要紧的，而且它看着像个边角料。
   *
   * 朋友圈和 Story 上的人不一定在这个球群里 —— 那几屏手上只有 uid，
   * 说「他没照片」的时候必须当真。不当真的话会去按球员查，而查出来的
   * 很可能是**同名的另一个人**的脸：一条动态配着别人的头像，
   * 而两边都不知道发生了什么。
   */
  it('明说「没有」的时候就是没有，不许再去查', () => {
    expect(photoFor(null, 'https://查到的别人的')).toBeNull()
  })
})

describe('挑哪一张脸', () => {
  const kind = (url: string | null, broken: boolean, hasCharacter: boolean) =>
    faceKind({ url, broken, hasCharacter })

  it('有照片就是照片，哪怕也有角色', () => {
    expect(kind('https://脸', false, true)).toBe('photo')
  })

  it('没照片就退回角色', () => {
    expect(kind(null, false, true)).toBe('character')
  })

  it('两样都没有才是名字首字', () => {
    expect(kind(null, false, false)).toBe('initials')
  })

  /*
   * 图加载失败要退回去。
   *
   * 会真的发生：桶里那个文件被删了，而 profiles 那一行还指着它。
   * 不退的话一屏都是碎图标 —— 比没有照片难看得多，而且人会以为
   * 整个 App 坏了，而其实只是一张图没了。
   */
  it('这张图坏了就当没有', () => {
    expect(kind('https://坏的', true, true)).toBe('character')
    expect(kind('https://坏的', true, false)).toBe('initials')
  })

  /* 空字符串不是地址。当成有的话，img 的 src 会指回当前这一页 */
  it('空地址不算有照片', () => {
    expect(kind('', false, true)).toBe('character')
  })
})
