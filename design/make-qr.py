#!/usr/bin/env python3
"""
战绩卡上那个二维码，编译期生成一次。

为什么不在浏览器里现画：
  网址是固定的，一年也不会变一次 —— 为一个常量往离线包里塞一个
  二维码库（最小的也有十几 KB），每个打开 App 的人都要下，不值得。

为什么是内联 SVG，不是 PNG 文件：
  战绩卡要靠 html-to-image 转成图片发到群里，那一步会把整个节点
  重画一遍。外部图片要先抓回来再内联，多一步就多一处会悄悄失败 ——
  而失败的样子是「图出来了，二维码那块是空白」，没人会发现。
  内联 SVG 没有这一步。

改了网址就重跑：
    pip install segno
    python3 design/make-qr.py

segno 只在这儿用一次，不进 package.json —— 它是出图工具，
不是 App 的依赖。生成出来的那个 .tsx 是提交进仓库的成品。
"""
import segno

URL = 'https://rallybadminton.com'
OUT = 'src/components/QrCode.tsx'

qr = segno.make(URL, error='m')
m = [[bool(c) for c in row] for row in qr.matrix]
n = len(m)

# 四格白边（quiet zone）。规范要求的，不是留白好看 ——
# 没有它，扫码器分不清二维码从哪里开始，很多手机直接扫不出来。
# 这一条栽过：第一版按 segno 给的矩阵原样画，边到边全是格子。
BORDER = 4
side = n + BORDER * 2

# 把每个黑格子并成一条 path 指令。一行里连着的黑格合成一个矩形 ——
# 一个格子一个 <rect> 的话，这段 SVG 会长到两千行。
parts = []
for y, row in enumerate(m):
    x = 0
    while x < n:
        if not row[x]:
            x += 1
            continue
        w = 1
        while x + w < n and row[x + w]:
            w += 1
        parts.append(f'M{x + BORDER} {y + BORDER}h{w}v1h-{w}z')
        x += w
path = ''.join(parts)

tsx = f'''/*
 * 这个文件是生成出来的，别手改 —— 见 design/make-qr.py。
 *
 * 内容是 {URL} 的二维码，纠错等级 M（脏一点、糊一点还扫得出来，
 * 而这张图是要被转发、截图、再转发的）。
 *
 * {n}×{n} 个格子，外加四格白边（没有白边很多手机扫不出来）。
 * viewBox 就用格子数，所以想画多大画多大，
 * 缩放不会糊 —— 位图二维码缩小之后扫不出来，正是这个原因。
 */
export function QrCode({{ size = 64, className }}: {{ size?: number; className?: string }}) {{
  return (
    <svg
      viewBox="0 0 {side} {side}"
      width={{size}}
      height={{size}}
      className={{className}}
      shapeRendering="crispEdges"
      role="img"
      aria-label="{URL}"
    >
      {{/* 白底是必须的：二维码扫的是黑白对比，透明底压在深色卡片上就扫不出来 */}}
      <rect width="{side}" height="{side}" fill="#fff" />
      <path d="{path}" fill="#000" />
    </svg>
  )
}}
'''
open(OUT, 'w').write(tsx)
print(f'{URL} → {n}×{n} + {BORDER} 白边 = {side}，{len(parts)} 条指令，{len(tsx)} 字节 → {OUT}')
