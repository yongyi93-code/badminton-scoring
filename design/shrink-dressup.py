"""把换装素材缩到「真的会被画出来」的那个尺寸。

    python3 design/shrink-dressup.py src/assets/dressup src/assets/dressup-m

extract-dressup.py 跑完之后跑这一步。可以重复跑 —— 已经够小的文件不动。

-------------------------------------------------------------------------
为什么要有这一步

素材是按 864×1152 的画布出的，而 App 里合成立绘的画布最大只开到
640px（见下面的 BUDGET）。也就是说每一张衣服都比它会被画出来的
尺寸大了一截，多出来的像素一个用户都没看见过，却每个人都要下载。

这一步不降画质，只是把从来没被显示过的像素扔掉：每个文件缩到
「它在所有用得到它的地方里，被画得最大的那一次」刚好够用的尺寸，
一个像素都不少。所以缩完之后任何一屏都不会被放大，肉眼没有差别。

编码参数和 extract-dressup.py 保持一致（图层 q92、掩膜无损）——
这一步只该改尺寸，不该顺手改画质。掩膜尤其不能转成有损：
它是拿来「按 alpha 擦」的，边缘糊一点就会在衣服周围留下毛边。

-------------------------------------------------------------------------
三个视图，各自画多大

App 里这套素材出现在三个地方，每个地方的画布上限不一样
（都在 src/components/Avatar.tsx 和 DressUp.tsx 里）：

    全身立绘   maxPx 640，取景框是 meta 里的 body（约 1114px 高）
    头肩头像   maxPx 256，取景框是 meta 里的 head（约 300px）
    商店小图   maxPx 200，取景框是那一件的框放大 1.2 倍

换算成「这张图要被画到多大」，取三者里最大的那个。
改了 App 里那三个数字，就要回来改 BUDGET 再跑一遍。

-------------------------------------------------------------------------
头肩那一档为什么要看像素、不能只看包围盒

裤子的包围盒又高又窄，上沿常常伸进头肩框里 —— 但那一块是透明的，
裤子并不会出现在头像上。只按包围盒判断的话，几乎每件衣服都会被
判成「头像里要用」，于是全都得按头像那档的高倍数保留，这一步就
基本白做了（实测：按包围盒算省 0%，按像素算省三成）。

所以真的去看那块区域里有没有画着东西。
"""

import io
import json
import os
import sys

from PIL import Image

# 和 App 里那三个 maxPx 对应
BUDGET = {'body': 640, 'head': 256, 'shop': 200}

# alpha 低于这个值当成没画东西 —— 抠图边缘总会留下几个近乎透明的点
INK = 8


def has_ink(im: Image.Image, box: dict, crop: dict) -> bool:
    """这张图在 crop 这块区域里，有没有真的画着东西"""
    x0, y0 = max(box['x'], crop['x']), max(box['y'], crop['y'])
    x1 = min(box['x'] + box['w'], crop['x'] + crop['w'])
    y1 = min(box['y'] + box['h'], crop['y'] + crop['h'])
    if x1 <= x0 or y1 <= y0:
        return False
    sx, sy = im.width / box['w'], im.height / box['h']
    part = im.crop((
        round((x0 - box['x']) * sx), round((y0 - box['y']) * sy),
        round((x1 - box['x']) * sx), round((y1 - box['y']) * sy),
    ))
    if part.width == 0 or part.height == 0:
        return False
    return part.getchannel('A').getextrema()[1] > INK


def shrink_dir(d: str) -> tuple[int, int]:
    meta = json.load(open(f'{d}/meta.json'))
    W, H = meta['size']
    body, head, items = meta['body'], meta['head'], meta['items']

    s_body = min(1, BUDGET['body'] / max(body['w'], body['h']))
    s_head = min(1, BUDGET['head'] / max(head['w'], head['h']))
    shop_of = lambda b: min(1, BUDGET['shop'] / min(max(b['w'], b['h']) * 1.2, W, H))

    jobs: list[tuple[str, int, int, bool]] = []

    for key, box in items.items():
        for suffix in ('', '.mask'):
            p = f'{d}/{key}{suffix}.webp'
            if not os.path.exists(p):
                continue
            im = Image.open(p).convert('RGBA')
            need = max(s_body, shop_of(box))
            if has_ink(im, box, head):
                need = max(need, s_head)
            jobs.append((p, max(1, round(box['w'] * need)), max(1, round(box['h'] * need)),
                         suffix == '.mask'))

    # 底图三个视图里都是整张画，所以按最吃分辨率的那一档留
    need_base = max(s_body, s_head, max(shop_of(b) for b in items.values()))
    jobs.append((f'{d}/base.webp', round(W * need_base), round(H * need_base), False))

    was = now = 0
    for p, tw, th, is_mask in jobs:
        im = Image.open(p).convert('RGBA')
        was += os.path.getsize(p)
        # 已经够小就别动 —— 这一步要能重复跑，而且绝不放大
        if tw >= im.width or th >= im.height:
            now += os.path.getsize(p)
            continue
        buf = io.BytesIO()
        small = im.resize((tw, th), Image.LANCZOS)
        if is_mask:
            small.save(buf, 'WEBP', lossless=True, method=6)
        else:
            small.save(buf, 'WEBP', quality=92, method=6)
        open(p, 'wb').write(buf.getvalue())
        now += len(buf.getvalue())
    return was, now


if __name__ == '__main__':
    dirs = sys.argv[1:]
    if not dirs:
        raise SystemExit(__doc__)
    total_was = total_now = 0
    for d in dirs:
        was, now = shrink_dir(d)
        total_was += was
        total_now += now
        print(f'{d}: {was/1024:.0f} KB → {now/1024:.0f} KB')
    if total_was:
        print(f'\n合计 {total_was/1024:.0f} KB → {total_now/1024:.0f} KB '
              f'（省 {100 - 100*total_now/total_was:.0f}%）')
        if total_now == total_was:
            print('一个字节都没少 —— 说明已经缩过了，或者 BUDGET 调大了')
