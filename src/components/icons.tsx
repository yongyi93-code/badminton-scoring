/* ------------------------------------------------------------------ *
 * 菜单图标
 *
 * 一整套自己画的线条图标，24×24，只描边不填色，线宽统一 1.75。
 *
 * -------------------------------------------------------------------
 * 为什么不装一个图标库
 *
 * 要的就这二十来个，而一个图标库进来是几百 KB 和一套跟这套界面
 * 没关系的视觉习惯（圆角多大、线多粗、留白多少）。这些全靠猜的话，
 * 一屏上二十个图标会像从五个地方拼来的。
 *
 * 全部原创：不描任何现成图标集，也不用任何游戏或品牌的素材。
 *
 * -------------------------------------------------------------------
 * 统一的那几条
 *
 * 24×24 的格子，图形占中间 18×18 左右（四边留 3 的余白）——
 * 留白不一致的话，同一列图标看起来会忽大忽小，哪怕尺寸都一样。
 * 线宽 1.75：1.5 在小尺寸上发虚，2 在这套偏细的字旁边显得憨。
 * 端点和拐角都是圆的，跟界面上那些圆角对得上。
 * ------------------------------------------------------------------ */

type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const Svg = ({ className, children }: IconProps & { children: React.ReactNode }) => (
  <svg {...base} className={className ?? 'size-[18px]'} aria-hidden>
    {children}
  </svg>
)

/* 两个人。好友、聊天那一行 */
export const IconFriends = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3" />
    <path d="M17.5 14.4a5.5 5.5 0 0 1 3 5.1" />
  </Svg>
)

/* 相片。朋友圈 —— 那一屏上绝大多数是照片 */
export const IconMoments = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M3.4 16.2 8 12.2l3.4 3 3-2.4 6.2 5" />
  </Svg>
)

/* 对话气泡。说点什么、反馈 */
export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5h16a1 1 0 0 1 1 1v8.6a1 1 0 0 1-1 1h-8.6L7 20v-3.9H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
    <path d="M8 10.8h.01M12 10.8h.01M16 10.8h.01" />
  </Svg>
)

/*
 * 收件筐。反馈与报错（管理员那一组）。
 *
 * 不跟「说点什么」共用气泡：那两行都在这一屏上，一个是「我要说」，
 * 一个是「别人说的都堆在这」，撞脸的话每次都要读字才分得清。
 */
export const IconInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 13.6 5.9 5.5a1.6 1.6 0 0 1 1.5-1.1h9.2a1.6 1.6 0 0 1 1.5 1.1l2.5 8.1" />
    <path d="M3.4 13.6h4.3l1 2.5h6.6l1-2.5h4.3v4.7a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6v-4.7Z" />
  </Svg>
)

/* 举手发言。申诉 —— 被禁言的人写来的话 */
export const IconAppeal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5h16a1 1 0 0 1 1 1v8.6a1 1 0 0 1-1 1h-8.6L7 20v-3.9H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
    <path d="M12 8.2v3.2" />
    <path d="M12 13.6h.01" />
  </Svg>
)

/* 小旗。举报队列 */
export const IconFlag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 21V3.8" />
    <path d="M5.5 4.6h11.8l-2.1 3.9 2.1 3.9H5.5" />
  </Svg>
)

/* 一列人名。球群成员名单 */
export const IconRoster = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6.5" cy="7" r="2.2" />
    <circle cx="6.5" cy="16" r="2.2" />
    <path d="M11.5 7H20M11.5 16H20" />
  </Svg>
)

/* 盾。管理员 */
export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2 5 6v5.6c0 4 2.8 7.3 7 9.2 4.2-1.9 7-5.2 7-9.2V6l-7-2.8Z" />
    <path d="m9.2 11.9 2 2 3.6-3.7" />
  </Svg>
)

/* 奖杯。比赛赛表 */
export const IconTrophy = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.6 3.8h8.8v4.6a4.4 4.4 0 1 1-8.8 0V3.8Z" />
    <path d="M7.6 5.8H5.4a2.3 2.3 0 0 0 2.4 3.5M16.4 5.8h2.2a2.3 2.3 0 0 1-2.4 3.5" />
    <path d="M12 12.9v2.9" />
    <path d="M8.7 20.2h6.6l-.8-4.4H9.5l-.8 4.4Z" />
  </Svg>
)

/* 柱状图。我的战绩 */
export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <path d="M7 20v-5.5M12 20V7M17 20v-8.5" />
  </Svg>
)

/* 日历。最近球局 */
export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.8h17" />
    <path d="M8 3.2v3.4M16 3.2v3.4" />
  </Svg>
)

/* 羽毛球。球群 —— 这个 App 里「一群人」最直白的样子 */
export const IconShuttle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 6.4a13 13 0 0 1 14 0" />
    <path d="M5 6.4 9.1 15.4h5.8L19 6.4" />
    <path d="M9.4 10.9h5.2" />
    <circle cx="12" cy="17.9" r="2.7" />
  </Svg>
)

/*
 * 一道门加一个往里走的箭头。登录。
 *
 * 本来画的是钥匙，但圆环加一根斜杆在 18px 下就是一个放大镜 ——
 * 实测摆进那一列里，眼睛先读成「搜索」。门和箭头没有这个歧义。
 */
export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.8 3.6h4.4a1.6 1.6 0 0 1 1.6 1.6v13.6a1.6 1.6 0 0 1-1.6 1.6h-4.4" />
    <path d="M4 12h9.4" />
    <path d="m10.2 8.6 3.4 3.4-3.4 3.4" />
  </Svg>
)

/*
 * 相机。压在头像角上那个小圆点。
 *
 * 画得比别的图标简单（一个机身、一个镜头、一块取景凸起），
 * 因为它只有 14 像素高 —— 那个尺寸上多一根线就糊成一团。
 */
export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.4a1.6 1.6 0 0 1 1.6-1.6h2.2l1.3-2.1h6.8l1.3 2.1h2.2a1.6 1.6 0 0 1 1.6 1.6v9.1a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6V8.4Z" />
    <circle cx="12" cy="12.6" r="3.4" />
  </Svg>
)

/* 名片。我的名片 */
export const IconCard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="8.6" cy="10.6" r="1.9" />
    <path d="M5.6 16a3.2 3.2 0 0 1 6 0" />
    <path d="M14.8 9.8H18M14.8 13.4H18" />
  </Svg>
)

/* 锁。改密码 */
export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10" width="15" height="10" rx="2.5" />
    <path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.6 0V10" />
    <path d="M12 14v2.4" />
  </Svg>
)

/* 垃圾桶。注销账号 */
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5h16" />
    <path d="M9.5 6.5V4.6h5v1.9" />
    <path d="M6.2 6.5 7 19.4a1.6 1.6 0 0 0 1.6 1.5h6.8a1.6 1.6 0 0 0 1.6-1.5l.8-12.9" />
    <path d="M10.4 10.2v6.6M13.6 10.2v6.6" />
  </Svg>
)

/* 地球。语言 */
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M3.4 12h17.2" />
    <path d="M12 3.4c2.2 2.4 3.4 5.4 3.4 8.6S14.2 18.2 12 20.6c-2.2-2.4-3.4-5.4-3.4-8.6S9.8 5.8 12 3.4Z" />
  </Svg>
)

/* 铃铛。开局提醒 */
export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.2 16.4V11a5.8 5.8 0 1 1 11.6 0v5.4l1.6 2.2H4.6l1.6-2.2Z" />
    <path d="M10 20.2a2.2 2.2 0 0 0 4 0" />
  </Svg>
)

/* 月亮。深色模式 */
export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.6 8.6 0 1 0 10.2 10.2Z" />
  </Svg>
)

/* 手机加一个向下的箭头。装到手机上 */
export const IconInstall = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.5" y="2.8" width="11" height="18.4" rx="2.5" />
    <path d="M12 7.6v6.2" />
    <path d="m9.4 11.4 2.6 2.6 2.6-2.6" />
    <path d="M10.6 18.2h2.8" />
  </Svg>
)

/* 一页纸。隐私政策与条款 */
export const IconDoc = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.2h7.6L18.5 8v12.8H6V3.2Z" />
    <path d="M13.4 3.4V8h4.9" />
    <path d="M8.8 12.4h6.4M8.8 16h6.4" />
  </Svg>
)

/* 云加一个感叹号。同步出问题了 */
export const IconCloudAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 18.5a4 4 0 0 1-.3-8 5.6 5.6 0 0 1 10.7 1.2A3.6 3.6 0 0 1 17 18.5H7Z" />
    <path d="M12 10v2.6" />
    <path d="M12 15.1h.01" />
  </Svg>
)
