/* ------------------------------------------------------------------ *
 * 州
 *
 * 马来西亚十三州加三个联邦直辖区。存在这儿只为一件事：
 * 让「我在雪兰莪排第几」这个数算得出来 —— 那比「全国第 147」
 * 有劲得多，而有劲正是让人想再打一场的东西。
 *
 * -------------------------------------------------------------------
 * 为什么要归一化，不直接存人填的那串字
 *
 * 同一个州这边的人会写成「雪兰莪」「Selangor」「雪州」「SELANGOR」，
 * 地址里还常常写成「Petaling Jaya, Selangor」。原样存进去的话，
 * 一个州会在榜上裂成四五个，而每一个都只有几个人。
 *
 * 所以：认得出来的归到同一个标准名，认不出来的就是空 ——
 * 空的人只上全国榜，不上地区榜。**不猜**：猜错了把人放进
 * 隔壁州的榜里，比不放他进去更糟。
 * ------------------------------------------------------------------ */

/** 标准州名。中文是显示用的，英文是匹配和存储用的 */
export const STATES: { id: string; zh: string; en: string }[] = [
  { id: 'johor', zh: '柔佛', en: 'Johor' },
  { id: 'kedah', zh: '吉打', en: 'Kedah' },
  { id: 'kelantan', zh: '吉兰丹', en: 'Kelantan' },
  { id: 'melaka', zh: '马六甲', en: 'Melaka' },
  { id: 'negeri-sembilan', zh: '森美兰', en: 'Negeri Sembilan' },
  { id: 'pahang', zh: '彭亨', en: 'Pahang' },
  { id: 'penang', zh: '槟城', en: 'Penang' },
  { id: 'perak', zh: '霹雳', en: 'Perak' },
  { id: 'perlis', zh: '玻璃市', en: 'Perlis' },
  { id: 'sabah', zh: '沙巴', en: 'Sabah' },
  { id: 'sarawak', zh: '砂拉越', en: 'Sarawak' },
  { id: 'selangor', zh: '雪兰莪', en: 'Selangor' },
  { id: 'terengganu', zh: '登嘉楼', en: 'Terengganu' },
  { id: 'kl', zh: '吉隆坡', en: 'Kuala Lumpur' },
  { id: 'putrajaya', zh: '布城', en: 'Putrajaya' },
  { id: 'labuan', zh: '纳闽', en: 'Labuan' },
]

/**
 * 除了标准名之外还认得的写法。
 *
 * 这份表是会长的 —— 每次发现有人这么写又没被认出来，就往里加一行。
 * 加错了的代价很小（多认一种写法），漏了的代价是那个人不上地区榜。
 */
const ALIASES: Record<string, string> = {
  /* 简称 */
  雪州: 'selangor',
  雪隆: 'selangor',
  吉隆玻: 'kl',
  隆市: 'kl',
  槟州: 'penang',
  甲州: 'melaka',
  丹州: 'kelantan',
  柔州: 'johor',
  /* 英文里的别名和旧拼法 */
  'kuala lumpur': 'kl',
  'wilayah persekutuan': 'kl',
  'wp kuala lumpur': 'kl',
  kl: 'kl',
  'pulau pinang': 'penang',
  'penang island': 'penang',
  georgetown: 'penang',
  malacca: 'melaka',
  'n. sembilan': 'negeri-sembilan',
  'n sembilan': 'negeri-sembilan',
  ns: 'negeri-sembilan',
  trengganu: 'terengganu',
  /* 常见的市，落在哪个州是确定的 —— 地址里往往只写到市 */
  'petaling jaya': 'selangor',
  'shah alam': 'selangor',
  'subang jaya': 'selangor',
  klang: 'selangor',
  puchong: 'selangor',
  cheras: 'selangor',
  kajang: 'selangor',
  'johor bahru': 'johor',
  ipoh: 'perak',
  seremban: 'negeri-sembilan',
  'kota kinabalu': 'sabah',
  kuching: 'sarawak',
  八打灵: 'selangor',
  蕉赖: 'selangor',
  加影: 'selangor',
  新山: 'johor',
  怡保: 'perak',
  芙蓉: 'negeri-sembilan',
  亚庇: 'sabah',
  古晋: 'sarawak',
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * 从一串字里认出是哪个州。认不出来返回 null。
 *
 * 喂给它的可以是一整个地址（「12, Jalan SS2/24, Petaling Jaya, Selangor」），
 * 也可以是人直接选的州名。两种都要认得 —— 球馆那边填的是地址，
 * 而地址里州名在最后，前面还有一堆门牌路名。
 */
export function stateOf(text: string | null | undefined): string | null {
  if (!text) return null
  const s = norm(text)
  /*
   * 先比标准名，再比别名。顺序要紧：
   * 「Kuala Lumpur」既是标准名也在别名表里，先命中哪个都一样，
   * 但以后加别名时容易出现一个别名压掉某个州的标准名。
   */
  for (const st of STATES) {
    if (s.includes(norm(st.en)) || text.includes(st.zh)) return st.id
  }
  for (const [alias, id] of Object.entries(ALIASES)) {
    const a = norm(alias)
    /*
     * 英文别名要卡词边界，中文的不用。
     *
     * 「ns」「kl」这种两个字母的，不卡边界的话「Jalan Insan」里
     * 那个 ns 会把人判成森美兰。中文没有这个问题，也没有空格可依靠。
     */
    if (/^[a-z. ]+$/.test(a)) {
      if (new RegExp(`(^|[^a-z])${a.replace(/\./g, '\\.')}([^a-z]|$)`).test(s)) return id
    } else if (text.includes(alias)) {
      return id
    }
  }
  return null
}

/** 州的显示名。认不出来的 id 原样返回，不至于显示成空白 */
export function stateName(id: string | null | undefined, zh: boolean): string {
  if (!id) return ''
  const st = STATES.find((x) => x.id === id)
  if (!st) return id
  return zh ? st.zh : st.en
}
