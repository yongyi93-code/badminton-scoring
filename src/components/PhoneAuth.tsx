import { useEffect, useRef, useState } from 'react'
import { useT, lang } from '@/lib/i18n'
import { Button, Field, cx, inputClass } from '@/components/ui'
import { sendPhoneCode, verifyPhoneCode } from '@/store/useAuth'
import {
  CODE_LEN,
  channelName,
  cleanCode,
  isCode,
  maskPhone,
  normalizePhone,
  prettyPhone,
} from '@/lib/phone'

/* ------------------------------------------------------------------ *
 * 用手机号进来
 *
 * -------------------------------------------------------------------
 * 这条路上没有「注册」和「登录」之分
 *
 * 邮箱那条有：注册要设一个密码，登录要记得那个密码，而「我到底注册过
 * 没有」是这一屏最常见的困惑。
 *
 * 手机号这条只有一件事 —— 要一条验证码，填进去就进来了。第一次来是
 * 注册，以后来是登录，人根本不用知道有这个区别。这正是做这条路的理由：
 * 它是给「连邮箱都嫌麻烦」的人用的，而「注册还是登录」「密码是什么」
 * 是两道凭空多出来的坎。没有密码，也就没有「忘了密码」。
 *
 * -------------------------------------------------------------------
 * 发之前把号码念回去给他看
 *
 * 打错一位的后果不是「收不到」，是**验证码发到了陌生人手机上** ——
 * 而他只会以为没发出去，一直点「再发一条」，每点一次都是钱。
 * 所以第二屏最上面那句写的是归一化之后的号码，不是他打进去的原文。
 * ------------------------------------------------------------------ */

/** 两条之间至少隔多久。Supabase 那边本来就拦，这里是把它说出来 */
const COOLDOWN = 60

export function PhoneAuth({ onDone }: { onDone: () => void }) {
  const t = useT()
  /* 「短信」还是「WhatsApp」—— 跟 OTP_CHANNEL 同一个开关，不会说假话 */
  const via = channelName(lang() === 'zh')
  const [step, setStep] = useState<'num' | 'code'>('num')
  const [input, setInput] = useState('')
  /** 真正发出去的那个号（已归一化）。填码那一步只认它，不认输入框 */
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const codeBox = useRef<HTMLInputElement>(null)

  const e164 = normalizePhone(input)

  /* 倒数。每点一条都是钱，所以不让人乱点，而且把还要等几秒说出来 */
  useEffect(() => {
    if (left <= 0) return
    const id = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [left])

  /* 到了填码那一步就把光标放进去 —— 少一次点击，老人家少一次找 */
  useEffect(() => {
    if (step === 'code') codeBox.current?.focus()
  }, [step])

  async function send(again = false) {
    if (!e164) return
    setBusy(true)
    setError(null)
    const res = await sendPhoneCode(e164)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSentTo(e164)
    setLeft(COOLDOWN)
    if (!again) {
      setCode('')
      setStep('code')
    }
  }

  async function check() {
    if (!sentTo || !isCode(code)) return
    setBusy(true)
    setError(null)
    const res = await verifyPhoneCode(sentTo, code)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onDone()
  }

  /* ---------------------------------------------------------------- *
    第一步：填号码
  * ---------------------------------------------------------------- */
  if (step === 'num') {
    return (
      <div className="space-y-4">
        <p className="text-ink-700 text-label">
          {t(
            `填手机号，我们用${via}发一个 6 位数的码过去。不用设密码，也不用邮箱。`,
            `Enter your phone number — we send a 6-digit code by ${via}. No password, no email.`,
          )}
        </p>

        <Field
          label={t('手机号', 'Phone number')}
          /*
            打对了就把标准写法念回去。
            人打的是 012-345 6789，发出去的是 +60123456789 —— 让他现在
            就看见这两个是同一个号，省得收到码之后对不上又以为出错了。
          */
          hint={
            input.trim() && !e164
              ? t('这个号码不对 —— 马来西亚的是 012-345 6789 这种', 'That does not look right — Malaysian numbers look like 012-345 6789')
              : e164
                ? prettyPhone(e164)
                : t('马来西亚号不用打 +60', 'Malaysian numbers: no need to type +60')
          }
        >
          <input
            className={cx(inputClass, input.trim() && !e164 && 'border-danger-600')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e164 && !busy && void send()}
            placeholder="012-345 6789"
          />
        </Field>

        {error && <p className="text-danger-600 text-label">{error}</p>}

        <Button
          variant="primary"
          size="lg"
          block
          disabled={!e164 || busy}
          onClick={() => void send()}
        >
          {busy ? t('发送中…', 'Sending…') : t(`用${via}发验证码`, `Send code by ${via}`)}
        </Button>
      </div>
    )
  }

  /* ---------------------------------------------------------------- *
    第二步：填码
  * ---------------------------------------------------------------- */
  return (
    <div className="space-y-4">
      <p className="text-ink-700 text-label">
        {t(
          `验证码用${via}发到 ${sentTo ? maskPhone(sentTo) : ''} 了。`,
          `We sent a code by ${via} to ${sentTo ? maskPhone(sentTo) : ''}.`,
        )}
      </p>

      <Field label={t('6 位验证码', '6-digit code')}>
        <input
          ref={codeBox}
          /* 字距拉开、字大一点：这几个数字是对着另一个屏幕一位位抄过来的 */
          className={cx(inputClass, 'text-center text-h2 tracking-[0.4em]')}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(cleanCode(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && isCode(code) && !busy && void check()}
          placeholder={'·'.repeat(CODE_LEN)}
        />
      </Field>

      {error && <p className="text-danger-600 text-label">{error}</p>}

      <Button
        variant="primary"
        size="lg"
        block
        disabled={!isCode(code) || busy}
        onClick={() => void check()}
      >
        {busy ? t('稍等…', 'Working…') : t('进去', 'Continue')}
      </Button>

      {/*
        再发一条。倒数没走完就按不动 —— 每一条都是钱，而「没收到」的人
        第一反应就是连点。把还要等几秒写在按钮上，人就真的会等。
      */}
      <Button
        variant="soft"
        block
        disabled={busy || left > 0}
        onClick={() => void send(true)}
      >
        {left > 0
          ? t(`没收到？${left} 秒后可以再发`, `Nothing yet? You can resend in ${left}s`)
          : t('没收到？再发一条', 'Nothing yet? Send another')}
      </Button>

      {/*
        改号码。打错一位是最常见的事，而这时候他已经在第二屏了 ——
        没有这个按钮就只能关掉整个弹层重来。
      */}
      <button
        className="text-brand-600 block w-full text-center text-caption"
        onClick={() => {
          setStep('num')
          setError(null)
          setCode('')
        }}
      >
        {t('号码打错了？改一下', 'Wrong number? Change it')}
      </button>
    </div>
  )
}
