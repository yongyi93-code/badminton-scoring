/** 队伍：A 队 / B 队 */
export type TeamSide = 'A' | 'B'

/** 水平分级，1 = 新手，5 = 高手。喂给轮转配对算法做实力平衡 */
export type Level = 1 | 2 | 3 | 4 | 5

/** 性别，'-' 表示未填。混双模式需要 */
export type Gender = 'M' | 'F' | '-'

export type MatchType = 'singles' | 'doubles' | 'mixed'

export type Player = {
  id: string
  name: string
  level: Level
  gender: Gender
  /** 退群的人隐藏在选人列表外，但历史战绩保留 */
  archived: boolean
  createdAt: number
}

export type Rules = {
  /** 每局目标分，默认 21 */
  pointsToWin: number
  /** 是否需净胜 2 分（20 平后打到净胜 2 分） */
  winBy2: boolean
  /** 封顶分，到此分先得者直接胜，默认 30 */
  cap: number
  /** 1 = 一局定胜负，3 = 三局两胜 */
  bestOf: 1 | 3
}

export const DEFAULT_RULES: Rules = {
  pointsToWin: 21,
  winBy2: true,
  cap: 30,
  bestOf: 1,
}

export type Fee = {
  /** 场地费总额 */
  courtFee: number
  /** 用了几筒/几个球 */
  shuttleCount: number
  /** 每筒/每个球单价 */
  shuttleUnitPrice: number
  /** 已付款的球员 id */
  paidPlayerIds: string[]
}

export type Session = {
  id: string
  /** ISO 日期字符串 yyyy-mm-dd */
  date: string
  venue: string
  /** 场地数 */
  courtCount: number
  /** 今晚出席的球员 id */
  playerIds: string[]
  /** 暂时不参与排场的人（受伤、去买水）；旧数据里可能没有这个字段 */
  restingIds?: string[]
  /** 自动排场时默认用哪种赛制 */
  defaultType: MatchType
  rules: Rules
  fee: Fee
  status: 'active' | 'ended'
  createdAt: number
  endedAt?: number
}

/**
 * 一局的发球初始状态。
 * 羽球双打规则：球员只在「自己发球时得分」才换左右区，
 * 因此必须记住开局站位才能正确推导当前发球者与站位。
 */
export type ServeInit = {
  /** 本局首先发球的队伍 */
  servingTeam: TeamSide
  /** A 队开局站右发球区的球员（单打时即该队球员） */
  rightA: string
  /** B 队开局站右发球区的球员 */
  rightB: string
}

export type Game = {
  a: number
  b: number
  /**
   * 逐分记录（每一分由哪队拿下），用于撤销与发球方推导。
   * 为 null 表示这局是「直接输入最终比分」录进来的，没有逐分数据。
   */
  points: TeamSide[] | null
  /** 直接输入比分时为 null */
  serveInit: ServeInit | null
}

export type MatchStatus = 'queued' | 'playing' | 'done'

export type Match = {
  id: string
  sessionId: string
  /** 分配到第几片场（0 起）；排队中为 null */
  courtIndex: number | null
  type: MatchType
  /** 单打 1 人，双打 2 人 */
  teamA: string[]
  teamB: string[]
  games: Game[]
  status: MatchStatus
  /** 创建顺序号，用于「休息了几轮」的推导 */
  seq: number
  startedAt?: number
  endedAt?: number
}

/** 由比赛记录推导出的球员统计，不落库 */
export type PlayerStats = {
  playerId: string
  games: number
  wins: number
  losses: number
  winRate: number
  pointsFor: number
  pointsAgainst: number
  diff: number
  /** 当前连胜（负数表示连败） */
  streak: number
  /** 是否达到上榜门槛（默认 3 场） */
  qualified: boolean
}

/** 上榜所需最少场次 */
export const RANK_MIN_GAMES = 3
