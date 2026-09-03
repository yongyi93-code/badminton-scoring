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
  /**
   * 认领这个球员的登录账号 id。
   *
   * 有主 = 这是某个人自己，他在自己手机上建的或者认领的；
   * 无主 = 别人代建的（不装 App 的球友、临时来的客人），谁都能帮他记分。
   *
   * 可选：本地建的球员在没登录时就是无主的，之后认领才补上。
   */
  ownerId?: string | null
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

/** 可选的每局分数 */
export const POINTS_OPTIONS = [11, 15, 21] as const

/**
 * 各分制对应的封顶分：21 分制封顶 30（现行 BWF 规则），
 * 15 分制封顶 21，11 分制封顶 15。表里没有的分制按「目标分 + 9」兜底。
 * 封顶分必须跟着目标分走，否则 11 分制的一个平分能拖到 30 分才结束。
 */
export const capFor = (pointsToWin: number): number =>
  ({ 11: 15, 15: 21, 21: 30 })[pointsToWin] ?? pointsToWin + 9

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

/**
 * 打法模式。
 * free     自由模式 —— 公平轮转配对，什么时候结束自己决定
 * king     车轮赛（打上打落）—— 赢的留场，输的排队尾
 * rotation 轮转赛（X 人转）—— 开局生成固定赛程，打完为止
 */
export type SessionFormat = 'free' | 'king' | 'rotation' | 'friendly'

/*
 * 文案表一律存成 [中文, English] 两元组，用的地方 t(...FORMAT_LABELS[f]) 展开。
 * 这样漏翻一句 TypeScript 当场就报元组长度不对，不会等到线上才发现。
 */
export const FORMAT_LABELS: Record<SessionFormat, [string, string]> = {
  free: ['自由模式', 'Free play'],
  king: ['车轮赛', 'King of the court'],
  rotation: ['轮转赛', 'Round robin'],
  friendly: ['友谊赛', 'Club friendly'],
}

/**
 * 友谊赛：两个俱乐部对打。
 *
 * 每一场都是主队 vs 客队（teamA 一定是主队），自动配对只在各自阵营里选人。
 *
 * 客队球员只属于这一场球局，不进正式球员名单 —— 别人俱乐部的人混进
 * 名单和排行榜，只会让自己这边的榜变得没法看。所以他们的名字直接存在
 * 这里，id 带 GUEST_PREFIX 前缀，一眼能认出来不是自己人。
 *
 * 友谊赛的比赛全部标 friendly，不进 MMR、段位和累计排行榜 ——
 * 客队大多只打这一晚，让他们的战绩去搅动常年累计的榜没有意义。
 */
export type FriendlySetup = {
  /** 主队（自己这边）名字 */
  homeName: string
  awayName: string
  /** 客队球员，只在这场球局里存在 */
  awayPlayers: GuestPlayer[]
}

export type GuestPlayer = {
  id: string
  name: string
  gender: Gender
}

/** 客队球员 id 的前缀，用来和正式球员区分 */
export const GUEST_PREFIX = 'guest:'

export const isGuestId = (id: string) => id.startsWith(GUEST_PREFIX)

/**
 * 配对时怎么用 MMR。
 *
 * balanced 均衡（高带低）—— 一场里高分带低分，两队平均分尽量相等。
 *          图的是每一场都咬得紧，混合水平的球局用这个。
 * tiered   同级（强打强）—— 尽量挑水平接近的四个人凑一场，
 *          高分打高分、低分打低分。图的是各打各的强度。
 *
 * 两种都还是先满足「已打场数最少的人必须上场」这条硬约束，
 * 谁也不会因为分数被晾在场下。
 */
export type PairingMode = 'balanced' | 'tiered'

export const PAIRING_MODE_LABELS: Record<PairingMode, [string, string]> = {
  balanced: ['均衡（高带低）', 'Balanced'],
  tiered: ['同级（强打强）', 'By level'],
}

export const PAIRING_MODE_HINTS: Record<PairingMode, [string, string]> = {
  balanced: [
    '一场里高分带低分，两队实力尽量拉平，每一场都咬得紧',
    'Strong players carry weaker ones so both sides are even and every game stays close',
  ],
  tiered: [
    '挑水平接近的人凑一场，高分打高分、低分打低分',
    'Players of similar level play each other — strong with strong, beginners with beginners',
  ],
}

/** 旧球局没存这个字段，统一从这里取 */
export const pairingModeOf = (session: Session): PairingMode =>
  session.pairingMode ?? 'balanced'

/**
 * 结束条件。三项都可留空 = 不限。
 * totalMatches / durationMinutes 是「上限」，谁先到就提示该结束了；
 * perPlayerMatches 是「下限」，用来提示「还有几个人没打够」。
 */
export type EndCondition = {
  /** 总场数上限 */
  totalMatches?: number
  /** 时长上限（分钟） */
  durationMinutes?: number
  /** 每人至少打满几场 */
  perPlayerMatches?: number
}

/** 车轮赛默认连胜上限，防止高手组合霸场一整晚 */
export const DEFAULT_STREAK_CAP = 3

/** 轮转赛默认每人打几场 */
export const DEFAULT_ROTATION_PER_PLAYER = 6

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

  /* --- 以下都是 v1.1 新增，旧数据没有这些字段，全部按可选处理 --- */

  /** 打法模式；缺失视为 'free'，保证 v1 存下来的球局还能打开 */
  format?: SessionFormat
  endCondition?: EndCondition
  /** 车轮赛连胜上限，0 = 不限 */
  kingStreakCap?: number
  /** 轮转赛生成赛程时设的每人场数，仅用于展示 */
  rotationPerPlayer?: number
  /** 自动配对怎么用 MMR；缺失视为 'balanced' */
  pairingMode?: PairingMode
  /** 友谊赛的两队信息，format === 'friendly' 时才有 */
  friendly?: FriendlySetup

  /**
   * 最多几个人。0 或者没有这个字段 = 不限。
   *
   * 场地是订好的、钱是 AA 的 —— 来的人比场地能容下的多，
   * 后面那几个整晚在旁边坐着。所以这是硬上限：满了就加不进来，
   * 不是提醒一下还能硬挤。
   *
   * 上限由开局的人自己定，也随时改得动（有人临时不来了就调小，
   * 多订了一片场就调大）。
   */
  maxPlayers?: number

  /**
   * 谁开的这个局（球员 id）。
   *
   * 球局现在是公开的：任何人开局，所有人都能在首页看见「谁在哪开了局」，
   * 自己点进去加入。列表上得写清楚是谁开的，不然一堆同一个球馆的局
   * 根本分不出该进哪个。
   *
   * 可选：这之前建的球局没有这个字段，照样能打开。
   */
  createdBy?: string
}

/** 旧数据没有 format 字段，统一从这里取，避免各处散落 ?? 'free' */
export const formatOf = (session: Session): SessionFormat =>
  session.format ?? 'free'

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
  /**
   * 友谊赛的比赛。标在比赛上而不是靠球局查 —— 统计全是从比赛记录直接推导的，
   * 挂在比赛上才能在 decidedMatches 一处就过滤干净，不会漏掉某条统计路径。
   */
  friendly?: boolean
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

/**
 * 一条人工发的公告。
 *
 * 首页那条快讯全部是从比赛记录现算的 —— 谁升段、谁连胜、哪个馆谁是
 * 第一。算得出来的东西不用人操心，但「这周五改去力天」「下周暂停一次」
 * 这类事情算不出来，只能有人说。
 *
 * 和快讯的区别也在这儿：快讯没有作者、删不掉（数据变了它自己就变），
 * 公告有作者、能删。
 */
export type Announcement = {
  id: string
  text: string
  /** 谁发的（球员 id） */
  authorId: string
  createdAt: number
}
