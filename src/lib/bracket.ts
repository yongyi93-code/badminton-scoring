/* ------------------------------------------------------------------ *
 * 单淘汰赛表
 *
 * 这个文件只管**纯逻辑**：多大的表、谁排在哪一格、轮空给谁、赢了往
 * 哪走。画出来的那一屏、存哪儿，都是别处的事。
 *
 * -------------------------------------------------------------------
 * 整张表由一个构造推出来，不是一堆特例
 *
 * 赛表最容易做成一坨 if：种子怎么摆一段、轮空怎么给一段、人数不够
 * 再来一段。那种写法每加一条规矩就多一个岔路，而办比赛的人一眼就能
 * 看出排错了（「凭什么一号种子第一轮就碰三号」）。
 *
 * 这里只有一个构造：
 *
 *   1. 把人排成一个**名次表**（种子在前，其余按抽签顺序）
 *   2. 算出这个大小的表的**标准种子位顺序**（seedOrder）
 *   3. 第 i 格放名次表上第 seedOrder[i] 个人；没有那个人就是轮空
 *
 * 三步之后，「1 号和 2 号只可能在决赛碰面」「1 号最早在半决赛碰
 * 3/4 号」「轮空优先给高种子」**全是白送的** —— 不是另外写的规则，
 * 是这个构造的数学后果。这也是为什么它测得住：每一条都能用一句
 * 断言钉死，而不是靠读代码相信。
 * ------------------------------------------------------------------ */

/**
 * 一个格子里的人。
 *
 * 单打一个名字，双打两个 —— 用数组而不是两个字段，是因为下游每一处
 * （画表、填分、分享）都只关心「这一格叫什么」，不关心是一个人还是
 * 两个。分成 name1/name2 的话，那些地方全要写两遍。
 */
export type Entrant = {
  id: string
  /** 一个名字（单打）或者两个（双打） */
  names: string[]
  /**
   * 种子号，1 是第一种子。没标就不是种子。
   *
   * 只有「按种子排」那一档用得上；全随机那档整列忽略。
   */
  seed?: number
}

/** 排签怎么排 */
export type DrawMode =
  /** 全随机。抽完就定 */
  | 'random'
  /** 按种子排：标了种子的按号入座，其余随机填空。公开赛的标准做法 */
  | 'seeded'
  /** 手动摆：调用方自己给出每一格是谁 */
  | 'manual'

/** 一场比赛。a / b 是 Entrant 的 id，null = 还没定或者轮空 */
export type BracketMatch = {
  /** 第几轮。0 = 第一轮 */
  round: number
  /** 这一轮里第几场，从 0 开始 */
  index: number
  a: string | null
  b: string | null
  scoreA?: number
  scoreB?: number
  /** 谁赢了。轮空那场一开始就有 */
  winner?: string | null
}

/**
 * 这么多人要用多大的表。
 *
 * 往上取到 2 的幂：23 个人用 32 人表，剩下 9 格是轮空。
 * 最小是 2 —— 一个人的比赛不是比赛，但这一层不替人做那个判断，
 * 只保证算出来的表画得出来。
 */
export function drawSize(n: number): number {
  let size = 2
  while (size < n) size *= 2
  return size
}

/** 这么大的表要打几轮。32 人 = 5 轮 */
export function roundCount(size: number): number {
  return Math.log2(size)
}

/**
 * 标准种子位顺序。
 *
 * 返回一个长度等于表大小的数组：第 i 格该放**名次第几**的人。
 * 8 人表是 [1, 8, 4, 5, 2, 7, 3, 6]。
 *
 * 构造是递归的：每翻一倍，把已有的每个名次 x 后面插一个 (sum - x)，
 * 其中 sum 是「这一轮两个名次相加的定值」。
 *
 *   [1, 2]                      两人表
 *   [1, 4, 2, 3]                sum = 5
 *   [1, 8, 4, 5, 2, 7, 3, 6]    sum = 9
 *
 * 这个顺序就是「强的和强的尽量晚碰面」那件事本身：
 * 1 号在最上、2 号在最下（只可能决赛见），3/4 号各自落在另外两个
 * 1/4 区（最早半决赛见），以此类推。
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2]
  while (order.length < size) {
    const sum = order.length * 2 + 1
    const next: number[] = []
    for (const x of order) next.push(x, sum - x)
    order = next
  }
  return order
}

/**
 * 把人排成名次表 —— 排签的全部随机性都在这一步，后面是纯计算。
 *
 * `seeded`：标了种子的按号在前（1、2、3…），其余洗牌接在后面。
 * `random`：整个洗牌，种子那一列当不存在。
 *
 * 洗牌用传进来的 rng，默认 Math.random —— 传得进去才测得了
 * 「同一个种子表两次排出来一样」这种事。
 */
export function rankEntrants(
  entrants: Entrant[],
  mode: Exclude<DrawMode, 'manual'>,
  rng: () => number = Math.random,
): Entrant[] {
  if (mode === 'random') return shuffle(entrants, rng)
  const seeded = entrants
    .filter((e) => typeof e.seed === 'number')
    .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
  const rest = shuffle(
    entrants.filter((e) => typeof e.seed !== 'number'),
    rng,
  )
  return [...seeded, ...rest]
}

/* Fisher–Yates。原地洗会改到调用方的数组，所以先复制 */
function shuffle<T>(list: T[], rng: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * 名次表 → 每一格是谁。null = 轮空。
 *
 * **轮空是白送的**：第 i 格要的是名次第 seedOrder[i] 的人，而名次表
 * 只有 n 个人 —— 要不到的那些格自然就是空的。而 seedOrder 把大号名次
 * 摆在高种子的对面，所以空格正好落在一号、二号种子那一侧。
 *
 * 这一条如果换成「先排人再补轮空」，就要另写一段「轮空该给谁」，
 * 而那段和 seedOrder 迟早会各说各话。
 */
export function placeRanked(ranked: Entrant[], size: number): (Entrant | null)[] {
  return seedOrder(size).map((rank) => ranked[rank - 1] ?? null)
}

/**
 * 摆好的格子 → 第一轮那几场。
 *
 * 一格对一格：0 vs 1、2 vs 3…
 * 有一边是空的，另一边**当场就赢了**（轮空），winner 直接填上 ——
 * 不然界面上会出现一场「等对手」的比赛，而它永远等不到。
 * 两边都空的那场 winner 是 null：它照样占一个位置，下一轮那一格也空着。
 */
export function firstRound(slots: (Entrant | null)[]): BracketMatch[] {
  const out: BracketMatch[] = []
  for (let i = 0; i < slots.length; i += 2) {
    const a = slots[i]
    const b = slots[i + 1]
    const m: BracketMatch = { round: 0, index: i / 2, a: a?.id ?? null, b: b?.id ?? null }
    /* 一边空 = 另一边轮空晋级。两边都空 = 这一格整个是空的 */
    if (a && !b) m.winner = a.id
    else if (!a && b) m.winner = b.id
    else if (!a && !b) m.winner = null
    out.push(m)
  }
  return out
}

/**
 * 整张表：所有轮次的所有场次，一开始就全生成出来。
 *
 * 为什么不是打完一轮再生成下一轮：赛表要**一眼看得到全貌**（办比赛
 * 的人要贴出来、参赛者要知道自己赢了下一场碰谁）。后生成的话，
 * 决赛那一格在半决赛打完之前根本不存在，画不出来。
 *
 * 后面几轮的 a/b 一开始都是 null，由 fillNext 随着结果往上填。
 */
export function buildBracket(slots: (Entrant | null)[]): BracketMatch[] {
  const rounds = roundCount(slots.length)
  const all = firstRound(slots)
  for (let r = 1; r < rounds; r++) {
    const count = slots.length / 2 ** (r + 1)
    for (let i = 0; i < count; i++) all.push({ round: r, index: i, a: null, b: null })
  }
  return fillNext(all)
}

/**
 * 把已经决出的胜者往上一轮填。
 *
 * 每次结果变了就整张重算一遍，而不是「只改受影响的那几格」——
 * 一张 64 人表也就 63 场，重算是免费的；而增量更新要处理「改了一场
 * 已经打完的比赛，后面几轮全作废」，那是真正会出错的地方。
 *
 * 上一轮第 2k、2k+1 场的胜者，进这一轮第 k 场。
 */
export function fillNext(matches: BracketMatch[]): BracketMatch[] {
  const out = matches.map((m) => ({ ...m }))
  const at = (r: number, i: number) => out.find((m) => m.round === r && m.index === i)
  const rounds = Math.max(...out.map((m) => m.round)) + 1

  for (let r = 1; r < rounds; r++) {
    const count = out.filter((m) => m.round === r).length
    for (let i = 0; i < count; i++) {
      const me = at(r, i)
      if (!me) continue
      const left = at(r - 1, i * 2)
      const right = at(r - 1, i * 2 + 1)

      /*
       * 换人了就把这一场的结果作废 —— 这一条是测试逼出来的。
       *
       * 现场改一场已经打完的比赛是常事（比分敲错一位）。改完之后
       * 后面那几场的**人**变了，可是旧比分还留着：决赛上站着一个
       * 已经被淘汰的人，而表上看起来一切正常，还有个冠军。
       *
       * 所以比的是「这一场的两边跟上次算出来时一样不一样」，
       * 不是「有没有比分」。比分是对着某两个人打出来的，人换了它就
       * 什么都不是了。
       */
      const wasA = me.a
      const wasB = me.b
      me.a = left?.winner ?? null
      me.b = right?.winner ?? null
      if (me.a !== wasA || me.b !== wasB) {
        delete me.scoreA
        delete me.scoreB
        delete me.winner
      }

      /*
       * 上一轮两场里有一场是空的（两边都轮空），这一场就也是轮空 ——
       * 人数远少于表大小的时候真的会出现（5 个人摆 8 人表）。
       */
      if (me.a && !me.b && right && right.winner === null) me.winner = me.a
      else if (!me.a && me.b && left && left.winner === null) me.winner = me.b
      else if (!me.a && !me.b) me.winner = null
      else if (me.scoreA === undefined || me.scoreB === undefined) delete me.winner
    }
  }
  return out
}

/**
 * 填一场的比分。填完顺手把胜者往上推。
 *
 * 平分不给赢家：羽毛球不会平，出现平分一定是填错了。这里不猜，
 * 留着 winner 空着，界面上那一场就还没打完。
 */
export function setScore(
  matches: BracketMatch[],
  round: number,
  index: number,
  scoreA: number,
  scoreB: number,
): BracketMatch[] {
  const next = matches.map((m) => {
    if (m.round !== round || m.index !== index) return { ...m }
    const win = scoreA > scoreB ? m.a : scoreB > scoreA ? m.b : undefined
    const copy: BracketMatch = { ...m, scoreA, scoreB }
    if (win === undefined) delete copy.winner
    else copy.winner = win
    return copy
  })
  return fillNext(next)
}

/**
 * 这一轮叫什么。
 *
 * 最后一轮是决赛、倒数第二是半决赛，再往前按人数叫「八强」「十六强」。
 * 办比赛的人贴出来的表上写的就是这几个词，不是「第 3 轮」。
 */
export function roundName(round: number, totalRounds: number, zh: boolean): string {
  const left = totalRounds - round
  if (left === 1) return zh ? '决赛' : 'Final'
  if (left === 2) return zh ? '半决赛' : 'Semi-final'
  if (left === 3) return zh ? '八强' : 'Quarter-final'
  const players = 2 ** left
  return zh ? `${players} 强` : `Round of ${players}`
}

/**
 * 这一格永远不会有人吗。
 *
 * 「两边都还是 null」有两种完全不同的意思，而画表时它们长得一样：
 *
 *   等上一轮打完   —— 人会来，只是还没打到
 *   这一格根本不存在 —— 人数远少于表大小时的那些空枝（11 个人摆 16 人表，
 *                      半决赛有一半是空的）
 *
 * 分不清的话，整张表上会摆着一堆「空」，而其中一半其实是决赛 ——
 * 办比赛的人会以为自己排错了。
 *
 * 判断很直接：这一格罩着第一轮的哪几场，那几场里有没有人。
 * 一个人都没有，它就是空枝。
 */
export function isDead(matches: BracketMatch[], round: number, index: number): boolean {
  const span = 2 ** round
  const first = matches.filter((m) => m.round === 0)
  for (let k = index * span; k < (index + 1) * span; k++) {
    const m = first.find((x) => x.index === k)
    if (m && (m.a || m.b)) return false
  }
  return true
}

/** 冠军。决赛没打完就是 null */
export function champion(matches: BracketMatch[]): string | null {
  const last = Math.max(...matches.map((m) => m.round))
  return matches.find((m) => m.round === last)?.winner ?? null
}

/** 一格上显示什么。双打两个名字用「/」隔开，和赛场上写的一样 */
export function slotLabel(e: Entrant | undefined | null, zh: boolean): string {
  if (!e) return zh ? '轮空' : 'Bye'
  return e.names.join(' / ')
}
