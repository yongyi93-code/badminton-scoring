import type {
  Game,
  Match,
  Rules,
  ServeInit,
  TeamSide,
} from '@/types'

export const other = (t: TeamSide): TeamSide => (t === 'A' ? 'B' : 'A')

/* ------------------------------------------------------------------ *
 * 一局的胜负判定
 * ------------------------------------------------------------------ */

/**
 * 封顶分至少要比目标分大 1，否则配置写反时封顶会反过来压掉「净胜 2 分」规则
 * （例如 cap=21、pointsToWin=21 会让 21:20 直接结束）
 */
const effectiveCap = (rules: Rules) =>
  Math.max(rules.cap, rules.pointsToWin + 1)

export function isGameOver(a: number, b: number, rules: Rules): boolean {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  if (!rules.winBy2) return hi >= rules.pointsToWin
  if (hi >= effectiveCap(rules)) return true
  return hi >= rules.pointsToWin && hi - lo >= 2
}

export function gameWinner(
  a: number,
  b: number,
  rules: Rules,
): TeamSide | null {
  if (!isGameOver(a, b, rules)) return null
  return a > b ? 'A' : 'B'
}

/** 距离拿下这一局还差几分（用于「赛点」提示） */
export function isGamePoint(
  a: number,
  b: number,
  rules: Rules,
): TeamSide | null {
  if (isGameOver(a, b, rules)) return null
  if (gameWinner(a + 1, b, rules) === 'A') return 'A'
  if (gameWinner(a, b + 1, rules) === 'B') return 'B'
  return null
}

/* ------------------------------------------------------------------ *
 * 整场的胜负判定（一局定胜负 / 三局两胜）
 * ------------------------------------------------------------------ */

export function gamesWon(
  games: Game[],
  rules: Rules,
): { A: number; B: number } {
  let A = 0
  let B = 0
  for (const g of games) {
    const w = gameWinner(g.a, g.b, rules)
    if (w === 'A') A++
    else if (w === 'B') B++
  }
  return { A, B }
}

export function matchWinner(games: Game[], rules: Rules): TeamSide | null {
  const need = rules.bestOf === 3 ? 2 : 1
  const { A, B } = gamesWon(games, rules)
  if (A >= need) return 'A'
  if (B >= need) return 'B'
  return null
}

/** 整场结束后，两队的总得分（所有局相加），用于净分差排名 */
export function matchPoints(games: Game[]): { A: number; B: number } {
  return games.reduce(
    (acc, g) => ({ A: acc.A + g.a, B: acc.B + g.b }),
    { A: 0, B: 0 },
  )
}

/* ------------------------------------------------------------------ *
 * 发球方与左右场区推导
 *
 * 羽球双打的关键规则：球员只有在「本方发球且得分」时才交换左右区。
 * 因此站位无法只靠分数奇偶推出来，必须从开局站位沿着逐分记录推演。
 * 推演出来后满足不变式：发球者 === 发球方当前处于「发球区」的那个人，
 * 而发球区由发球方分数奇偶决定（偶数在右区）。
 * ------------------------------------------------------------------ */

export type Court = 'right' | 'left'

export type TeamPositions = { right: string; left: string }

export type ServeState = {
  scoreA: number
  scoreB: number
  servingTeam: TeamSide
  serverId: string
  receiverId: string
  /** 发球方此刻应从哪个发球区开球 */
  serveCourt: Court
  /** 双打时四人当前站位；单打时 left 与 right 相同 */
  positions: { A: TeamPositions; B: TeamPositions }
}

const courtOf = (score: number): Court => (score % 2 === 0 ? 'right' : 'left')

function initialPositions(
  match: Match,
  init: ServeInit,
): { A: TeamPositions; B: TeamPositions } {
  const build = (team: string[], rightId: string): TeamPositions => {
    if (team.length < 2) return { right: team[0], left: team[0] }
    const right = team.includes(rightId) ? rightId : team[0]
    const left = team.find((p) => p !== right) ?? team[1]
    return { right, left }
  }
  return {
    A: build(match.teamA, init.rightA),
    B: build(match.teamB, init.rightB),
  }
}

/**
 * 从开局站位 + 逐分记录推导当前发球状态。
 * 没有逐分记录（直接输入比分的局）时返回 null。
 */
export function deriveServe(match: Match, gameIndex: number): ServeState | null {
  const game = match.games[gameIndex]
  if (!game || !game.points || !game.serveInit) return null

  const isDoubles = match.teamA.length > 1
  const positions = initialPositions(match, game.serveInit)
  const score: Record<TeamSide, number> = { A: 0, B: 0 }
  let servingTeam = game.serveInit.servingTeam
  // 0 分为偶数 → 从右区发球，所以开局发球者就是发球方站右区的人
  let serverId = positions[servingTeam].right

  for (const winner of game.points) {
    score[winner] += 1
    if (winner === servingTeam) {
      // 发球方得分：同一人继续发球，但本方两人交换左右区
      if (isDoubles) {
        const p = positions[winner]
        positions[winner] = { right: p.left, left: p.right }
      }
      // serverId 不变
    } else {
      // 接发方得分：夺得发球权，站位不变，由分数奇偶决定谁发
      servingTeam = winner
      serverId = isDoubles
        ? positions[winner][courtOf(score[winner])]
        : positions[winner].right
    }
  }

  const serveCourt = courtOf(score[servingTeam])
  const receivingTeam = other(servingTeam)
  // 右区发向对方右区（两侧场区互为斜对角）
  const receiverId = positions[receivingTeam][serveCourt]

  return {
    scoreA: score.A,
    scoreB: score.B,
    servingTeam,
    serverId,
    receiverId,
    serveCourt,
    positions,
  }
}

/* ------------------------------------------------------------------ *
 * 加分 / 撤销
 * ------------------------------------------------------------------ */

/** 给某队加一分。已结束的局不再加分（原样返回） */
export function addPoint(game: Game, team: TeamSide, rules: Rules): Game {
  if (isGameOver(game.a, game.b, rules)) return game
  const points = game.points ? [...game.points, team] : null
  return {
    ...game,
    a: team === 'A' ? game.a + 1 : game.a,
    b: team === 'B' ? game.b + 1 : game.b,
    points,
  }
}

/** 撤销上一分。没有逐分记录或还没得分时原样返回 */
export function undoPoint(game: Game): Game {
  if (!game.points || game.points.length === 0) return game
  const points = game.points.slice(0, -1)
  const removed = game.points[game.points.length - 1]
  return {
    ...game,
    a: removed === 'A' ? game.a - 1 : game.a,
    b: removed === 'B' ? game.b - 1 : game.b,
    points,
  }
}

/* ------------------------------------------------------------------ *
 * 建局
 * ------------------------------------------------------------------ */

export function makeServeInit(match: Match, servingTeam: TeamSide): ServeInit {
  return {
    servingTeam,
    rightA: match.teamA[0],
    rightB: match.teamB[0],
  }
}

export function emptyGame(match: Match, servingTeam: TeamSide): Game {
  return { a: 0, b: 0, points: [], serveInit: makeServeInit(match, servingTeam) }
}

/**
 * 下一局的初始状态：上一局的胜方先发球（羽球规则），站位沿用上一局开局站位。
 * 已打完整场时返回 null。
 */
export function nextGame(match: Match, rules: Rules): Game | null {
  if (matchWinner(match.games, rules)) return null
  const last = match.games[match.games.length - 1]
  if (!last) return emptyGame(match, 'A')
  if (!isGameOver(last.a, last.b, rules)) return null
  const winner = gameWinner(last.a, last.b, rules) ?? 'A'
  return {
    a: 0,
    b: 0,
    points: [],
    serveInit: {
      servingTeam: winner,
      rightA: last.serveInit?.rightA ?? match.teamA[0],
      rightB: last.serveInit?.rightB ?? match.teamB[0],
    },
  }
}

/** 当前正在打的那一局的下标（都打完则指向最后一局） */
export function activeGameIndex(match: Match, rules: Rules): number {
  for (let i = 0; i < match.games.length; i++) {
    const g = match.games[i]
    if (!isGameOver(g.a, g.b, rules)) return i
  }
  return Math.max(0, match.games.length - 1)
}

/** 比分文字，例如 "21-18" 或三局 "21-18, 19-21, 21-15" */
export function scoreLine(games: Game[]): string {
  return games.map((g) => `${g.a}-${g.b}`).join(', ')
}
