#!/usr/bin/env python3
"""
生成 RALLY 使用指南 PDF。

    python3 docs/make-guide.py

留着这个脚本而不是只留 PDF：App 一直在改，指南得跟着改。改文字比
重做一份排版省事得多，而且下次谁来改都看得懂。

字体用系统里的文泉驿正黑并且嵌进 PDF —— 不嵌的话，没装中文字体的
电脑打开会是一片方框，而这份东西多半要发到群里给各种设备打开。
"""

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

FONT = "WQY"
pdfmetrics.registerFont(
    TTFont(FONT, "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", subfontIndex=0)
)
# 这套字体只有一个字重。把粗体也指到同一个文件，<b> 标签才不会报错，
# 层级改用字号和颜色来区分。
pdfmetrics.registerFontFamily(FONT, normal=FONT, bold=FONT, italic=FONT, boldItalic=FONT)

BRAND = colors.HexColor("#0d8f83")
INK = colors.HexColor("#1c2b2a")
MUTED = colors.HexColor("#6b7d7b")
LINE = colors.HexColor("#d8e3e1")
FILL = colors.HexColor("#f1f7f6")
WARN = colors.HexColor("#b45309")

APP_URL = "https://yongyi93-code.github.io/badminton-scoring/"


def style(name, size, leading, color=INK, space_before=0, space_after=0, **kw):
    return ParagraphStyle(
        name,
        fontName=FONT,
        fontSize=size,
        leading=leading,
        textColor=color,
        spaceBefore=space_before,
        spaceAfter=space_after,
        **kw,
    )


S = {
    "cover_title": style("ct", 44, 52, BRAND, space_after=6, alignment=TA_CENTER),
    "cover_sub": style("cs", 13, 20, MUTED, alignment=TA_CENTER),
    "cover_note": style("cn", 10, 16, MUTED, alignment=TA_CENTER),
    "h1": style("h1", 19, 26, BRAND, space_before=2, space_after=8),
    "h2": style("h2", 13, 19, INK, space_before=11, space_after=4),
    "body": style("b", 10.5, 17, INK, space_after=5),
    "muted": style("m", 9.5, 15, MUTED, space_after=4),
    "step": style("s", 10.5, 17, INK, space_after=3, leftIndent=15, firstLineIndent=-15),
    "cell": style("c", 9.5, 14.5, INK),
    "cell_key": style("ck", 9.5, 14.5, BRAND),
    "tip": style("t", 9.5, 15, INK),
}


def rule_after(title):
    """
    标题 + 底下那条细线。

    用 KeepTogether 把标题、细线和后面第一段绑在一起 —— 不绑的话，
    正文自然流动时会出现「标题孤零零留在页底、内容翻到下一页」，
    那是排版里最显眼的一种难看。
    """
    t = Table([[""]], colWidths=[165 * mm], rowHeights=[1.4])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), BRAND)]))
    return [Spacer(1, 6), KeepTogether([Paragraph(title, S["h1"]), t]), Spacer(1, 9)]


def box(lines, tone="tip"):
    """
    提示框。颜色只分两档：一般提示用品牌色，会踩坑的用橙色 ——
    再多就没人分得清哪个更要紧。
    """
    edge = WARN if tone == "warn" else BRAND
    bg = colors.HexColor("#fdf6ec") if tone == "warn" else FILL
    inner = [[Paragraph(x, S["tip"])] for x in lines]
    t = Table(inner, colWidths=[157 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, -1), 2.5, edge),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return [Spacer(1, 3), t, Spacer(1, 7)]


def kv_table(rows, key_w=42):
    data = [
        [Paragraph(k, S["cell_key"]), Paragraph(v, S["cell"])] for k, v in rows
    ]
    t = Table(data, colWidths=[key_w * mm, (165 - key_w) * mm])
    t.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.6, LINE),
                ("BACKGROUND", (0, 0), (0, -1), FILL),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return [Spacer(1, 2), t, Spacer(1, 8)]


def steps(items):
    return [Paragraph(f"{i + 1}.&nbsp;&nbsp;{x}", S["step"]) for i, x in enumerate(items)]


def bullets(items):
    return [Paragraph(f"·&nbsp;&nbsp;{x}", S["step"]) for x in items]


# ------------------------------------------------------------------ #
# 页眉页脚
# ------------------------------------------------------------------ #

def decorate(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setFont(FONT, 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(22 * mm, 12 * mm, "RALLY 使用指南")
        canvas.drawRightString(188 * mm, 12 * mm, str(page - 1))
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(22 * mm, 16 * mm, 188 * mm, 16 * mm)
    canvas.restoreState()


def build(path):
    doc = BaseDocTemplate(
        path,
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title="RALLY 使用指南",
        author="RALLY",
        subject="羽球社交竞技平台 · 使用指南",
    )
    frame = Frame(
        doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main",
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=decorate)])
    doc.build(story())


# ------------------------------------------------------------------ #
# 正文
# ------------------------------------------------------------------ #

def story():
    f = []

    # ---- 封面 ----
    f += [
        Spacer(1, 58 * mm),
        Paragraph("RALLY", S["cover_title"]),
        Paragraph("羽球社交竞技平台", S["cover_sub"]),
        Spacer(1, 4),
        Paragraph("使用指南", S["cover_sub"]),
        Spacer(1, 26 * mm),
        Paragraph(
            "开局、加入、记分、排名、升段 —— 一处完成", S["cover_note"]
        ),
        Spacer(1, 8),
        Paragraph(APP_URL, S["cover_note"]),
        PageBreak(),
    ]

    # ---- 1 第一次使用 ----
    f += rule_after("一、第一次使用")
    f += [Paragraph("三步就能开始，五分钟以内。", S["body"])]
    f += [Paragraph("第 1 步　打开网址", S["h2"])]
    f += [Paragraph(f"用手机浏览器打开：{APP_URL}", S["body"])]

    f += [Paragraph("第 2 步　加到主屏幕", S["h2"])]
    f += bullets(
        [
            "<b>iPhone</b>：Safari 底部「分享」按钮 → 往下找「加入主屏幕」→ 添加",
            "<b>Android</b>：Chrome 右上角「三个点」的菜单→「添加到主屏幕」",
        ]
    )
    f += box(
        [
            "<b>这一步别跳过。</b>iPhone 上只有从主屏幕那个图标打开，才收得到「有人开球局」的通知 —— "
            "Safari 标签页里根本没有这个能力，这是苹果的限制，不是 App 的问题。",
            "而且加到主屏幕之后打开更快、没有浏览器地址栏，用起来就跟一个正经 App 一样。",
        ],
        tone="warn",
    )

    f += [Paragraph("第 3 步　注册，建一个你自己", S["h2"])]
    f += steps(
        [
            "点右下角「我的」",
            "点「登录 / 注册」→ 切到「注册」→ 填邮箱和密码（至少 6 位）→ 注册并登录",
            "回到「我的」，点「建一个你自己」→ 填名字、选男女 → 完成",
        ]
    )
    f += box(
        [
            "<b>为什么要先登录再建角色：</b>你的名字、战绩、金币、角色都存在云端，换手机登录回来就都在。"
            "不登录建出来的人只活在这台手机上，下次登录会被云端覆盖掉。",
            "<b>名字建完能改：</b>「我的」页面右上角「改名字」。",
        ]
    )


    # ---- 2 界面 ----
    f += rule_after("二、底下那五个按钮")
    f += kv_table(
        [
            ("首页", "最新消息、你当前的球局、别人开的局、最近打过的几场"),
            ("球局", "所有球局的完整列表，翻历史用这里"),
            ("＋（中间）", "开一场新球局。它不是一个页面，是直接开始一条流程"),
            ("发现", "全体排名、你常去的球馆（每个馆有自己的排行榜）"),
            ("我的", "你的段位和战绩、角色换装、登录、开局提醒、语言、深色模式"),
        ],
        key_w=32,
    )

    # ---- 3 开局 ----
    f += rule_after("三、开一场球局")
    f += [Paragraph("点中间的「＋」，四步走完就开局了。", S["body"])]
    f += kv_table(
        [
            ("① 在哪打", "球馆名字、几片场地、最多几个人（可以不限）"),
            ("② 怎么打", "自由模式还是轮转赛、默认双打还是单打"),
            ("③ 规矩", "多少分一局、要不要净胜两分、几局几胜"),
            ("④ 谁来了", "先把已经到的人勾上就行，后到的人自己加进来"),
        ],
        key_w=30,
    )
    f += box(
        [
            "<b>一个人就能开局。</b>不用等凑够四个人 —— 开了之后其他人在自己首页就看得见，会自己加进来。",
            "<b>人数上限。</b>场地订好了、钱是 AA 的时候特别有用：满了别人就加不进来，不会来了一堆人在旁边坐着。"
            "上限随时能在球局页面里改，改小也不会把已经在里面的人踢出去。",
        ]
    )

    # ---- 4 加入 ----
    f += rule_after("四、加入别人开的球局")
    f += [
        Paragraph(
            "别人开了局，你首页的「别人开的局」那一块就会出现 —— 谁开的、在哪、几个人了。"
            "点右边「加入」，直接进去。",
            S["body"],
        )
    ]
    f += box(
        [
            "<b>同一时间只能在一场球局里。</b>已经在一场里的时候，别的球局按钮是灰的「加不了」，"
            "底下会写着你人在哪一场 —— 点那行字就直接跳过去。",
            "<b>临时来不了？</b>进球局页面，人员名单最下面有一行「我今天来不了，退出这个球局」。"
            "已经打过球的人退不掉：那几场比赛还挂在你名下，退了排名和分账就对不上。",
        ]
    )
    f += box(
        [
            "<b>没装 App 的球友怎么办：</b>在球局页面点「+ 加人」，直接填名字。"
            "系统会列出「以前来过的」，从里面挑同一个人，他的战绩才不会每周重新算。",
        ]
    )


    # ---- 5 打球 ----
    f += rule_after("五、打球时：排场和记分")
    f += steps(
        [
            "球局页面点「排下一场」，系统按「谁休息得久、水平怎么搭」自动配对",
            "想提前安排就点「预排一场」，让大家知道下一场是谁",
            "上场后点那一场进记分页，左右两边各是一队，得分点一下加一分",
            "打完自动跳到结算，显示谁赢了、每个人 MMR 加减、有没有升段",
        ]
    )
    f += box(
        [
            "<b>记错分了？</b>记分页上有退回按钮，一分一分退得回去。已经结束的比赛也能改 —— "
            "球局页面「已打完」那一栏点进去就行。按错「结束」是最常发生的事，所以留了这条路。",
            "<b>有人要休息几场？</b>在「谁该上场」名单里点他的名字，可以标成休息中，排场就会跳过他。",
        ]
    )

    # ---- 6 结束 ----
    f += rule_after("六、打完：结束球局")
    f += [
        Paragraph(
            "球局页面右上角「结束」。结束之后会出一张结算：出席几人、打了几场、"
            "人均多少钱、今晚 MVP、今晚排名。还能生成一张图片发到群里。",
            S["body"],
        )
    ]
    f += box(
        [
            "<b>记得按结束。</b>不按的话这一场会一直挂在「进行中」。"
            "（首页对超过 12 小时没动静的球局会自动不显示，但它仍然没有结算 —— "
            "去「球局」那一页 找到它，补按一次结束就行。）",
            "<b>结束了还能改。</b>结算页可以重新打开球局，改完再结束一次。",
        ],
        tone="warn",
    )


    # ---- 7 排名 ----
    f += rule_after("七、排名是怎么算的")
    f += [Paragraph("MMR：你的长期水平分", S["h2"])]
    f += bullets(
        [
            "赢一场 <b>+10</b>，输一场 <b>-10</b>",
            "最低到 <b>0</b> 为止，不会变成负数 —— 打得再差也是从头爬，不至于挖个坑",
            "赢比自己强的队伍算「爆冷」，加倍给分",
            "跨球馆累计：换个球馆打，MMR 不变",
        ]
    )

    f += [Paragraph("段位（跟着 MMR 走，会自动升）", S["h2"])]
    f += kv_table(
        [
            ("先锋 Herald", "MMR 0 起"),
            ("卫士 Guardian", "50 起"),
            ("中军 Crusader", "100 起"),
            ("统帅 Archon", "150 起"),
            ("传奇 Legend", "300 起"),
            ("万古 Ancient", "400 起"),
            ("超凡 Divine", "500 起"),
            ("冠绝 Immortal", "700 起"),
        ],
        key_w=48,
    )

    f += [Paragraph("三种排行榜，口径不一样", S["h2"])]
    f += kv_table(
        [
            ("今晚排名", "只算这一场球局的比赛，按胜率排"),
            ("球馆排行榜", "只算在那个馆打的比赛，按胜率排（发现页 → 点那个球馆）"),
            ("全体排名", "所有人放在一起，按 MMR 排（发现页 → 全体排名）"),
        ],
        key_w=32,
    )
    f += box(
        [
            "<b>同一个人在不同榜上名次不一样，是正常的。</b>胜率离开范围就没意义 —— "
            "在强队里打的五成和在弱队里打的五成不是一回事。所以「全体」那一榜只能按 MMR 排。",
        ]
    )


    # ---- 8 角色 ----
    f += rule_after("八、角色和金币")
    f += bullets(
        [
            "<b>赢一场 = 10 金币</b>（输了不扣金币，只扣 MMR）",
            "金币在「我的 → 我的角色」里花，买背景、头像框、称号",
            "段位升上去，角色形象会自动跟着换 —— 新手 → 进阶 → 精英 → 高手 → 传奇",
            "角色的男女跟着你资料里填的性别走，改资料角色就跟着改，买过的东西一件不少",
        ]
    )

    # ---- 9 通知 ----
    f += rule_after("九、开局提醒（有人开局就通知你）")
    f += steps(
        [
            "确认你是从<b>主屏幕图标</b>打开的（不是浏览器标签页）",
            "「我的」→ 找到「开局提醒」→ 点「打开」",
            "系统弹出询问时选「允许」",
        ]
    )
    f += box(
        [
            "开局的人自己不会收到通知 —— 按下按钮的就是他本人。所以要试的话得两台手机。",
            "点错了「不允许」就弹不出来了，得去手机的<b>系统设置</b>里找到 RALLY 把通知打开。",
        ]
    )


    # ---- 10 常见问题 ----
    f += rule_after("十、常见问题")
    f += kv_table(
        [
            (
                "换手机了 / 换浏览器了",
                "登录一下就全回来了。你的角色是跟着账号的，不是跟着手机。"
                "<b>不要重新建一个角色</b> —— 那会变成两个你，战绩各算各的。",
            ),
            (
                "忘记密码",
                "登录弹层里点「忘记密码了？」→ 填邮箱 → 收件箱点那个链接（<b>记得翻垃圾邮件</b>）"
                "→ 会跳回 RALLY 让你设新密码。",
            ),
            (
                "界面怪怪的",
                "「我的」页面拉到最底下，点「检查更新」。版本号变了就是拿到新版了。",
            ),
            (
                "看不到别人刚做的改动",
                "把 App 切到后台再切回来，会自动重新同步一次。手机把后台网页冻结之后，"
                "实时更新会断掉，这是正常现象。",
            ),
            (
                "加不进球局",
                "两个原因：<b>已满</b>（按钮显示「已满」），或者<b>你已经在别的球局里</b>"
                "（按钮显示「加不了」，底下会写是哪一场）。",
            ),
            (
                "退不出球局",
                "你已经在这一场里打过球了。那几场比赛还挂在你名下，退了排名和 AA 分账就对不上。",
            ),
            (
                "「登录」点了没反应",
                "先看看网络。还是不行的话，「我的」→ 检查更新，再试一次。",
            ),
        ],
        key_w=44,
    )

    f += [Spacer(1, 6)]
    f += box(
        [
            "<b>数据存在哪：</b>所有记录都在云端，每个人登录后看到的是同一份。"
            "手机没网的时候照样能记分，联网之后会自动补传上去。",
        ]
    )

    f += [
        Spacer(1, 12),
        Paragraph(
            "还有搞不定的，直接在群里问。",
            S["muted"],
        ),
    ]
    return f


if __name__ == "__main__":
    import os

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "RALLY-使用指南.pdf")
    build(out)
    print("生成:", out)
