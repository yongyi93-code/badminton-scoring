/* ------------------------------------------------------------------ *
 * 二维码：现画一个
 *
 * 原来卡片上那个是**编译期**生成的（design/make-qr.py + segno），
 * 因为它的内容是个常量：站点首页。理由写在那个脚本开头，当时是对的。
 *
 * 现在不是常量了：分享一场球局要带上球局 id 和球群邀请码，每一场都
 * 不一样 —— 扫码的人才能直接落进那一场，而不是落在首页再自己去找。
 *
 * -------------------------------------------------------------------
 * 为什么自己写而不是装一个库
 *
 * 这里只需要**一种**二维码：一条几十个字符的 ASCII 网址，纠错 M。
 * 通用库要支持数字/字母数字/汉字/结构化追加/所有纠错等级/所有版本，
 * 而那些这里一样都用不上 —— 代价是十几 KB 进离线包，每个打开 App
 * 的人都要下。
 *
 * 自己写的风险是**算错了也看不出来** —— Reed-Solomon 错一位，
 * 画出来还是一张像模像样的二维码，只是扫不出来。所以这一份从头到尾
 * 拿 segno（Python 那个库）当标准答案比对过：几十个真实的邀请网址，
 * 矩阵**一格一格**对得上（见 tests/qr.test.ts）。
 *
 * -------------------------------------------------------------------
 * 只做这么多，是故意的
 *
 *   · 只有字节模式 —— 网址是 ASCII，数字模式那些压缩用不上
 *   · 只有纠错 M   —— 这张图要被转发、截图、再转发，L 太脆；
 *                     Q/H 会让格子变密，而屏幕上那块地方就这么大
 *   · 只到版本 10  —— 271 字节，而一条邀请链接七十几个字符
 *
 * 超出范围就抛错，不是悄悄降级：画出一张扫不出来的二维码比不画更糟，
 * 因为没人会去验证它。
 * ------------------------------------------------------------------ */

/** 支持到第几版。10 版在纠错 M 下放得下 271 字节 */
const MAX_VERSION = 10

/** 每一版的总码字数（数据 + 纠错） */
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346]

/**
 * 纠错 M 的分块表：[每块纠错码字数, 第一组块数, 每块数据码字数, 第二组块数, 每块数据码字数]
 *
 * 这张表是规范里抄来的，没有公式可以算 —— 抄错一行的后果是那一版
 * 的码全部扫不出来，所以测试里每一版都真的编过一次。
 */
const EC_M: [number, number, number, number, number][] = [
  [0, 0, 0, 0, 0],
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
]

/** 每一版校正图案的中心坐标 */
const ALIGN = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

/* ------------------------------------------------------------------ *
 * GF(256)：Reed-Solomon 要用的那套加减乘除
 *
 * 本原多项式 0x11D，和规范一致。这两张表开销极小（各 256 字节），
 * 但省掉了每次乘法都去做多项式取模。
 * ------------------------------------------------------------------ */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  /* 后半截是前半截的复制，乘法里就不用再对 255 取模了 */
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/**
 * 生成多项式：(x-α⁰)(x-α¹)…(x-α^(n-1))
 *
 * 系数**从最高次往下**排，所以 poly[0] 恒等于 1。
 *
 * 这一处的顺序反过来写过一版，后果值得记下来：数据码字、掩码、格式
 * 信息全都分毫不差，只有纠错那一段是另一串数 —— 画出来是一张
 * 结构完全正确、看着毫无破绽、但扫不出来的二维码。
 * 是拿 segno 逐个码字比对才揪出来的。
 */
function generator(n: number): number[] {
  let poly = [1]
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      /* 乘 x：往高次挪一位；再加上 α^i 倍的自己 */
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** 一块数据的纠错码字 */
function ecc(data: number[], n: number): number[] {
  const gen = generator(n)
  const rem = new Array<number>(n).fill(0)
  for (const byte of data) {
    const factor = byte ^ rem[0]
    rem.shift()
    rem.push(0)
    if (factor !== 0) for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i + 1], factor)
  }
  return rem
}

/* ------------------------------------------------------------------ *
 * 比特流
 * ------------------------------------------------------------------ */

class Bits {
  readonly out: number[] = []
  push(value: number, len: number) {
    for (let i = len - 1; i >= 0; i--) this.out.push((value >> i) & 1)
  }
  get length() {
    return this.out.length
  }
}

/** 这个网址在纠错 M 下要第几版。放不下就是 null */
function pickVersion(bytes: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const [ec, b1, , b2] = EC_M[v]
    const dataCodewords = TOTAL_CODEWORDS[v] - ec * (b1 + b2)
    /* 版本 1-9 的字符数指示符是 8 位，10 版起是 16 位 */
    const header = 4 + (v < 10 ? 8 : 16)
    if (header + bytes * 8 <= dataCodewords * 8) return v
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 画矩阵
 * ------------------------------------------------------------------ */

type Grid = { on: boolean[][]; used: boolean[][]; n: number }

const blank = (n: number): Grid => ({
  on: Array.from({ length: n }, () => new Array<boolean>(n).fill(false)),
  used: Array.from({ length: n }, () => new Array<boolean>(n).fill(false)),
  n,
})

function put(g: Grid, y: number, x: number, on: boolean) {
  g.on[y][x] = on
  g.used[y][x] = true
}

/** 三个角上那个「回」字，连同它外面那一圈空白 */
function finder(g: Grid, top: number, left: number) {
  for (let y = -1; y <= 7; y++) {
    for (let x = -1; x <= 7; x++) {
      const yy = top + y
      const xx = left + x
      if (yy < 0 || yy >= g.n || xx < 0 || xx >= g.n) continue
      /*
       * 先判「在不在那个 7×7 的框里」，再判是不是框的边。
       *
       * 少了 inBox 那一句，外面那一圈（-1 和 7）会跟着被画黑 ——
       * 而那一圈正是分隔用的白边，没有它三个「回」字会和数据连成一片，
       * 扫码器就认不出定位符了。
       */
      const inBox = y >= 0 && y <= 6 && x >= 0 && x <= 6
      const edge = y === 0 || y === 6 || x === 0 || x === 6
      const core = y >= 2 && y <= 4 && x >= 2 && x <= 4
      put(g, yy, xx, inBox && (edge || core))
    }
  }
}

function functionPatterns(g: Grid, version: number) {
  finder(g, 0, 0)
  finder(g, 0, g.n - 7)
  finder(g, g.n - 7, 0)

  /* 定位图案：第 6 行和第 6 列上黑白相间的那一条 */
  for (let i = 8; i < g.n - 8; i++) {
    put(g, 6, i, i % 2 === 0)
    put(g, i, 6, i % 2 === 0)
  }

  /* 校正图案。和三个「回」字重叠的那几个不画 */
  const centers = ALIGN[version]
  for (const cy of centers) {
    for (const cx of centers) {
      const corner =
        (cy === 6 && cx === 6) ||
        (cy === 6 && cx === g.n - 7) ||
        (cy === g.n - 7 && cx === 6)
      if (corner) continue
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const edge = Math.max(Math.abs(y), Math.abs(x))
          put(g, cy + y, cx + x, edge !== 1)
        }
      }
    }
  }

  /* 左下角那个永远是黑的格子 */
  put(g, g.n - 8, 8, true)

  /* 格式信息那两块先占位，值等选完掩码才知道 */
  for (let i = 0; i < 9; i++) {
    if (!g.used[8][i]) put(g, 8, i, false)
    if (!g.used[i][8]) put(g, i, 8, false)
  }
  for (let i = 0; i < 8; i++) {
    if (!g.used[8][g.n - 1 - i]) put(g, 8, g.n - 1 - i, false)
    if (!g.used[g.n - 1 - i][8]) put(g, g.n - 1 - i, 8, false)
  }

  /* 7 版起左下和右上各有一块版本信息 */
  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const on = ((bits >> i) & 1) === 1
      const a = Math.floor(i / 3)
      const b = (i % 3) + g.n - 11
      put(g, b, a, on)
      put(g, a, b, on)
    }
  }
}

/** 版本信息的 BCH(18,6) */
function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

/** 格式信息的 BCH(15,5)，再和 0x5412 异或 */
function formatBits(mask: number): number {
  /* 纠错等级 M 的编码是 0b00 */
  const data = (0b00 << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

/*
 * 格式信息要写两份，摆法是规范钉死的。
 *
 * 这一段的位序是**量出来的**，不是照着记忆写的 —— 我第一版写成了
 * 低位在前、起点在 (0,8)，画出来是一张结构完全正确、扫不出来的码。
 * 拿 segno 的图反解出来才发现：**高位在前**，第一份从 (8,0) 起沿着
 * 左上角那个「回」字绕一圈，第二份从左下角往上再接到右上角。
 *
 * k 是从高位数起的第几位：k=0 是最高位。
 */
function putFormat(g: Grid, mask: number) {
  const bits = formatBits(mask)
  const n = g.n
  for (let k = 0; k < 15; k++) {
    const on = ((bits >> (14 - k)) & 1) === 1

    /* 第一份：(8,0)…(8,5) → (8,7) → (8,8) → (7,8) → (5,8)…(0,8) */
    if (k < 6) g.on[8][k] = on
    else if (k === 6) g.on[8][7] = on
    else if (k === 7) g.on[8][8] = on
    else if (k === 8) g.on[7][8] = on
    else g.on[14 - k][8] = on

    /* 第二份：左下角那一列从下往上，接右上角那一行从左往右 */
    if (k < 7) g.on[n - 1 - k][8] = on
    else g.on[8][n - 15 + k] = on
  }
}

const MASKS: ((y: number, x: number) => boolean)[] = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (_y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
]

/**
 * 掩码的罚分。规范里的四条，分数越低越好。
 *
 * 这一段错了不会让码扫不出来，但会选到一个对比度差的掩码 ——
 * 而那要在昏暗的球馆里、隔着一层手机膜才看得出来。
 */
function penalty(on: boolean[][]): number {
  const n = on.length
  let score = 0

  /* 规则一：一行/一列里连着 5 个以上同色 */
  const runs = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1
      for (let j = 1; j < n; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run += 1
          if (run === 5) score += 3
          else if (run > 5) score += 1
        } else run = 1
      }
    }
  }
  runs((i, j) => on[i][j])
  runs((i, j) => on[j][i])

  /* 规则二：2×2 的同色方块 */
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = on[y][x]
      if (on[y][x + 1] === v && on[y + 1][x] === v && on[y + 1][x + 1] === v) score += 3
    }
  }

  /* 规则三：像「回」字定位符的那串花纹（1011101 加四格空白） */
  const P1 = [true, false, true, true, true, false, true, false, false, false, false]
  const P2 = [false, false, false, false, true, false, true, true, true, false, true]
  const match = (get: (k: number) => boolean, at: number, p: boolean[]) => {
    for (let k = 0; k < 11; k++) if (get(at + k) !== p[k]) return false
    return true
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= n - 11; j++) {
      const row = (k: number) => on[i][k]
      const col = (k: number) => on[k][i]
      if (match(row, j, P1) || match(row, j, P2)) score += 40
      if (match(col, j, P1) || match(col, j, P2)) score += 40
    }
  }

  /* 规则四：黑格比例离一半越远罚得越多 */
  let dark = 0
  for (const row of on) for (const cell of row) if (cell) dark += 1
  const ratio = (dark * 100) / (n * n)
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10

  return score
}

/** 从右下角开始，两列一组来回蛇行地把码字填进去 */
function placeData(g: Grid, bytes: number[]) {
  let bit = 0
  const next = () => {
    const i = bit >> 3
    const on = i < bytes.length && ((bytes[i] >> (7 - (bit & 7))) & 1) === 1
    bit += 1
    return on
  }

  let upward = true
  for (let right = g.n - 1; right > 0; right -= 2) {
    /* 第 6 列是竖着那条定位图案，整列跳过 */
    if (right === 6) right = 5
    for (let step = 0; step < g.n; step++) {
      const y = upward ? g.n - 1 - step : step
      for (const x of [right, right - 1]) {
        if (g.used[y][x]) continue
        g.on[y][x] = next()
        g.used[y][x] = true
      }
    }
    upward = !upward
  }
}

/* ------------------------------------------------------------------ *
 * 对外
 * ------------------------------------------------------------------ */

/**
 * 画出一个二维码的格子图（true = 黑）。
 *
 * 不带白边 —— 白边是画图那一层的事（见 qrPath）。
 *
 * @throws 内容超出版本 10 在纠错 M 下的容量（271 字节），或者不是 ASCII
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    /*
     * 只收 ASCII。
     *
     * 非 ASCII 要按 UTF-8 编，而扫码器那边认不认 UTF-8 全看它自己
     * （规范里默认是 ISO-8859-1）—— 也就是说能画出来但可能扫成乱码。
     * 这里只画网址，所以直接拒掉，不留一条会静悄悄出错的路。
     */
    if (code > 127) throw new Error(`二维码只支持 ASCII，遇到了「${ch}」`)
    bytes.push(code)
  }

  const version = pickVersion(bytes.length)
  if (version === null) throw new Error(`二维码放不下这么长的内容（${bytes.length} 字节）`)

  const [ecCount, b1, d1, b2, d2] = EC_M[version]
  const dataCodewords = b1 * d1 + b2 * d2

  /* 一、比特流：模式 + 长度 + 内容 + 结束符 */
  const bits = new Bits()
  bits.push(0b0100, 4)
  bits.push(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) bits.push(b, 8)
  bits.push(0, Math.min(4, dataCodewords * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0, 1)

  /* 二、补足到该有的长度，用规范指定的那两个字节轮流填 */
  const data: number[] = []
  for (let i = 0; i < bits.out.length; i += 8) {
    let byte = 0
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits.out[i + k]
    data.push(byte)
  }
  for (let i = 0; data.length < dataCodewords; i++) data.push(i % 2 === 0 ? 0xec : 0x11)

  /* 三、分块、各算各的纠错码 */
  const blocks: number[][] = []
  const eccs: number[][] = []
  let at = 0
  for (let i = 0; i < b1 + b2; i++) {
    const size = i < b1 ? d1 : d2
    const block = data.slice(at, at + size)
    at += size
    blocks.push(block)
    eccs.push(ecc(block, ecCount))
  }

  /*
   * 四、交错。
   *
   * 各块的第 1 个码字、各块的第 2 个…… 这样一块连续的污渍会被摊到
   * 所有块上，每块各错一点都还纠得回来 —— 而挤在一块上就纠不动了。
   * 这正是这张图被反复转发、截图之后还扫得出来的原因。
   */
  const interleaved: number[] = []
  for (let i = 0; i < Math.max(d1, d2); i++)
    for (const b of blocks) if (i < b.length) interleaved.push(b[i])
  for (let i = 0; i < ecCount; i++) for (const e of eccs) interleaved.push(e[i])

  /* 五、摆格子，八个掩码各试一遍，挑罚分最低的 */
  const n = version * 4 + 17
  let best: boolean[][] | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const g = blank(n)
    functionPatterns(g, version)
    placeData(g, interleaved)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (!isFunction(g, y, x, version) && MASKS[mask](y, x)) g.on[y][x] = !g.on[y][x]
    putFormat(g, mask)
    const score = penalty(g.on)
    if (score < bestScore) {
      bestScore = score
      best = g.on
    }
  }
  return best as boolean[][]
}

/*
 * 哪些格子是「功能图案」—— 它们不参与掩码。
 *
 * 单独判一遍而不是用 used：placeData 跑完之后 used 全都是 true 了，
 * 分不出哪些是数据、哪些是图案。
 */
function isFunction(g: Grid, y: number, x: number, version: number): boolean {
  const n = g.n
  if (y === 6 || x === 6) return true
  if (y < 9 && x < 9) return true
  if (y < 9 && x >= n - 8) return true
  if (y >= n - 8 && x < 9) return true
  if (version >= 7) {
    if (y < 6 && x >= n - 11) return true
    if (x < 6 && y >= n - 11) return true
  }
  for (const cy of ALIGN[version]) {
    for (const cx of ALIGN[version]) {
      const corner =
        (cy === 6 && cx === 6) || (cy === 6 && cx === n - 7) || (cy === n - 7 && cx === 6)
      if (corner) continue
      if (Math.abs(y - cy) <= 2 && Math.abs(x - cx) <= 2) return true
    }
  }
  return false
}

/** 白边几格。规范要求 4 —— 少了很多手机直接扫不出来 */
export const QR_BORDER = 4

/**
 * 把格子图变成一条 SVG path。
 *
 * 一行里连着的黑格并成一个矩形：一个格子一个 <rect> 的话，
 * 这段 SVG 会长到两千行，而它是要被 html-to-image 整个重画一遍的。
 */
export function qrPath(matrix: boolean[][], border = QR_BORDER): string {
  const parts: string[] = []
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y]
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x += 1
        continue
      }
      let w = 1
      while (x + w < row.length && row[x + w]) w += 1
      parts.push(`M${x + border} ${y + border}h${w}v1h-${w}z`)
      x += w
    }
  }
  return parts.join('')
}
