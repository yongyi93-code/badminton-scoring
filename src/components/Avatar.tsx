import type { ReactNode } from 'react'
import {
  itemById,
  SKIN_TONES,
  type AvatarProfile,
  type AvatarSex,
  type AvatarSlot,
} from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * 角色形象
 *
 * Q 版半身像，全部用 SVG 手绘，装在 100×100 的 viewBox 里 ——
 * 放大缩小都不糊，也不用打包任何图片资源，离线可用是这个 App 的底线。
 *
 * 分层顺序：背景 → 后发 → 身体/战服 → 脖子 → 头 → 五官 → 前发 → 武器。
 * 后发要压在身体下面、前发要盖住额头，所以头发拆成前后两层分开画。
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
        d="M41 70 h18 v10 q-9 4 -18 0 Z"
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
 * 战服
 *
 * 都从 y=76 往下画到画面底，肩线宽度按性别微调。
 * ------------------------------------------------------------------ */

const bodyPath = (sex: AvatarSex) =>
  sex === 'm'
    ? 'M50 79 C64 79 76 85 81 92 L85 100 L15 100 L19 92 C24 85 36 79 50 79 Z'
    : 'M50 80 C62 80 73 86 78 93 L82 100 L18 100 L22 93 C27 86 38 80 50 80 Z'

function Outfit({ id, sex }: { id: string | undefined; sex: AvatarSex }) {
  const body = bodyPath(sex)

  if (id === 'jersey') {
    return (
      <g>
        <path d={body} fill="#1f6feb" stroke={shade("#1f6feb", -0.42)} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M50 79 L43 87 L50 94 L57 87 Z" fill="#fdfbff" />
        <path d="M19 92 L15 100 L26 100 L29 92 Z" fill="#c7e0ff" />
        <path d="M81 92 L85 100 L74 100 L71 92 Z" fill="#c7e0ff" />
        <text
          x="50"
          y="99"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="#fdfbff"
        >
          1
        </text>
      </g>
    )
  }

  if (id === 'leather') {
    return (
      <g>
        <path d={body} fill="#7a4b2a" stroke={shade("#7a4b2a", -0.42)} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M50 79 L40 89 L50 97 L60 89 Z" fill="#5c3720" />
        <path d="M22 94 h56" {...stroke('#3f2616', 3)} />
        <ellipse cx="26" cy="92" rx="7.5" ry="6.5" fill="#8f5c36" />
        <ellipse cx="74" cy="92" rx="7.5" ry="6.5" fill="#8f5c36" />
        <circle cx="50" cy="92" r="3.2" fill="#d8a25e" />
      </g>
    )
  }

  if (id === 'knight') {
    return (
      <g>
        <path d={body} fill="#b9c2cf" stroke={shade("#b9c2cf", -0.42)} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M50 79 L41 88 L50 97 L59 88 Z" fill="#8f99a8" />
        {/* 肩甲 */}
        <path d="M19 92 C20 83 29 81 34 86 L32 100 L15 100 Z" fill="#d5dce6" />
        <path d="M81 92 C80 83 71 81 66 86 L68 100 L85 100 Z" fill="#d5dce6" />
        <path d="M19 92 C20 83 29 81 34 86" {...stroke('#8f99a8', 1.6)} />
        <path d="M81 92 C80 83 71 81 66 86" {...stroke('#8f99a8', 1.6)} />
        {/* 胸前那颗金星 */}
        <path
          d="M50 88 l2.4 5 l5.5 0.7 l-4 3.9 l0.9 5.4 l-4.8 -2.6 l-4.8 2.6 l0.9 -5.4 l-4 -3.9 l5.5 -0.7 Z"
          fill="#f2c14e"
        />
      </g>
    )
  }

  if (id === 'shadow') {
    return (
      <g>
        <path d={body} fill="#241f2e" stroke={shade("#241f2e", -0.42)} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M50 79 L40 90 L50 99 L60 90 Z" fill="#15121c" />
        <path d="M22 93 C34 100 66 100 78 93" {...stroke('#c0392b', 2.4)} />
        <path d="M19 92 C21 84 29 82 34 87 L33 100 L16 100 Z" fill="#312a3d" />
        <path d="M81 92 C79 84 71 82 66 87 L67 100 L84 100 Z" fill="#312a3d" />
        <circle cx="50" cy="90" r="3.6" fill="#c0392b" />
        <circle cx="50" cy="90" r="1.5" fill="#ffb4a8" />
      </g>
    )
  }

  // 训练服：免费款
  return (
    <g>
      <path d={body} fill="#3f4757" stroke={shade("#3f4757", -0.42)} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M50 79 L44 86 L50 92 L56 86 Z" fill="#e9edf3" />
      <path d="M22 96 h56" {...stroke('#2c3340', 2.4)} />
    </g>
  )
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
  racket: (
    <>
      <ellipse cx="0" cy="-13" rx="9.5" ry="12" fill="#cfe3ff" opacity="0.55" />
      <ellipse cx="0" cy="-13" rx="9.5" ry="12" {...stroke('#1f6feb', 2.4)} />
      <path d="M-6 -22 v18 M0 -25 v21 M6 -22 v18" {...stroke('#8fbaf5', 1)} />
      <path d="M-8 -18 h16 M-9.5 -13 h19 M-8 -8 h16" {...stroke('#8fbaf5', 1)} />
      <path d="M0 -1 v10" {...stroke('#1f6feb', 3.2)} />
      <path d="M0 6 v8" {...stroke('#f2a33c', 4.4)} />
    </>
  ),
  dagger: (
    <>
      <path d="M0 -26 L4 -10 L0 -5 L-4 -10 Z" fill="#dde4ee" />
      <path d="M0 -26 L0 -5" {...stroke('#9aa6b8', 1)} />
      <path d="M-7 -9 h14" {...stroke('#8a6b3a', 3)} />
      <path d="M0 -8 v11" {...stroke('#3f2f1e', 3.6)} />
      <circle cx="0" cy="5" r="2.4" fill="#c9a227" />
    </>
  ),
  sword: (
    <>
      <path d="M0 -36 L4.2 -28 L4.2 -8 L-4.2 -8 L-4.2 -28 Z" fill="#e4eaf3" />
      <path d="M0 -35 L0 -8" {...stroke('#a6b1c2', 1.2)} />
      <path d="M-9 -7 h18" {...stroke('#c9a227', 3.4)} />
      <path d="M0 -6 v11" {...stroke('#3f2f1e', 3.8)} />
      <circle cx="0" cy="7" r="2.8" fill="#c9a227" />
    </>
  ),
  staff: (
    <>
      <path d="M0 -30 v40" {...stroke('#6b4a2c', 3.4)} />
      <circle cx="0" cy="-33" r="7" fill="#7c5cf0" opacity="0.4" />
      <circle cx="0" cy="-33" r="4.4" fill="#a48bff" />
      <circle cx="-1.4" cy="-34.6" r="1.4" fill="#fff" />
      <path d="M-6 -28 q6 4 12 0" {...stroke('#c9a227', 2)} />
    </>
  ),
  greatsword: (
    <>
      <path d="M0 -42 L6.4 -32 L6.4 -8 L-6.4 -8 L-6.4 -32 Z" fill="#eef2f8" />
      <path d="M0 -41 L0 -8" {...stroke('#9aa6b8', 1.6)} />
      <path d="M-3.6 -32 L-3.6 -11 M3.6 -32 L3.6 -11" {...stroke('#c3ccda', 1)} />
      <path d="M-11 -6 h22" {...stroke('#5b5060', 4.2)} />
      <path d="M0 -5 v14" {...stroke('#2f2836', 4.2)} />
      <circle cx="0" cy="11" r="3.2" fill="#c0392b" />
    </>
  ),
}

/**
 * 武器摆位：往右让开脸，握把落在肩膀高度，刀尖朝右上。
 * 头最宽到 x=77，所以握把放 x=87 才不压脸。
 */
const WEAPON_AT = 'translate(88 78) rotate(14) scale(0.8)'

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
 * 组装
 * ------------------------------------------------------------------ */

const IRIS: Record<AvatarSex, string> = { m: '#3f7fd8', f: '#4fa89c' }

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
  const backdrop = equipped.background ? BACKDROPS[equipped.background] : null
  const weapon = equipped.weapon ? WEAPONS[equipped.weapon] : null

  return (
    <>
      {backdrop}
      {hair.back}
      <Outfit id={equipped.outfit} sex={sex} />
      <Head skin={tone} />
      <Face sex={sex} skin={tone} iris={IRIS[sex]} />
      {hair.front}
      {weapon && <g transform={WEAPON_AT}>{weapon}</g>}
    </>
  )
}

export function AvatarView({
  sex,
  skin = 0,
  equipped = {},
  className,
  title,
}: {
  sex: AvatarSex
  skin?: number
  equipped?: Partial<Record<AvatarSlot, string>>
  className?: string
  title?: string
}) {
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

  if (item.slot === 'weapon') {
    // 武器本来吊在角色手边，单独展示要摆正、居中、放大
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        <g transform="translate(50 68) scale(1.9)">{WEAPONS[itemId]}</g>
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
  // 发型看头，战服看肩
  const crop = item.slot === 'hair' ? '12 0 76 76' : '12 66 76 34'

  return (
    <svg viewBox={crop} className={className} aria-hidden>
      <AvatarInner sex={sex} skin={0} equipped={{ hair, outfit }} />
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
