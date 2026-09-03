import { useT } from '@/lib/i18n'
import { useState } from 'react'
import { Button, Field, Sheet, inputClass } from '@/components/ui'
import { cancelRecovery, setNewPassword, useAuth } from '@/store/useAuth'

/* ------------------------------------------------------------------ *
 * 设置新密码
 *
 * 点「忘记密码」邮件里的链接回来时出现。挂在 App 最外层而不是「我的」
 * 那一屏里 —— 链接会把人带回上次停在的任何一页，而这件事必须当场做完：
 * 那个临时会话是一次性的，这次不设，下次打开还是进不来。
 *
 * 关不掉（没有取消按钮直接关的路），只能设完或者明确说「算了」——
 * 随手划走的话人会以为已经改好了。
 * ------------------------------------------------------------------ */

export function RecoverySheet() {
  const t = useT()
  const { recovering } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!recovering) return null

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await setNewPassword(password)
    setBusy(false)
    if (res.ok) {
      setPassword('')
      setDone(true)
    } else {
      setError(res.error)
    }
  }

  return (
    <Sheet
      open
      onClose={() => {
        /* 划走当放弃，但要留下痕迹：不然人会以为密码已经改好了 */
        cancelRecovery()
      }}
      title={t('设置新密码', 'Set a new password')}
    >
      <div className="space-y-4">
        {done ? (
          <>
            <p className="text-ink-700 text-label">
              {t(
                '改好了。以后就用这个新密码登录。',
                'Done. Use the new password from now on.',
              )}
            </p>
            <Button variant="primary" size="lg" block onClick={() => cancelRecovery()}>
              {t('知道了', 'Got it')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-ink-700 text-label">
              {t(
                '你是从重设密码的邮件点进来的。现在设一个新密码 —— 这个链接只能用这一次，关掉就得重新发一封。',
                'You came in from the password reset email. Set a new password now — this link works once, so closing this means asking for another email.',
              )}
            </p>

            <Field label={t('新密码', 'New password')} hint={t('至少 6 位', 'At least 6 characters')}>
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && password.length >= 6 && !busy && void submit()
                }
              />
            </Field>

            {error && <p className="text-danger-600 text-label">{error}</p>}

            <Button
              variant="primary"
              size="lg"
              block
              disabled={password.length < 6 || busy}
              onClick={() => void submit()}
            >
              {busy ? t('稍等…', 'Working…') : t('设好了', 'Save it')}
            </Button>

            <button
              className="text-ink-500 block w-full text-center text-caption"
              onClick={() => cancelRecovery()}
            >
              {t('算了，不改了', 'Never mind')}
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}
