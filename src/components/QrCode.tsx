import { useMemo } from 'react'
import { QR_BORDER, qrMatrix, qrPath } from '@/lib/qr'

/* ------------------------------------------------------------------ *
 * 一个二维码
 *
 * 这个文件原来是**生成出来的**（design/make-qr.py + segno），里面是一条
 * 写死的 path —— 因为它的内容是个常量：站点首页。
 *
 * 现在内容不是常量了（每场球局、每个球群各不一样），所以改成现画。
 * 编码那一半在 lib/qr.ts，那儿写了为什么自己写而不是装一个库。
 *
 * -------------------------------------------------------------------
 * 还是内联 SVG，不是 <img>
 *
 * 战绩卡要靠 html-to-image 转成图片发到群里，那一步会把整个节点重画
 * 一遍。外部图片要先抓回来再内联，多一步就多一处会悄悄失败 —— 而失败
 * 的样子是「图出来了，二维码那块是空白」，没人会发现。
 *
 * viewBox 用格子数，所以想画多大画多大，缩放不会糊。位图二维码缩小
 * 之后扫不出来，正是这个原因。
 *
 * -------------------------------------------------------------------
 * 多大才扫得出来
 *
 * 实测过（两个解码器 zxing-cpp + OpenCV，六十条真实邀请网址）：
 *
 *   一条完整邀请（球局 + 球群码，75 字符 → 37 格）
 *     240px 两个都稳    160px 两个都行    80px 只有 zxing 读得出
 *
 *   只带球群码（36 字符 → 29 格）
 *     160px 两个都行    80px 只有 zxing
 *
 * 结论：**别给得太小**。屏幕上让人扫的给到 200px 以上；战绩卡那种
 * 会被聊天软件再压一道的，按「压掉一半之后还剩多少」来算。
 * ------------------------------------------------------------------ */

export function QrCode({
  text,
  size = 160,
  className,
}: {
  /** 要编进去的内容。只能是 ASCII，太长会抛错（见 lib/qr.ts） */
  text: string
  size?: number
  className?: string
}) {
  /*
   * 算一次就够了。
   *
   * 这一段要试八个掩码、每个都算一遍罚分 —— 几毫秒的事，但它挂在
   * 战绩卡上，而那一屏每改一次比分都会重画。
   */
  const drawn = useMemo(() => {
    try {
      const matrix = qrMatrix(text)
      return { side: matrix.length + QR_BORDER * 2, path: qrPath(matrix) }
    } catch {
      /*
       * 画不出来就不画。
       *
       * 走到这儿只有两种可能：内容里有非 ASCII，或者长得超出了版本 10。
       * 两种都不该在这个 App 里发生（编进去的只有自家网址），但**万一**
       * 发生了，宁可这一块空着也不能让整屏崩掉 —— 它只是张卡上的一个角。
       */
      return null
    }
  }, [text])

  if (!drawn) return null

  return (
    <svg
      viewBox={`0 0 ${drawn.side} ${drawn.side}`}
      width={size}
      height={size}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={text}
    >
      {/* 白底是必须的：二维码扫的是黑白对比，透明底压在深色卡片上就扫不出来 */}
      <rect width={drawn.side} height={drawn.side} fill="#fff" />
      <path d={drawn.path} fill="#000" />
    </svg>
  )
}
