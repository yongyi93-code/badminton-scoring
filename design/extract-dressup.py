#!/usr/bin/env python3
"""把一组「同一个人、同一个姿势、只换一件装备」的整图，拆成分层换装的素材。

用法：
    python3 design/extract-dressup.py design/dressup-src src/assets/dressup

输入目录里要有：
    base.png          底图，绿幕
    <槽位>-<编号>.png  变体，绿幕，除了那一件之外和底图完全一样

输出：
    base.webp         抠掉绿幕的底图
    <id>.webp         那一件的图层（带透明）
    <id>.mask.webp    那一件的区域掩膜
    meta.json         画布尺寸和每一层的位置

--------------------------------------------------------------------
为什么要掩膜，不能只叠图层
--------------------------------------------------------------------
合成不是简单叠加，是「先按掩膜擦掉那块，再画上新的」。
少了擦这一步，短袖换无袖时底图的旧袖子会从新衣服边上露出来 ——
图层的 alpha 分不出「区域内但透明（该擦）」和「区域外（该留）」。

--------------------------------------------------------------------
图层的 alpha 必须是硬的
--------------------------------------------------------------------
栽过一次：拿逐像素差异的强弱当 alpha，衣服内部就会留下一片半透明的洞，
浅色底上看不出来，一放到 App 的深色卡片上立刻现形（一块发黑的补丁）。

所以这里的 alpha 只有两个来源，都是非零即一：
    区域内 ∧ 变体那一处是人（不是绿幕）  → 不透明
    其余                                → 透明
「变体那一处是绿幕」的情况是对的：无袖换下短袖，露出来的确实该是背景。
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

# 出图是 1728×2304，交付减半 —— 手机上足够清楚，包体小一半
SCALE = 0.5

# 差异阈值。低于这个数当成没变（出图之间总有一点点噪声）
DIFF_THRESHOLD = 30

# 绿幕：色相偏绿且够饱和就算背景
GREEN_MARGIN = 28


def person_alpha(rgb: np.ndarray) -> np.ndarray:
    """绿幕抠像。返回 0/255 的硬 alpha。

    判据是「绿比红蓝都高出一截」，不是比某个绿色近 ——
    背景本身有噪点和明暗，比颜色距离会在边上留一圈碎点。
    """
    r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
    is_green = (g - np.maximum(r, b)) > GREEN_MARGIN
    keep = ~is_green
    # 抠出来难免有零星孤点，开运算扫掉，再把人身上被误判的小洞填回去
    keep = ndimage.binary_opening(keep, np.ones((3, 3)))
    keep = ndimage.binary_fill_holes(keep)
    return (keep * 255).astype(np.uint8)


def unspill(rgb: np.ndarray) -> np.ndarray:
    """去绿边。绿幕会在人的轮廓上染一圈绿，把过高的绿压到红蓝之间。"""
    out = rgb.astype(np.int16).copy()
    r, g, b = out[:, :, 0], out[:, :, 1], out[:, :, 2]
    cap = np.maximum(r, b)
    spill = g > cap
    g[spill] = cap[spill]
    return np.clip(out, 0, 255).astype(np.uint8)


def changed_region(base: np.ndarray, var: np.ndarray) -> np.ndarray:
    """底图和变体不一样的那块，清理成一整片。"""
    diff = np.abs(base.astype(int) - var.astype(int)).max(axis=2)
    reg = diff > DIFF_THRESHOLD

    # 开运算去噪。核太大会把细的东西（窄裙、拍杆）整根吃掉，所以从大往小退
    for k in (7, 5, 3):
        opened = ndimage.binary_opening(reg, np.ones((k, k)))
        if opened.sum() > 0.15 * reg.sum():
            reg = opened
            break

    # 出图角落可能有水印之类的小块。留下最大的那一团和它量级相当的，其余丢掉。
    # 不能用「和底图人形相交」来筛：球拍本来就伸在人的轮廓之外，那样会把拍子全删了
    lab, n = ndimage.label(reg, np.ones((3, 3)))
    if n > 1:
        sizes = ndimage.sum(reg, lab, range(1, n + 1))
        biggest = sizes.max()
        keep = {i + 1 for i, s in enumerate(sizes) if s >= 0.1 * biggest}
        reg = np.isin(lab, list(keep))

    # 衣服中间和底图撞色的地方会漏成洞，填上 —— 区域是「这一片」，不是「哪些像素变了」
    reg = ndimage.binary_fill_holes(reg)
    reg = ndimage.binary_closing(reg, np.ones((9, 9)))
    return reg


def to_canvas(arr: np.ndarray) -> Image.Image:
    """按 SCALE 缩到交付尺寸。

    必须先预乘 alpha 再缩（RGBa 就是预乘模式）。
    直接缩 RGBA 的话，全透明像素的颜色也会被插值算进邻居里 ——
    这些像素留着的是抠掉的绿幕色，去完绿边是暗青，缩完就在衣服边上
    描了一圈脏边。浅色底上不明显，深色卡片上一眼就看到。
    """
    im = Image.fromarray(arr, 'RGBA')
    w, h = int(im.width * SCALE), int(im.height * SCALE)
    return im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')


def main(src_dir: str, out_dir: str) -> None:
    src, out = Path(src_dir), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    base_rgb = np.array(Image.open(src / 'base.png').convert('RGB'))
    base_a = person_alpha(base_rgb)
    base_rgba = np.dstack([unspill(base_rgb), base_a])
    canvas = to_canvas(base_rgba)
    canvas.save(out / 'base.webp', quality=92, method=6)
    W, H = canvas.size

    items = {}
    for path in sorted(src.glob('*.png')):
        item_id = path.stem
        if item_id == 'base':
            continue

        var_rgb = np.array(Image.open(path).convert('RGB'))
        if var_rgb.shape != base_rgb.shape:
            raise SystemExit(f'{item_id}: 尺寸和底图对不上 {var_rgb.shape}')

        reg = changed_region(base_rgb, var_rgb)
        if not reg.any():
            raise SystemExit(f'{item_id}: 和底图没有差别，是不是传错了图')

        ys, xs = np.where(reg)
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        # 交付尺寸是原图的一半，框对齐到偶数像素，缩放后不会差半格
        x0, y0 = x0 - x0 % 2, y0 - y0 % 2
        x1, y1 = x1 + x1 % 2, y1 + y1 % 2

        sub_reg = reg[y0:y1, x0:x1]
        sub_rgb = var_rgb[y0:y1, x0:x1]
        # 图层的 alpha：区域内 ∧ 是人。硬的，不掺差异强弱
        alpha = ((sub_reg & (person_alpha(var_rgb)[y0:y1, x0:x1] > 0)) * 255).astype(np.uint8)

        layer = to_canvas(np.dstack([unspill(sub_rgb), alpha]))
        # 掩膜必须把区域放在 alpha 通道里，不能存成灰度图。
        # 合成那一步是 destination-out，它按来源的 alpha 擦 ——
        # 灰度图没有 alpha 通道，浏览器当成整块不透明，会把整个方框都擦掉。
        reg_a = (sub_reg.astype(np.uint8) * 255)
        mask = to_canvas(np.dstack([np.zeros_like(reg_a)] * 3 + [reg_a]))
        layer.save(out / f'{item_id}.webp', quality=92, method=6)
        mask.save(out / f'{item_id}.mask.webp', lossless=True, method=6)

        items[item_id] = {
            'x': int(x0 * SCALE),
            'y': int(y0 * SCALE),
            'w': layer.width,
            'h': layer.height,
        }
        print(f'{item_id:12s} {items[item_id]}  实心占比 {alpha.mean() / 255:.0%}')

    (out / 'meta.json').write_text(
        json.dumps({'size': [W, H], 'items': items}, separators=(',', ':')),
        encoding='utf-8',
    )
    print(f'\n{len(items)} 件，画布 {W}×{H}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
