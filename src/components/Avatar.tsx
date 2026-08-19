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

function Eye({
  x,
  y,
  iris,
  wide,
}: {
  x: number
  y: number
  iris: string
  /** 女生的眼睛画大一点，男生窄一点，靠这一个开关区分 */
  wide: boolean
}) {
  const rx = wide ? 7 : 6.2
  const ry = wide ? 8.6 : 7.4
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#fdfbff" />
      <ellipse cx={x} cy={y + 0.6} rx={rx * 0.78} ry={ry * 0.82} fill={iris} />
      <ellipse
        cx={x}
        cy={y + 2.2}
        rx={rx * 0.78}
        ry={ry * 0.5}
        fill={shade(iris, -0.35)}
      />
      <ellipse cx={x} cy={y + 0.8} rx={rx * 0.36} ry={ry * 0.46} fill={INK} />
      <circle cx={x - rx * 0.32} cy={y - ry * 0.38} r={rx * 0.3} fill="#fff" />
      <circle
        cx={x + rx * 0.34}
        cy={y + ry * 0.42}
        r={rx * 0.16}
        fill="#fff"
        opacity="0.75"
      />
      {/* 上眼睑：Q 版里这条粗线比眼球本身还重要 */}
      <path
        d={`M${x - rx - 1} ${y - ry * 0.5} Q${x} ${y - ry - 2.4} ${x + rx + 1} ${y - ry * 0.5}`}
        {...stroke(INK, wide ? 3.4 : 3)}
      />
    </g>
  )
}

function Face({ sex, skin, iris }: { sex: AvatarSex; skin: string; iris: string }) {
  const female = sex === 'f'
  const eyeY = 48
  return (
    <g>
      {/* 眉毛：男生粗平，女生细弯，是男女差别最明显的一笔 */}
      {female ? (
        <>
          <path d="M32 37 Q39 33.5 45.5 36.5" {...stroke(LINE, 2.2)} />
          <path d="M68 37 Q61 33.5 54.5 36.5" {...stroke(LINE, 2.2)} />
        </>
      ) : (
        <>
          <path d="M31 36.5 L45.5 38.5" {...stroke(LINE, 3.4)} />
          <path d="M69 36.5 L54.5 38.5" {...stroke(LINE, 3.4)} />
        </>
      )}

      <Eye x={38.5} y={eyeY} iris={iris} wide={female} />
      <Eye x={61.5} y={eyeY} iris={iris} wide={female} />

      {/* 鼻子只用一小道阴影带过，画实了会破坏 Q 版比例 */}
      <path d="M50 56.5 q1.8 1.4 0 2.4" {...stroke(shade(skin, -0.32), 1.6)} />

      {/* 嘴 */}
      {female ? (
        <path d="M46.5 63.5 q3.5 3.2 7 0" {...stroke(INK, 1.8)} />
      ) : (
        <path d="M46 63.5 q4 2.6 8 0" {...stroke(INK, 1.8)} />
      )}

      {female && (
        <>
          <ellipse cx="31" cy="55" rx="4.5" ry="2.6" fill="#f2909f" opacity="0.35" />
          <ellipse cx="69" cy="55" rx="4.5" ry="2.6" fill="#f2909f" opacity="0.35" />
        </>
      )}
    </g>
  )
}

/* ------------------------------------------------------------------ *
 * 头与身体
 * ------------------------------------------------------------------ */

function Head({ skin }: { skin: string }) {
  const dark = shade(skin, -0.14)
  return (
    <g>
      {/* 耳朵 */}
      <ellipse cx="23.5" cy="49" rx="4" ry="6" fill={skin} />
      <ellipse cx="76.5" cy="49" rx="4" ry="6" fill={skin} />
      <path d="M23.5 46.5 q1.6 2.6 0 5" {...stroke(dark, 1.2)} />
      <path d="M76.5 46.5 q-1.6 2.6 0 5" {...stroke(dark, 1.2)} />
      {/* 头：上宽下窄，收一个小尖下巴 */}
      <path
        d="M50 15
           C68 15 77 27 77 44
           C77 57 70 68 60 72
           Q50 76 40 72
           C30 68 23 57 23 44
           C23 27 32 15 50 15 Z"
        fill={skin}
      />
      {/* 脖子 */}
      <path d="M42 68 h16 v9 q-8 4 -16 0 Z" fill={shade(skin, -0.1)} />
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
    ? 'M50 74 C63 74 74 80 79 88 L83 100 L17 100 L21 88 C26 80 37 74 50 74 Z'
    : 'M50 75 C61 75 71 81 76 89 L80 100 L20 100 L24 89 C29 81 39 75 50 75 Z'

function Outfit({ id, sex }: { id: string | undefined; sex: AvatarSex }) {
  const body = bodyPath(sex)

  if (id === 'jersey') {
    return (
      <g>
        <path d={body} fill="#1f6feb" />
        <path d="M50 74 L44 82 L50 88 L56 82 Z" fill="#fdfbff" />
        <path d="M21 88 L17 100 L27 100 L30 88 Z" fill="#c7e0ff" />
        <path d="M79 88 L83 100 L73 100 L70 88 Z" fill="#c7e0ff" />
        <text
          x="50"
          y="98"
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
        <path d={body} fill="#7a4b2a" />
        <path d="M50 74 L40 84 L50 92 L60 84 Z" fill="#5c3720" />
        <path d="M24 90 h52" {...stroke('#3f2616', 3)} />
        <ellipse cx="28" cy="88" rx="7" ry="6" fill="#8f5c36" />
        <ellipse cx="72" cy="88" rx="7" ry="6" fill="#8f5c36" />
        <circle cx="50" cy="88" r="3" fill="#d8a25e" />
      </g>
    )
  }

  if (id === 'knight') {
    return (
      <g>
        <path d={body} fill="#b9c2cf" />
        <path d="M50 74 L41 83 L50 92 L59 83 Z" fill="#8f99a8" />
        {/* 肩甲 */}
        <path d="M21 88 C22 80 30 78 34 82 L32 100 L17 100 Z" fill="#d5dce6" />
        <path d="M79 88 C78 80 70 78 66 82 L68 100 L83 100 Z" fill="#d5dce6" />
        <path d="M21 88 C22 80 30 78 34 82" {...stroke('#8f99a8', 1.6)} />
        <path d="M79 88 C78 80 70 78 66 82" {...stroke('#8f99a8', 1.6)} />
        {/* 胸前那颗金星 */}
        <path
          d="M50 84 l2.6 5.4 l6 0.8 l-4.3 4.2 l1 5.9 l-5.3 -2.8 l-5.3 2.8 l1 -5.9 l-4.3 -4.2 l6 -0.8 Z"
          fill="#f2c14e"
        />
      </g>
    )
  }

  if (id === 'shadow') {
    return (
      <g>
        <path d={body} fill="#241f2e" />
        <path d="M50 74 L40 85 L50 94 L60 85 Z" fill="#15121c" />
        <path d="M24 89 C34 96 66 96 76 89" {...stroke('#c0392b', 2.4)} />
        <path d="M21 88 C23 81 30 79 34 83 L33 100 L18 100 Z" fill="#312a3d" />
        <path d="M79 88 C77 81 70 79 66 83 L67 100 L82 100 Z" fill="#312a3d" />
        <circle cx="50" cy="86" r="3.4" fill="#c0392b" />
        <circle cx="50" cy="86" r="1.4" fill="#ffb4a8" />
      </g>
    )
  }

  // 训练服：免费款
  return (
    <g>
      <path d={body} fill="#3f4757" />
      <path d="M50 74 L44 81 L50 87 L56 81 Z" fill="#e9edf3" />
      <path d="M24 92 h52" {...stroke('#2c3340', 2.4)} />
    </g>
  )
}

/* ------------------------------------------------------------------ *
 * 发型
 *
 * 每款给出 back（压在身体下面）和 front（盖住额头和两鬓）两层。
 * ------------------------------------------------------------------ */

type Hair = { back?: ReactNode; front: ReactNode }

const hairOf = (id: string | undefined, sex: AvatarSex): Hair => {
  switch (id) {
    case 'm-spiky': {
      const c = '#241f2b'
      return {
        front: (
          <g>
            <path
              d="M23 44 C21 26 33 12 50 12 C67 12 79 26 77 44
                 L72 33 L68 41 L62 28 L56 38 L50 26 L44 38 L38 28 L32 41 L28 33 Z"
              fill={c}
            />
            <path d="M31 30 L36 20 L40 29" fill={shade(c, 0.16)} />
            <path d="M60 29 L64 20 L69 30" fill={shade(c, 0.16)} />
          </g>
        ),
      }
    }
    case 'm-wolf': {
      const c = '#5a3a24'
      return {
        back: (
          <path d="M22 42 C20 60 24 74 30 84 L70 84 C76 74 80 60 78 42 Z" fill={shade(c, -0.2)} />
        ),
        front: (
          <g>
            <path
              d="M23 46 C21 26 33 13 50 13 C67 13 79 26 77 46
                 C74 36 70 31 64 29 C58 40 46 42 38 36 C32 39 27 40 23 46 Z"
              fill={c}
            />
            <path d="M36 21 C41 18 46 17 50 18" {...stroke(shade(c, 0.2), 1.4)} opacity="0.6" />
          </g>
        ),
      }
    }
    case 'm-silver': {
      const c = '#b9c0d0'
      return {
        back: <path d="M23 42 C21 58 25 70 30 78 L70 78 C75 70 79 58 77 42 Z" fill={shade(c, -0.22)} />,
        front: (
          <g>
            <path
              d="M23 46 C21 25 34 12 50 12 C66 12 79 25 77 46
                 C73 34 66 28 58 27 C52 36 40 39 33 33 C28 36 25 40 23 46 Z"
              fill={c}
            />
            <path d="M38 20 C43 17 50 17 55 19" {...stroke("#fff", 1.4)} opacity="0.5" />
            <path d="M27 42 C29 33 34 28 39 26" {...stroke(shade(c, -0.3), 2.4)} />
            <path d="M25 44 C30 34 40 31 50 32 C60 31 70 34 75 44" {...stroke(shade(c, -0.28), 1.6)} opacity="0.8" />
          </g>
        ),
      }
    }
    case 'f-twin': {
      const c = '#6b4632'
      return {
        back: (
          <g>
            <path d="M26 40 C18 44 12 58 15 74 C19 84 27 84 29 76 C27 62 28 50 32 44 Z" fill={c} />
            <path d="M74 40 C82 44 88 58 85 74 C81 84 73 84 71 76 C73 62 72 50 68 44 Z" fill={c} />
            <ellipse cx="24" cy="38" rx="7" ry="6" fill={shade(c, 0.12)} />
            <ellipse cx="76" cy="38" rx="7" ry="6" fill={shade(c, 0.12)} />
          </g>
        ),
        front: (
          <g>
            <path
              d="M22 48 C20 25 34 11 50 11 C66 11 80 25 78 48
                 C76 38 72 32 66 30 L62 38 L56 30 L50 37 L44 30 L38 38 L34 30 C28 32 24 38 22 48 Z"
              fill={c}
            />
            <path d="M39 20 C44 17 51 17 56 19" {...stroke(shade(c, 0.2), 1.4)} opacity="0.6" />
          </g>
        ),
      }
    }
    case 'f-long': {
      const c = '#1f1b26'
      return {
        back: (
          <path d="M21 40 C17 60 18 82 22 100 L78 100 C82 82 83 60 79 40 Z" fill={c} />
        ),
        front: (
          <g>
            <path
              d="M22 48 C20 24 34 11 50 11 C66 11 80 24 78 48
                 C77 36 73 30 68 28 C63 36 52 39 44 34 C33 36 25 40 22 48 Z"
              fill={c}
            />
            <path d="M22 48 C22 62 24 72 27 80 L33 80 C29 68 28 56 30 44 Z" fill={shade(c, 0.1)} />
            <path d="M78 48 C78 62 76 72 73 80 L67 80 C71 68 72 56 70 44 Z" fill={shade(c, 0.1)} />
            <path d="M39 19 C45 16 52 16 57 18" {...stroke(shade(c, 0.3), 1.4)} opacity="0.55" />
          </g>
        ),
      }
    }
    case 'f-wavy': {
      const c = '#d9b26a'
      return {
        back: (
          <path
            d="M21 40 C15 56 20 66 15 78 C22 84 26 78 28 88 C34 84 38 92 44 88
               L56 88 C62 92 66 84 72 88 C74 78 78 84 85 78 C80 66 85 56 79 40 Z"
            fill={c}
          />
        ),
        front: (
          <g>
            <path
              d="M22 48 C20 24 34 11 50 11 C66 11 80 24 78 48
                 C76 36 71 30 65 29 C60 38 46 41 38 35 C30 37 24 41 22 48 Z"
              fill={c}
            />
            <path d="M24 46 C20 56 26 62 22 70" {...stroke(shade(c, -0.22), 2.6)} />
            <path d="M76 46 C80 56 74 62 78 70" {...stroke(shade(c, -0.22), 2.6)} />
            <path d="M39 19 C45 16 52 16 57 19" {...stroke("#f6e3b8", 1.4)} opacity="0.6" />
          </g>
        ),
      }
    }
    case 'f-bob': {
      const c = '#6b4632'
      return {
        back: <path d="M22 42 C20 56 23 66 27 72 L73 72 C77 66 80 56 78 42 Z" fill={shade(c, -0.15)} />,
        front: (
          <g>
            <path
              d="M22 50 C20 25 34 11 50 11 C66 11 80 25 78 50
                 C77 42 75 36 71 32 L66 40 L60 31 L54 39 L48 30 L42 39 L36 31 L30 39
                 C26 40 23 44 22 50 Z"
              fill={c}
            />
            <path d="M22 50 C22 60 24 66 26 70 L32 70 C29 62 28 56 29 46 Z" fill={shade(c, 0.1)} />
            <path d="M78 50 C78 60 76 66 74 70 L68 70 C71 62 72 56 71 46 Z" fill={shade(c, 0.1)} />
          </g>
        ),
      }
    }
    default: {
      // 利落短发：男生的免费款，也是所有缺省情况的兜底
      const c = sex === 'f' ? '#6b4632' : '#4a3526'
      return {
        front: (
          <g>
            <path
              d="M23 47 C21 26 34 12 50 12 C66 12 79 26 77 47
                 C74 37 70 31 64 29 C57 38 44 40 36 34 C29 36 25 40 23 47 Z"
              fill={c}
            />
            <path d="M38 20 C43 17 50 17 55 19" {...stroke(shade(c, 0.22), 1.4)} opacity="0.6" />
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
const WEAPON_AT = 'translate(87 74) rotate(14) scale(0.82)'

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
  const crop = item.slot === 'hair' ? '14 4 72 72' : '14 62 72 40'

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
