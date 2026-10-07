import { describe, expect, it } from 'vitest'
import {
  OTP_CHANNEL,
  PHONE_AUTH_READY,
  channelName,
  cleanCode,
  isCode,
  isPhone,
  maskPhone,
  normalizePhone,
  prettyPhone,
} from '@/lib/phone'

/* ------------------------------------------------------------------ *
 * 手机号
 *
 * 这一块错了**不会报错**：同一个人用三种写法打同一个号，
 * 数据库看到的是三个不同的账号，于是他注册出三个，而战绩在第一个里。
 * 他看到的只是「登进去什么都没了」，根本不会联想到是横杠的事。
 *
 * 所以下面大半在钉同一件事：同一个号，不管怎么打，出来都一样。
 * ------------------------------------------------------------------ */

describe('同一个号，怎么打都一样', () => {
  const SAME = [
    '012-345 6789',
    '012 345 6789',
    '0123456789',
    '012-3456789',
    '123456789',
    '60123456789',
    '+60123456789',
    '+60 12-345 6789',
    '  012-345 6789  ',
    '(012) 345-6789',
  ]

  it('十种写法归到同一串', () => {
    const out = new Set(SAME.map((s) => normalizePhone(s)))
    expect([...out]).toEqual(['+60123456789'])
  })
})

describe('认得出的号', () => {
  it('011 那一档比别的长一位', () => {
    expect(normalizePhone('011-1234 5678')).toBe('+601112345678')
  })

  it('各个手机前缀都收', () => {
    for (const p of ['010', '011', '012', '013', '014', '016', '017', '018', '019']) {
      const n = p === '011' ? `${p}12345678` : `${p}1234567`
      expect(normalizePhone(n)).not.toBeNull()
    }
  })

  it('自己打了 + 的外国号照收', () => {
    expect(normalizePhone('+65 9123 4567')).toBe('+6591234567')
    expect(normalizePhone('+86 138 0013 8000')).toBe('+8613800138000')
  })
})

describe('认不出的一律 null，不猜', () => {
  /*
   * 猜错的后果不是「这次登不上」，是**他注册成了别人的号码** ——
   * 而那个人有一天真来注册时会撞上「这个号已经有人了」。
   */
  it('空的、乱打的', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
    expect(normalizePhone('---')).toBeNull()
  })

  it('带字母的判死 —— 多半是把名字打进来了', () => {
    /* 悄悄删掉字母会把「Ah Meng 012」变成一个看起来很正常的号码 */
    expect(normalizePhone('Ah Meng 0123456789')).toBeNull()
    expect(normalizePhone('012-345 678O')).toBeNull()
  })

  it('太短太长', () => {
    expect(normalizePhone('0123')).toBeNull()
    expect(normalizePhone('012345678901234567')).toBeNull()
    expect(normalizePhone('+1')).toBeNull()
  })

  it('固定电话不收 —— 座机收不到 WhatsApp', () => {
    /* 当场说「这个号收不到」，比让他等一条永远不来的消息强 */
    expect(normalizePhone('03-7788 9900')).toBeNull()
    expect(normalizePhone('04-123 4567')).toBeNull()
  })

  it('马来西亚的号少一位多一位都不收', () => {
    expect(normalizePhone('012-345 678')).toBeNull()
    expect(normalizePhone('012-345 67890')).toBeNull()
  })

  it('isPhone 跟 normalizePhone 一个口径', () => {
    expect(isPhone('012-345 6789')).toBe(true)
    expect(isPhone('03-7788 9900')).toBe(false)
  })
})

describe('给人看的写法', () => {
  it('马来西亚的号按本地习惯断节', () => {
    expect(prettyPhone('+60123456789')).toBe('+60 12-345 6789')
    expect(prettyPhone('+601112345678')).toBe('+60 11-1234 5678')
  })

  it('别的国家原样返回 —— 瞎断比不断还难读', () => {
    expect(prettyPhone('+6591234567')).toBe('+6591234567')
  })

  it('遮一半：留国码和最后四位', () => {
    /* 留头留尾让人认出「这是我那个号」，中间盖住是因为手机在球馆里传着看 */
    const masked = maskPhone('+60123456789')
    expect(masked.startsWith('+60')).toBe(true)
    expect(masked.endsWith('6789')).toBe(true)
    expect(masked).toContain('•')
    /* 盖掉的那几位真的不见了 */
    expect(masked).not.toContain('12345')
  })
})

describe('验证码', () => {
  it('只留数字，最多 6 位', () => {
    expect(cleanCode('12 34-56')).toBe('123456')
    expect(cleanCode('1234567890')).toBe('123456')
    expect(cleanCode('abc')).toBe('')
  })

  it('够 6 位才算填完', () => {
    expect(isCode('123456')).toBe(true)
    expect(isCode('12345')).toBe(false)
    expect(isCode('1234567')).toBe(false)
  })
})

describe('验证码走哪条道', () => {
  /*
   * 这几条钉的是一件容易被忘的事：**改了那个开关，界面要跟着改口**。
   * 写死「WhatsApp」的话，哪天切成短信，App 会一直教人去 WhatsApp
   * 里找一条永远不会到的消息。
   */
  it('两条道各有各的说法', () => {
    expect(channelName(true, 'whatsapp')).toBe('WhatsApp')
    expect(channelName(false, 'whatsapp')).toBe('WhatsApp')
    expect(channelName(true, 'sms')).toBe('短信')
    expect(channelName(false, 'sms')).toBe('SMS')
  })

  it('不传就按现在设的那条道', () => {
    expect(channelName(true)).toBe(channelName(true, OTP_CHANNEL))
  })

  it('现在设的是这两个之一，没写错字', () => {
    expect(['sms', 'whatsapp']).toContain(OTP_CHANNEL)
  })
})

describe('手机号登录这道闸', () => {
  /*
   * 这不是在测一个常量，是在钉一条规矩：**没配好发信的那一端之前，
   * 那条路不许露面**。露了的结果是陌生人打开 App、点注册，第一眼
   * 看到的是一条走不通的路 —— 而第一屏就碰壁的人不会再试第二次。
   *
   * Twilio 配好了就把它改成 true，这条测试会跟着红，提醒改的人
   * 顺手确认一遍：真的能发出去了吗？
   */
  it('还没配发信那一端，所以是关着的', () => {
    expect(PHONE_AUTH_READY).toBe(false)
  })
})
