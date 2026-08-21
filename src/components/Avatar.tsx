import type { ReactNode } from 'react'
import {
  itemById,
  SKIN_TONES,
  type AvatarProfile,
  type AvatarSex,
  type AvatarSlot,
} from '@/lib/avatar'
import { artUrl, HEAD_CROP, type Stage } from '@/lib/avatarArt'
import { cx } from '@/components/ui'

/* ------------------------------------------------------------------ *
 * 角色形象
 *
 * 全身 Q 版立绘，约 2 头身，全部用 SVG 手绘，装在 100×100 的 viewBox 里 ——
 * 放大缩小都不糊，也不用打包任何图片资源，离线可用是这个 App 的底线。
 *
 * 分层顺序：背景 → 地面投影 → 披风 → 后发 → 光身子 → 战服 → 头 → 五官 → 前发 → 武器。
 * 后发要压在身体下面、前发要盖住额头，所以头发拆成前后两层分开画。
 *
 * 头和五官仍然按原来那套 100×100 的坐标画，最后整组缩放到画面上半截 ——
 * 比把每条路径重算一遍靠谱，也不会在改比例时改漏某一笔。
 *
 * 造型全部自己画的几何形状，没有临摹任何游戏的角色美术。
 * ------------------------------------------------------------------ */

const INK = '#2a2431'
const LINE = '#3a3244'

const stroke = (color = INK, width = 2) => ({
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
})

/** 把颜色调亮或调暗，用来自动生成高光和阴影，省得每个色号手写三遍 */
const shade = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => mix(c).toString(16).padStart(2, '0'))
    .join('')}`
}

/* ------------------------------------------------------------------ *
 * 五官
 * ------------------------------------------------------------------ */

/**
 * 眼睛是这张脸唯一的重点，值得堆细节。
 * 关键三层：虹膜上深下浅做出通透感、粗黑上眼睑压出神、
 * 左上一块大高光 + 右下一点小高光让眼球显得是圆的。
 */
function Eye({
  x,
  y,
  iris,
  wide,
  /** 眼尾往哪边挑，左右眼要相反 */
  dir,
}: {
  x: number
  y: number
  iris: string
  wide: boolean
  dir: 1 | -1
}) {
  const rx = wide ? 8.2 : 7.2
  const ry = wide ? 10.4 : 9
  const deep = shade(iris, -0.55)
  const glow = shade(iris, 0.42)
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#fbf8f6" />
      {/* 虹膜三层：顶上最深，往下越来越亮 */}
      <ellipse cx={x} cy={y + 0.6} rx={rx * 0.84} ry={ry * 0.86} fill={deep} />
      <ellipse cx={x} cy={y + 2.2} rx={rx * 0.8} ry={ry * 0.68} fill={iris} />
      <ellipse cx={x} cy={y + 4} rx={rx * 0.62} ry={ry * 0.4} fill={glow} />
      <ellipse cx={x} cy={y + 1.2} rx={rx * 0.3} ry={ry * 0.42} fill="#191420" />
      {/* 高光 */}
      <ellipse
        cx={x - rx * 0.34}
        cy={y - ry * 0.44}
        rx={rx * 0.32}
        ry={ry * 0.24}
        fill="#fff"
        transform={`rotate(-20 ${x} ${y})`}
      />
      <circle cx={x + rx * 0.4} cy={y + ry * 0.36} r={rx * 0.15} fill="#fff" opacity="0.8" />
      {/* 上眼睑，眼尾挑出一小笔 */}
      <path
        d={`M${x - rx - 1.4} ${y - ry * 0.3}
            Q${x} ${y - ry - 3.4} ${x + rx + 1} ${y - ry * 0.5}
            L${x + rx * dir + 2.4 * dir} ${y - ry * 0.9}`}
        {...stroke(INK, wide ? 4 : 3.6)}
      />
      {/* 下眼睑：只轻轻带一笔，压太重会显得凶 */}
      <path
        d={`M${x - rx * 0.75} ${y + ry * 0.92} Q${x} ${y + ry + 1.2} ${x + rx * 0.75} ${y + ry * 0.82}`}
        {...stroke(INK, 1.3)}
        opacity="0.55"
      />
    </g>
  )
}

function Face({ sex, skin, iris }: { sex: AvatarSex; skin: string; iris: string }) {
  const female = sex === 'f'
  const eyeY = 52
  return (
    <g>
      {/* 眉毛：男生粗平，女生细弯，是男女差别最明显的一笔 */}
      {female ? (
        <>
          <path d="M31 40 Q38 36 45 39.5" {...stroke(LINE, 2.2)} />
          <path d="M69 40 Q62 36 55 39.5" {...stroke(LINE, 2.2)} />
        </>
      ) : (
        <>
          {/* 眉头细、眉峰粗，两段拼出粗细变化，比一根等粗线自然得多 */}
          <path d="M31 39 Q37 36.5 42 38.6" {...stroke(LINE, 3.2)} />
          <path d="M42 38.6 L45.5 41.2" {...stroke(LINE, 2.2)} />
          <path d="M69 39 Q63 36.5 58 38.6" {...stroke(LINE, 3.2)} />
          <path d="M58 38.6 L54.5 41.2" {...stroke(LINE, 2.2)} />
        </>
      )}

      <Eye x={37.5} y={eyeY} iris={iris} wide={female} dir={-1} />
      <Eye x={62.5} y={eyeY} iris={iris} wide={female} dir={1} />

      {/* 鼻子只用一小道阴影带过，画实了会破坏 Q 版比例 */}
      <path d="M50 61 q1.6 1.3 -0.2 2.2" {...stroke(shade(skin, -0.3), 1.5)} />

      {/* 嘴 */}
      {female ? (
        <path d="M46.8 67.5 q3.2 3 6.4 0" {...stroke(INK, 1.7)} />
      ) : (
        <path d="M46.2 67.5 q3.8 2.6 7.6 0" {...stroke(INK, 1.7)} />
      )}

      {/* 腮红：女生明显、男生淡一点，都有会显得气色好 */}
      <ellipse cx="28.5" cy="60" rx="5" ry="2.8" fill="#f2909f" opacity={female ? 0.38 : 0.18} />
      <ellipse cx="71.5" cy="60" rx="5" ry="2.8" fill="#f2909f" opacity={female ? 0.38 : 0.18} />
    </g>
  )
}

/* ------------------------------------------------------------------ *
 * 头与身体
 * ------------------------------------------------------------------ */

/** 头的轮廓：颧骨宽、下巴收尖，Q 版的可爱全靠这个比例 */
const HEAD_D = `M50 9
  C70 9 80 23 80 44
  C80 59 73 70 63 75
  Q50 81 37 75
  C27 70 20 59 20 44
  C20 23 30 9 50 9 Z`

function Head({ skin }: { skin: string }) {
  const line = shade(skin, -0.45)
  return (
    <g>
      {/* 耳朵 */}
      <ellipse cx="20.5" cy="53" rx="4.4" ry="6.4" fill={skin} stroke={line} strokeWidth="1.3" />
      <ellipse cx="79.5" cy="53" rx="4.4" ry="6.4" fill={skin} stroke={line} strokeWidth="1.3" />
      {/* 脖子先画，让下巴压在上面 */}
      <path
        d="M41 70 h18 v15 q-9 4 -18 0 Z"
        fill={shade(skin, -0.16)}
        stroke={line}
        strokeWidth="1.3"
      />
      <path d={HEAD_D} fill={skin} stroke={line} strokeWidth="1.5" strokeLinejoin="round" />
      {/*
        额头投影：刘海压下来的那块阴影。
        原来一片纯肤色，脸是平的；加了这层头发才像有厚度地盖在头上。
        画在头之后、五官之前，前发会把它的上半截盖掉，只留一道柔边。
      */}
      <ellipse cx="50" cy="28" rx="29" ry="15" fill={shade(skin, -0.2)} opacity="0.42" />
      {/* 下巴一点反光，脸不至于死板 */}
      <path d="M43 73 q7 3.4 14 0" {...stroke(shade(skin, -0.16), 1.2)} opacity="0.5" />
    </g>
  )
}

/* ------------------------------------------------------------------ *
 * 身体与战服
 *
 * 全身 Q 版，约 2 头身：头占画面上半截，身体从 y≈54 往下站到 y≈97。
 * 半身像的时候战服只剩领口那一条，五套看起来都一样；
 * 改成全身之后胸甲、护肩、腰带、护腿、靴子、披风才有地方放。
 *
 * 每套战服给 { cape, body }：披风要压在身体后面，所以单独一层。
 * ------------------------------------------------------------------ */

/** 站立的地面投影，画在最底层，角色才像站着而不是飘着 */
const GROUND = <ellipse cx="50" cy="97" rx="19" ry="3" fill="#000" opacity="0.2" />

/** 光身子：躯干、手臂、手、腿。战服盖在上面，露出来的地方就是皮肤 */
function BodyBase({ skin }: { skin: string }) {
  const line = shade(skin, -0.45)
  const p = { fill: skin, stroke: line, strokeWidth: 1.4, strokeLinejoin: 'round' as const }
  return (
    <g>
      <path d="M39 55 Q50 52 61 55 L60 76 Q50 79 40 76 Z" {...p} />
      <path d="M39 56 C33 58 30 64 30 71 L37 71 C37 65 38 60 42 57 Z" {...p} />
      <path d="M61 56 C67 58 70 64 70 71 L63 71 C63 65 62 60 58 57 Z" {...p} />
      <circle cx="33.5" cy="73" r="4.4" {...p} />
      <circle cx="66.5" cy="73" r="4.4" {...p} />
      <path d="M42 74 h7.2 v16 h-7.2 Z" {...p} />
      <path d="M50.8 74 h7.2 v16 h-7.2 Z" {...p} />
    </g>
  )
}

type Suit = { cape?: ReactNode; body: ReactNode }

/** 靴子：几套战服共用，只换颜色和金边 */
const boots = (main: string, trim?: string) => (
  <g>
    <path
      d="M40 86 h10 v8 q0 3 -3 3 h-9 q-1 -6 2 -11 Z"
      fill={main}
      stroke={shade(main, -0.42)}
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M60 86 h-10 v8 q0 3 3 3 h9 q1 -6 -2 -11 Z"
      fill={main}
      stroke={shade(main, -0.42)}
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    {trim && (
      <>
        <path d="M39.5 88.5 h10.5 M60.5 88.5 h-10.5" {...stroke(trim, 1.8)} />
      </>
    )}
  </g>
)

/**
 * 护腕：贴着小臂画一小圈，别画成方块。
 * 上一版是两个深色矩形，在深色战服上看起来像身上破了两个洞。
 */
const wristbands = (main: string, trim: string) => (
  <g>
    <path
      d="M30.2 65.5 h6.6 a1.6 1.6 0 0 1 1.6 1.6 v3.4 a1.6 1.6 0 0 1 -1.6 1.6 h-6.6 Z"
      fill={main}
      stroke={shade(main, -0.42)}
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path
      d="M69.8 65.5 h-6.6 a1.6 1.6 0 0 0 -1.6 1.6 v3.4 a1.6 1.6 0 0 0 1.6 1.6 h6.6 Z"
      fill={main}
      stroke={shade(main, -0.42)}
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M30.4 68.2 h7.6 M69.6 68.2 h-7.6" {...stroke(trim, 1.4)} />
  </g>
)

/** 腰带：同上，是把上下身分开的关键一笔 */
const belt = (main: string, buckle: string) => (
  <g>
    <path
      d="M39 70 h22 v5 h-22 Z"
      fill={main}
      stroke={shade(main, -0.42)}
      strokeWidth="1.3"
    />
    <rect x="46.5" y="70" width="7" height="5" rx="1.2" fill={buckle} />
  </g>
)

function Outfit({ id, sex }: { id: string | undefined; sex: AvatarSex }): Suit {
  const female = sex === 'f'
  const line = (c: string) => ({
    stroke: shade(c, -0.42),
    strokeWidth: 1.4,
    strokeLinejoin: 'round' as const,
  })

  /** 上身主体：女生腰收一点 */
  const torso = female
    ? 'M38 55 Q50 51 62 55 L60 71 Q50 74 40 71 Z'
    : 'M37 55 Q50 51 63 55 L61 72 Q50 75 39 72 Z'
  const sleeveL = 'M38 55 C32 57 29 63 29 70 L37 70 C37 64 38 59 42 56 Z'
  const sleeveR = 'M62 55 C68 57 71 63 71 70 L63 70 C63 64 62 59 58 56 Z'

  /** 短裤 / 短裙：羽球场上的下装，男女不同 */
  const bottoms = (c: string) =>
    female ? (
      <path d="M38 70 L35 82 h30 L62 70 Z" fill={c} {...line(c)} />
    ) : (
      <path d="M39 70 h22 v10 h-9 v-4 h-4 v4 h-9 Z" fill={c} {...line(c)} />
    )

  /** 球鞋：白底 + 一道彩色边，五套都用，只换那道边的颜色 */
  const shoes = (accent: string) => boots('#f2f4f8', accent)

  if (id === 'jersey') {
    // 进阶：蓝黑撞色，斜襟
    const c = '#16213b'
    return {
      body: (
        <g>
          <path d={sleeveL} fill="#1f6feb" {...line('#1f6feb')} />
          <path d={sleeveR} fill="#1f6feb" {...line('#1f6feb')} />
          <path d={torso} fill={c} {...line(c)} />
          <path d="M39 58 L61 68" {...stroke('#1f6feb', 3.4)} />
          <path d="M44 52 Q50 57 56 52" {...stroke('#dbe7ff', 2.2)} />
          {bottoms('#12182a')}
          {shoes('#1f6feb')}
        </g>
      ),
    }
  }

  if (id === 'elite') {
    // 精英：无袖，露出手臂，护腕加护膝
    const c = '#2b3f6b'
    return {
      body: (
        <g>
          <path d={torso} fill={c} {...line(c)} />
          {/* 无袖：只在肩头收一个窄边，手臂露出来 */}
          <path d="M38 55 Q50 51 62 55 L61 60 Q50 56 39 60 Z" fill="#3d5a94" {...line(c)} />
          <path d="M40 60 L60 70" {...stroke('#7fb4ff', 2.8)} />
          {wristbands('#3d5a94', '#7fb4ff')}
          {bottoms('#1d2a45')}
          {/* 护膝：精英开始有伤病管理，也是辨识度 */}
          <path d="M42 82 h7 v5 h-7 Z" fill="#3d5a94" {...line(c)} />
          {shoes('#4f8ef7')}
        </g>
      ),
    }
  }

  if (id === 'pro') {
    // 高手：全黑无袖 + 紫色描线 + 长筒袜
    const c = '#2e2450'
    return {
      body: (
        <g>
          <path d={torso} fill={c} {...line(c)} />
          <path d="M38 55 Q50 51 62 55 L61 59 Q50 55 39 59 Z" fill="#43356f" {...line(c)} />
          <path d="M41 58 L59 71 M59 58 L41 71" {...stroke('#b490ff', 2.4)} />
          {wristbands('#43356f', '#b490ff')}
          {belt('#1b1533', '#b490ff')}
          {bottoms('#211a3c')}
          {/* 长筒袜：从裙／裤一直包到鞋口 */}
          <path d="M42 80 h7.2 v8 h-7.2 Z" fill="#372c5e" {...line(c)} />
          <path d="M50.8 80 h7.2 v8 h-7.2 Z" fill="#372c5e" {...line(c)} />
          {shoes('#8b5cf6')}
        </g>
      ),
    }
  }

  if (id === 'legend') {
    // 传奇：黑金 + 金翼 + 光环。整条成长线的终点，值得画得夸张
    const c = '#241d33'
    const gold = '#f2c14e'
    /**
     * 一只翅膀：从肩后长出来，先往上扬再往下收，羽片一根根排开。
     * 上一版是两片横着伸出去的弧形色块，看起来像挂了两根香蕉 ——
     * 翅膀的形要靠「上缘一条弧 + 下缘一排羽尖」才立得住。
     */
    const wing = (flip: boolean) => (
      <g transform={flip ? 'translate(100 0) scale(-1 1)' : undefined}>
        {/*
          外缘一条上扬的弧线把翼展拉到头顶高度，
          内缘用三段扇贝形收回肩膀 —— 那三个凹口就是羽毛尖，
          少了它整块金色就只是一片叶子。
        */}
        <path
          d="M40 59
             C33 46 22 33 7 26
             C11 35 13 42 12 49
             C16 44 20 42 25 42
             C23 49 20 55 15 61
             C21 58 27 57 32 58
             C29 63 25 67 20 71
             C27 68 34 66 40 65 Z"
          fill={gold}
          stroke="#a8801f"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        {/* 羽干：每根羽毛回到翼根，翅膀才有结构 */}
        <path
          d="M38 60 C30 51 22 42 12 34 M38 62 C31 56 27 51 21 45
             M38 64 C32 61 28 58 23 54"
          {...stroke('#a8801f', 1)}
          opacity="0.7"
        />
        {/* 上缘高光，翅膀才有厚度 */}
        <path d="M9 28 C20 36 31 48 39 60" {...stroke('#fff3cf', 1.5)} opacity="0.8" />
      </g>
    )
    return {
      cape: (
        <g>
          {/* 背后的金色光环 */}
          <circle cx="50" cy="58" r="32" fill={gold} opacity="0.13" />
          <circle cx="50" cy="58" r="21" fill={gold} opacity="0.12" />
          {wing(false)}
          {wing(true)}
        </g>
      ),
      body: (
        <g>
          <path d={sleeveL} fill={c} {...line(c)} />
          <path d={sleeveR} fill={c} {...line(c)} />
          <path d={torso} fill={c} {...line(c)} />
          {/* 胸前金纹 */}
          <path d="M39 58 L50 68 L61 58" {...stroke(gold, 2.6)} />
          <path d="M44 52 Q50 57 56 52" {...stroke(gold, 2.2)} />
          {wristbands('#3a3050', gold)}
          {belt('#171226', gold)}
          {bottoms('#1a1528')}
          <path d="M42 80 h7.2 v8 h-7.2 Z" fill="#3a3050" {...line(c)} />
          <path d="M50.8 80 h7.2 v8 h-7.2 Z" fill="#3a3050" {...line(c)} />
          {shoes(gold)}
        </g>
      ),
    }
  }

  // 新手队服：白衣黑裤，免费款
  const c = '#f0f3f8'
  return {
    body: (
      <g>
        <path d={sleeveL} fill="#20242f" {...line('#20242f')} />
        <path d={sleeveR} fill="#20242f" {...line('#20242f')} />
        <path d={torso} fill={c} {...line(c)} />
        <path d="M44 52 Q50 57 56 52" {...stroke('#98a3b5', 2.2)} />
        <path d="M40 62 L60 62" {...stroke('#c7d0dd', 2)} />
        {bottoms('#20242f')}
        {shoes('#20242f')}
      </g>
    ),
  }
}

/* ------------------------------------------------------------------ *
 * 发型
 *
 * 每款给出 back（压在身体下面）和 front（盖住额头和两鬓）两层。
 * ------------------------------------------------------------------ */

type Hair = { back?: ReactNode; front: ReactNode }

/**
 * 一撮头发 = 填色 + 描边。
 * 描边是这版和上一版最大的差别：纯色块拼出来的头发是平的，
 * 沿轮廓压一条深色线之后才有「一片压着一片」的厚度。
 */
const strand = (d: string, c: string, w = 1.5) => (
  <path d={d} fill={c} stroke={shade(c, -0.45)} strokeWidth={w} strokeLinejoin="round" />
)

/** 高光：顺着头顶弧度扫一条，别画满，留白才像反光 */
const gloss = (d: string, c: string, w = 3.2) => (
  <path d={d} {...stroke(shade(c, 0.34), w)} opacity="0.55" />
)

const hairOf = (id: string | undefined, sex: AvatarSex): Hair => {
  switch (id) {
    case 'm-spiky': {
      const c = '#2a2431'
      return {
        front: (
          <g>
            {strand(
              `M19 48 C17 26 30 4 50 4 C70 4 83 26 81 48
               L74 30 Q72 37 70 42 L63 25 Q60 33 57 39 L50 22 Q46 32 43 39 L37 25 Q33 37 30 42 L26 30 Z`,
              c,
            )}
            {strand('M30 42 L37 25 L43 39 Z', shade(c, 0.14), 0)}
            {strand('M57 39 L63 25 L70 42 Z', shade(c, 0.14), 0)}
            {gloss('M34 24 C40 17 48 15 55 18', c, 2.6)}
          </g>
        ),
      }
    }

    case 'm-wolf': {
      const c = '#5d3b23'
      return {
        back: strand(
          'M20 44 C17 62 20 78 26 88 L74 88 C80 78 83 62 80 44 Z',
          shade(c, -0.24),
        ),
        front: (
          <g>
            {strand(
              `M19 50 C17 24 31 6 50 6 C69 6 83 24 81 50
               C78 38 73 31 66 29 L60 40 L54 28 C46 40 34 41 28 35
               C23 39 21 44 19 50 Z`,
              c,
            )}
            {strand('M54 28 L60 40 L66 29 Z', shade(c, 0.16), 0)}
            {gloss('M32 24 C39 17 49 15 57 19', c)}
          </g>
        ),
      }
    }

    case 'm-silver': {
      const c = '#aeb6c6'
      return {
        back: strand('M20 42 C18 58 22 72 28 80 L72 80 C78 72 82 58 80 42 Z', shade(c, -0.26)),
        front: (
          <g>
            {strand(
              `M19 50 C17 22 32 5 50 5 C68 5 83 22 81 50
               C77 36 69 28 60 27 C53 38 38 42 30 35 C24 39 21 44 19 50 Z`,
              c,
            )}
            {/* 斜向的一大绺，银发要靠这个才不糊成一坨 */}
            {strand('M30 35 C38 41 52 38 60 27 C52 34 40 36 30 35 Z', shade(c, -0.2), 0)}
            {gloss('M33 22 C41 14 52 13 60 18', c, 3.6)}
          </g>
        ),
      }
    }

    case 'f-twin': {
      const c = '#6f4830'
      return {
        back: (
          <g>
            {strand('M27 42 C16 46 9 60 12 76 C16 90 27 90 30 79 C27 64 29 50 34 45 Z', c)}
            {strand('M73 42 C84 46 91 60 88 76 C84 90 73 90 70 79 C73 64 71 50 66 45 Z', c)}
            {strand('M24 40 a7 6 0 1 0 0.1 0 Z', shade(c, 0.12))}
            {strand('M76 40 a7 6 0 1 0 0.1 0 Z', shade(c, 0.12))}
          </g>
        ),
        front: (
          <g>
            {strand(
              `M19 52 C17 22 32 4 50 4 C68 4 83 22 81 52
               C79 40 75 32 68 29 Q60 37 57 30 Q53 36 50 40 Q46 35 43 30 Q40 37 37 41 Q34 34 32 29
               C25 32 21 40 19 52 Z`,
              c,
            )}
            {strand('M32 29 L37 41 L43 30 Z', shade(c, 0.14), 0)}
            {gloss('M36 20 C43 15 53 15 60 19', c)}
          </g>
        ),
      }
    }

    case 'f-long': {
      const c = '#241d29'
      return {
        back: strand('M18 42 C14 62 15 84 19 100 L81 100 C85 84 86 62 82 42 Z', c),
        front: (
          <g>
            {/* 两鬓垂到肩，是黑长直最像样的地方 */}
            {strand('M19 48 C19 64 22 76 26 86 L34 86 C29 72 27 58 29 44 Z', shade(c, 0.1))}
            {strand('M81 48 C81 64 78 76 74 86 L66 86 C71 72 73 58 71 44 Z', shade(c, 0.1))}
            {strand(
              `M19 52 C17 22 32 4 50 4 C68 4 83 22 81 52
               C80 38 76 30 70 27 C64 37 52 41 43 35 C31 37 22 42 19 52 Z`,
              c,
            )}
            {gloss('M37 18 C44 13 54 13 61 18', c, 2.8)}
          </g>
        ),
      }
    }

    case 'f-wavy': {
      const c = '#d9ab5f'
      return {
        back: strand(
          `M18 42 C11 58 18 68 12 82 C20 90 25 82 27 93
           C34 88 39 97 45 92 L55 92 C61 97 66 88 73 93
           C75 82 80 90 88 82 C82 68 89 58 82 42 Z`,
          c,
        ),
        front: (
          <g>
            {strand('M20 48 C15 60 22 68 17 78 L26 82 C29 70 27 56 29 44 Z', shade(c, -0.16))}
            {strand('M80 48 C85 60 78 68 83 78 L74 82 C71 70 73 56 71 44 Z', shade(c, -0.16))}
            {strand(
              `M19 52 C17 22 32 4 50 4 C68 4 83 22 81 52
               C78 38 72 30 65 28 C58 38 44 42 36 35 C27 37 21 44 19 52 Z`,
              c,
            )}
            {gloss('M35 19 C43 12 55 13 62 19', c, 3.6)}
          </g>
        ),
      }
    }

    case 'f-bob': {
      const c = '#6f4830'
      return {
        back: strand('M19 42 C17 58 21 70 26 76 L74 76 C79 70 83 58 81 42 Z', shade(c, -0.2)),
        front: (
          <g>
            {strand('M19 48 C19 60 21 70 25 76 L33 76 C29 66 28 56 29 44 Z', shade(c, 0.1))}
            {strand('M81 48 C81 60 79 70 75 76 L67 76 C71 66 72 56 71 44 Z', shade(c, 0.1))}
            {strand(
              `M19 54 C17 22 32 4 50 4 C68 4 83 22 81 54
               C80 44 77 36 73 31 Q64 38 60 30 Q56 36 53 41 Q49 34 46 29 Q42 36 39 41 Q35 34 32 30
               C27 34 21 44 19 54 Z`,
              c,
            )}
            {gloss('M37 18 C44 13 54 13 61 18', c)}
          </g>
        ),
      }
    }

    default: {
      // 利落短发：男生的免费款，也是所有缺省情况的兜底
      const c = sex === 'f' ? '#6f4830' : '#4d3626'
      return {
        front: (
          <g>
            {strand(
              `M19 50 C17 24 31 5 50 5 C69 5 83 24 81 50
               C79 38 74 30 67 27 Q58 34 55 27 Q51 33 48 37 Q45 31 42 26 Q39 32 36 36 Q33 30 30 27
               C25 31 21 40 19 50 Z`,
              c,
            )}
            {strand('M30 27 L36 36 L42 26 Z', shade(c, 0.15), 0)}
            {gloss('M34 21 C41 15 51 14 58 19', c)}
          </g>
        ),
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 武器
 *
 * 一律举在右手边，画在最上层。
 * ------------------------------------------------------------------ */

/**
 * 武器一律画在以握把为原点的局部坐标里，刀身朝上（负 y）。
 * 摆放位置由外面统一的 WEAPON_AT 决定 —— 原来每把各写各的 transform，
 * 结果巨剑直接横穿角色的脸。摆位收到一处，加新武器不会再犯。
 */
const WEAPONS: Record<string, ReactNode> = {
  ...Object.fromEntries(
    (
      [
        // [id, 拍框, 拍线, 拍柄, 握把]
        ['racket', '#cfd8e6', '#eef2f8', '#5b6577', '#f2a33c'],
        ['racket-blue', '#1f6feb', '#cfe3ff', '#123a75', '#0f2a52'],
        ['racket-pro', '#8b5cf6', '#e2d5ff', '#4a2f86', '#241a44'],
        ['racket-gold', '#f2c14e', '#fff3cf', '#a8801f', '#5c4610'],
        ['racket-legend', '#ff8a3d', '#ffe0c4', '#a8481f', '#2a2333'],
      ] as const
    ).map(([id, frame, mesh, shaft, grip]) => [
      id,
      <>
        {id === 'racket-legend' && (
          <circle cx="0" cy="-24" r="15" fill={frame} opacity="0.22" />
        )}
        <ellipse cx="0" cy="-24" rx="9.5" ry="12" fill={mesh} opacity="0.5" />
        <ellipse cx="0" cy="-24" rx="9.5" ry="12" {...stroke(frame, 2.6)} />
        {/* 拍线要密，三根横三根竖看起来是个井字号，不是球拍 */}
        <path
          d="M-7.4 -31 v14 M-3.7 -34 v20 M0 -35.5 v23 M3.7 -34 v20 M7.4 -31 v14"
          {...stroke(mesh, 0.8)}
        />
        <path
          d="M-6.6 -31 h13.2 M-8.6 -27.5 h17.2 M-9.4 -24 h18.8 M-8.6 -20.5 h17.2 M-6.6 -17 h13.2"
          {...stroke(mesh, 0.8)}
        />
        {/* 拍杆穿过手心，握把往下露一小截 —— 这样才像握着，不是浮在手边 */}
        <path d="M0 -12 v9" {...stroke(shaft, 3.2)} />
        <path d="M0 -4 v14" {...stroke(grip, 4.8)} />
      </>,
    ]),
  ),
}

/**
 * 武器摆位：往右让开脸，握把落在肩膀高度，刀尖朝右上。
 * 头最宽到 x=77，所以握把放 x=87 才不压脸。
 */
/** 握在右手上（手心在 66.5,73），拍面朝上举在身侧 */
const WEAPON_AT = 'translate(66.5 73) rotate(10) scale(0.62)'

/* ------------------------------------------------------------------ *
 * 背景
 * ------------------------------------------------------------------ */

const BACKDROPS: Record<string, ReactNode> = {
  court: (
    <>
      <rect x="0" y="0" width="100" height="100" fill="#2f6b4f" />
      <rect x="8" y="14" width="84" height="72" {...stroke('#e6f2ea', 1.6)} />
      <path d="M8 50 h84" {...stroke('#e6f2ea', 1.6)} />
      <path d="M50 14 v72" {...stroke('#e6f2ea', 1.2)} />
      <path d="M22 14 v72 M78 14 v72" {...stroke('#e6f2ea', 1.2)} />
    </>
  ),
  podium: (
    <>
      <rect x="0" y="0" width="100" height="100" fill="#1b2436" />
      <path d="M50 0 L86 70 L14 70 Z" fill="#f2c14e" opacity="0.12" />
      <rect x="30" y="70" width="40" height="30" fill="#f2c14e" />
      <rect x="4" y="80" width="26" height="20" fill="#c9d1d9" />
      <rect x="70" y="84" width="26" height="16" fill="#b08d57" />
    </>
  ),
  night: (
    <>
      <rect x="0" y="0" width="100" height="100" fill="#0e1626" />
      {/* 两盏顶灯打下来的光锥，夜场那种「场内亮、场外黑」的感觉 */}
      <path d="M22 0 L44 74 L0 74 Z" fill="#cfe3ff" opacity="0.12" />
      <path d="M78 0 L100 74 L56 74 Z" fill="#cfe3ff" opacity="0.12" />
      <circle cx="22" cy="4" r="5" fill="#fff6d8" />
      <circle cx="78" cy="4" r="5" fill="#fff6d8" />
      <rect x="0" y="74" width="100" height="26" fill="#1d4f3c" />
      <path d="M0 82 h100" {...stroke('#e6f2ea', 1.2)} />
    </>
  ),
  final: (
    <>
      <rect x="0" y="0" width="100" height="100" fill="#141b2e" />
      {/* 看台：一排排小方块，人多的场子 */}
      {Array.from({ length: 4 }, (_, row) =>
        Array.from({ length: 12 }, (_, col) => (
          <rect
            key={`${row}-${col}`}
            x={col * 8.6 - 1}
            y={row * 7 + 6}
            width="6.4"
            height="4.4"
            rx="1.4"
            fill="#2c3a5c"
            opacity={0.5 + row * 0.12}
          />
        )),
      )}
      <rect x="0" y="40" width="100" height="60" fill="#1d4f3c" />
      <rect x="6" y="46" width="88" height="48" {...stroke('#e6f2ea', 1.6)} />
      <path d="M50 46 v48" {...stroke('#e6f2ea', 1.2)} />
      <circle cx="50" cy="30" r="26" fill="#f2c14e" opacity="0.1" />
    </>
  ),
  galaxy: (
    <>
      <rect x="0" y="0" width="100" height="100" fill="#151a2e" />
      <circle cx="72" cy="26" r="26" fill="#7c3aed" opacity="0.28" />
      <circle cx="26" cy="72" r="22" fill="#0ea5e9" opacity="0.22" />
      {[
        [12, 16, 1.5], [30, 9, 1], [58, 14, 1.2], [86, 44, 1.4], [92, 12, 1],
        [18, 44, 1], [8, 62, 1.3], [44, 30, 0.9], [68, 62, 1.1], [88, 78, 1.3],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity="0.85" />
      ))}
    </>
  ),
}

/* ------------------------------------------------------------------ *
 * 头像框
 *
 * 套在头像圆圈外面的一圈，和人本身无关 —— 所以立绘图片和 SVG 手绘
 * 都能用。排行榜上每个人的头像都在，这一圈是最容易被看见的显摆位。
 *
 * 画在 0 0 100 100 里，圆心 50,50，人像占到半径 46 左右，
 * 框画在 46~50 这一圈，往里不压脸、往外不出血。
 * ------------------------------------------------------------------ */

type FrameArt = { ring: ReactNode; glow?: string }

const FRAMES: Record<string, FrameArt> = {
  'ring-steel': {
    ring: (
      <>
        <circle cx="50" cy="50" r="45" {...stroke('#7d8797', 5)} />
        <circle cx="50" cy="50" r="45" {...stroke('#c3ccd9', 2)} />
      </>
    ),
  },
  'ring-jade': {
    ring: (
      <>
        <circle cx="50" cy="50" r="45" {...stroke('#1f5f52', 5)} />
        <circle cx="50" cy="50" r="45" {...stroke('#4fd6ac', 2.2)} />
        {/* 四颗角石，等距落在圆上 */}
        {[0, 90, 180, 270].map((a) => (
          <circle
            key={a}
            cx={50 + 45 * Math.cos((a * Math.PI) / 180)}
            cy={50 + 45 * Math.sin((a * Math.PI) / 180)}
            r="4"
            fill="#7ff0c8"
            stroke="#1f5f52"
            strokeWidth="1.4"
          />
        ))}
      </>
    ),
    glow: '#4fd6ac',
  },
  'ring-gold': {
    ring: (
      <>
        <circle cx="50" cy="50" r="45" {...stroke('#8a6712', 6)} />
        <circle cx="50" cy="50" r="45" {...stroke('#f2c14e', 3)} />
        <circle cx="50" cy="50" r="41" {...stroke('#fff3cf', 1)} opacity="0.6" />
      </>
    ),
    glow: '#f2c14e',
  },
  'ring-flame': {
    ring: (
      <>
        {/* 火苗先画，压在环下面，看起来是从环里烧出来的 */}
        {Array.from({ length: 14 }, (_, i) => (
          <path
            key={i}
            d="M50 8 C53.4 3 55 -1 50 -6 C45 -1 46.6 3 50 8 Z"
            fill={i % 2 ? '#ffd166' : '#ff7a2f'}
            transform={`rotate(${i * (360 / 14)} 50 50)`}
          />
        ))}
        <circle cx="50" cy="50" r="45" {...stroke('#7a2410', 5.6)} />
        <circle cx="50" cy="50" r="45" {...stroke('#ff7a2f', 3)} />
      </>
    ),
    glow: '#ff7a2f',
  },
  'ring-crown': {
    ring: (
      <>
        <circle cx="50" cy="50" r="45" {...stroke('#5c4610', 6)} />
        <circle cx="50" cy="50" r="45" {...stroke('#ffd85e', 3.2)} />
        {/*
          王冠压在环的正上方，坐在 r=45 那条线上。
          画布只到 y=0，所以冠尖顶到 1 为止 —— 再高就被裁掉了。
        */}
        <path
          d="M37 12 L40.5 2 L45 9 L50 1 L55 9 L59.5 2 L63 12 Z"
          fill="#ffd85e"
          stroke="#8a6712"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M37 12 h26" {...stroke('#8a6712', 2)} />
        <circle cx="50" cy="1.5" r="2" fill="#fff3cf" stroke="#8a6712" strokeWidth="0.9" />
      </>
    ),
    glow: '#ffd85e',
  },
}

/**
 * 有画法的装备 id。
 *
 * 商店卖的是 id，画的是这几个 Record 的 key —— 两边对不上就是
 * 「花了金币但什么都没变」，而这种 bug 界面上一点都不报错，
 * 只会悄悄退回默认款。测试拿这份清单和商店对一遍，
 * 以后加新货漏画哪一件，当场就红。
 */
export const DRAWN_IDS: Record<string, string[]> = {
  frame: Object.keys(FRAMES),
  background: Object.keys(BACKDROPS),
  weapon: Object.keys(WEAPONS),
}

/**
 * 头像框。单独一个 <svg> 叠在头像上面，不进 AvatarInner ——
 * 那样立绘图片版就用不上了，而这一圈恰恰是有立绘之后唯一还能买的东西。
 */
export function AvatarFrame({ itemId }: { itemId: string }) {
  const art = FRAMES[itemId]
  if (!art) return null
  return (
    /*
      比头像本体大一圈（-inset-[12%]），环画在 r=45，
      正好落在头像圆的外沿上 —— 和头像同样大小的话，
      这一圈会压在脸上。
    */
    <svg
      viewBox="0 0 100 100"
      className="pointer-events-none absolute -inset-[12%] h-[124%] w-[124%]"
      aria-hidden
    >
      {art.glow && (
        <circle cx="50" cy="50" r="45" fill="none" stroke={art.glow} strokeWidth="9" opacity="0.2" />
      )}
      {art.ring}
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * 组装
 * ------------------------------------------------------------------ */

const IRIS: Record<AvatarSex, string> = { m: '#3f7fd8', f: '#4fa89c' }

/**
 * 把整颗头（含头发五官）从原来的整张画布缩到上半截。
 * 原来头顶在 y=9，缩放后落在 y=2；0.72 是等比，描边不会被拉扁。
 */
const HEAD_AT = 'translate(50 2) scale(0.7) translate(-50 -9)'

/** 角色本体，不带 <svg> 外壳 —— 这样整图和商店里的裁剪图能共用同一份画法 */
function AvatarInner({
  sex,
  skin,
  equipped,
}: {
  sex: AvatarSex
  skin: number
  equipped: Partial<Record<AvatarSlot, string>>
}) {
  const tone = SKIN_TONES[skin] ?? SKIN_TONES[0]
  const hair = hairOf(equipped.hair, sex)
  const suit = Outfit({ id: equipped.outfit, sex })
  const backdrop = equipped.background ? BACKDROPS[equipped.background] : null
  const weapon = equipped.weapon ? WEAPONS[equipped.weapon] : null

  return (
    <>
      {backdrop}
      {GROUND}
      {suit.cape}
      {/*
        头连同头发、五官原本按 100×100 整张画布画。
        这里整组缩到画面上半截，得到约 2 头身的 Q 版比例，
        比把每条路径重算一遍靠谱得多。
      */}
      <g transform={HEAD_AT}>{hair.back}</g>
      <BodyBase skin={tone} />
      {suit.body}
      <g transform={HEAD_AT}>
        <Head skin={tone} />
        <Face sex={sex} skin={tone} iris={IRIS[sex]} />
        {hair.front}
      </g>
      {weapon && (
        <>
          <g transform={WEAPON_AT}>{weapon}</g>
          {/* 右手补画一次，盖在拍柄上 —— 手指在握把外面，球拍才是被握住的 */}
          <circle
            cx="66.5"
            cy="73"
            r="4.4"
            fill={tone}
            stroke={shade(tone, -0.45)}
            strokeWidth="1.4"
          />
        </>
      )}
    </>
  )
}

/**
 * 全身立绘。
 *
 * 给了 stage 而且那一格放了立绘图片，就用图片，背后衬一层这一阶段的光晕；
 * 没图就照旧用 SVG 手绘 —— 两套画法共存，一张图都不放 App 也完整。
 */
export function AvatarView({
  sex,
  skin = 0,
  equipped = {},
  stage,
  className,
  title,
}: {
  sex: AvatarSex
  skin?: number
  equipped?: Partial<Record<AvatarSlot, string>>
  stage?: Stage
  className?: string
  title?: string
}) {
  const art = stage && artUrl(sex, stage)
  if (art) {
    /*
     * 买来的背景要画在立绘后面。
     * 漏掉这一层的话，有立绘的时候背景是唯一还能买的「装在人身上」的东西，
     * 买完却一点变化都没有 —— 花了金币看不到东西，比不卖还糟。
     */
    const backdrop = equipped.background ? BACKDROPS[equipped.background] : null
    return (
      <span className={cx('relative block overflow-hidden', className)}>
        {backdrop ? (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            {backdrop}
          </svg>
        ) : (
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 top-1/4 blur-xl"
            style={{
              background: `radial-gradient(ellipse at 50% 60%, ${stage.glow}66, transparent 70%)`,
            }}
          />
        )}
        {/*
          立绘自带设计稿那层渐变底，衬在买来的背景前面会像贴了张照片。
          圆角加一道细边，让它看起来是「裱起来的立绘」而不是没对齐。
        */}
        <img
          src={art}
          alt={title ?? '角色'}
          className={cx(
            'relative h-full w-full object-contain',
            !!backdrop && 'rounded-lg',
          )}
          draggable={false}
        />
      </span>
    )
  }

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={title ?? '角色'}
    >
      {title && <title>{title}</title>}
      <AvatarInner sex={sex} skin={skin} equipped={equipped} />
    </svg>
  )
}

/** 商店和衣柜列表里的小图：只画这一件，不画人 */
export function GearIcon({ itemId, className }: { itemId: string; className?: string }) {
  const item = itemById(itemId)
  if (!item) return null

  if (item.slot === 'background') {
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        {BACKDROPS[itemId]}
      </svg>
    )
  }

  if (item.slot === 'frame') {
    // 框是套在头像外面的，单独看一圈线看不懂 —— 里面垫一个圆当作头像
    return (
      <span className={cx('relative block', className)}>
        <span className="block h-full w-full rounded-full bg-ink-700" />
        <AvatarFrame itemId={itemId} />
      </span>
    )
  }

  if (item.slot === 'title') {
    return (
      <span
        className={cx(
          'flex items-center justify-center rounded-lg bg-ink-800 p-1 text-center text-[11px] font-medium leading-tight text-lime-glow',
          className,
        )}
      >
        {item.name}
      </span>
    )
  }

  if (item.slot === 'weapon') {
    // 武器本来吊在角色手边，单独展示要摆正、居中、放大
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        <g transform="translate(50 72) scale(1.9)">{WEAPONS[itemId]}</g>
      </svg>
    )
  }

  /*
   * 发型和战服直接拿真人预览 —— 比抽出一件平铺更看得懂穿上是什么样。
   * 但要各自裁到对应部位：整个人缩成一个小方块时战服只占底下一条，
   * 五套战服看起来会一模一样，根本不知道自己在买什么。
   */
  const sex: AvatarSex = item.sex ?? 'm'
  const hair = item.slot === 'hair' ? item.id : sex === 'm' ? 'm-short' : 'f-bob'
  const outfit = item.slot === 'outfit' ? item.id : 'tee'
  // 发型裁到头，战服裁到身子 —— 各看各的部位才分得清买的是什么
  const crop = item.slot === 'hair' ? '26 0 48 50' : '14 48 72 52'

  return (
    <svg viewBox={crop} className={className} aria-hidden>
      <AvatarInner sex={sex} skin={0} equipped={{ hair, outfit }} />
    </svg>
  )
}

/**
 * 头肩特写：把立绘裁到头和肩膀。
 * 全身缩进一个小圆圈时人只有几像素高，认不出是谁；裁近才有头像的作用。
 */
export function AvatarFace({
  sex,
  skin = 0,
  equipped = {},
  stage,
  className,
  title,
}: {
  sex: AvatarSex
  skin?: number
  equipped?: Partial<Record<AvatarSlot, string>>
  stage?: Stage
  className?: string
  title?: string
}) {
  const art = stage && artUrl(sex, stage)
  if (art) {
    // 立绘是全身的，缩进小圆圈里人只有几像素高 —— 放大后把头挪到圆心
    return (
      <span className={cx('block overflow-hidden', className)}>
        <img
          src={art}
          alt={title ?? '头像'}
          className="h-full w-full object-contain"
          style={{
            transform: `scale(${HEAD_CROP.scale})`,
            transformOrigin: `50% ${HEAD_CROP.originY}%`,
          }}
          draggable={false}
        />
      </span>
    )
  }

  // 裁到 y=60：多带一截领口，队服的颜色也能在头像里看出来
  return (
    <svg viewBox="22 2 56 58" className={className} role="img" aria-label={title ?? '头像'}>
      {title && <title>{title}</title>}
      <AvatarInner sex={sex} skin={skin} equipped={equipped} />
    </svg>
  )
}

/** 名字旁边的小头像 */
export function AvatarBadge({
  avatar,
  size = 28,
}: {
  avatar: AvatarProfile
  size?: number
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-800"
      style={{ width: size, height: size }}
    >
      <AvatarView
        sex={avatar.sex}
        skin={avatar.skin}
        equipped={avatar.equipped}
        className="h-full w-full"
      />
    </span>
  )
}
