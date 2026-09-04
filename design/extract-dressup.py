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

# 绿幕抠像的软边范围。
# 「绿度」= 绿比红蓝里高的那个还高出多少。实测纯背景在 38~45 之间。
# 绿度 >= GREEN_OUT 全透明，<= GREEN_IN 全不透明，中间线性过渡。
GREEN_OUT = 36
GREEN_IN = 18


def person_alpha(rgb: np.ndarray) -> np.ndarray:
    """绿幕抠像。返回 0~255 的软 alpha。

    判据是「绿比红蓝都高出一截」，不是比某个绿色近 ——
    背景本身有噪点和明暗，比颜色距离会在边上留一圈碎点。

    为什么是软的：出图里的辉光（发光的球衣、发光的鞋底）会糊在绿幕上，
    这种「辉光掺绿幕」的像素绿度介于两者之间。一刀切成不透明的话，
    去完绿边就在人身上描了一圈青灰，深色卡片上特别明显；
    切成透明又会把辉光整个剃掉。按绿度渐变，辉光自然成了半透明，
    衬到什么底色上都对。

    衣服本身不会被误伤：这套配色是白/黑/蓝/紫/金，绿度都 <= 0。
    以后要是出了绿色的球衣，得换抠图方式 —— 下面那句自检会报出来。
    """
    r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
    greenness = g - np.maximum(r, b)
    soft = np.clip((GREEN_OUT - greenness) / (GREEN_OUT - GREEN_IN), 0, 1)

    # 背景噪点会留下零星孤点，按「明显是人」的部分做一次开运算扫掉，
    # 再把这些孤点从软 alpha 里减掉。不动边缘的过渡带。
    solid = ndimage.binary_opening(soft > 0.5, np.ones((3, 3)))
    speck = (soft > 0.5) & ~ndimage.binary_dilation(solid, np.ones((5, 5)))
    soft[speck] = 0

    # 只留和人物连在一起的部分。
    # 出图右下角有「AI生成」水印，是压在绿幕上的半透明白字 ——
    # 绿度介于纯背景和人之间，软抠像会留下淡淡一层，
    # 既会跟着画进 App 的角落，也会把取景框整个带偏。
    # 球拍、辉光都是长在人身上的，不会被这一刀切掉。
    lab, n = ndimage.label(soft > 0.05, np.ones((3, 3)))
    if n > 1:
        sizes = ndimage.sum(soft > 0.05, lab, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s >= 0.02 * sizes.max()]
        soft[~np.isin(lab, keep)] = 0
    return np.round(soft * 255).astype(np.uint8)


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


# 这些槽位是不透光的实心东西，区域内部破洞就是出问题了。
# 球拍不在里面：拍面本来就是镂空的，网线之间透出背景是对的，
# 拿同一把尺子量它，每一支拍都要报警 —— 报了等于没报。
SOLID_SLOTS = ('top', 'bottom', 'shoes')


def warn_holes(item_id: str, reg: np.ndarray, alpha: np.ndarray) -> None:
    """实心装备的区域深处要是破了洞，多半是抠图把衣服当背景了 —— 喊一声。

    这种错在浅色底上完全看不出来，只有放到 App 的深色卡片上才现形，
    所以宁可在这里啰嗦一句。绿色系的衣服会触发它。
    """
    if not item_id.startswith(SOLID_SLOTS):
        return
    inner = ndimage.binary_erosion(reg, np.ones((15, 15)))
    if not inner.any():
        return
    hole = ndimage.binary_erosion(inner & (alpha < 200), np.ones((9, 9)))
    ratio = hole.sum() / inner.sum()
    if ratio > 0.1:
        print(f'  ⚠ {item_id}: 区域内部破了 {ratio:.0%} 的洞，检查是不是被绿幕吃掉了')


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
    visible = {}
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
        # 图层的 alpha = 区域内 × 抠像的软 alpha。
        # 注意透明度只能来自抠像，不能拿「和底图差多少」当权重 ——
        # 栽过一次：那样衣服中间和底图撞色的地方会留下一片半透明的洞，
        # 浅色底上看不出来，深色卡片上就是一块发黑的补丁。
        var_a = person_alpha(var_rgb)[y0:y1, x0:x1]
        alpha = (sub_reg * var_a).astype(np.uint8)
        warn_holes(item_id, sub_reg, alpha)

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

        # 取景要按「真看得见的那一块」，不能按上面这个框。
        # 两者能差很远：发光的装备，辉光糊在绿幕上被抠像判成背景，
        # 于是区域框比图层实际画出来的东西宽出几十像素的空白。
        # 拿区域框去取景，全身像就为了一圈透明的边而整体缩小。
        vys, vxs = np.where(alpha > 8)
        if len(vxs):
            visible[item_id] = {
                'x': int((x0 + int(vxs.min())) * SCALE),
                'y': int((y0 + int(vys.min())) * SCALE),
                'w': int((int(vxs.max()) - int(vxs.min()) + 1) * SCALE),
                'h': int((int(vys.max()) - int(vys.min()) + 1) * SCALE),
            }
        print(f'{item_id:12s} {items[item_id]}  实心占比 {alpha.mean() / 255:.0%}')

    body, head = framing(base_a, visible, W, H)
    (out / 'meta.json').write_text(
        json.dumps(
            {'size': [W, H], 'items': items, 'body': body, 'head': head},
            separators=(',', ':'),
        ),
        encoding='utf-8',
    )
    print(f'\n{len(items)} 件，画布 {W}×{H}')
    print(f'全身取景 {body}')
    print(f'头肩取景 {head}')


def framing(base_alpha: np.ndarray, visible: dict, W: int, H: int):
    """算两个取景框，写进 meta 里，省得每换一套素材就回去改代码里的常量。

    画布两边留了大片空白（画的时候要给球拍留地方），
    按整张画布缩放的话人小得看不清脸 —— 所以全身要框到人身上，
    头像还要再往里框到头肩，不然缩进小圆圈里认不出是谁。

    传进来的是每件装备「真画出来的那一块」，不是它的区域框。
    区域框会比实际画面大一圈：发光装备的辉光糊在绿幕上，抠像判成背景
    抠掉了，区域却还算它在内。按区域取景，就为了一圈透明的边把人缩小。
    """
    ys, xs = np.where(base_alpha > 128)
    px0, px1 = int(xs.min() * SCALE), int(xs.max() * SCALE)
    py0, py1 = int(ys.min() * SCALE), int(ys.max() * SCALE)

    # 全身：人 + 所有装备图层的并集。装备会伸到人形之外 ——
    # 球拍往左挥、发光的鞋往下探，只框人形会把它们切掉
    x0, y0, x1, y1 = px0, py0, px1, py1
    for b in visible.values():
        x0, y0 = min(x0, b['x']), min(y0, b['y'])
        x1, y1 = max(x1, b['x'] + b['w']), max(y1, b['y'] + b['h'])
    pad = round(H * 0.02)
    body = {
        'x': max(0, x0 - pad),
        'y': max(0, y0 - pad),
        'w': min(W, x1 + pad) - max(0, x0 - pad),
        'h': min(H, y1 + pad) - max(0, y0 - pad),
    }

    # 头肩：从头顶往下取一个正方形。0.29 是按这套画风的头身比来的，
    # 换成写实比例的素材要重调
    side = round((py1 - py0) * 0.29)
    cx = (px0 + px1) // 2
    head = {
        'x': max(0, min(cx - side // 2, W - side)),
        'y': max(0, min(py0 - round(side * 0.08), H - side)),
        'w': side,
        'h': side,
    }
    return body, head


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
