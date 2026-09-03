#!/usr/bin/env python3
"""
生成 RALLY 使用指南 PDF（图解版）。

    python3 docs/make-guide.py

第一版是一份文字说明书，用户的反馈是「太多字了，用图解释」。所以这一版
反过来：画界面、画箭头、画流程，文字只留标签和一句话。

为什么整页用 canvas 直接画，而不是用 Platypus 的文档流：这份东西的主体
是示意图 —— 手机框、卡片、箭头、连线，位置都是精确摆的。用文档流去凑
这种版面，比直接给坐标麻烦得多。

两个踩过的坑，写下来免得再踩：

  1. 文泉驿正黑没有 ✓ 和 ✕（U+2713 / U+2715）。缺字不报错、直接印成
     空白 —— 上一版就栽在这上面：字体没有 U+2212（真减号），
     「输一场 −10」印出来变成「输一场 10」，规则当场讲反。
     所以那两个符号是用矢量线画的，而且每次构建前都跑一遍 check_glyphs()。
  2. 字体必须嵌进 PDF。不嵌的话没装中文字体的设备打开是一片方框，
     而这份东西是要发到群里给各种手机电脑打开的。
"""

import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4  # noqa: F401  （只用它的宽度）
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdfcanvas

FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
FONT = "WQY"
pdfmetrics.registerFont(TTFont(FONT, FONT_PATH, subfontIndex=0))

# 页面比 A4 矮一截。
#
# 这份东西是发到群里、在手机上看的，不是拿去打印的。用 A4 的话每页
# 底下空掉三成 —— 内容就那么多，纸太长而已。裁短之后每一屏看到的
# 信息更多，也不用一直往下划。宽度保持 A4，真要打印照样放得下。
W = A4[0]
H = 232 * mm
BRAND = colors.HexColor("#0d8f83")
BRAND_L = colors.HexColor("#e6f4f2")
INK = colors.HexColor("#1c2b2a")
MUTED = colors.HexColor("#7a8c8a")
LINE = colors.HexColor("#cdddda")
FILL = colors.HexColor("#f4f9f8")
WARN = colors.HexColor("#c2410c")
WARN_L = colors.HexColor("#fdf0e6")
DIM = colors.HexColor("#b9c7c5")
GOLD = colors.HexColor("#d99a1e")

APP_URL = "https://yongyi93-code.github.io/badminton-scoring/"


def Y(top_mm):
    """从页面顶部量的坐标，换成 reportlab 的左下原点坐标"""
    return H - top_mm * mm


# ------------------------------------------------------------------ #
# 基础画笔
# ------------------------------------------------------------------ #

#: 所有真正画到纸上的字符。给 check_glyphs() 用。
DRAWN = set()


def text(c, x, y, s, size=9, color=INK, align="l"):
    DRAWN.update(s)
    c.setFont(FONT, size)
    c.setFillColor(color)
    if align == "c":
        c.drawCentredString(x, y, s)
    elif align == "r":
        c.drawRightString(x, y, s)
    else:
        c.drawString(x, y, s)


def box(c, x, y, w, h, r=3, fill=None, stroke=LINE, lw=0.8):
    c.setLineWidth(lw)
    if fill:
        c.setFillColor(fill)
    if stroke:
        c.setStrokeColor(stroke)
    c.roundRect(x, y, w, h, r, stroke=1 if stroke else 0, fill=1 if fill else 0)


def arrow(c, x1, y1, x2, y2, color=BRAND, lw=1.4, head=2.6):
    """只画横平竖直的箭头 —— 斜的在这种示意图里只会显得乱"""
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(lw)
    c.line(x1, y1, x2, y2)
    if x2 > x1:
        c.lines([(x2, y2, x2 - head, y2 + head), (x2, y2, x2 - head, y2 - head)])
    elif x2 < x1:
        c.lines([(x2, y2, x2 + head, y2 + head), (x2, y2, x2 + head, y2 - head)])
    elif y2 < y1:
        c.lines([(x2, y2, x2 - head, y2 + head), (x2, y2, x2 + head, y2 + head)])
    else:
        c.lines([(x2, y2, x2 - head, y2 - head), (x2, y2, x2 + head, y2 - head)])


def tick(c, x, y, s=4, color=BRAND, lw=1.8):
    """对勾。字体里没有 ✓，只能画"""
    c.setStrokeColor(color)
    c.setLineWidth(lw)
    c.setLineCap(1)
    c.lines([
        (x - s, y, x - s * 0.25, y - s * 0.7),
        (x - s * 0.25, y - s * 0.7, x + s, y + s * 0.75),
    ])
    c.setLineCap(0)


def cross(c, x, y, s=4, color=WARN, lw=1.8):
    """叉。字体里也没有 ✕"""
    c.setStrokeColor(color)
    c.setLineWidth(lw)
    c.setLineCap(1)
    c.lines([(x - s, y - s, x + s, y + s), (x - s, y + s, x + s, y - s)])
    c.setLineCap(0)


def badge(c, x, y, n, r=5.2, color=BRAND):
    """步骤编号的实心圆"""
    c.setFillColor(color)
    c.circle(x, y, r, stroke=0, fill=1)
    c.setFont(FONT, r * 1.45)
    c.setFillColor(colors.white)
    c.drawCentredString(x, y - r * 0.52, str(n))


def note(c, x, y, w, lines, tone="tip"):
    """
    提示条。只分两档颜色：一般是品牌色，会踩坑的是橙色 ——
    再多档就没人分得清哪个更要紧。返回这一块的高度。
    """
    edge = WARN if tone == "warn" else BRAND
    bg = WARN_L if tone == "warn" else FILL
    lh = 5.2 * mm
    h = lh * len(lines) + 3.5 * mm
    c.setFillColor(bg)
    c.roundRect(x, y - h, w, h, 2, stroke=0, fill=1)
    c.setFillColor(edge)
    c.rect(x, y - h, 2.2, h, stroke=0, fill=1)
    for i, ln in enumerate(lines):
        text(c, x + 6 * mm, y - 5.6 * mm - i * lh, ln, 8.6, INK)
    return h


# ------------------------------------------------------------------ #
# 手机与界面元件
# ------------------------------------------------------------------ #

def phone(c, x, y, w=44 * mm, h=80 * mm, label=None):
    """
    一台手机的外框，返回屏幕内容区 (sx, sy, sw, sh)。

    画得很简：圆角矩形 + 顶部一道听筒。示意图不需要像素级还原，
    需要的是「一眼看出这是手机屏幕」。
    """
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor("#9fb3b0"))
    c.setLineWidth(1.1)
    c.roundRect(x, y, w, h, 5, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#c9d6d4"))
    c.roundRect(x + w / 2 - 6, y + h - 5, 12, 2, 1, stroke=0, fill=1)
    if label:
        text(c, x + w / 2, y - 5.5 * mm, label, 8.4, MUTED, "c")
    pad = 3
    return x + pad, y + pad, w - pad * 2, h - 8


def tabbar(c, sx, sy, sw, highlight=None):
    """底部五项导航。highlight 传 0-4"""
    bh = 9 * mm
    c.setFillColor(colors.HexColor("#fbfdfd"))
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.rect(sx, sy, sw, bh, stroke=1, fill=1)
    names = ["首页", "球局", "", "发现", "我的"]
    step = sw / 5
    for i, nm in enumerate(names):
        cx = sx + step * (i + 0.5)
        if i == 2:
            c.setFillColor(BRAND)
            c.circle(cx, sy + bh * 0.55, 5.2, stroke=0, fill=1)
            c.setStrokeColor(colors.white)
            c.setLineWidth(1.3)
            c.lines([
                (cx - 2.4, sy + bh * 0.55, cx + 2.4, sy + bh * 0.55),
                (cx, sy + bh * 0.55 - 2.4, cx, sy + bh * 0.55 + 2.4),
            ])
            continue
        col = BRAND if highlight == i else MUTED
        c.setFillColor(col)
        c.circle(cx, sy + bh * 0.68, 1.9, stroke=0, fill=1)
        text(c, cx, sy + bh * 0.2, nm, 5.6, col, "c")
    return bh


def ui_card(c, x, y, w, h, title, sub=None, btn=None, tone="normal", title_size=7.6):
    """屏幕里的一张卡片。tone: normal / brand / dim"""
    bg = {"normal": colors.white, "brand": BRAND_L, "dim": colors.HexColor("#f2f4f4")}[tone]
    edge = {"normal": LINE, "brand": BRAND, "dim": LINE}[tone]
    box(c, x, y, w, h, 2.5, fill=bg, stroke=edge, lw=0.7)
    tcol = DIM if tone == "dim" else INK
    text(c, x + 2.5 * mm, y + h - 4.6 * mm, title, title_size, tcol)
    if sub:
        text(c, x + 2.5 * mm, y + h - 8.4 * mm, sub, 6, DIM if tone == "dim" else MUTED)
    if btn:
        label, bt = btn
        bw, bh = 13 * mm, 5.2 * mm
        bx, by = x + w - bw - 2.5 * mm, y + (h - bh) / 2
        fill = {"primary": BRAND, "soft": colors.HexColor("#e4e9e9")}[bt]
        box(c, bx, by, bw, bh, 2.2, fill=fill, stroke=None)
        text(c, bx + bw / 2, by + 1.8 * mm, label, 6.4,
             colors.white if bt == "primary" else MUTED, "c")
    return h


def section(c, top_mm, num, title, sub=None):
    """一节的大标题 + 底下那条线。返回下一块内容该从哪个 y 开始"""
    y = Y(top_mm)
    badge(c, 20 * mm + 5.4, y + 2.4, num, 5.4)
    text(c, 29 * mm, y, title, 15, BRAND)
    c.setStrokeColor(BRAND)
    c.setLineWidth(1.2)
    c.line(20 * mm, y - 3.4 * mm, W - 20 * mm, y - 3.4 * mm)
    if sub:
        text(c, 20 * mm, y - 9 * mm, sub, 8.6, MUTED)
        return y - 15 * mm
    return y - 10 * mm


def footer(c, page):
    if page == 0:
        return
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(20 * mm, 15 * mm, W - 20 * mm, 15 * mm)
    text(c, 20 * mm, 11 * mm, "RALLY 使用指南", 7.4, MUTED)
    text(c, W - 20 * mm, 11 * mm, str(page), 7.4, MUTED, "r")


# ------------------------------------------------------------------ #
# 各页
# ------------------------------------------------------------------ #

def page_cover(c):
    c.setFillColor(BRAND)
    c.rect(0, H - 6 * mm, W, 6 * mm, stroke=0, fill=1)

    text(c, W / 2, Y(30), "RALLY", 46, BRAND, "c")
    text(c, W / 2, Y(40), "羽球社交竞技平台", 12, MUTED, "c")

    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.line(W / 2 - 20 * mm, Y(47), W / 2 + 20 * mm, Y(47))

    text(c, W / 2, Y(57), "使 用 指 南", 19, INK, "c")
    text(c, W / 2, Y(65), "全部用图说明", 9.6, MUTED, "c")

    px = W / 2 - 24 * mm
    py = Y(198)
    sx, sy, sw, sh = phone(c, px, py, 48 * mm, 118 * mm)
    text(c, sx + 3 * mm, sy + sh - 5.5 * mm, "RALLY", 9, BRAND)
    ui_card(c, sx + 2.5 * mm, sy + sh - 32 * mm, sw - 5 * mm, 20 * mm,
            "今晚去打球？", "开一个球局", tone="brand")
    ui_card(c, sx + 2.5 * mm, sy + sh - 56 * mm, sw - 5 * mm, 20 * mm,
            "力天羽球馆", "阿伟开的 · 4/8 人", btn=("加入", "primary"))
    ui_card(c, sx + 2.5 * mm, sy + sh - 80 * mm, sw - 5 * mm, 20 * mm,
            "城中羽球馆", "9月3日 · 12 场")
    tabbar(c, sx, sy, sw, highlight=0)

    text(c, W / 2, Y(212), APP_URL, 8.6, MUTED, "c")


def page_start(c):
    y = section(c, 26, 1, "三步开始", "五分钟以内")

    pw, ph = 52 * mm, 108 * mm
    gap = (W - 40 * mm - pw * 3) / 2
    xs = [20 * mm + i * (pw + gap) for i in range(3)]
    py = y - ph - 16 * mm

    # ① 打开网址
    sx, sy, sw, sh = phone(c, xs[0], py, pw, ph, "① 手机浏览器打开")
    box(c, sx + 2 * mm, sy + sh - 10 * mm, sw - 4 * mm, 5.5 * mm, 2.5,
        fill=colors.HexColor("#eef2f2"), stroke=None)
    text(c, sx + sw / 2, sy + sh - 8.3 * mm, "github.io/badminton-scoring", 5, MUTED, "c")
    text(c, sx + sw / 2, sy + sh / 2 - 2 * mm, "RALLY", 20, BRAND, "c")

    # ② 加到主屏幕
    sx, sy, sw, sh = phone(c, xs[1], py, pw, ph, "② 加到主屏幕")
    text(c, sx + sw / 2, sy + sh - 18 * mm, "分享", 10, MUTED, "c")
    arrow(c, sx + sw / 2, sy + sh - 23 * mm, sx + sw / 2, sy + sh - 34 * mm)
    box(c, sx + 4 * mm, sy + sh - 48 * mm, sw - 8 * mm, 12 * mm, 2.5, fill=BRAND_L, stroke=BRAND)
    text(c, sx + sw / 2, sy + sh - 44 * mm, "加入主屏幕", 9.4, BRAND, "c")
    arrow(c, sx + sw / 2, sy + sh - 51 * mm, sx + sw / 2, sy + sh - 62 * mm)
    c.setFillColor(BRAND)
    c.roundRect(sx + sw / 2 - 8 * mm, sy + 20 * mm, 16 * mm, 16 * mm, 4, stroke=0, fill=1)
    text(c, sx + sw / 2, sy + 25 * mm, "R", 19, colors.white, "c")
    text(c, sx + sw / 2, sy + 14 * mm, "RALLY", 7.4, MUTED, "c")

    # ③ 注册 + 建自己
    sx, sy, sw, sh = phone(c, xs[2], py, pw, ph, "③ 注册，建一个你自己")
    box(c, sx + 3 * mm, sy + sh - 22 * mm, sw - 6 * mm, 7 * mm, 1.5, fill=colors.white, stroke=LINE)
    text(c, sx + 5 * mm, sy + sh - 19.5 * mm, "邮箱", 7.4, MUTED)
    box(c, sx + 3 * mm, sy + sh - 34 * mm, sw - 6 * mm, 7 * mm, 1.5, fill=colors.white, stroke=LINE)
    text(c, sx + 5 * mm, sy + sh - 31.5 * mm, "密码（至少 6 位）", 7.4, MUTED)
    box(c, sx + 3 * mm, sy + sh - 48 * mm, sw - 6 * mm, 8.5 * mm, 2, fill=BRAND, stroke=None)
    text(c, sx + sw / 2, sy + sh - 45 * mm, "注册并登录", 8.6, colors.white, "c")
    arrow(c, sx + sw / 2, sy + sh - 52 * mm, sx + sw / 2, sy + sh - 64 * mm)
    box(c, sx + 3 * mm, sy + sh - 78 * mm, sw - 6 * mm, 11 * mm, 2, fill=BRAND_L, stroke=BRAND)
    text(c, sx + sw / 2, sy + sh - 74 * mm, "建一个你自己", 9.4, BRAND, "c")
    text(c, sx + sw / 2, sy + 14 * mm, "填名字 · 选男女", 7.6, MUTED, "c")

    for i in range(2):
        ax = xs[i] + pw + gap / 2
        arrow(c, ax - 4.5 * mm, py + ph / 2, ax + 4.5 * mm, py + ph / 2, lw=1.8, head=3.4)

    note(c, 20 * mm, py - 16 * mm, W - 40 * mm, [
        "iPhone 一定要做第 ② 步：只有从主屏幕那个图标打开，才收得到「有人开球局」的通知。",
        "第 ③ 步要先登录再建角色 —— 不登录建的人只活在这台手机上，下次登录会被覆盖掉。",
    ], tone="warn")


def page_nav(c):
    y = section(c, 26, 2, "底下五个按钮", "四个是地方，中间那个是动作")

    pw, ph = 60 * mm, 128 * mm
    px = 22 * mm
    py = y - ph - 12 * mm
    sx, sy, sw, sh = phone(c, px, py, pw, ph)
    text(c, sx + 3 * mm, sy + sh - 5.5 * mm, "RALLY", 9, BRAND)
    ui_card(c, sx + 2.5 * mm, sy + sh - 32 * mm, sw - 5 * mm, 19 * mm,
            "最新消息", "阿伟：周五改去力天")
    ui_card(c, sx + 2.5 * mm, sy + sh - 56 * mm, sw - 5 * mm, 19 * mm,
            "力天羽球馆", "进行中 · 6 人", tone="brand")
    ui_card(c, sx + 2.5 * mm, sy + sh - 80 * mm, sw - 5 * mm, 19 * mm,
            "城中羽球馆", "小林开的 · 2/8", btn=("加入", "primary"))
    bh = tabbar(c, sx, sy, sw)

    items = [
        ("首页", "最新消息、你在的球局、别人开的局"),
        ("球局", "全部球局，翻历史用这里"),
        ("＋", "开一场新球局"),
        ("发现", "全体排名、你常去的球馆"),
        ("我的", "段位战绩、角色、登录、开局提醒"),
    ]
    step = sw / 5
    lx = px + pw + 12 * mm
    top = y - 22 * mm
    row = 23 * mm
    for i, (nm, desc) in enumerate(items):
        ty = top - i * row
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.setDash(1.5, 1.5)
        c.line(sx + step * (i + 0.5), sy + bh + 1.5 * mm, lx - 5 * mm, ty + 1.2 * mm)
        c.setDash()
        c.setFillColor(BRAND if i == 2 else colors.HexColor("#dfeceb"))
        c.circle(lx - 2.4 * mm, ty + 1.4 * mm, 1.8 * mm, stroke=0, fill=1)
        text(c, lx + 1.5 * mm, ty, nm, 10.5, BRAND)
        text(c, lx + 1.5 * mm, ty - 5.2 * mm, desc, 8, MUTED)


def page_session(c):
    y = section(c, 26, 3, "开局 · 加入")

    text(c, 20 * mm, y, "点中间的 ＋ ，四步走完就开局", 10, INK)
    bw = (W - 40 * mm - 3 * 5 * mm) / 4
    by = y - 27 * mm
    four = [("在哪打", ["球馆 · 场地数", "人数上限"]),
            ("怎么打", ["自由 / 轮转", "双打 / 单打"]),
            ("规矩", ["多少分一局", "几局几胜"]),
            ("谁来了", ["勾到场的人", "后到的自己加"])]
    for i, (t1, t2) in enumerate(four):
        bx = 20 * mm + i * (bw + 5 * mm)
        box(c, bx, by, bw, 21 * mm, 3, fill=FILL, stroke=LINE)
        badge(c, bx + 6 * mm, by + 15.5 * mm, i + 1, 4.4)
        text(c, bx + 11 * mm, by + 14 * mm, t1, 9.4, INK)
        for j, ln in enumerate(t2):
            text(c, bx + 4 * mm, by + 8 * mm - j * 4.4 * mm, ln, 7, MUTED)
        if i < 3:
            arrow(c, bx + bw + 0.8 * mm, by + 10.5 * mm, bx + bw + 4.2 * mm, by + 10.5 * mm, lw=1.2)

    note(c, 20 * mm, by - 5 * mm, W - 40 * mm, [
        "一个人就能开局 —— 开了之后别人在自己首页看得见，会自己加进来。",
    ])

    y2 = by - 24 * mm
    text(c, 20 * mm, y2, "别人开了局，你首页就会出现", 10, INK)
    cw = 84 * mm
    cy = y2 - 21 * mm
    ui_card(c, 20 * mm, cy, cw, 16 * mm, "力天羽球馆", "阿伟开的 · 4/8 人",
            btn=("加入", "primary"), title_size=9)
    arrow(c, 20 * mm + cw + 4 * mm, cy + 8 * mm, 20 * mm + cw + 13 * mm, cy + 8 * mm, lw=1.6, head=3)
    tick(c, 20 * mm + cw + 21 * mm, cy + 8 * mm, 4.5)
    text(c, 20 * mm + cw + 28 * mm, cy + 6.4 * mm, "点一下就进去了", 9, INK)

    y3 = cy - 16 * mm
    text(c, 20 * mm, y3, "同一时间只能在一场球局里", 10, INK)
    cw2 = 78 * mm
    cy2 = y3 - 21 * mm
    ui_card(c, 20 * mm, cy2, cw2, 16 * mm, "力天羽球馆", "你在这一场", tone="brand", title_size=9)
    tick(c, 20 * mm + cw2 - 7 * mm, cy2 + 8 * mm, 3.6)
    x2 = 20 * mm + cw2 + 13 * mm
    ui_card(c, x2, cy2, cw2, 16 * mm, "城中羽球馆", "小林开的 · 3/8",
            btn=("加不了", "soft"), tone="dim", title_size=9)
    cross(c, x2 - 6.5 * mm, cy2 + 8 * mm, 3.2)

    note(c, 20 * mm, cy2 - 5 * mm, W - 40 * mm, [
        "临时来不了：进球局页面，名单最下面点「我今天来不了，退出这个球局」。",
        "已经打过球的人退不掉 —— 那几场比赛还挂在你名下。",
    ])


def page_play(c):
    y = section(c, 26, 4, "打球 · 结束", "排场 → 记分 → 结算")

    pw, ph = 52 * mm, 112 * mm
    gap = (W - 40 * mm - pw * 3) / 2
    xs = [20 * mm + i * (pw + gap) for i in range(3)]
    py = y - ph - 14 * mm

    # ① 排下一场
    sx, sy, sw, sh = phone(c, xs[0], py, pw, ph, "① 点「排下一场」")
    text(c, sx + 3 * mm, sy + sh - 5.5 * mm, "谁该上场", 8, INK)
    for i in range(4):
        yy = sy + sh - 20 * mm - i * 11 * mm
        box(c, sx + 2.5 * mm, yy, sw - 5 * mm, 9 * mm, 1.8, fill=colors.white, stroke=LINE)
        c.setFillColor(colors.HexColor("#dfeceb"))
        c.circle(sx + 6.5 * mm, yy + 4.5 * mm, 2.6 * mm, stroke=0, fill=1)
        text(c, sx + 11 * mm, yy + 3 * mm, ["阿伟", "小林", "阿明", "Yy"][i], 8, INK)
        text(c, sx + sw - 3.5 * mm, yy + 3 * mm, f"打了 {3 - i} 场", 6.4, MUTED, "r")
    box(c, sx + 2.5 * mm, sy + 5 * mm, sw - 5 * mm, 9 * mm, 2, fill=BRAND, stroke=None)
    text(c, sx + sw / 2, sy + 8 * mm, "排下一场", 9, colors.white, "c")
    text(c, sx + sw / 2, sy + 18 * mm, "按休息久、水平搭自动配", 6.4, MUTED, "c")

    # ② 记分
    sx, sy, sw, sh = phone(c, xs[1], py, pw, ph, "② 得分点一下")
    text(c, sx + sw / 2, sy + sh - 6 * mm, "1 号场", 6.4, MUTED, "c")
    hw = (sw - 6 * mm) / 2
    box(c, sx + 2.5 * mm, sy + sh - 56 * mm, hw, 44 * mm, 2.5,
        fill=colors.HexColor("#eef5fb"), stroke=colors.HexColor("#a8c8e4"))
    text(c, sx + 2.5 * mm + hw / 2, sy + sh - 32 * mm, "21", 27, colors.HexColor("#2f6690"), "c")
    text(c, sx + 2.5 * mm + hw / 2, sy + sh - 50 * mm, "阿伟 / 小林", 6.6, MUTED, "c")
    box(c, sx + sw / 2 + 0.5 * mm, sy + sh - 56 * mm, hw, 44 * mm, 2.5,
        fill=colors.HexColor("#fdeeee"), stroke=colors.HexColor("#e4a8a8"))
    text(c, sx + sw / 2 + 0.5 * mm + hw / 2, sy + sh - 32 * mm, "18", 27, colors.HexColor("#9e3b3b"), "c")
    text(c, sx + sw / 2 + 0.5 * mm + hw / 2, sy + sh - 50 * mm, "阿明 / Yy", 6.6, MUTED, "c")
    text(c, sx + sw / 2, sy + 16 * mm, "记错了？", 8.6, INK, "c")
    text(c, sx + sw / 2, sy + 9 * mm, "有退回按钮，一分一分退", 7, MUTED, "c")

    # ③ 结算
    sx, sy, sw, sh = phone(c, xs[2], py, pw, ph, "③ 右上角「结束」")
    text(c, sx + sw / 2, sy + sh - 6 * mm, "今晚结算", 8.4, BRAND, "c")
    for i, (k, v) in enumerate([("出席", "6 人"), ("打了", "12 场"), ("人均", "RM 15")]):
        yy = sy + sh - 18 * mm - i * 9 * mm
        text(c, sx + 4 * mm, yy, k, 8, MUTED)
        text(c, sx + sw - 4 * mm, yy, v, 8, INK, "r")
    box(c, sx + 2.5 * mm, sy + sh - 62 * mm, sw - 5 * mm, 14 * mm, 2, fill=BRAND_L, stroke=BRAND)
    c.setFillColor(GOLD)
    c.circle(sx + 8.5 * mm, sy + sh - 55 * mm, 3.2 * mm, stroke=0, fill=1)
    text(c, sx + 14 * mm, sy + sh - 57 * mm, "今晚 MVP　阿伟", 8.4, INK)
    text(c, sx + 4 * mm, sy + sh - 72 * mm, "今晚排名", 8, MUTED)
    for i in range(3):
        yy = sy + sh - 80 * mm - i * 7 * mm
        text(c, sx + 4 * mm, yy, f"{i + 1}.", 7.4, MUTED)
        text(c, sx + 10 * mm, yy, ["阿伟", "Yy", "小林"][i], 7.4, INK)

    for i in range(2):
        ax = xs[i] + pw + gap / 2
        arrow(c, ax - 4.5 * mm, py + ph / 2, ax + 4.5 * mm, py + ph / 2, lw=1.8, head=3.4)

    note(c, 20 * mm, py - 16 * mm, W - 40 * mm, [
        "记得按「结束」—— 不按的话这一场会一直挂在「进行中」，也不会出结算。",
    ], tone="warn")


def page_rank(c):
    y = section(c, 26, 5, "排名 · 段位 · 金币")

    text(c, 20 * mm, y, "每打完一场", 10, INK)
    ry = y - 21 * mm
    cw = 52 * mm
    box(c, 20 * mm, ry, cw, 16 * mm, 3, fill=colors.HexColor("#eef7f2"), stroke=BRAND)
    text(c, 20 * mm + 6 * mm, ry + 8.8 * mm, "赢", 13, BRAND)
    text(c, 20 * mm + 17 * mm, ry + 9.6 * mm, "MMR +10", 10, INK)
    text(c, 20 * mm + 17 * mm, ry + 3.6 * mm, "金币 +10", 8, GOLD)

    bx2 = 20 * mm + cw + 8 * mm
    box(c, bx2, ry, cw, 16 * mm, 3, fill=colors.HexColor("#f7f0f0"),
        stroke=colors.HexColor("#c98b8b"))
    text(c, bx2 + 6 * mm, ry + 8.8 * mm, "输", 13, colors.HexColor("#9e3b3b"))
    text(c, bx2 + 17 * mm, ry + 9.6 * mm, "MMR -10", 10, INK)
    text(c, bx2 + 17 * mm, ry + 3.6 * mm, "金币不扣", 8, MUTED)

    note(c, 20 * mm, ry - 5 * mm, W - 40 * mm, [
        "MMR 最低到 0 为止，不会变成负数。赢比自己强的队伍算「爆冷」，加倍给分。",
    ])

    y2 = ry - 27 * mm
    text(c, 20 * mm, y2, "MMR 到了就自动升段", 10, INK)
    tiers = [("先锋", 0), ("卫士", 50), ("中军", 100), ("统帅", 150),
             ("传奇", 300), ("万古", 400), ("超凡", 500), ("冠绝", 700)]
    tcolors = ["#8fa07d", "#9fb0bf", "#5fb8a8", "#7fc47f",
               "#e3b344", "#b98cd8", "#7fb3ff", "#ff8a3d"]
    bw = (W - 40 * mm) / 8
    base = y2 - 42 * mm
    for i, ((nm, mn), col) in enumerate(zip(tiers, tcolors)):
        bx = 20 * mm + i * bw
        bh = 5 * mm + i * 3.3 * mm
        c.setFillColor(colors.HexColor(col))
        c.roundRect(bx + 1.6 * mm, base, bw - 3.2 * mm, bh, 1.5, stroke=0, fill=1)
        text(c, bx + bw / 2, base + bh + 2 * mm, nm, 7.6, INK, "c")
        text(c, bx + bw / 2, base - 4.6 * mm, str(mn), 6.4, MUTED, "c")
    text(c, W / 2, base - 10 * mm, "↑ 升上去需要的 MMR", 6.6, MUTED, "c")

    y3 = base - 20 * mm
    text(c, 20 * mm, y3, "三种排行榜，口径不一样", 10, INK)
    cols = [("今晚排名", "只算这一场", "按胜率"),
            ("球馆排行榜", "只算那个馆", "按胜率"),
            ("全体排名", "所有人一起", "按 MMR")]
    cw2 = (W - 40 * mm - 2 * 6 * mm) / 3
    cy = y3 - 27 * mm
    for i, (t1, t2, t3) in enumerate(cols):
        bx = 20 * mm + i * (cw2 + 6 * mm)
        hl = i == 2
        box(c, bx, cy, cw2, 21 * mm, 3, fill=BRAND_L if hl else FILL, stroke=BRAND if hl else LINE)
        text(c, bx + cw2 / 2, cy + 14.5 * mm, t1, 9.4, BRAND if hl else INK, "c")
        text(c, bx + cw2 / 2, cy + 9 * mm, t2, 7.4, MUTED, "c")
        text(c, bx + cw2 / 2, cy + 3.5 * mm, t3, 8, INK, "c")

    note(c, 20 * mm, cy - 5 * mm, W - 40 * mm, [
        "同一个人在不同榜上名次不一样，是正常的 —— 胜率离开范围就没意义。",
    ])


def page_faq(c):
    y = section(c, 26, 6, "遇到问题")

    rows = [
        ("换手机 / 换浏览器",
         "登录一下就全回来了。不要重新建角色 —— 那会变成两个你。"),
        ("忘记密码",
         "登录弹层点「忘记密码了？」→ 收件箱点链接（翻一下垃圾邮件）→ 设新密码。"),
        ("界面怪怪的",
         "「我的」拉到最底下 → 点「检查更新」。版本号变了就是新版。"),
        ("看不到别人刚做的改动",
         "把 App 切到后台再切回来，会自动重新同步一次。"),
        ("加不进球局",
         "写「已满」= 人满了；写「加不了」= 你已经在别的球局里。"),
        ("退不出球局",
         "你已经在这一场里打过球了，那几场比赛还挂在你名下。"),
    ]
    rh = 19 * mm
    for i, (q, a) in enumerate(rows):
        yy = y - 4 * mm - i * (rh + 4 * mm) - rh
        box(c, 20 * mm, yy, W - 40 * mm, rh, 3, fill=colors.white, stroke=LINE)
        c.setFillColor(BRAND_L)
        c.roundRect(20 * mm, yy, 5 * mm, rh, 3, stroke=0, fill=1)
        c.setFillColor(BRAND)
        c.circle(22.5 * mm, yy + rh / 2, 1.6 * mm, stroke=0, fill=1)
        text(c, 29 * mm, yy + rh - 7 * mm, q, 10.4, INK)
        text(c, 29 * mm, yy + 5.5 * mm, a, 8.4, MUTED)

    last = y - 4 * mm - len(rows) * (rh + 4 * mm) - 6 * mm
    note(c, 20 * mm, last, W - 40 * mm, [
        "所有记录都在云端，每个人登录后看到的是同一份。",
        "手机没网照样能记分，联网之后自动补传上去。",
    ])
    text(c, W / 2, last - 21 * mm, "还有搞不定的，直接在群里问。", 9, MUTED, "c")


PAGES = [page_cover, page_start, page_nav, page_session, page_play, page_rank, page_faq]


def build(path):
    c = pdfcanvas.Canvas(path, pagesize=(W, H))
    c.setTitle("RALLY 使用指南")
    c.setAuthor("RALLY")
    c.setSubject("羽球社交竞技平台 · 图解使用指南")
    for i, fn in enumerate(PAGES):
        fn(c)
        footer(c, i)
        c.showPage()
    c.save()


def check_glyphs():
    """
    检查真正画上去的字，字体里有没有。

    缺字不会报错，直接印成空白 —— 上一版就栽在这上面：字体没有
    U+2212（真减号），「输一场 −10」印出来变成「输一场 10」，
    规则当场讲反。

    只看 DRAWN（text() 实际画过的字），不扫源码 —— 扫源码会把注释里
    举例用的那几个字符也算进来，误报一堆。
    """
    from fontTools.ttLib import TTCollection

    cmap = set(TTCollection(FONT_PATH).fonts[0].getBestCmap())
    return sorted(ch for ch in DRAWN if ord(ch) not in cmap and ch not in "\n\t")


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "RALLY-使用指南.pdf")
    build(out)
    miss = check_glyphs()
    if miss:
        raise SystemExit(
            "这些字符字体里没有，纸上会是空白："
            + " ".join(f"{ch}(U+{ord(ch):04X})" for ch in miss)
        )
    print("生成:", out, f"（画了 {len(DRAWN)} 种字符，全部有字形）")
