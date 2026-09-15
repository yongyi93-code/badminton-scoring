import { describe, expect, it } from 'vitest'
import { STATES, stateName, stateOf } from '@/lib/region'

/*
 * 认州。
 *
 * 这一层唯一会真出事的是**认错**：把一个人放进隔壁州的榜里，
 * 比不放他进去糟得多 —— 后者他知道自己没上榜，前者他不知道自己
 * 在和不该比的人比。所以宁可认不出来，也不许猜。
 */

describe('直接写州名', () => {
  it('中文认得出', () => {
    expect(stateOf('雪兰莪')).toBe('selangor')
    expect(stateOf('吉隆坡')).toBe('kl')
  })

  it('英文认得出，大小写不管', () => {
    expect(stateOf('Selangor')).toBe('selangor')
    expect(stateOf('SELANGOR')).toBe('selangor')
    expect(stateOf('  selangor  ')).toBe('selangor')
  })

  it('十六个州和联邦直辖区，每一个都认得出自己的名字', () => {
    for (const st of STATES) {
      expect(stateOf(st.zh), st.zh).toBe(st.id)
      expect(stateOf(st.en), st.en).toBe(st.id)
    }
  })
})

describe('从一整个地址里认', () => {
  it('州名在地址最后', () => {
    expect(stateOf('12, Jalan SS2/24, Petaling Jaya, Selangor')).toBe('selangor')
  })

  it('只写到市也认得 —— 地址常常不写州', () => {
    expect(stateOf('No 5, Jalan Bukit, Johor Bahru')).toBe('johor')
    expect(stateOf('力天羽球馆，蕉赖')).toBe('selangor')
  })

  it('简称和旧拼法', () => {
    expect(stateOf('雪州')).toBe('selangor')
    expect(stateOf('Pulau Pinang')).toBe('penang')
    expect(stateOf('Malacca')).toBe('melaka')
  })
})

describe('宁可认不出来，也不许猜', () => {
  it('空的就是空的', () => {
    expect(stateOf('')).toBeNull()
    expect(stateOf(null)).toBeNull()
    expect(stateOf(undefined)).toBeNull()
  })

  it('认不出来的返回 null，不瞎归到某个州', () => {
    expect(stateOf('力天羽球馆')).toBeNull()
    expect(stateOf('Court 3')).toBeNull()
    expect(stateOf('Singapore')).toBeNull()
  })

  /*
   * 两个字母的别名必须卡词边界。
   *
   * 不卡的话，「Jalan Insan」里那个 ns 会把人判成森美兰，
   * 「Bukit Kled」里的 kl 会把人判成吉隆坡 —— 而这种错没人会发现，
   * 只会有人纳闷自己怎么在别的州的榜上。
   */
  it('路名里碰巧有 ns / kl 这两个字母，不算', () => {
    expect(stateOf('Jalan Insan 5')).toBeNull()
    expect(stateOf('Taman Klebang')).toBeNull()
    expect(stateOf('Jalan Bukit Kledang')).toBeNull()
  })

  it('但真的写了 KL 就认', () => {
    expect(stateOf('Sri Petaling, KL')).toBe('kl')
    expect(stateOf('KL')).toBe('kl')
  })
})

describe('显示名', () => {
  it('中英各一套', () => {
    expect(stateName('selangor', true)).toBe('雪兰莪')
    expect(stateName('selangor', false)).toBe('Selangor')
  })

  it('空的显示成空，不是「undefined」', () => {
    expect(stateName(null, true)).toBe('')
    expect(stateName(undefined, false)).toBe('')
  })

  /* 以后删掉某个 id、而数据库里还留着旧值时，别显示成一片空白 */
  it('不认得的 id 原样显示，不吞掉', () => {
    expect(stateName('atlantis', true)).toBe('atlantis')
  })
})
