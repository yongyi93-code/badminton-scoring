import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, Field, Sheet, inputClass } from '@/components/ui'
import { changePassword } from '@/store/useAuth'
import { PASSWORD_MIN, checkPasswordChange } from '@/lib/authText'

/* ------------------------------------------------------------------ *
 * 改密码
 *
 * 登录着的人改自己的密码。以前只有「忘记密码」那条路 —— 而那条路要
 * 退出登录、去收信、点链接，为了一件本来一屏就能办完的事。
 *
 * -------------------------------------------------------------------
 * 要填旧密码
 *
 * 不是走过场：Supabase 那边不一定要求旧密码（后台那个开关默认是关的），
 * 也就是说捡到一台没锁屏的手机就能把人家密码改掉。这一层自己验
 * （store/useAuth 的 changePassword），所以不管后台怎么设都拦得住。
 *
 * -------------------------------------------------------------------
 * 新密码要输两遍
 *
 * 这一屏唯一能真正伤到人的错误是**打错了自己不知道**：改成了一个
 * 他以为的密码，下次登录才发现进不去，而那时候已经想不起打错了什么。
 * 多一个格子换掉这个，划算。
 * ------------------------------------------------------------------ */

export function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  /* 关掉就清空：密码不该留在内存里等下一次打开 */
  useEffect(() => {
    if (open) return
    setCurrent('')
    setNext('')
    setAgain('')
    setError(null)
    setDone(false)
  }, [open])

  const submit = async () => {
    const bad = checkPasswordChange({ current, next, again })
    if (bad) {
      setError(bad)
      return
    }
    setBusy(true)
    setError(null)
    const res = await changePassword(current, next)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    /*
     * 改成了之后不直接关掉。
     *
     * 关掉的话人看到的只是弹层消失，和「我点了但没反应」长得一模一样 ——
     * 而这件事他下次登录才验证得了。说一句，让他自己按「好了」。
     */
    setCurrent('')
    setNext('')
    setAgain('')
    setDone(true)
  }

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={t('改密码', 'Change password')}>
      {done ? (
        <div className="space-y-4">
          <p className="text-brand-600 text-label">
            {t('改好了。下次登录用新密码。', 'Done. Use the new password next time you sign in.')}
          </p>
          {/*
            这一句不能省。以为「改了密码别人就被踢出去了」是一个会让人
            放心得太早的误会 —— 而他真正该做的（去那台手机上退出登录）
            没人会替他做。
          */}
          <p className="text-ink-500 text-caption">
            {t(
              '别的手机上已经登录的不会被踢下线。要断掉的话，得去那台手机上自己退出。',
              'Devices already signed in stay signed in. To cut one off, sign out on that device.',
            )}
          </p>
          <Button block variant="soft" onClick={onClose}>
            {t('好了', 'Done')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('现在的密码', 'Current password')}>
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={current}
              disabled={busy}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>

          <Field
            label={t('新密码', 'New password')}
            hint={t(`至少 ${PASSWORD_MIN} 位`, `At least ${PASSWORD_MIN} characters`)}
          >
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={next}
              disabled={busy}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>

          <Field label={t('再输一次新密码', 'New password again')}>
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={again}
              disabled={busy}
              onChange={(e) => setAgain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && void submit()}
            />
          </Field>

          {error && <p className="text-danger-600 text-label">{error}</p>}

          <Button variant="primary" size="lg" block disabled={busy} onClick={() => void submit()}>
            {busy ? t('正在改…', 'Changing…') : t('改密码', 'Change password')}
          </Button>

          <p className="text-ink-500 text-caption">
            {t(
              '想不起现在的密码？关掉这里，用登录那一屏的「忘记密码了？」。',
              'Cannot remember your current password? Close this and use “Forgot password?” on the sign-in screen.',
            )}
          </p>
        </div>
      )}
    </Sheet>
  )
}
