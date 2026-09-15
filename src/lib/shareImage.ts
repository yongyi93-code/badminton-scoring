import { pick } from './i18n'
import { isInAppBrowser } from './install'

/*
 * html-to-image 是用到才下的。
 *
 * 它有小半兆，而整个 App 里只有一处用得上 —— 赛后那张战绩卡的
 * 「分享」。摆在主包里的话，每一个打开 App 的人都要为一个他今晚
 * 可能一次都不会点的按钮付这笔流量。
 *
 * 点下去那一刻再下，慢个几百毫秒；而那时候按钮本来就要转一会儿圈
 * （后面还要渲染、转 canvas、编码 PNG），多的这一下看不出来。
 */
const loadToSvg = async () => (await import('html-to-image')).toSvg

export type ShareOutcome =
  /** 系统分享面板开了 —— 人可以直接发进群 */
  | 'shared'
  /** 退回下载，而且这个浏览器的下载是靠得住的 */
  | 'downloaded'
  /**
   * 退回下载了，但这是个 App 内嵌浏览器（WhatsApp、FB…），
   * 那种浏览器会把下载**默默吞掉** —— 不报错，也不存。
   *
   * 所以这里不敢说「存好了」。以前说了，于是界面显示「图片已下载」，
   * 人回相册里翻半天什么都没有 —— 那比直接说存不了难受得多。
   */
  | 'maybe-blocked'
  | 'failed'

/**
 * 节点 → PNG Blob。
 *
 * 不用 html-to-image 的 toPng/toBlob：它在 img.decode() 之后要等一帧
 * requestAnimationFrame，而页面切到后台时 rAF 不触发，会永远卡住
 * （用户点了生成图再切去微信就中招）。这里只用它把节点转成自包含的 SVG，
 * 再自己画到 canvas 上，全程不依赖动画帧。
 */
async function nodeToPngBlob(node: HTMLElement, scale = 2): Promise<Blob> {
  const width = node.offsetWidth
  const height = node.offsetHeight
  if (!width || !height) throw new Error(pick('分享卡片还没渲染出来', 'The share card has not rendered yet'))

  const toSvg = await loadToSvg()
  const svgUrl = await toSvg(node, { width, height, cacheBust: true })

  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(pick('SVG 转图片失败', 'Could not turn the SVG into an image')))
    img.src = svgUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(pick('浏览器不支持 canvas', 'This browser has no canvas support'))
  ctx.fillStyle = '#0d1d16'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  if (!blob) throw new Error(pick('导出 PNG 失败', 'Could not export the PNG'))
  return blob
}

/**
 * 把一个 DOM 节点转成图片。
 * 手机上优先调系统分享面板（可以直接发进 WhatsApp / 微信群），
 * 桌面浏览器或不支持时退回下载。
 */
export async function shareNodeAsImage(
  node: HTMLElement,
  filename: string,
  title: string,
): Promise<ShareOutcome> {
  const blob = await nodeToPngBlob(node)
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean
  }

  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      // 用户自己取消分享不算失败
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared'
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  /*
   * 得真挂进文档里再点。
   *
   * 一个没进 DOM 的 <a> 上调 click()，有些浏览器根本不当回事 ——
   * 不报错，也不下载。这一处正是那种「代码看着完全合理」的坑。
   */
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  /*
   * 晚点再撤销那个 blob 网址。
   *
   * 原来是 click() 下一行就撤，而下载是异步开始的 —— 撤早了，
   * 浏览器回头去读那个网址时已经没东西了，下载就那么没了。
   * 手机上尤其容易中招，因为那一下还要过一遍系统的下载器。
   */
  setTimeout(() => URL.revokeObjectURL(url), 60_000)

  /*
   * 内嵌浏览器里不敢说「存好了」。
   *
   * WhatsApp / FB 那种浏览器会把下载默默吞掉 —— 不报错，也不存。
   * 以前这里一律返回 downloaded，界面就显示「图片已下载，可以手动
   * 发到群里」，人回相册里翻半天什么都没有。
   *
   * 说不准就说不准。一句「可能没存上，用手机浏览器打开再试」
   * 比一句笃定的假话有用得多。
   */
  return isInAppBrowser() ? 'maybe-blocked' : 'downloaded'
}
