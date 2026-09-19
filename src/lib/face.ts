/* ------------------------------------------------------------------ *
 * 头像该显示哪一张脸
 *
 * 三层退路，从上往下：
 *
 *   photo      他自己的照片          「你是谁」
 *   character  换装角色              「你有多强」
 *   initials   名字首字的色块        什么都没有时的最后一道
 *
 * 逻辑单拎出来是因为它**错了不会报错**，只会安静地显示错的那张脸 ——
 * 而界面测试这个仓库没有（全是纯逻辑的）。画图那部分在 Avatar 里，
 * 这里只管「挑哪一张」。
 * ------------------------------------------------------------------ */

export type FaceKind = 'photo' | 'character' | 'initials'

/**
 * 最后用哪个地址。
 *
 * `given` 是调用方显式给的：
 *
 *   undefined   没意见 —— 去名片表里查（绝大多数地方）
 *   string      就用这个
 *   null        **他没有照片，别去查**
 *
 * 最后那一条是有意的，不是省事：朋友圈和 Story 上的人不一定在这个
 * 球群里，按球员查出来多半是空，而更坏的是**查到同名那个人的**。
 * 那几屏手上的 uid 才是准的，所以它说没有就是没有。
 */
export function photoFor(given: string | null | undefined, looked: string | null): string | null {
  return given === undefined ? looked : given
}

/**
 * 挑哪一张脸。
 *
 * `broken` 是「这张图加载失败过」。会发生：桶里的文件被删了而
 * profiles 那一行还指着它。不退回去的话，列表上是一排碎图标 ——
 * 比没有照片难看得多，而且人会以为 App 坏了。
 */
export function faceKind(o: {
  url: string | null
  broken: boolean
  hasCharacter: boolean
}): FaceKind {
  if (o.url && !o.broken) return 'photo'
  return o.hasCharacter ? 'character' : 'initials'
}
