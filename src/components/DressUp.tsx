import { useEffect, useRef, useState } from 'react'
import {
  baseUrl,
  DRESS_CANVAS,
  DRESS_SLOTS,
  dressLayer,
  type DressSlot,
} from '@/lib/dressup'
import { cx } from '@/components/ui'

/* ------------------------------------------------------------------ *
 * 分层换装的渲染
 *
 * 必须用 canvas，不能用一堆 <img> 叠起来 ——
 * 合成里有「擦」这一步（destination-out），DOM 做不到。
 * 少了它，短袖换无袖时底图的旧袖子会从新衣服边上露出来。
 *
 * 每一件的画法固定两步：
 *   1. 用掩膜把那块从画布上擦掉
 *   2. 把图层画上去
 * ------------------------------------------------------------------ */

/** 图片只解码一次，之后换装是纯 canvas 操作，点一下立刻出结果 */
const cache = new Map<string, Promise<HTMLImageElement>>()

function load(src: string): Promise<HTMLImageElement> {
  let p = cache.get(src)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
    cache.set(src, p)
  }
  return p
}

export type DressPicks = Partial<Record<DressSlot, string>>

export type CropBox = { x: number; y: number; w: number; h: number }

/* ------------------------------------------------------------------ *
 * 取景框
 *
 * 两个数都是按素材实测定的，不是拍脑袋：
 * 底图人物占 x 298~564、y 58~1099；把所有装备的图层并起来是 x 157~600、
 * y 58~1150（球拍往左挥得最远，发光的球鞋往下探得最深）。
 * 换了素材要重新量一次这两个框 —— design/extract-dressup.py 会打印每一层的位置。
 * ------------------------------------------------------------------ */

/**
 * 全身。画布两边留了大片空白（画的时候要给球拍留地方），
 * 按整张画布缩放的话人小得看不清脸，所以框到人身上。
 */
export const BODY_CROP_BOX: CropBox = { x: 134, y: 38, w: 490, h: 1114 }

/**
 * 头肩。
 * 立绘是全身的，缩进小圆圈里人只有几像素高 —— 头像必须裁近才认得出是谁。
 */
export const HEAD_CROP_BOX: CropBox = { x: 281, y: 34, w: 300, h: 300 }

/**
 * 取景是画出来的，不是用 CSS 变换裁的。
 *
 * 换过一版：CSS 那种做法要按容器宽高比换算偏移，容器一不是正方形
 * （衣柜里的小图就是扁的）东西就跑出框外。直接把画布开成取景框那么大、
 * 画之前把坐标系平移过去，剩下的交给 max-w/max-h 自动缩放，
 * 什么形状的容器都对。
 *
 * maxPx 是给画布分辨率封顶：商店一屏四十来个小图，
 * 每个都开成原尺寸的话光画布就要几百兆显存。
 */
async function paint(
  canvas: HTMLCanvasElement,
  picks: DressPicks,
  box: CropBox,
  maxPx: number,
) {
  const [W, H] = DRESS_CANVAS
  const base = baseUrl()
  if (!base) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 先把这一帧要用的图全部准备好再画，避免画到一半闪烁
  const jobs = DRESS_SLOTS.map((slot) => {
    const id = picks[slot]
    return id ? dressLayer(id) : null
  })
  const [baseImg, ...layers] = await Promise.all([
    load(base),
    ...jobs.map((j) => (j ? Promise.all([load(j.art), load(j.mask)]) : null)),
  ])

  const scale = Math.min(1, maxPx / Math.max(box.w, box.h))
  canvas.width = Math.round(box.w * scale)
  canvas.height = Math.round(box.h * scale)
  ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale)
  ctx.clearRect(box.x, box.y, box.w, box.h)
  ctx.drawImage(baseImg, 0, 0, W, H)

  layers.forEach((pair, i) => {
    const job = jobs[i]
    if (!pair || !job) return
    const [art, mask] = pair
    const { x, y, w, h } = job.box
    // ① 按掩膜擦掉这一块
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(mask, x, y, w, h)
    // ② 画上新装备
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(art, x, y, w, h)
  })
}

/**
 * 换装立绘。
 *
 * crop 是画布坐标系里的取景框，默认全身；排行榜那种小圆头像传 HEAD_CROP_BOX
 * 裁到头肩，商店小图传 dressCrop(id) 裁到那一件。
 */
export function DressUpView({
  picks,
  crop = BODY_CROP_BOX,
  maxPx = 640,
  className,
  title,
}: {
  picks: DressPicks
  crop?: CropBox
  /** 画布分辨率上限，小图传小一点省显存 */
  maxPx?: number
  className?: string
  title?: string
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [ready, setReady] = useState(false)
  /*
   * picks 和 crop 每次渲染都是新对象，直接进依赖数组会无限重画 ——
   * 拍平成一个字符串，内容真变了才重画。
   */
  const key = [
    ...DRESS_SLOTS.map((s) => picks[s] ?? ''),
    `${crop.x},${crop.y},${crop.w},${crop.h}`,
    maxPx,
  ].join('|')

  useEffect(() => {
    let alive = true
    const el = ref.current
    if (!el) return
    paint(el, picks, crop, maxPx).then(() => alive && setReady(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <span
      className={cx('flex items-center justify-center overflow-hidden', className)}
      role="img"
      aria-label={title ?? '角色'}
    >
      {/*
        画布自带内在尺寸（就是取景框的大小），max-w/max-h 会等比缩到容器里 ——
        容器是方是扁都不会切到人，也不用去量容器有多大。
      */}
      <canvas
        ref={ref}
        className="max-h-full max-w-full"
        style={{ opacity: ready ? 1 : 0, transition: 'opacity .18s' }}
      />
    </span>
  )
}

