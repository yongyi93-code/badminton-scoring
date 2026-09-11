import { pick } from './i18n'
import { chronological, decidedMatches, matchWinnerBySets } from './ranking'
import {
  DRESS_ITEMS,
  DRESS_SLOTS,
  dressId,
  dressItemsFor,
  dressStartersFor,
  dressUpFor,
} from './dressup'
import type { Match, TeamSide } from '@/types'

/* ------------------------------------------------------------------ *
 * 角色养成
 *
 * 目的很单纯：让人多一个想赢的理由。赢球拿金币，金币换装备把自己打扮帅。
 *
 * 设计上最要紧的一条：金币和 MMR「赚了多少」不落库，
 * 永远从比赛记录实时算出来 —— 和排行榜同一个口径，
 * 删掉一场比赛立刻跟着变，不会出现「战绩改了但积分没改」这种对不上的账。
 * 落库的只有「花掉了多少」和「买了什么」，这两个没法从比赛推导。
 * ------------------------------------------------------------------ */

/** 赢一场加多少 MMR */
export const WIN_POINTS = 10

/**
 * 赢一场拿多少金币。和 MMR 分开，因为这两件事的尺度本来就不一样。
 *
 * MMR 是水平的刻度，一场 10 分，几十场才换一个段位 —— 慢是对的，
 * 那是长期能力的读数。金币是花的钱，一晚上打十场该看得见地富起来，
 * 不然商店里那件 200 的衣服要打二十场，中间十九场都没有盼头。
 *
 * 三倍于 MMR 是照着商店的价目定的：赢一场 30，最便宜的一件 40，
 * 打两场就能买到第一件东西；最贵的 1600 要五十几场，是个长期目标。
 */
export const WIN_COINS = 30

/**
 * 输一场扣多少 MMR（正数，算的时候是减掉）。
 * 扣到 0 就打住，不做负分 —— 打得再差也是从 0 重新爬，不至于挖个坑劝退新人。
 * 金币不受影响。
 */
export const LOSS_POINTS = 10

/** 角色性别，只此两种 */
export type AvatarSex = 'm' | 'f'

export const AVATAR_SEXES: { sex: AvatarSex; label: [string, string] }[] = [
  { sex: 'm', label: ['男', 'Male'] },
  { sex: 'f', label: ['女', 'Female'] },
]

/** 肤色档位，免费换，不进商店 */
export const SKIN_TONES = ['#f6dcc0', '#e8bb96', '#c68a63', '#8d5a3b'] as const

/**
 * 装备槽位，一个槽位同时只能穿一件。
 *
 * 前三个是画在人身上的，换了立绘图片就没法再单独换（图片是一整张画好的人）；
 * 后三个是画在人周围的另外几层 —— 背景衬在后面、头像框套在外面、
 * 称号写在名字旁边 —— 两种画法都能用，也是有立绘之后金币唯一的去处。
 */
export type AvatarSlot =
  | 'hair'
  | 'outfit'
  | 'weapon'
  | 'background'
  | 'frame'
  | 'title'
  // 分层换装的四件，见 lib/dressup.ts。有那套素材时用这四个，
  // 上面的 hair/outfit/weapon 就收起来 —— 两套画法不能同时上身。
  | 'top'
  | 'bottom'
  | 'shoes'
  | 'racket'

export const SLOT_LABELS: Record<AvatarSlot, [string, string]> = {
  hair: ['发型', 'Hair'],
  outfit: ['战服', 'Outfit'],
  weapon: ['武器', 'Racket'],
  background: ['背景', 'Background'],
  frame: ['头像框', 'Frame'],
  title: ['称号', 'Title'],
  top: ['上衣', 'Top'],
  bottom: ['下装', 'Bottom'],
  shoes: ['球鞋', 'Shoes'],
  racket: ['球拍', 'Racket'],
}

/**
 * 商品名，按当前语言取。
 *
 * 名字存的是两元组，取的时候才挑 —— 组件只要自己调过 useT()，
 * 切语言时会重渲染，这里也就跟着出新的语言。
 */
export const itemName = (item: Pick<ShopItem, 'name'>) => pick(...item.name)

/** 槽位展示顺序 */
export const SLOT_ORDER: AvatarSlot[] = [
  'top',
  'bottom',
  'shoes',
  'racket',
  'hair',
  'outfit',
  'weapon',
  'background',
  'frame',
  'title',
]

export type ShopItem = {
  id: string
  /**
   * [中文, English]。存成两元组而不是在这里就 pick() 定死 ——
   * 这张表是模块级常量，求值发生在 initLang() 之前，
   * 当场 pick 会把语言冻在默认值上，之后切语言也不会变。
   */
  name: [string, string]
  slot: AvatarSlot
  price: number
  /** 需要达到的段位下标，0 = 无门槛 */
  minLevel: number
  /** 只有某个性别能用；不填就是两边通用 */
  sex?: AvatarSex
}

/**
 * 商店目录。
 * 价格按「赢几场能买到」来定。这批价是照着赢一场 10 金币定的
 * （80 = 赢 8 场）；金币基数改成 WIN_COINS = 30 之后，同一件东西
 * 现在不到 3 场就买得起 —— 价目表还没跟着往上调，先记在这里。
 *
 * 段位门槛摊开到八段，每升一段都至少解锁一件新东西 ——
 * 升段本身要有看得见的奖励，不然中间几段爬起来没盼头。
 * 越靠后的段位配越贵的货，价格和段位一起卡，不会攒够钱就一步到位。
 *
 * 发型分男女：同一个名字在男女身上是两种画法，所以标了 sex；
 * 战服和武器男女通用，省一半工作量也省一半商店条目。
 */
export const SHOP_ITEMS: ShopItem[] = [
  // 发型 —— 男
  { id: 'm-short', name: ['利落短发', 'Cropped Hair'], slot: 'hair', price: 0, minLevel: 0, sex: 'm' },
  { id: 'm-spiky', name: ['刺猬头', 'Spiky Hair'], slot: 'hair', price: 80, minLevel: 0, sex: 'm' },
  { id: 'm-wolf', name: ['狼尾', 'Wolf Cut'], slot: 'hair', price: 200, minLevel: 2, sex: 'm' },
  { id: 'm-silver', name: ['银发', 'Silver Hair'], slot: 'hair', price: 700, minLevel: 6, sex: 'm' },
  // 发型 —— 女
  { id: 'f-bob', name: ['齐耳短发', 'Bob Cut'], slot: 'hair', price: 0, minLevel: 0, sex: 'f' },
  { id: 'f-twin', name: ['双马尾', 'Twin Tails'], slot: 'hair', price: 80, minLevel: 0, sex: 'f' },
  { id: 'f-long', name: ['黑长直', 'Long Straight'], slot: 'hair', price: 200, minLevel: 2, sex: 'f' },
  { id: 'f-wavy', name: ['金色大波浪', 'Golden Waves'], slot: 'hair', price: 700, minLevel: 6, sex: 'f' },
  /*
   * 战服是一条羽球的成长线，不是奇幻装备：
   * 白队服 → 蓝黑队服 → 无袖精英 → 全黑高手 → 金翼传奇。
   * 越往后越像「真的很能打的人」，最后一档加翅膀和金光。
   */
  { id: 'tee', name: ['新手队服', 'Starter Kit'], slot: 'outfit', price: 0, minLevel: 0 },
  { id: 'jersey', name: ['进阶队服', 'Club Jersey'], slot: 'outfit', price: 60, minLevel: 0 },
  { id: 'elite', name: ['精英战袍', 'Elite Kit'], slot: 'outfit', price: 150, minLevel: 1 },
  { id: 'pro', name: ['高手战衣', 'Pro Kit'], slot: 'outfit', price: 400, minLevel: 4 },
  { id: 'legend', name: ['传奇金翼', 'Legendary Wings'], slot: 'outfit', price: 900, minLevel: 7 },
  /* 武器全是球拍 —— 这是羽球 App，手里拿剑说不过去 */
  { id: 'racket', name: ['入门球拍', 'Starter Racket'], slot: 'weapon', price: 0, minLevel: 0 },
  { id: 'racket-blue', name: ['碳素拍', 'Carbon Racket'], slot: 'weapon', price: 70, minLevel: 0 },
  { id: 'racket-pro', name: ['竞速拍', 'Speed Racket'], slot: 'weapon', price: 250, minLevel: 3 },
  { id: 'racket-gold', name: ['金标拍', 'Gold Label Racket'], slot: 'weapon', price: 500, minLevel: 5 },
  { id: 'racket-legend', name: ['传奇战拍', 'Legendary Racket'], slot: 'weapon', price: 1200, minLevel: 7 },
  /*
   * 下面三类画在人的外面，不动人本身 ——
   * 所以换成立绘图片之后，金币还有地方花，赢球还是有奔头。
   */
  // 背景：衬在人后面
  { id: 'court', name: ['球场', 'Court'], slot: 'background', price: 120, minLevel: 0 },
  { id: 'night', name: ['夜场灯光', 'Night Lights'], slot: 'background', price: 260, minLevel: 2 },
  { id: 'podium', name: ['领奖台', 'Podium'], slot: 'background', price: 500, minLevel: 4 },
  { id: 'final', name: ['决赛主场', 'Finals Arena'], slot: 'background', price: 800, minLevel: 6 },
  { id: 'galaxy', name: ['星空', 'Starfield'], slot: 'background', price: 1200, minLevel: 7 },
  // 头像框：套在头像圆圈外面，排行榜上一眼就看得见，最适合拿来显摆
  { id: 'ring-steel', name: ['钢圈', 'Steel Ring'], slot: 'frame', price: 90, minLevel: 0 },
  { id: 'ring-jade', name: ['翠环', 'Jade Ring'], slot: 'frame', price: 220, minLevel: 2 },
  { id: 'ring-gold', name: ['金边', 'Gold Rim'], slot: 'frame', price: 450, minLevel: 4 },
  { id: 'ring-flame', name: ['烈焰环', 'Flame Ring'], slot: 'frame', price: 900, minLevel: 6 },
  { id: 'ring-crown', name: ['王冠框', 'Crown Frame'], slot: 'frame', price: 1600, minLevel: 7 },
  // 称号：写在名字旁边的一行小字
  { id: 'title-newbie', name: ['初入球场', 'Newcomer'], slot: 'title', price: 40, minLevel: 0 },
  { id: 'title-grinder', name: ['球场劳模', 'Court Regular'], slot: 'title', price: 150, minLevel: 1 },
  { id: 'title-upset', name: ['爆冷专家', 'Giant Killer'], slot: 'title', price: 300, minLevel: 3 },
  { id: 'title-streak', name: ['连胜王', 'Streak King'], slot: 'title', price: 600, minLevel: 5 },
  { id: 'title-king', name: ['无可匹敌', 'Untouchable'], slot: 'title', price: 1400, minLevel: 7 },
]

/** 画在人身上的老三样。有分层换装素材时它们下架，换成四个新槽位 */
const BODY_SLOTS: AvatarSlot[] = ['hair', 'outfit', 'weapon']

/**
 * 某个性别能买到的东西。
 *
 * 有分层换装素材的性别走上衣／下装／球鞋／球拍这四个槽位；
 * 没有的还是老的发型／战服／武器。两套不能混着卖 ——
 * 混着卖就会出现「买了战服但身上是分层立绘，看不到变化」。
 * 背景／头像框／称号画在人外面，两边都有。
 */
export const shopFor = (sex: AvatarSex): ShopItem[] => {
  const mine = SHOP_ITEMS.filter((i) => !i.sex || i.sex === sex)
  if (!dressUpFor(sex)) return mine
  return [...dressItemsFor(sex), ...mine.filter((i) => !BODY_SLOTS.includes(i.slot))]
}

/** 开局白送的那几件，价格为 0 —— 新号一进来就有得穿，不至于光着 */
export const STARTER_IDS = SHOP_ITEMS.filter((i) => i.price === 0).map((i) => i.id)

const ALL_ITEMS = [...SHOP_ITEMS, ...DRESS_ITEMS]

export const itemById = (id: string): ShopItem | undefined =>
  ALL_ITEMS.find((i) => i.id === id)

/**
 * 装备线从奇幻改成羽球时，轻甲／骑士铠／暗影战衣和那几把刀剑都换掉了。
 * 已经买过的人身上会留着一批不存在的 id，画的时候找不到就悄悄退回新手队服，
 * 看起来像从来没升过级 —— 所以按同一档位一件换一件。
 * 价格和门槛都对得上，换过去不用补差价，也没人白掉一级。
 */
const GEAR_RENAMES: Record<string, string> = {
  leather: 'elite',
  knight: 'pro',
  shadow: 'legend',
  dagger: 'racket-blue',
  sword: 'racket-pro',
  staff: 'racket-gold',
  greatsword: 'racket-legend',
}

/** 把一个角色身上和衣柜里的旧 id 换成新 id，其余原样保留 */
export const retireOldGear = (a: AvatarProfile): AvatarProfile => {
  const rename = (id: string) => GEAR_RENAMES[id] ?? id
  return {
    ...a,
    owned: [...new Set(a.owned.map(rename))],
    equipped: Object.fromEntries(
      Object.entries(a.equipped)
        .filter(([, id]) => !!id)
        .map(([slot, id]) => [slot, rename(id as string)]),
    ) as AvatarProfile['equipped'],
  }
}

/* ------------------------------------------------------------------ *
 * 等级
 * ------------------------------------------------------------------ */

export type LevelTier = {
  /** 英文段位名，和 Dota 一致 */
  name: string
  /** [中文叫法, English]。英文那格和 name 相同，见 tierName */
  label: [string, string]
  /** 达到这个段位所需的累计积分 */
  min: number
  color: string
}

/**
 * 段位怎么写出来。
 *
 * 中文界面是「Herald 先锋」—— 英文名是叫法，中文是解释，两个都要。
 * 英文界面里两格是同一个词，再拼一次就成了「Herald Herald」，所以只留一个。
 */
export const tierName = (tier: LevelTier) =>
  pick(`${tier.name} ${tier.label[0]}`, tier.name)

/** 每个段位内部分几颗星 */
export const STARS_PER_TIER = 5

/** 冠绝之上每多少分升一级（冠绝 1、冠绝 2……） */
export const IMMORTAL_STEP = 100

/**
 * 段位照搬 Dota 那一套八段，一段不少。
 *
 * 门槛看 MMR：赢一场 +10（爆冷 +20），输一场 −10 但扣到 0 就打住。
 * 顺风局大致换算成净胜场：卫士 +5、中军 +10、统帅 +15、传奇 +30、
 * 万古 +40、超凡 +50、冠绝 +70；爆冷赢得多的话会快不少。
 *
 * 到了冠绝还能继续往上，每 100 分加一级，显示成「Immortal 1」。
 *
 * 各段跨度不是递增的：先锋／卫士／中军各 50，统帅 150，传奇／万古各 100，
 * 超凡 200。也就是说统帅那一段比后面的传奇、万古都更难熬 —— 这是特意的，
 * 前三段快速过掉给新人正反馈，统帅是第一道真正的坎。
 *
 * 门槛是纯常量，MMR 又是每次从整份比赛记录现算的（不落库），
 * 所以改这张表会把所有人的段位一起重算，不会留下「老数据按老规则」的烂账。
 */
export const PET_LEVELS: LevelTier[] = [
  { name: 'Herald', label: ['先锋', 'Herald'], min: 0, color: '#8fa07d' },
  { name: 'Guardian', label: ['卫士', 'Guardian'], min: 50, color: '#9fb0bf' },
  { name: 'Crusader', label: ['中军', 'Crusader'], min: 100, color: '#5fb8a8' },
  { name: 'Archon', label: ['统帅', 'Archon'], min: 150, color: '#7fc47f' },
  { name: 'Legend', label: ['传奇', 'Legend'], min: 300, color: '#e3b344' },
  { name: 'Ancient', label: ['万古', 'Ancient'], min: 400, color: '#b98cd8' },
  { name: 'Divine', label: ['超凡', 'Divine'], min: 500, color: '#7fb3ff' },
  { name: 'Immortal', label: ['冠绝', 'Immortal'], min: 700, color: '#ff8a3d' },
]

export type LevelInfo = {
  /** 段位下标，和 ShopItem.minLevel 对应 */
  index: number
  tier: LevelTier
  /** 显示用的完整名字，例如 'Archon' 或 'Immortal 3' */
  display: string
  /**
   * 冠绝之上的编号：0 = 冠绝本身，1 = 冠绝 1，以此类推。
   * 没到冠绝为 null。
   */
  immortalRank: number | null
  /** 下一段，已进冠绝为 null（冠绝之上按编号无限涨） */
  next: LevelTier | null
  /** 距离下一段（或下一个冠绝编号）还差多少分 */
  toNext: number
  /** 当前段位内的进度 0~1 */
  progress: number
  /**
   * 段位内的第几颗星（1~5）。
   * 冠绝不分星，改用编号，返回 null。
   */
  star: number | null
}

/**
 * 由 MMR 算出段位。
 * MMR 本身已经夹在 0 以上，这里再夹一次纯粹是防御。
 */
export function levelOf(mmr: number): LevelInfo {
  const pts = Math.max(0, mmr)
  let index = 0
  for (let i = 0; i < PET_LEVELS.length; i++) {
    if (pts >= PET_LEVELS[i].min) index = i
  }
  const tier = PET_LEVELS[index]
  const next = PET_LEVELS[index + 1] ?? null

  // 冠绝：不再有下一段，改成每 IMMORTAL_STEP 分一个编号，可以一直往上
  if (!next) {
    const over = pts - tier.min
    const immortalRank = Math.floor(over / IMMORTAL_STEP)
    const intoStep = over - immortalRank * IMMORTAL_STEP
    return {
      index,
      tier,
      display: immortalRank > 0 ? `${tier.name} ${immortalRank}` : tier.name,
      immortalRank,
      next: null,
      toNext: IMMORTAL_STEP - intoStep,
      progress: intoStep / IMMORTAL_STEP,
      star: null,
    }
  }

  const span = next.min - tier.min
  const progress = span > 0 ? (pts - tier.min) / span : 1
  return {
    index,
    tier,
    display: tier.name,
    immortalRank: null,
    next,
    toNext: next.min - pts,
    progress,
    // 刚进这一段就是 1 星，差一分升段还是 5 星
    star: Math.min(STARS_PER_TIER, Math.floor(progress * STARS_PER_TIER) + 1),
  }
}

/** 某段位第 n 颗星对应多少 MMR，用来告诉人「再赢几场亮下一颗星」 */
export function starThreshold(tierIndex: number, star: number): number {
  const tier = PET_LEVELS[tierIndex]
  const next = PET_LEVELS[tierIndex + 1]
  if (!tier || !next) return tier?.min ?? 0
  const span = next.min - tier.min
  return tier.min + Math.ceil((span * (star - 1)) / STARS_PER_TIER)
}

/* ------------------------------------------------------------------ *
 * 积分
 * ------------------------------------------------------------------ */

/** 爆冷（赢了平均 MMR 比自己高的一方）时，赢的分翻几倍 */
export const UPSET_MULTIPLIER = 2

/** 碾压时翻几倍。MMR 和金币都翻 —— 和爆冷不一样，爆冷只翻 MMR */
export const BLOWOUT_MULTIPLIER = 2

/**
 * 碾压：每一局对手的分都不到一半。
 *
 * 21 分制就是对手不超过 10 分，15 分制不超过 7，11 分制不超过 5 ——
 * 一条规则套所有分制，不用每处去查这场球局定的是几分。
 *
 * 拿这一局赢家的分当分母，而不是去查球局规则里的目标分：
 *
 *   一是 replayMatches 手上只有比赛，没有球局，查不到那个目标分；
 *   二是打到平分加赛时（30:28），赢家实际拿的是 30 分，
 *      拿 21 当分母会把 28:30 这种硬仗算成……不，28 本来就不到一半。
 *      真正的差别在另一头：拿实际分当分母更严，而严是对的 ——
 *      一场打到加赛的球，无论如何不该算碾压。
 *
 * 三局两胜要每一局都碾压才算。赢家中间输过一局的话，那一局里
 * 「对手的分」比赢家还高，这个判断自然就不成立了 —— 不用特判。
 *
 * 0:0 的空局要排掉：三局两胜打 2:0 结束时，第三局可能是个没打的空壳，
 * 而 0 不小于 0 的一半，留着它会把每一场碾压都判成不是。
 */
export function isBlowout(match: Match, winner: TeamSide): boolean {
  const played = match.games.filter((g) => g.a + g.b > 0)
  if (played.length === 0) return false
  return played.every((g) => {
    const won = winner === 'A' ? g.a : g.b
    const lost = winner === 'A' ? g.b : g.a
    return lost * 2 < won
  })
}

/* ------------------------------------------------------------------ *
 * 防刷分
 *
 * 两条规矩，挡的是两种不同的刷法，缺一条另一条就有明显的绕法。
 *
 * 先说清楚它们挡不住什么，免得以后有人以为这里已经防死了：
 *
 *   改手机时钟   —— 时间取的是 Date.now()，也就是手机自己的钟。
 *                   往前拨十分钟再点最后一分，时长规矩就过了。
 *                   补不了：这个 App 是离线优先的（球馆信号差是常态），
 *                   改用服务器时间的话，离线打完再同步的人两次写入
 *                   落在同一个服务器时刻，正常打球的反而会被判成 0 分钟。
 *   真人打假球   —— 两个人真的在场上站三分钟，然后记一个 21:0。
 *                   任何时间和场次的规则都看不出来。
 *
 * 这两条挡的是「懒得动」和「重复来」，那是刷分的绝大多数。
 * 真要防死得靠对手确认，那是另一件事。
 * ------------------------------------------------------------------ */

/** 一场球至少要打这么久才算分 */
export const MIN_SCORING_MS = 3 * 60_000

/**
 * 这一场从开始记分到最后一次记分，经过了多久。拿不到时间就返回 null。
 *
 * 起点是「摆上场」——也就是点开记分那一刻，不是「记下第一分」那一刻。
 *
 * 第一版用的是第一分，理由是「摆上场之后热身、等对手、买水，可能过
 * 十分钟才真开打，把那一段算进去等于白送时长」。道理没错，但用下来
 * 太紧了：真实的一场球，从点开记分到打完本来就包着换边、捡球、
 * 喝水那些，按「第一分到最后一分」算会把正常的短局也判成太快。
 * 而这条规矩宁可漏掉几个刷分的，也不该冤枉真打了球的人。
 *
 * 没有 startedAt 的（老数据、或者从队列直接顶上来的边角）退回第一分。
 *
 * 终点用最后一次记分动作，不用「点打完」：
 *   两者之间可以隔很久。十秒点完 21 分、把手机丢那儿等三分钟再点打完，
 *   用 endedAt 就正好放过这种，而那恰恰是要挡的那一类。
 */
export function scoringSpan(match: Match): number | null {
  const first = match.startedAt ?? match.firstPointAt
  const last = match.lastPointAt
  if (first == null || last == null) return null
  return Math.max(0, last - first)
}

/**
 * 这一场太快，不算分。
 *
 * 拿不到时长的一律放行，这是有意的：lastPointAt 是这次改动才开始写的，
 * 两种录法（逐分、直接输入）都会写。所以「没有 lastPointAt」等于
 * 「这条是老版本记的」—— 老账不翻，规矩只从现在往后管。
 */
export function tooQuick(match: Match): boolean {
  const span = scoringSpan(match)
  return span !== null && span < MIN_SCORING_MS
}

/**
 * 同一组人重复打，第几场之后开始打折。
 *
 * 为什么要这一条：时长规矩挡不住「摆四片场同时刷」「挂机去吃饭」
 * 「把手机时钟往前拨」这三种 —— 它们都只是在跟一个钟较劲。而刷分的
 * 本质不是快，是同样那几个人来回打很多场。掐在这个点上，钟就没用了。
 *
 * 这也不全是防作弊。真正的 Elo 里，反复赢同一个人本来就越赢越少 ——
 * 因为对方分掉下去了。这个 App 是固定 ±10，天生没有那个刹车，
 * 这一条等于把它补回来。
 *
 * 门槛定得比一晚上正常打球高：11 个人轮着转，同一组四个人碰上五次
 * 都难；就算全场只有四个人（这在羽球里太常见了，两对打一晚上），
 * 换着搭档也是三种组合分摊，很难有一种赢到第六场。
 */
export const REPEAT_FULL = 5
export const REPEAT_HALF = 10

/** 同一组人第 n 次赢同一组人（n 从 0 起）时，收益乘几 */
export function repeatFactor(seen: number): number {
  if (seen < REPEAT_FULL) return 1
  if (seen < REPEAT_HALF) return 0.5
  return 0
}

/**
 * 「这个球局里、这一组人、这一边赢」的标识。
 *
 * 赢家和输家分开记，两边各自排序 —— 换了搭档就是另一组，
 * 反过来赢也是另一组。四个人打一晚上，正常会换搭档也会互有胜负，
 * 落在好几个不同的标识上；刷分的那种从头到尾只落在同一个上。
 *
 * 必须带上球局，这一点是写测试时发现的：不带的话计数就是「这辈子」。
 * 每周固定跟同一个人打单打的两个人，打满十场之后就永远不再涨分了 ——
 * 那不是防作弊，那是把最忠实的用户赶走。折扣只在一个晚上之内有意义。
 *
 * 代价说清楚：换个球局，计数就从头开始。刷分的人多开几个球局就能
 * 绕过去。没按「按天」算是因为球局本来就是这个 App 里「一场球」的单位，
 * 跨零点还在打的那种按天算反而会拦腰断掉。多开球局这条留给对手确认去堵。
 */
function matchupKey(match: Match, winners: string[], losers: string[]): string {
  const w = [...winners].sort().join(',')
  const l = [...losers].sort().join(',')
  return `${match.sessionId}|${w}>${l}`
}

/* ------------------------------------------------------------------ *
 * 加注
 *
 * 开打前双方讲好「这场打大的」：赢的一方 MMR 和金币都双倍，
 * 输的一方 MMR 扣双倍。钱是系统出的，不从对手兜里掏。
 *
 * 为什么不做真的对赌（金币在人之间转）：
 * 现在这一整套防刷分管的都是「一个人能赚多快」，一条都不管「转账」。
 * 开了转移的口子，注册几个小号老实打、再把金币全押给大号，
 * 规矩一条没破，大号一夜暴富。真对赌要等对手确认做完。
 *
 * 为什么加注不叠加、也是最多双倍：
 * 刷分的人打 21:0 本来就拿双倍（碾压），加注给不了他更多 ——
 * 也就是说这个功能一点没有抬高刷分的天花板。
 * 而对正常打球的人，它让一场 21:18 的硬仗也值双倍，那才是它存在的意义。
 * ------------------------------------------------------------------ */

/** 加注赢了翻几倍。和碾压、爆冷同一个数 —— 任何加成最多双倍 */
export const STAKE_MULTIPLIER = 2

/** 加注输了扣多少金币。没加注的场次输了一分不扣，这是唯一的例外 */
export const STAKE_COIN_LOSS = WIN_COINS * STAKE_MULTIPLIER

/**
 * 加注的场次又打出碾压：在双倍之上再加一档，MMR 变成 30（双倍 20 + 10）。
 *
 * 这是「任何加成最多双倍」唯一的例外，而且是有意开的：说好打大的、
 * 结果还被打到不够一半的分，那一场在场上就是比别的场重，
 * 记分也该照这个重量来。输赢同一个数 —— 双方是讲好的，刻度当然一样。
 */
export const STAKED_BLOWOUT_BONUS = WIN_POINTS

/**
 * 加注又碾压时，金币在双倍之上再加的那一档 —— 90（双倍 60 + 30）。
 *
 * 和 MMR 走同一条阶梯：两边都是「基数 → 双倍 → 三倍」。
 * 分开两套倍数试过，结果是同一场球两个数字讲两个故事，
 * 场上没人对得上账；同一条阶梯只要记住一句「这一场算三场」。
 */
export const STAKED_BLOWOUT_COIN_BONUS = WIN_COINS

/**
 * 加注 + 碾压那一场相当于几场普通的。MMR 和金币是同一个数，
 * 所以界面上只要说一次「三倍」，不用分开讲两遍。
 */
export const STAKED_BLOWOUT_MULTIPLIER =
  (WIN_POINTS * STAKE_MULTIPLIER + STAKED_BLOWOUT_BONUS) / WIN_POINTS

/** 这一场里所有会被加注影响到的人 */
export const stakeParticipants = (match: Match): string[] => [
  ...match.teamA,
  ...match.teamB,
]

/**
 * 还差谁点确认。
 *
 * 发起的人不用点 —— 他按下加注就等于同意了。
 * 其余每一个人都要点，包括发起人的搭档：他的金币和分一样要跟着翻，
 * 凭什么由队友替他决定。
 */
export function stakePending(match: Match): string[] {
  const ok = new Set([...(match.stakeOk ?? []), ...(match.stakeBy ? [match.stakeBy] : [])])
  return stakeParticipants(match).filter((id) => !ok.has(id))
}

/** 场上每个人都点过头了 */
export const stakeSettled = (match: Match): boolean =>
  stakePending(match).length === 0

/**
 * 这一场的加注算不算数。三个条件缺一不可：
 *
 * 1. 真的加过注
 * 2. 场上每个人都在自己手机上点过确认
 * 3. 这一场是逐分记下来的
 *
 * 第 3 条是为了让加注永远是「开打前定的」。「直接输入最终比分」
 * 是打完之后才录的，那时候谁赢已经知道了 —— 全员确认在那种局面下
 * 也证明不了什么，因为所有人都看得见结果。
 *
 * 界面上还会更早拦一次（加注的场次不给用直接输入），
 * 那层是为了别让人白确认一轮才发现不算数；这一层是算分的最后一道。
 */
export function stakeApplies(match: Match): boolean {
  return match.staked === true && match.firstPointAt != null && stakeSettled(match)
}

export type Progress = {
  wins: number
  losses: number
  /** MMR，最低 0，不会变成负数 */
  mmr: number
  /** 累计赚到的金币（还没扣花掉的） */
  coins: number
  level: LevelInfo
}

export const emptyProgress = (): Progress => ({
  wins: 0,
  losses: 0,
  mmr: 0,
  coins: 0,
  level: levelOf(0),
})

/** 一场比赛落到某个人头上的结果。重放算出来的，不落库 */
export type MatchImpact = {
  playerId: string
  won: boolean
  /**
   * 这一场 MMR 的增减。
   * 输球扣到 0 就打住，所以负的那一侧可能比 LOSS_POINTS 小，甚至是 0 ——
   * 赛后页面要显示的是真实发生的变化，不是规则上的名义值。
   */
  delta: number
  mmrBefore: number
  mmrAfter: number
  /** 这一场赚到的金币，输球为 0 */
  coins: number
}

/** 一场比赛的完整账：谁赢、算不算爆冷、每个人各自变了多少 */
export type MatchOutcome = {
  matchId: string
  winner: TeamSide
  /** 赢的这队打之前平均 MMR 更低 —— 这一场算爆冷，赢家 MMR 双倍 */
  upset: boolean
  /** 每一局对手都不到一半的分 —— 这一场算碾压，赢家 MMR 和金币都双倍 */
  blowout: boolean
  /** 打得太快（不到 MIN_SCORING_MS）—— 这一场进战绩，但不动 MMR 和金币 */
  tooQuick: boolean
  /** 这一组人这样赢过几次了（不含这一场）。到了 REPEAT_FULL 就开始打折 */
  repeats: number
  /** 开打前加过注，而且这一场是逐分记的 —— 双倍，输的那边也扣双倍 */
  staked: boolean
  impacts: MatchImpact[]
}

/**
 * 按时间顺序重放所有比赛，算出每个人的 MMR、金币和战绩，
 * 同时把每一场各自的增减记下来。
 *
 * 为什么必须一场一场推，不能用「胜场×10 − 负场×10」这个公式：
 *
 * 1. MMR 到 0 就不再往下扣。先输 3 场再赢 2 场，逐场算是 0→0→0→10→20，
 *    公式算是 2×10 − 3×10 = −10。两个结果不一样，逐场推的才是我们要的。
 * 2. 爆冷加倍要看「打这场的当下双方 MMR 谁高」，那是个随时间变的量，
 *    只有重放才知道。
 *
 * 每场的增减和总进度是同一次重放的两个产物，故意不拆成两个函数 ——
 * 拆开就是两份 MMR 规则，改一处漏一处的时候，赛后页面显示的
 * 「+20」和排行榜上实际涨的分就对不上了。
 *
 * 代价是 O(比赛数 × 每场人数)，几千场也就几万次运算，无所谓。
 */
export function replayMatches(matches: Match[]): {
  progress: Map<string, Progress>
  outcomes: Map<string, MatchOutcome>
} {
  const out = new Map<string, Progress>()
  const outcomes = new Map<string, MatchOutcome>()
  const get = (id: string) => {
    let p = out.get(id)
    if (!p) {
      p = emptyProgress()
      out.set(id, p)
    }
    return p
  }
  const avgMmr = (team: string[]) =>
    team.length ? team.reduce((s, id) => s + get(id).mmr, 0) / team.length : 0
  /*
   * 「这个球局里，这一组人这样赢过几次了」。跟着重放一路累加 ——
   * 重放本来就是从头按时间走一遍，数到第几次是顺手的事。
   */
  const seenMatchups = new Map<string, number>()
  /** 这一组人这个球局里已经赢过几次（不含这一场） */
  const repeatsOf = (m: Match, winners: string[], losers: string[]) => {
    const key = matchupKey(m, winners, losers)
    const seen = seenMatchups.get(key) ?? 0
    seenMatchups.set(key, seen + 1)
    return seen
  }

  for (const m of chronological(decidedMatches(matches))) {
    const winnerSide = matchWinnerBySets(m)
    if (!winnerSide) continue
    const winners = winnerSide === 'A' ? m.teamA : m.teamB
    const losers = winnerSide === 'A' ? m.teamB : m.teamA

    // 爆冷：赢的这队打这场之前平均 MMR 更低
    const upset = avgMmr(winners) < avgMmr(losers)
    // 碾压：每一局对手都不到一半的分
    const blowout = isBlowout(m, winnerSide)

    // 加注：开打前讲好的双倍
    const staked = stakeApplies(m)

    /*
     * 加成一律双倍，互相不叠加 —— 只有一个例外：加注 + 碾压。
     *
     * 不叠加是因为叠起来就是四倍八倍，一场球顶好几场：分数忽上忽下
     * 失去意义，也正好给刷分的人指路（找个分低的队友，加注，赢一场 21:5）。
     *
     * 那个例外没有破坏这件事：加注要场上四个人各自在自己手机上点头，
     * 刷分的人拿不到 —— 他真正能自己造出来的只有碾压，而碾压本来就是双倍。
     * 也就是说天花板对一个人独自刷分的人没变，变的只是「四个人讲好打大的、
     * 结果还被打爆」那一场。
     */
    const stakedBlowout = staked && blowout
    const gain = stakedBlowout
      ? WIN_POINTS * STAKE_MULTIPLIER + STAKED_BLOWOUT_BONUS
      : upset || blowout || staked
        ? WIN_POINTS * UPSET_MULTIPLIER
        : WIN_POINTS
    /*
     * 金币跟着碾压和加注翻，不跟着爆冷。
     *
     * 爆冷是「对手比你强」，那是 MMR 该管的事；金币是买装备的钱，
     * 按「你打得多干净」给更直观。加注要跟着翻是因为它是双方讲好的，
     * 场上人人知道 —— 说好打大的，赢了却只多拿分不多拿钱，说不过去。
     */
    const coinGain = stakedBlowout
      ? WIN_COINS * BLOWOUT_MULTIPLIER + STAKED_BLOWOUT_COIN_BONUS
      : blowout || staked
        ? WIN_COINS * BLOWOUT_MULTIPLIER
        : WIN_COINS
    /*
     * 输的一方只在加注时扣双倍。
     *
     * 碾压和爆冷不加重处罚：那两种是系统判出来的，输的人没同意过。
     * 加注是他自己点头的（而且是在自己手机上点的），那才叫赌注 ——
     * 没有下行风险的赌注不是赌注。
     *
     * 碾压也扣双倍：被打到不够一半的分，那是场上所有人都看见的事，
     * 赢的那边拿双倍，输的这边也该照这个刻度算。原来只翻赢的一侧，
     * 于是一场 21:3 和一场 21:19 对输家是一样的代价 —— 那不对。
     *
     * 爆冷不在内，还是扣原样。爆冷是「对手明明分比你低却赢了」，
     * 说的是对手超常，不是你被打爆 —— 输给一个分低的人已经够难受了，
     * 再加倍扣是罚错了东西。
     */
    const lossPoints = stakedBlowout
      ? LOSS_POINTS * STAKE_MULTIPLIER + STAKED_BLOWOUT_BONUS
      : staked || blowout
        ? LOSS_POINTS * STAKE_MULTIPLIER
        : LOSS_POINTS
    /*
     * 金币只在加注的场次扣 —— 这是「金币只涨不跌」唯一的例外，
     * 而且是本人点头换来的。
     *
     * 碾压不扣金币，哪怕它现在扣双倍 MMR。两者的区别在「同没同意」：
     * 加注是四个人各自在自己手机上点过头的，输了掏钱是那笔交易的一半；
     * 碾压是系统按比分判的，没人点过头，凭什么动他攒装备的钱。
     * MMR 是水平的刻度，被打爆就该往下走；金币是劳动所得，不该没收。
     *
     * 扣到 0 就打住，和 MMR 同一个做法。
     *
     * 有个边角要说清楚：余额 = 赚到的 − 花掉的。一个人把钱花光了
     * （余额 0）再输一场加注，赚到的那一栏掉了 60，但余额本来就是 0，
     * 看起来像没扣。要修得让重放知道他花了多少，而「花掉多少」是落库的、
     * 不是从比赛推出来的 —— 为这个边角把那条界线打通不值得。
     */
    const coinLoss = stakedBlowout
      ? WIN_COINS * STAKE_MULTIPLIER + STAKED_BLOWOUT_COIN_BONUS
      : staked
        ? STAKE_COIN_LOSS
        : 0

    /*
     * 打折和不算分，最后一起乘上去。
     *
     * 两条防刷分的规矩都只动 MMR 和金币，不动胜负场次 ——
     * 球是真打了的（或者至少记下来了），战绩里该留着；
     * 把它从战绩里也抹掉，等于替人判定「这场不作数」，
     * 那是另一个性质的事，我们没有那个把握。
     *
     * 输的那一边同样打折。只打赢家的折会让反复对打变成净扣分：
     * 全场只有四个人打一晚上的那种（羽球里太常见了），
     * 到后面就是赢的不加、输的照扣，那不是我们要的。
     */
    const quick = tooQuick(m)
    const repeats = repeatsOf(m, winners, losers)
    const factor = quick ? 0 : repeatFactor(repeats)

    const finalGain = Math.round(gain * factor)
    const finalCoins = Math.round(coinGain * factor)
    const finalLoss = Math.round(lossPoints * factor)
    const finalCoinLoss = Math.round(coinLoss * factor)
    const impacts: MatchImpact[] = []

    for (const id of winners) {
      const p = get(id)
      const before = p.mmr
      p.wins += 1
      p.mmr += finalGain
      p.coins += finalCoins
      impacts.push({
        playerId: id,
        won: true,
        delta: p.mmr - before,
        mmrBefore: before,
        mmrAfter: p.mmr,
        coins: finalCoins,
      })
    }
    for (const id of losers) {
      const p = get(id)
      const before = p.mmr
      const coinsBefore = p.coins
      p.losses += 1
      // 输球扣分，但扣到 0 就打住，不做负分
      p.mmr = Math.max(0, p.mmr - finalLoss)
      // 金币只有加注的场次才扣，同样扣到 0 为止
      p.coins = Math.max(0, p.coins - finalCoinLoss)
      impacts.push({
        playerId: id,
        won: false,
        delta: p.mmr - before,
        mmrBefore: before,
        mmrAfter: p.mmr,
        // 负数：结算页要显示「金币 −20」。真扣掉多少以封底后为准
        coins: p.coins - coinsBefore,
      })
    }

    outcomes.set(m.id, {
      matchId: m.id,
      winner: winnerSide,
      upset,
      blowout,
      tooQuick: quick,
      repeats,
      staked,
      impacts,
    })
  }

  for (const p of out.values()) p.level = levelOf(p.mmr)
  return { progress: out, outcomes }
}

export function progressByPlayer(matches: Match[]): Map<string, Progress> {
  return replayMatches(matches).progress
}

/**
 * 某一场比赛的账。
 *
 * 友谊赛和还没打完的场次没有账（它们本来就不进 MMR），返回 null，
 * 由调用方决定怎么说 —— 赛后页面会明写「这场不算 MMR」。
 */
export const outcomeOf = (
  matches: Match[],
  matchId: string,
): MatchOutcome | null => replayMatches(matches).outcomes.get(matchId) ?? null

/** MMR 走势上的一个点 */
export type MmrPoint = {
  /** 这一场打完的时间；起点那一项跟第一场同时 */
  at: number
  /** 起点那一项没有对应的比赛，是空串 */
  matchId: string
  mmr: number
  /** 这一场的增减，起点是 0 */
  delta: number
}

/**
 * 某个人的 MMR 走势，按时间顺序，第一项是他打第一场之前的起点。
 *
 * 横轴故意用「第几场」而不是日期：羽球是一晚上打六场、然后隔一周再打，
 * 按日期铺开的话所有起伏都挤成几根竖线，中间全是空白。
 * 而且大家自己也是按场数记的（「我最近十场」），不是按天。
 */
export function mmrTimeline(matches: Match[], playerId: string): MmrPoint[] {
  const { outcomes } = replayMatches(matches)
  const endedAt = new Map(matches.map((m) => [m.id, m.endedAt ?? m.startedAt ?? 0]))
  const out: MmrPoint[] = []
  // outcomes 是重放时按时间顺序塞进去的，Map 保持插入顺序
  for (const [id, o] of outcomes) {
    const mine = o.impacts.find((i) => i.playerId === playerId)
    if (!mine) continue
    const at = endedAt.get(id) ?? 0
    if (out.length === 0) {
      out.push({ at, matchId: '', mmr: mine.mmrBefore, delta: 0 })
    }
    out.push({ at, matchId: id, mmr: mine.mmrAfter, delta: mine.delta })
  }
  return out
}

export const progressOf = (playerId: string, matches: Match[]): Progress =>
  progressByPlayer(matches).get(playerId) ?? emptyProgress()

/** 只关心赢了几场的地方用这个 */
export const winCount = (playerId: string, matches: Match[]): number =>
  progressOf(playerId, matches).wins

/* ------------------------------------------------------------------ *
 * 角色档案
 * ------------------------------------------------------------------ */

export type AvatarProfile = {
  playerId: string
  sex: AvatarSex
  /** 肤色档位下标，免费换 */
  skin: number
  /** 已买下的装备 id */
  owned: string[]
  /** 当前每个槽位穿着什么 */
  equipped: Partial<Record<AvatarSlot, string>>
  /** 累计花掉的金币。只有这个和 owned 需要落库 */
  spent: number
  createdAt: number
}

/** 换性别时把发型换成对应性别的免费款，否则会顶着异性发型 */
export const defaultHair = (sex: AvatarSex): string =>
  sex === 'm' ? 'm-short' : 'f-bob'

/**
 * 补上分层换装的开局装备：白送的那几件塞进衣柜，空着的槽位穿上第一件。
 *
 * 幂等，重复跑没事 —— 所以三个地方都能用同一份：新建角色、换性别、
 * 以及老存档的迁移（素材是后来才加的，之前建的女号身上一件都没有，
 * 不补的话打开角色页只有一个底图，看起来像没穿衣服）。
 *
 * 已经穿着的不动。手上有更贵的球拍，不该被开局那把顶掉。
 */
export const grantDressUp = (a: AvatarProfile): AvatarProfile => {
  if (!dressUpFor(a.sex)) return a
  const starters = dressStartersFor(a.sex)
  const owned = [...new Set([...a.owned, ...starters])]
  const mine = new Set(dressItemsFor(a.sex).map((i) => i.id))

  const equipped = { ...a.equipped }
  for (const slot of DRESS_SLOTS) {
    const now = equipped[slot]
    if (now && mine.has(now)) continue
    /*
     * 空着，或者穿着的是另一个性别那套（换性别之后会这样 ——
     * 两套的 id 不通用）。挑这个槽位里已经买过的最贵的一件穿上，
     * 没买过就穿白送的那件。
     *
     * 挑最贵的是为了换回来时能自动穿回好东西：owned 从来不清空，
     * 换过去换回来，攒下的家当还在身上。
     */
    const best = dressItemsFor(a.sex)
      .filter((i) => i.slot === slot && owned.includes(i.id))
      .sort((x, y) => y.price - x.price)[0]
    equipped[slot] = best?.id ?? dressId(a.sex, slot, 0)
  }
  return { ...a, owned, equipped }
}

/**
 * 老三样也一起给：换性别、或者以后把分层素材撤掉时，
 * SVG 那条路还得有东西穿，不然人是光的。
 */
export const newAvatar = (playerId: string, sex: AvatarSex): AvatarProfile =>
  grantDressUp({
    playerId,
    sex,
    skin: 0,
    // 免费那几件直接送，新号一进来就穿戴整齐
    owned: [...STARTER_IDS],
    equipped: { hair: defaultHair(sex), outfit: 'tee', weapon: 'racket' },
    spent: 0,
    createdAt: Date.now(),
  })

/** 还剩多少金币能花。金币只增不减，所以正常不会为负，夹一下防御 */
export const balanceOf = (
  avatar: AvatarProfile | undefined,
  coins: number,
): number => Math.max(0, coins - (avatar?.spent ?? 0))

export type BuyBlock = 'owned' | 'level' | 'money' | null

/**
 * 能不能买。返回挡住的原因，界面直接拿来显示，
 * 免得每处自己拼「段位不够」还是「金币不够」。
 *
 * 两道关分别看两个数：段位门槛看 MMR（会掉），价格看金币（不会掉）。
 * 所以输球可能让你暂时买不了某件高段位的货，但不会没收已经买下的东西。
 */
export function buyBlocker(
  item: ShopItem,
  avatar: AvatarProfile | undefined,
  progress: Progress,
): BuyBlock {
  if (avatar?.owned.includes(item.id)) return 'owned'
  if (progress.level.index < item.minLevel) return 'level'
  if (balanceOf(avatar, progress.coins) < item.price) return 'money'
  return null
}

/** 身上装备的总价值，用来显示「这身行头值多少」 */
export function outfitValue(avatar: AvatarProfile | undefined): number {
  if (!avatar) return 0
  return SLOT_ORDER.reduce((sum, slot) => {
    const id = avatar.equipped[slot]
    return sum + (id ? (itemById(id)?.price ?? 0) : 0)
  }, 0)
}
