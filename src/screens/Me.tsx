import { LANG_LABELS, type Lang, useLang, useT } from '@/lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { avatarOf, playerMap, useApp } from '@/store/useApp'
import type { Gender } from '@/types'
import { useNav } from '@/store/useNav'
import { socialBadge, useSocial } from '@/store/useSocial'
import {
  Body,
  Button,
  Card,
  Field,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  Toast,
  cx,
  inputClass,
} from '@/components/ui'
import {
  IconAppeal,
  IconBell,
  IconCalendar,
  IconCamera,
  IconCard,
  IconChart,
  IconChat,
  IconCloudAlert,
  IconDoc,
  IconFlag,
  IconFriends,
  IconInbox,
  IconGlobe,
  IconInstall,
  IconKey,
  IconLock,
  IconMoments,
  IconMoon,
  IconRoster,
  IconShield,
  IconShuttle,
  IconTrash,
  IconTrophy,
} from '@/components/icons'
import { Avatar } from '@/components/PlayerBits'
import { RankChip } from '@/components/RankMedal'
import { AvatarView } from '@/components/Avatar'
import { stageOf } from '@/lib/avatarArt'
import { progressOf } from '@/lib/avatar'
import { computeStats, decidedMatches, sideOf } from '@/lib/ranking'
import { formatDate, percent, streakLabel } from '@/lib/format'
import { venueLabel } from '@/lib/venues'
import { BUILD_ID, buildStamp, forceUpdate } from '@/lib/update'
import { useTheme } from '@/store/useTheme'
import { cloudReady, defaultClubCode } from '@/lib/supabase'
import { resendConfirm, sendPasswordReset, signIn, signOut, signUp, useAuth } from '@/store/useAuth'
import {
  disablePush,
  enablePush,
  initPush,
  isStandalone,
  pushConfigured,
  swStatus,
  usePushState,
  watchLangForPush,
} from '@/lib/push'
import { pullAll, pushAll, useSyncStatus } from '@/lib/sync'
import { InstallSheet } from '@/components/InstallCard'
import { ClubSheet } from '@/components/Club'
import { FeedbackSheet } from '@/components/FeedbackSheet'
import { DeleteAccountSheet } from '@/components/DeleteAccount'
import { PhotoSheet } from '@/components/Photo'
import { PasswordSheet } from '@/components/PasswordSheet'
import { PhoneAuth } from '@/components/PhoneAuth'
import { PHONE_AUTH_READY } from '@/lib/phone'
import { BanNotice, useMyBan } from '@/components/BanNotice'
import { useInstallHow } from '@/lib/install'

const ARROW = (
  <svg viewBox="0 0 24 24" className="text-ink-300 size-5 shrink-0" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
)

/* ------------------------------------------------------------------ *
 * 登录 / 注册
 *
 * 同一个弹层两用，靠一个 Segmented 切 —— 分成两屏的话，
 * 「我到底注册过没有」这个最常见的困惑还得让人自己退出去重选。
 * ------------------------------------------------------------------ */

function AuthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const push = useNav((s) => s.push)
  /*
   * 先选用什么进来：手机号还是邮箱。
   *
   * 手机号摆在前面、并且是默认 —— 这条路本来就是为「连邮箱都嫌麻烦」
   * 的人加的，把它放第二个等于白加。
   */
  const [way, setWay] = useState<'phone' | 'email'>(PHONE_AUTH_READY ? 'phone' : 'email')
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  /** 重设邮件发出去之后显示的那句话 */
  const [sent, setSent] = useState<string | null>(null)
  /**
   * 卡在「去邮箱点一下链接」这一步的那个地址。
   *
   * 有值的时候底下会多一个「重发」按钮 —— 那是这一整块里最常按的
   * 那个键：进了垃圾箱、发信被限流、邮箱打错了，三种都表现成
   * 「我没收到」。
   */
  const [pending, setPending] = useState<string | null>(null)
  /**
   * 注册成功了，现在**只剩一件事**：去邮箱点那个链接。
   *
   * 有这个状态是因为少了它那一屏在说假话：注册完表单原样留在那儿，
   * 邮箱、密码框、「注册并登录」全都还在，密码框还是空的 ——
   * 看起来就像「还要再填一次密码才算完」。其实这一屏已经没他的事了。
   *
   * 它和 pending 不是一回事：登录时被「邮箱还没验证」挡回来也会设
   * pending（为了给「重发」按钮），但那时候表单**必须留着** ——
   * 他点完链接回来就是要在这儿登录的。
   */
  const [parked, setParked] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    setSent(null)
    setPending(null)
    setParked(false)

    if (mode === 'forgot') {
      const res = await sendPasswordReset(email)
      setBusy(false)
      if (res.ok) {
        setSent(
          t(
            '邮件发出去了。去收件箱点那个链接，会跳回 RALLY 让你设新密码。找不到就翻一下垃圾邮件。',
            'Sent. Open the link in your inbox — it comes back to RALLY and lets you set a new password. Check your spam folder if it is not there.',
          ),
        )
      } else {
        setError(res.error)
      }
      return
    }

    const run = mode === 'in' ? signIn : signUp
    const res = await run(email, password)
    setBusy(false)
    if (res.ok) {
      setPassword('')
      /*
       * 注册成功但还要验证邮箱：**不关弹层**。
       *
       * 关掉的话人只看到弹层消失、却没登录进去，下一秒他会再点一次
       * 「注册」，然后撞上「这个邮箱已经注册过了」—— 彻底卡在门口。
       * 留在这儿，把那句话和「重发」按钮一起摆在他眼前。
       */
      if (res.confirm) {
        setPending(res.confirm)
        setParked(true)
        setSent(
          t(
            `注册好了。我们往 ${res.confirm} 发了一封验证邮件 —— 去邮箱点开里面那个链接就能用了。这一屏不用再填什么。找不到就翻一下垃圾邮件。`,
            `You are signed up. We sent a verification email to ${res.confirm} — open the link in it and you are in. Nothing more to fill in here. Check your spam folder if it is not there.`,
          ),
        )
        return
      }
      onClose()
      return
    }
    /*
     * 这个邮箱已经有人用了。
     *
     * 不画红字：他没做错什么，只是走错了门 —— 直接把他挪到「登录」，
     * 邮箱留着，密码清掉。写成报错的话，一个本来一步就能进来的人
     * 会以为注册失败，然后换个邮箱再注册一个账号 —— 而他的战绩在旧那个里。
     */
    if (res.already) {
      setMode('in')
      setPassword('')
      setSent(res.error)
      return
    }
    setError(res.error)
    /* 登录被挡是因为没验证邮箱 —— 顺手把「重发」摆出来 */
    if (res.unconfirmed) setPending(email.trim())
  }

  /**
   * 从「去邮箱点链接」那一屏退回表单。
   *
   * 两个出口都要有：点完链接回来的（去登录）、和邮箱打错了的（重新注册）。
   * 少了后者，一个把地址打错一个字母的人就只能关掉整个弹层重来 ——
   * 而他关掉之后第一反应是再点一次「注册」，又回到同一屏。
   */
  const leaveParked = (next: 'in' | 'up') => {
    setParked(false)
    setPending(null)
    setSent(null)
    setError(null)
    setPassword('')
    setMode(next)
    /* 换一个邮箱：旧的那个清掉，不然他会以为只要改一改就行 */
    if (next === 'up') setEmail('')
  }

  const resend = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    const res = await resendConfirm(pending)
    setBusy(false)
    if (res.ok) {
      setSent(
        t(
          `又发了一封到 ${pending}。还是没有的话，多半是邮箱地址打错了 —— 换一个再注册一次。`,
          `Sent another one to ${pending}. Still nothing? The address is probably wrong — sign up again with a different one.`,
        ),
      )
    } else {
      setError(res.error)
    }
  }

  const ready =
    mode === 'forgot'
      ? email.trim().length > 3
      : email.trim().length > 3 && password.length >= 6

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        way === 'phone'
          ? t('用手机号进来', 'Continue with phone')
          : mode === 'forgot'
            ? t('忘记密码', 'Forgot password')
            : mode === 'in'
              ? t('登录', 'Sign in')
              : t('注册', 'Create an account')
      }
    >
      <div className="space-y-4">
        {/* ------------------------------------------------------------ *
          手机号 / 邮箱。

          忘记密码那一档不显示这一条：那时候人正在一条很窄的路上走，
          半路给他一个岔口只会让他走丢。
        * ------------------------------------------------------------ */}
        {PHONE_AUTH_READY && mode !== 'forgot' && (
          <Segmented
            value={way}
            onChange={(v: 'phone' | 'email') => {
              setWay(v)
              setError(null)
              setSent(null)
              setPending(null)
              setParked(false)
            }}
            options={[
              { value: 'phone', label: t('手机号', 'Phone') },
              { value: 'email', label: t('邮箱', 'Email') },
            ]}
          />
        )}

        {way === 'phone' ? (
          <PhoneAuth onDone={onClose} />
        ) : parked ? (
          /* ------------------------------------------------------------ *
            注册完了，只剩「去邮箱点一下」这一件事。

            所以整张表单让位。留着的话，一个空的密码框加一个灰掉的
            「注册并登录」摆在眼前 —— 人会以为还要在这儿再填一次密码
            才算注册成功，而其实这一屏已经没他的事了。
          * ------------------------------------------------------------ */
          <>
            {sent && <p className="text-brand-600 text-label">{sent}</p>}
            {error && <p className="text-danger-600 text-label">{error}</p>}

            {pending && (
              <Button variant="soft" block disabled={busy} onClick={() => void resend()}>
                {t('没收到？再发一封', 'Did not get it? Send again')}
              </Button>
            )}

            {/*
              点完链接多半会自己跳回 App 并登录好 —— 这个按钮是给
              「在电脑上点的链接」那种人留的退路。
            */}
            <Button variant="primary" size="lg" block onClick={() => leaveParked('in')}>
              {t('点好了，去登录', 'Done — sign in')}
            </Button>

            <button
              className="text-ink-500 block w-full text-center text-caption"
              onClick={() => leaveParked('up')}
            >
              {t('邮箱打错了？换一个重新注册', 'Wrong email? Sign up with another')}
            </button>
          </>
        ) : (
        <>
        {mode !== 'forgot' && (
          <Segmented
            value={mode}
            onChange={(v: 'in' | 'up') => {
              setMode(v)
              setError(null)
              setSent(null)
              /* 换一边就把「重发」收起来：它认的是上一次填的那个邮箱 */
              setPending(null)
            }}
            options={[
              { value: 'in', label: t('登录', 'Sign in') },
              { value: 'up', label: t('注册', 'Sign up') },
            ]}
          />
        )}

        {mode === 'forgot' && (
          <p className="text-ink-700 text-label">
            {t(
              '填注册时用的邮箱，我们发一个链接过去。点开会跳回 RALLY，在那里设新密码。',
              'Enter the email you signed up with. We send a link that comes back to RALLY, where you set a new password.',
            )}
          </p>
        )}

        <Field label={t('邮箱', 'Email')}>
          <input
            className={inputClass}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        {mode !== 'forgot' && (
        <Field
          label={t('密码', 'Password')}
          hint={mode === 'up' ? t('至少 6 位', 'At least 6 characters') : undefined}
        >
          <input
            className={inputClass}
            type="password"
            /* 注册和登录用不同的 autocomplete，密码管理器才知道是存还是填 */
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ready && !busy && void submit()}
          />
        </Field>
        )}

        {error && <p className="text-danger-600 text-label">{error}</p>}
        {sent && <p className="text-brand-600 text-label">{sent}</p>}

        {/*
          「重发」。摆在提示底下、主按钮上面 —— 卡在这一步的人下一个
          动作十有八九就是它，不该让他去别处找。

          写成 soft 不是 primary：主按钮还是「注册 / 登录」，
          重发是补救，不是这一屏要人做的事。
        */}
        {pending && (
          <Button variant="soft" block disabled={busy} onClick={() => void resend()}>
            {t('没收到？再发一封', 'Did not get it? Send again')}
          </Button>
        )}

        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          {busy
            ? t('稍等…', 'Working…')
            : mode === 'forgot'
              ? t('发重设邮件', 'Send reset link')
              : mode === 'in'
                ? t('登录', 'Sign in')
                : t('注册并登录', 'Create account')}
        </Button>

        {/*
          注册那一档才写这一句。登录的人早就同意过了，
          每次登录再问一遍是走形式。

          做成一行字而不是一个必勾的方框：勾选框会让人机械地点掉，
          而这一行下面就是两个真的点得开的链接。想看的看得到，
          不想看的也已经被告知了。
        */}
        {mode === 'up' && (
          <p className="text-ink-500 text-caption">
            {t('点「注册并登录」就表示你同意 ', 'By creating an account you agree to the ')}
            <button
              className="text-brand-600 underline underline-offset-4"
              onClick={() => {
                onClose()
                push({ name: 'legal', tab: 'terms' })
              }}
            >
              {t('服务条款', 'Terms of Service')}
            </button>
            {t(' 和 ', ' and ')}
            <button
              className="text-brand-600 underline underline-offset-4"
              onClick={() => {
                onClose()
                push({ name: 'legal', tab: 'privacy' })
              }}
            >
              {t('隐私政策', 'Privacy Policy')}
            </button>
            {t('。', '.')}
          </p>
        )}

        {/* 忘记密码的入口只在登录那一档出现 —— 注册时问这个没有意义 */}
        {mode === 'in' && (
          <button
            className="text-brand-600 block w-full text-center text-caption"
            onClick={() => {
              setMode('forgot')
              setError(null)
              setSent(null)
            }}
          >
            {t('忘记密码了？', 'Forgot your password?')}
          </button>
        )}
        {mode === 'forgot' && (
          <button
            className="text-ink-500 block w-full text-center text-caption"
            onClick={() => {
              setMode('in')
              setError(null)
              setSent(null)
            }}
          >
            {t('想起来了，回去登录', 'Never mind — back to sign in')}
          </button>
        )}

        <p className="text-ink-500 text-caption">
          {t(
            '密码只用来登录同步，和球局数据没关系。忘了密码可以换个邮箱重新注册，本机数据不会丢。',
            'This password is only for syncing. Forget it and you can sign up with another email — nothing on this phone is lost.',
          )}
        </p>
        </>
        )}
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ *
 * 云同步
 *
 * 云端为准：那张表是唯一的一份历史，这台手机是它的缓存。
 * 所以这一屏不再是「上传 / 下载」两个方向让人选。
 *
 * 而且它现在是一屏「出事了才进得来」的工具：平时同步自己跑，
 * 「我的」上根本不会出现入口。摆一个「同步状态」在那，只会让人
 * 点进来，然后对着「手动推送」「从云端刷新」发愣 —— 那两个按钮
 * 是卡住时才用的，不是日常功能。
 *
 * 「全部清空」整个拿掉了：它会顺着同步把云端一起清空，也就是把
 * 所有人的战绩一起抹掉 —— 这种按钮不该放在任何人点得到的地方。
 * 真要重来，去 Supabase 后台跑一句 SQL。
 * ------------------------------------------------------------------ */

function CloudSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const players = useApp((s) => s.players)
  const sessions = useApp((s) => s.sessions)
  const matches = useApp((s) => s.matches)
  const status = useSyncStatus()
  const { session } = useAuth()
  const [busy, setBusy] = useState<'pull' | 'push' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const local = t(
    `${players.length} 位球员 · ${sessions.length} 场球局 · ${matches.length} 场比赛`,
    `${players.length} players · ${sessions.length} sessions · ${matches.length} matches`,
  )

  const line =
    status.state === 'syncing'
      ? t('同步中…', 'Syncing…')
      : status.state === 'error'
        ? status.message
        : status.state === 'idle'
          ? status.pending > 0
            ? t(`还有 ${status.pending} 条没推上去`, `${status.pending} changes still to push`)
            : t('已经和云端一致', 'Up to date with the cloud')
          : t('没在同步', 'Not syncing')

  const doPull = async () => {
    setMessage(null)
    setBusy('pull')
    const res = await pullAll()
    setBusy(null)
    if (!res.ok) setMessage(res.error)
    else if (res.empty)
      setMessage(t('云端还是空的', 'The cloud is still empty'))
    else setMessage(t('已经从云端刷新', 'Refreshed from the cloud'))
  }

  const doPush = async () => {
    setMessage(null)
    setBusy('push')
    const res = await pushAll()
    setBusy(null)
    setMessage(
      res.ok
        ? t(`已推上去 ${res.count} 条`, `Pushed ${res.count} rows`)
        : res.error,
    )
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('登录', 'Sign in')}>
      <div className="space-y-4">
        <div className="bg-fill rounded-xl px-4 py-3">
          <p className="font-semibold">{local}</p>
          {/*
            登录没登录得摆在最显眼的地方。同步出问题时第一个要问的就是
            这个 —— 之前排查一次卡了很久，就是因为界面上看不出来。
          */}
          <p className="text-ink-500 mt-1 text-caption">
            {session
              ? t(`已登录：${session.user.email ?? ''}`, `Signed in: ${session.user.email ?? ''}`)
              : session === null
                ? t('没登录 —— 云端不认这台手机', 'Not signed in — the cloud does not know this phone')
                : t('正在确认登录状态…', 'Checking sign-in…')}
          </p>
          <p
            className={
              status.state === 'error'
                ? 'text-danger-600 mt-1 text-caption'
                : 'text-ink-500 mt-1 text-caption'
            }
          >
            {line}
          </p>
        </div>

        <p className="text-ink-500 text-caption">
          {t(
            '平时不用管它：记完分自己就推上去了，别人记的分也会自己出现。下面两个是卡住时才用的。',
            'It runs on its own — your scores go up and other people’s come down. The two below are only for when it gets stuck.',
          )}
        </p>

        <div className="space-y-2">
          <Button block variant="soft" disabled={busy !== null} onClick={() => void doPull()}>
            {busy === 'pull' ? t('刷新中…', 'Refreshing…') : t('从云端刷新一次', 'Refresh from the cloud')}
          </Button>
          <Button block variant="soft" disabled={busy !== null} onClick={() => void doPush()}>
            {busy === 'push' ? t('推送中…', 'Pushing…') : t('把这台手机的推上去', 'Push this phone up')}
          </Button>
        </div>

        {message && <p className="text-brand-600 text-label">{message}</p>}

      </div>
    </Sheet>
  )
}

/* 图标块的六种底色。成对取，见 index.css 里那一段 */
const TILES = {
  green: 'bg-tile-green text-tile-green-ink',
  blue: 'bg-tile-blue text-tile-blue-ink',
  violet: 'bg-tile-violet text-tile-violet-ink',
  amber: 'bg-tile-amber text-tile-amber-ink',
  rose: 'bg-tile-rose text-tile-rose-ink',
  slate: 'bg-tile-slate text-tile-slate-ink',
} as const

type Tile = keyof typeof TILES

/**
 * 菜单里的一行。
 *
 * -------------------------------------------------------------------
 * 每行左边一个图标
 *
 * 原来这一屏是一整列纯文字，二十行长得一模一样，找入口只能一行行读。
 * 加了图标之后，第二次进来找的是「那个橙色的奖杯」——
 * 认图形和颜色比认字快得多，这也是微信、Telegram、Line 这些
 * 设置页全都这么排的原因。
 *
 * -------------------------------------------------------------------
 * 副标题只留「现在怎么样」，不留「这是什么」
 *
 * 原来几乎每一行底下都挂一句解释，结果一行有两行高，一屏塞不下几条，
 * 而那些解释看过一次就不必再看了 —— 它们天天占着地方，
 * 却只在第一次有用。
 *
 * 所以留下来的只有会变的那种：几条没读、都处理完了、同步出问题了、
 * 登录用的哪个邮箱。这些是**状态**，每次进来都得看一眼。
 * 剩下的解释交给图标和标题。
 */
function MenuRow({
  icon,
  tile = 'slate',
  title,
  hint,
  right,
  onClick,
  danger,
}: {
  icon?: ReactNode
  tile?: Tile
  title: string
  /** 只写会变的状态，别写「这是什么」—— 见上面那段 */
  hint?: string
  right?: ReactNode
  onClick?: () => void
  danger?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className="border-line bg-surface flex w-full items-center gap-3 border-b px-4 py-2.5 text-left last:border-b-0 active:bg-fill"
    >
      {icon && (
        <span
          className={cx(
            'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
            /* 危险的那几行（注销账号）不按分类给色，一律红 —— 那是警告，不是分类 */
            danger ? TILES.rose : TILES[tile],
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 py-1">
        <span className={danger ? 'text-danger-600 block' : 'block'}>{title}</span>
        {hint && <span className="text-ink-500 mt-0.5 block text-caption">{hint}</span>}
      </span>
      {right ?? (onClick ? ARROW : null)}
    </Tag>
  )
}

export function Me() {
  const t = useT()
  const { lang, setLang } = useLang()
  const { players, sessions, matches, avatars, meId } = useApp()
  const setMeId = useApp((s) => s.setMeId)
  const push = useNav((s) => s.push)
  const { theme, setTheme } = useTheme()
  const social = useSocial()
  /* 未读私信 + 没处理的好友申请，合起来一个数 */
  const badge = socialBadge(social)
  /* 我自己被封了没有。没被封是 null，那时这一块整个不出现 */
  const { ban: myBan } = useMyBan()
  const openReports = social.openReports
  const openFeedback = social.openFeedback
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackDone, setFeedbackDone] = useState<string | null>(null)
  const [feedbackErr, setFeedbackErr] = useState<string | null>(null)

  const [picking, setPicking] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  /** 已经装了就是 'installed'，那一行不用出现 */
  const installHow = useInstallHow() === 'installed' ? null : true
  const [selfName, setSelfName] = useState('')
  const [selfGender, setSelfGender] = useState<Gender>('-')
  const addPlayer = useApp((s) => s.addPlayer)
  const claimPlayer = useApp((s) => s.claimPlayer)
  const updatePlayer = useApp((s) => s.updatePlayer)
  const setAvatarSex = useApp((s) => s.setAvatarSex)
  const [authOpen, setAuthOpen] = useState(false)
  const [cloudOpen, setCloudOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [clubOpen, setClubOpen] = useState(false)
  const clubs = useApp((s) => s.clubs)
  const clubId = useApp((s) => s.clubId)
  const club = clubs.find((c) => c.id === clubId)
  const sync = useSyncStatus()
  const syncHint =
    sync.state === 'syncing'
      ? t('同步中…', 'Syncing…')
      : sync.state === 'error'
        ? sync.message
        : sync.state === 'idle' && sync.pending > 0
          ? t(`还有 ${sync.pending} 条没推上去`, `${sync.pending} still to push`)
          : t('已经和云端一致', 'Up to date')
  /*
   * 出事了才把那一行摆出来。
   * 「同步中」不算出事 —— 那是一闪而过的正常状态，为它冒出一行
   * 再消失，只会让人以为出了什么问题。
   */
  const needsAttention =
    sync.state === 'error' || (sync.state === 'idle' && sync.pending > 0)
  const { session } = useAuth()
  /*
   * 能不能换头像。
   *
   * 照片长在**账号**上（profiles 那张表按 uid），不在球员行上 ——
   * 所以没接云端、或者没登录，换了也存不住。那两种情况下头像
   * 不给点，角上那个相机点也不出现。
   */
  const canEditPhoto = cloudReady && !!session
  /** 登录账号 id。没登录就是 null，那时选人只是本机标记 */
  const uid = session?.user.id ?? null

  /*
   * 接了云端、但还没登录 —— 这时候不该让人建角色。
   *
   * 没接云端（.env 里没配）是另一回事：那种模式下数据本来就只在这台
   * 手机上，本机建角色是唯一的用法，照旧放行。离线可用是底线。
   */
  const mustSignIn = cloudReady && !session
  const pushState = usePushState()
  const [pushBusy, setPushBusy] = useState(false)
  const [pushNote, setPushNote] = useState<string | null>(null)
  /* 退出登录失败时的说明。message 那个只画在备份弹层里，退出时看不见 */
  const [signOutNote, setSignOutNote] = useState<string | null>(null)
  useEffect(() => {
    void initPush()
    /* 切语言时把通知的语言也报上去 —— 挂一次，之后自己跟着 */
    watchLangForPush()
  }, [])
  const [updating, setUpdating] = useState(false)

  const names = useMemo(() => playerMap(players), [players])
  const me = meId ? names.get(meId) : undefined

  /*
   * 注册完直接把名字问了，不用自己去找「建一个你自己」。
   *
   * 时机是这里唯一要小心的事：必须等云端拉完（state === 'idle'）再问。
   * 拉之前本机是空的，老用户在新手机上登录，头几秒看起来也像「还没有
   * 角色」—— 这时候弹出来，他就会再建一个自己，于是排行榜上出现两个
   * 同名的人。之前踩过这个坑，是同一个原因。
   *
   * 'error' 也不问：拉失败时我们根本不知道云端有没有他。
   *
   * 只问一次。人要是关掉了，那是他的选择，不该每次切回这一屏又弹一遍
   * —— 入口一直在下面那张卡上。
   */
  const [autoAsked, setAutoAsked] = useState(false)
  useEffect(() => {
    if (autoAsked || me || !uid) return
    if (sync.state !== 'idle') return
    setAutoAsked(true)
    setPicking(true)
  }, [autoAsked, me, uid, sync.state])

  const progress = useMemo(
    () => (me ? progressOf(me.id, matches) : null),
    [me, matches],
  )
  const stats = useMemo(
    () => (me ? computeStats(matches, [me.id])[0] : null),
    [me, matches],
  )
  const mine = useMemo(
    () => (me ? decidedMatches(matches).filter((m) => sideOf(m, me.id) !== null) : []),
    [me, matches],
  )
  const avatar = me ? avatarOf(avatars, me.id) : undefined

  /* 本月战绩 —— 规格 §K 要的「本月概览」 */
  const thisMonth = useMemo(() => {
    const key = new Date().toISOString().slice(0, 7)
    const ids = new Set(
      sessions.filter((s) => s.date.startsWith(key)).map((s) => s.id),
    )
    const ms = mine.filter((m) => ids.has(m.sessionId))
    if (!me) return { games: 0, wins: 0 }
    const wins = ms.filter((m) => {
      const side = sideOf(m, me.id)
      const a = m.games.reduce((n, g) => n + (g.a > g.b ? 1 : 0), 0)
      const b = m.games.length - a
      return side === 'A' ? a > b : b > a
    }).length
    return { games: ms.length, wins }
  }, [mine, sessions, me])

  const recent = useMemo(
    () =>
      sessions
        .filter((s) => (me ? s.playerIds.includes(me.id) : false))
        .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))
        .slice(0, 3),
    [sessions, me],
  )

  const streak = stats ? streakLabel(stats.streak) : ''

  return (
    <Screen tabBar>
      <header className="safe-top px-5 pb-3">
        <h1 className="text-h1">{t('我的', 'Me')}</h1>
      </header>

      <Body>
        {/*
          被封了的话，这是这一屏上最该先看到的东西 —— 摆在最上面。
          不摆的话人只会发现「怎么发不出消息」，然后以为 App 坏了，
          一遍遍重试。原因、期限、申诉都在这张卡上。
        */}
        {myBan && <BanNotice ban={myBan} />}

        {me && progress && stats ? (
          <>
            {/* ---------------------------------------------------------- *
              名片那一张。

              原来是两张白卡：上面一张头像加三个数字，下面一张换装角色。
              两张都是白底白框，跟底下那一长串菜单一个质感 —— 整屏没有
              一处是「这是你」，从上到下一样平。

              改成一张，顶上压一条球场绿。社交 App 的个人页几乎都这么做
              （Instagram、Strava、Discord 都是一条色带加一个压在上面的
              头像）：那条色带不是装饰，它是这一屏唯一的「主角在这里」。

              用 court 这个色而不是别的：它在这套配色里就是「那片真的场地」，
              深浅两套主题都是同一个深绿，压白字 7.9:1。整个 App 也就
              记分板和这里敢铺这么大一块。

              换装角色并进来当同一张卡的下半截 —— 它是这个 App 唯一的
              养成线，值当挨着名字，而不是另起一张卡排在下面。
            * ---------------------------------------------------------- */}
            <div className="border-line rounded-card shadow-card overflow-hidden border">
              <div className="bg-court text-on-court px-4 pt-4 pb-3">
                <div className="flex items-center gap-3.5">
                  {/* -------------------------------------------------- *
                    点头像就能换照片。

                    换照片这件事原来只在「我的名片」里，藏在账号那一组
                    往下翻好几屏 —— 而人要换头像时第一反应是**去点那张
                    头像**，微信、IG、LINE 全是这个手势。

                    光能点还不够：看不见的入口等于没有。所以角上压一个
                    相机小圆点，那是「这里可以动」唯一的说法。

                    没登录就不给点，也不给那个点 —— 照片是长在账号上的，
                    没账号存不住。摆一个点下去只会说「先登录」的入口，
                    比不摆更气人。

                    外面那一圈半透明白是另一件事：深绿底上不套的话，
                    深色的头像照片会跟底糊在一起，看不出边。
                  * -------------------------------------------------- */}
                  {canEditPhoto ? (
                    <button
                      onClick={() => setPhotoOpen(true)}
                      aria-label={t('换头像', 'Change photo')}
                      className="relative shrink-0 rounded-full p-[3px] ring-2 ring-white/25 active:ring-white/50"
                    >
                      <Avatar name={me.name} avatar={avatar} playerId={me.id} size="lg" />
                      <span className="bg-accent text-on-accent ring-court absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-full ring-2">
                        <IconCamera className="size-3.5" />
                      </span>
                    </button>
                  ) : (
                    <span className="shrink-0 rounded-full p-[3px] ring-2 ring-white/25">
                      <Avatar name={me.name} avatar={avatar} playerId={me.id} size="lg" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-h2">{me.name}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <RankChip level={progress.level} onDark />
                      <span className="tnum rounded-full bg-white/16 px-2 py-0.5 text-xs">
                        MMR {progress.mmr}
                      </span>
                      {streak && (
                        <span className="rounded-full bg-white/16 px-2 py-0.5 text-xs">
                          {streak}
                        </span>
                      )}
                    </div>
                  </div>
                  {/*
                    深绿上不能用 tertiary：那个是 brand-600 的字，
                    深绿压深绿等于没有。这里自己写一个半透明白的。
                  */}
                  <button
                    onClick={() => {
                      setSelfName(me.name)
                      setSelfGender(me.gender)
                      setPicking(true)
                    }}
                    className="shrink-0 self-start rounded-full bg-white/16 px-3 py-1 text-caption active:bg-white/28"
                  >
                    {t('改名字', 'Edit')}
                  </button>
                </div>

                <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-white/18 pt-3 text-center">
                  <div>
                    <p className="tnum text-h2">{thisMonth.games}</p>
                    <p className="text-caption text-white/70">{t('本月场次', 'This month')}</p>
                  </div>
                  <div>
                    <p className="tnum text-h2">{thisMonth.wins}</p>
                    <p className="text-caption text-white/70">{t('本月胜场', 'Wins')}</p>
                  </div>
                  <div>
                    <p className="tnum text-h2">{percent(stats.winRate)}</p>
                    <p className="text-caption text-white/70">{t('总胜率', 'Win rate')}</p>
                  </div>
                </div>
              </div>

              {/*
                角色换装。规格里整份都没提这一块，但它是 App 里唯一的
                养成线 —— 赢球赚金币、金币换装备、装备穿在身上给别人看。
              */}
              <button
                onClick={() => push({ name: 'avatar', playerId: me.id })}
                className="bg-surface active:bg-fill flex w-full items-center gap-3.5 px-4 py-3 text-left"
              >
                <span className="bg-fill size-14 shrink-0 overflow-hidden rounded-2xl">
                  {avatar ? (
                    <AvatarView
                      sex={avatar.sex}
                      skin={avatar.skin}
                      equipped={avatar.equipped}
                      stage={stageOf(progress.level)}
                      className="h-full w-full"
                      title={me.name}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-2xl">
                      👤
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-title">{t('我的 Avatar', 'My Avatar')}</span>
                  <span className="text-ink-500 mt-0.5 block text-label">
                    {avatar
                      ? t(`${progress.coins} 金币可花`, `${progress.coins} coins to spend`)
                      : t('还没建角色，去挑一个', 'No character yet — pick one')}
                  </span>
                </span>
                {ARROW}
              </button>
            </div>

            {/*
              好友和私聊。放在战绩上面，因为它是唯一一处「别人在等我」——
              有人加了我、有人跟我说了话，这两件事往下压一屏就等于没有。
              badge 里的数字是未读私信 + 没处理的好友申请，合起来一个数：
              两个小红点摆在一起，人只会数不清到底有几件事。
            */}
            <SectionTitle>{t('好友', 'Friends')}</SectionTitle>
            <div className="border-line rounded-card overflow-hidden border">
              <MenuRow
                icon={<IconFriends />}
                tile="blue"
                title={t('好友与私聊', 'Friends and chat')}
                hint={badge > 0 ? t(`${badge} 条新的`, `${badge} new`) : undefined}
                right={
                  badge > 0 ? (
                    <span className="bg-brand-solid text-on-brand tnum flex size-6 shrink-0 items-center justify-center rounded-full text-caption">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : undefined
                }
                onClick={() => push({ name: 'friends' })}
              />
              {/*
                朋友圈。摆在「好友与私聊」下面，因为它是好友的事 ——
                只有好友看得到，同一个球群但没加好友的人也看不到。
                这一句留着：它是「谁看得见我发的东西」，看一百次也还是要紧。
              */}
              <MenuRow
                icon={<IconMoments />}
                tile="violet"
                title={t('朋友圈', 'Moments')}
                hint={t('只有好友看得到', 'Friends only')}
                onClick={() => push({ name: 'moments' })}
              />
            </div>

            {/* ---------------------------------------------------------- *
              管理那几行，从「好友」里拆出来单独一组。

              原来它们跟好友、朋友圈挤在同一张卡里，一连七行 ——
              而这两拨事根本不是一回事：一边是「我跟球友」，
              一边是「我替这个群收拾东西」。混在一起的结果是，
              普通人每次都要从一堆管理入口里找自己的朋友圈。

              整组只有管理员看得见。真正把门的是数据库那边的策略，
              不是这个判断 —— 这里只管别让人看见点不动的东西。
            * ---------------------------------------------------------- */}
            {social.isAdmin && (
              <>
                <SectionTitle>{t('管理', 'Admin')}</SectionTitle>
                <div className="border-line rounded-card overflow-hidden border">
                  <MenuRow
                    icon={<IconAppeal />}
                    tile="rose"
                    title={t('申诉', 'Appeals')}
                    onClick={() => push({ name: 'appeals' })}
                  />
                  <MenuRow
                    icon={<IconFlag />}
                    tile="rose"
                    title={t('举报队列', 'Reports')}
                    hint={
                      openReports > 0
                        ? t(`${openReports} 条等你看`, `${openReports} waiting for you`)
                        : t('都处理完了', 'All clear')
                    }
                    right={
                      openReports > 0 ? (
                        <span className="bg-danger-600 tnum flex size-6 shrink-0 items-center justify-center rounded-full text-caption text-white">
                          {openReports > 99 ? '99+' : openReports}
                        </span>
                      ) : undefined
                    }
                    onClick={() => push({ name: 'reports' })}
                  />
                  {/*
                    球群成员。

                    这一屏上的东西（名字、打过几场）别处本来也看得到 ——
                    所以这一道不是保密，是不让「整个群的名册」成为
                    随手一点就摊开的一屏。入口和屏本身都挡：只藏入口的话，
                    从别处跳进去照样看得到。
                  */}
                  <MenuRow
                    icon={<IconRoster />}
                    tile="slate"
                    title={t('球群成员', 'Club roster')}
                    onClick={() => push({ name: 'roster' })}
                  />
                  {/* 管理员名单只有 owner 看得见 —— 普通管理员看见一个改不动的入口，只会以为是坏了 */}
                  {social.isOwner && (
                    <MenuRow
                      icon={<IconShield />}
                      tile="violet"
                      title={t('管理员', 'Admins')}
                      onClick={() => push({ name: 'admins' })}
                    />
                  )}
                  <MenuRow
                    icon={<IconInbox />}
                    tile="amber"
                    title={t('反馈与报错', 'Feedback and crashes')}
                    hint={
                      openFeedback > 0
                        ? t(`${openFeedback} 条没看`, `${openFeedback} unread`)
                        : t('都看完了', 'All caught up')
                    }
                    right={
                      openFeedback > 0 ? (
                        <span className="bg-brand-solid text-on-brand tnum flex size-6 shrink-0 items-center justify-center rounded-full text-caption">
                          {openFeedback > 99 ? '99+' : openFeedback}
                        </span>
                      ) : undefined
                    }
                    onClick={() => push({ name: 'feedback' })}
                  />
                </div>
              </>
            )}

            {/* ---------------------------------------------------------- *
              比赛和战绩摆在一起：两样都是「我打得怎么样」。
              比赛在上，因为它有时限（今天要办的），战绩什么时候看都行。

              比赛入口给所有人，不只管理员：办比赛的不一定是球群管理员，
              而且这一套东西根本不碰球群的数据。
            * ---------------------------------------------------------- */}
            <SectionTitle>{t('比赛与战绩', 'Play')}</SectionTitle>
            <div className="border-line rounded-card overflow-hidden border">
              <MenuRow
                icon={<IconTrophy />}
                tile="amber"
                title={t('淘汰赛赛表', 'Knockout brackets')}
                onClick={() => push({ name: 'tournaments' })}
              />
              <MenuRow
                icon={<IconChart />}
                tile="green"
                title={t('完整战绩与对手分析', 'Full record and head-to-heads')}
                hint={t(
                  `${stats.games} 场 · ${stats.wins} 胜 ${stats.losses} 负`,
                  `${stats.games} played · ${stats.wins}W ${stats.losses}L`,
                )}
                onClick={() => push({ name: 'profile', playerId: me.id })}
              />
            </div>

            {recent.length > 0 && (
              <>
                <SectionTitle>{t('最近球局', 'Recent sessions')}</SectionTitle>
                <div className="border-line rounded-card overflow-hidden border">
                  {recent.map((s) => (
                    <MenuRow
                      key={s.id}
                      icon={<IconCalendar />}
                      tile={s.status === 'active' ? 'green' : 'slate'}
                      title={venueLabel(s.venue)}
                      hint={`${formatDate(s.date)} · ${
                        s.status === 'active' ? t('进行中', 'Live') : t('已结束', 'Finished')
                      }`}
                      onClick={() =>
                        push(
                          s.status === 'active'
                            ? { name: 'board', sessionId: s.id }
                            : { name: 'summary', sessionId: s.id },
                        )
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : mustSignIn ? (
          /*
           * 接了云端却没登录时，不给建角色。
           *
           * 建出来的人只活在这台手机上：下次登录，云端整份盖下来就把他
           * 冲掉了 —— 名字、角色、金币全没。用户这边看到的是「我明明建过」，
           * 根本不会联想到是登录这一步。
           *
           * 而且「谁建的就是谁的」这条规则要成立，得先知道「谁」是谁。
           * 没登录的时候这个问题没有答案。
           */
          <Card>
            <p className="text-title">{t('先登录', 'Sign in first')}</p>
            <p className="text-ink-500 mt-1 text-label">
              {session === undefined
                ? t('正在确认登录状态…', 'Checking sign-in…')
                : t(
                    '你的角色、战绩和金币都存在云端，换手机也拿得回来。所以得先登录，才知道这个角色是谁的。',
                    'Your character, record and coins live in the cloud so they follow you to a new phone — which means signing in has to come first.',
                  )}
            </p>
            <div className="mt-4">
              <Button
                block
                variant="primary"
                disabled={session === undefined}
                onClick={() => setAuthOpen(true)}
              >
                {t('登录 / 注册', 'Sign in or sign up')}
              </Button>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-title">{t('先建一个你自己', 'Create yourself first')}</p>
            <p className="text-ink-500 mt-1 text-label">
              {/*
                在哪个群里，这里必须说出来。
                同一个人在每个群里是不同的球员记录，所以刚切进一个新群时，
                这一屏就是空的 —— 不点名是哪个群的话，看起来像是数据没了。
                有人因此以为自己丢了全部战绩，实际只是站在另一个群里。
              */}
              {club
                ? t(
                    `你在「${club.name}」这个球群里还没有球员。填个名字就好 —— 每个球群的球员是分开的，你在别的群里的战绩一条都没少。`,
                    `You do not have a player in “${club.name}” yet. Just a name — each club keeps its own players, and your record in other clubs is untouched.`,
                  )
                : t(
                    '填个名字就好。建完这一页会显示你的段位、战绩和角色，开新球局时你也自动在场上。',
                    'Just a name. After that this page shows your rank, record and character, and you are put on court automatically when you start a session.',
                  )}
            </p>
            {/*
              在好几个群里的人，最可能想做的其实是切回去，不是再建一个自己。

              配了默认球群时这个按钮不出现：那种模式下每次同步都会把人
              拨回默认群，按了也会被拨回来 —— 一个点了不起作用的按钮
              比没有这个按钮糟得多。
            */}
            {clubs.length > 1 && !defaultClubCode && (
              <button
                onClick={() => setClubOpen(true)}
                className="text-brand-600 mt-2 text-label font-semibold"
              >
                {t('← 换回别的球群', '← Switch to another club')}
              </button>
            )}
            <div className="mt-4">
              <Button block variant="primary" onClick={() => setPicking(true)}>
                {t('建一个你自己', 'Create yourself')}
              </Button>
            </div>
          </Card>
        )}

        {/*
          球群。

          摆在登录上面：登录是一次性的手续，球群是每天都在用的东西 ——
          邀请码要发给球友，人多了还要换群。
        */}
        {/*
          球群那一节。

          配了默认球群（所有人注册完自动进同一个）之后，这个概念对用的人
          就不存在了 —— 摆一个「球群 · 邀请码 · 换个球群」在这里，
          只会让人问「这是什么，我要不要管」，而正确答案是「不用管」。

          原来的门槛是「在好几个群里才显示」。那个不够：账号上留着一个
          早就不用的旧群（比如那次事故留下的），照样会把这一节顶出来。
          既然自动进群这条路已经保证了「所有人在同一个群」，
          那就干脆按开关来 —— 配了默认球群，这一节整个不出现。

          真被卡在错的群里时还有出路：上面那张「你在这个群里还没有球员」
          的卡片里有「← 换回别的球群」，那条留着没动。
        */}
        {cloudReady && session && club && !defaultClubCode && (
          <>
            <SectionTitle>{t('球群', 'Club')}</SectionTitle>
            <div className="border-line rounded-card overflow-hidden border">
              <MenuRow
                icon={<IconShuttle />}
                tile="green"
                title={club.name}
                hint={t(
                  `邀请码 ${club.code} · 点这里发给球友`,
                  `Invite code ${club.code} · tap to share it`,
                )}
                onClick={() => setClubOpen(true)}
              />
            </div>
          </>
        )}

        {/*
          登录。没接云端（.env 里没配）时整块不显示 ——
          与其摆一个点了没反应的入口，不如干脆不出现。

          这里叫「登录」不叫「云同步」：同步是它顺带做的事，
          用户想的是「我要登入我的账号」。拿实现细节当标题，
          人只会想「我不需要同步啊」然后跳过它 —— 结果换手机就丢档。
        */}
        {cloudReady && (
          <>
            <SectionTitle>{t('账号', 'Account')}</SectionTitle>
            <div className="border-line rounded-card overflow-hidden border">
              {session === undefined ? (
                <MenuRow title={t('正在检查登录状态…', 'Checking sign-in…')} />
              ) : session ? (
                <MenuRow
                  icon={<IconKey />}
                  tile="green"
                  title={t('已登录', 'Signed in')}
                  hint={session.user.email ?? undefined}
                  right={
                    <Button
                      size="sm"
                      variant="soft"
                      onClick={() => {
                        /*
                         * 退出会清掉本机缓存，所以没推上去的东西必须先推完。
                         * 推不动（多半是离线）就不退，把原因说出来 ——
                         * 默默退掉的话，那几场刚记的分就永远找不回来了。
                         */
                        void signOut().then((r) => {
                          if (!r.ok) {
                            setSignOutNote(
                              t(
                                `还有东西没同步上去，先连上网再退出：${r.error}`,
                                `Some changes are not synced yet — get back online before signing out: ${r.error}`,
                              ),
                            )
                          }
                        })
                      }}
                    >
                      {t('退出', 'Sign out')}
                    </Button>
                  }
                />
              ) : (
                <MenuRow
                  icon={<IconKey />}
                  tile="green"
                  title={t('登录', 'Sign in')}
                  hint={t(
                    '换手机也拿得回来',
                    'Get your data back on another phone',
                  )}
                  onClick={() => setAuthOpen(true)}
                />
              )}
              {/*
                同步好好的时候不显示这一行。
                
                同步是背景里的事，正常运转时用户什么都不用知道 ——
                而摆一个「同步状态」在那，只会让人点进去，然后对着
                「手动推送」「从云端刷新」「全部清空」发愣。那三个按钮
                是出事时才用的工具，不是日常功能。
                
                出事了才冒出来：这时候它恰恰是最该被看见的一行。
              */}
              {session && needsAttention && (
                <MenuRow
                  icon={<IconCloudAlert />}
                  tile="amber"
                  title={t('同步遇到问题', 'Sync needs attention')}
                  hint={syncHint}
                  onClick={() => setCloudOpen(true)}
                />
              )}
              {/*
                注销账号。

                摆在「登录」这一组里，而不是设置里 —— 它是账号的事，
                人要找它的时候会先想到「我是在哪儿登录的」。

                做成普通的一行、不做成红色按钮：它不该在这一屏上抢眼，
                真要按的人找得到就够了。所有吓人的话都在点开之后那一屏。
              */}
              {session && (
                <MenuRow
                  icon={<IconCard />}
                  tile="blue"
                  title={t('我的名片', 'My card')}
                  onClick={() => setPhotoOpen(true)}
                />
              )}
              {/*
                改密码。摆在「我的名片」和「注销账号」中间 ——
                这一组从轻到重排：看看自己是谁 → 改个密码 → 删掉账号。
              */}
              {session && (
                <MenuRow
                  icon={<IconLock />}
                  tile="slate"
                  title={t('改密码', 'Change password')}
                  onClick={() => setPwOpen(true)}
                />
              )}
              {/* 图标走红色：这一行是警告，不是分类 */}
              {session && (
                <MenuRow
                  icon={<IconTrash />}
                  danger
                  title={t('注销账号', 'Delete account')}
                  hint={t('永久删除，没法撤销', 'Permanent, cannot be undone')}
                  onClick={() => setDeleteOpen(true)}
                />
              )}
            </div>
            {signOutNote && (
              <p className="text-danger-600 px-1 text-caption">{signOutNote}</p>
            )}
            <p className="text-ink-500 px-1 text-caption">
              {session
                ? syncHint
                : t(
                    '登录之后自动同步：你记的分会推上去，别人记的会自己出现。',
                    'Once signed in it syncs on its own — your scores go up, other people’s come down.',
                  )}
            </p>
          </>
        )}

        <SectionTitle>{t('设置', 'Settings')}</SectionTitle>
        <div className="border-line rounded-card overflow-hidden border">
          <MenuRow
            icon={<IconGlobe />}
            tile="blue"
            title={t('语言', 'Language')}
            right={
              <div className="flex gap-1">
                {(['zh', 'en'] as Lang[]).map((l) => (
                  <Button
                    key={l}
                    size="sm"
                    variant={l === lang ? 'primary' : 'soft'}
                    onClick={() => setLang(l)}
                  >
                    {LANG_LABELS[l]}
                  </Button>
                ))}
              </div>
            }
          />
          {/*
            开局提醒。没配 VAPID 公钥时整行不出现 —— 与其摆一个
            点了永远失败的开关，不如当它不存在。
          */}
          {pushConfigured() && (
            <MenuRow
              icon={<IconBell />}
              tile="amber"
              title={t('开局提醒', 'Session alerts')}
              hint={
                pushNote ??
                (pushState === 'on'
                  ? t('有人开球局时会通知你', 'You get a notification when someone starts a session')
                  : pushState === 'denied'
                    ? t('通知被关掉了，要去手机设置里开', 'Notifications are off — turn them on in your phone settings')
                    : pushState === 'unsupported'
                      ? isStandalone()
                        ? t('这台手机不支持', 'Not supported on this phone')
                        : t('要从主屏幕那个图标打开才能开', 'Open RALLY from the Home Screen icon to turn this on')
                      : t('有人开球局时通知我', 'Tell me when someone starts a session'))
              }
              right={
                <Button
                  size="sm"
                  variant={pushState === 'on' ? 'soft' : 'primary'}
                  disabled={pushBusy || pushState === 'denied' || pushState === 'unsupported'}
                  onClick={() => {
                    setPushNote(null)
                    setPushBusy(true)
                    /*
                      按下去之前先看一眼后台服务的状态。
                      正在装的话当场说出来 —— 那一步要下 3 MB 的离线包，
                      手机数据网络下可能要十几二十秒。不说的话按钮就那样
                      停在「稍等…」，人只会以为又坏了（上一版正是这样）。
                    */
                    void swStatus().then((st) => {
                      if (st === 'installing') {
                        setPushNote(
                          t(
                            '离线包还在下载（大概 3 MB），下完就会打开，别关这一屏。',
                            'The offline bundle is still downloading (about 3 MB) — it will turn on once that finishes. Stay on this screen.',
                          ),
                        )
                      }
                    })
                    const job =
                      pushState === 'on' ? disablePush() : enablePush(meId)
                    /*
                      catch 不是走过场。
                      这里等的是一串浏览器接口（通知权限、Service Worker、
                      推送订阅），任何一环抛出来都会让 then 不执行 ——
                      而 then 里那句 setPushBusy(false) 正是把按钮从
                      「稍等…」放回来的唯一一处。少了 catch，一次异常
                      就是一个永远按不动的开关，而且不说为什么。
                    */
                    void job
                      .then((r) => {
                        /* 成功了要把「正在下载」那句清掉，否则它会一直挂着 */
                        setPushNote(r.ok ? null : r.error)
                      })
                      .catch((e: unknown) => {
                        setPushNote(e instanceof Error ? e.message : String(e))
                      })
                      .finally(() => setPushBusy(false))
                  }}
                >
                  {pushBusy
                    ? t('稍等…', 'Wait…')
                    : pushState === 'on'
                      ? t('关掉', 'Turn off')
                      : t('打开', 'Turn on')}
                </Button>
              }
            />
          )}
          <MenuRow
            icon={<IconMoon />}
            tile="violet"
            title={t('深色模式', 'Dark mode')}
            right={
              <Button
                size="sm"
                variant="soft"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? t('切成浅色', 'Go light') : t('切成深色', 'Go dark')}
              </Button>
            }
          />
          {/*
            首页那张卡能划掉，划掉不等于永远不想装 —— 这里是长期入口。
            已经装了就不显示：那时候说什么都是废话。
          */}
          {installHow !== null && (
            <MenuRow
              icon={<IconInstall />}
              tile="green"
              title={t('装到手机上', 'Put RALLY on your phone')}
              onClick={() => setInstallOpen(true)}
            />
          )}
        </div>

        {/*
          反馈入口。摆在最下面，但是在版本号上面 ——
          撞上问题的人本来就会一路划到底找「这东西该跟谁说」，
          而在这一行之前，他找到底也找不到，只能默默卸载。

          需要登录：一条没法回复、也认不出是谁的反馈，
          查起来等于一张匿名纸条。
        */}
        <div className="border-line rounded-card overflow-hidden border">
          {session && (
            <MenuRow
              icon={<IconChat />}
              tile="blue"
              title={t('说点什么', 'Tell us')}
              hint={t('出问题了、想要个功能', 'Something broken, or something you wish it did')}
              onClick={() => setFeedbackOpen(true)}
            />
          )}
          {/*
            不需要登录也看得到 —— 一个还在犹豫要不要注册的人，
            想先看看你拿他的数据干什么，这很合理。
          */}
          <MenuRow
            icon={<IconDoc />}
            tile="slate"
            title={t('隐私政策与服务条款', 'Privacy and Terms')}
            onClick={() => push({ name: 'legal' })}
          />
        </div>

        {/*
          装成 PWA 之后旧缓存会一直顶着，界面看不出更没更新。
          把版本印出来，再给个一键清缓存的按钮，省得靠反复划掉 App 碰运气。
        */}
        <div className="text-ink-500 flex items-center justify-center gap-3 pt-2 pb-4 text-caption">
          <span className="tnum">
            RALLY {BUILD_ID} · {buildStamp()}
          </span>
          <button
            onClick={() => {
              setUpdating(true)
              void forceUpdate()
            }}
            disabled={updating}
            className="decoration-line underline underline-offset-4 disabled:opacity-60"
          >
            {updating ? t('更新中…', 'Updating…') : t('检查更新', 'Check for updates')}
          </button>
        </div>
      </Body>

      <FeedbackSheet
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onDone={(m) => {
          setFeedbackErr(null)
          setFeedbackDone(m)
        }}
        onError={setFeedbackErr}
      />
      <Toast message={feedbackDone} onClose={() => setFeedbackDone(null)} />
      <Toast message={feedbackErr} tone="error" onClose={() => setFeedbackErr(null)} />

      {/*
        没有「从名单里挑一个」这回事了 —— 谁建的就是谁的。
        
        原来这里列出所有球员让你认领自己，是名册时代的做法：
        那时候是一个人把大家都建好，你再去里面找自己。现在每个人
        自己注册、自己建自己，这份名单就只剩「让你看见别人」这一个
        作用了，而那正是要去掉的东西。
        
        同一张表单也用来改自己的名字 —— 球员库拿掉之后，
        这是全 App 唯一能改自己名字的地方，没有它打错一个字就永远错着。
      */}
      <Sheet
        open={picking}
        onClose={() => setPicking(false)}
        title={me ? t('改我的名字', 'Edit my name') : t('建一个你自己', 'Create yourself')}
      >
        <div className="space-y-4">
          {!me && (
            <p className="text-ink-500 text-caption">
              {t(
                '填你自己的名字，别人在排行榜和对阵表上看到的就是它。建完就是你的，别人认领不走。',
                'Use your own name — this is what everyone sees in rankings and line-ups. Once created it is yours; nobody else can take it.',
              )}
            </p>
          )}
          <Field label={t('你的名字', 'Your name')}>
            <input
              className={inputClass}
              value={selfName}
              onChange={(e) => setSelfName(e.target.value)}
              placeholder={t('例如 阿明', 'e.g. Alvin')}
              autoFocus={!me}
            />
          </Field>
          {/*
            性别必填，没有「不填」这一档。
            它有两个下家：混双排场按它分边，立绘角色按它画男女。
            留一个「不填」等于让人跳过一个后面两处都要的信息 ——
            跳过的人最后还是要回来补，只是那时候他已经忘了在哪补。
          */}
          <Field
            label={t('性别', 'Gender')}
            hint={t('混双排场要用，也决定角色是男是女', 'Used for mixed doubles, and it decides your character')}
          >
            <Segmented
              value={selfGender}
              onChange={setSelfGender}
              options={[
                { value: 'M', label: t('男', 'Male') },
                { value: 'F', label: t('女', 'Female') },
              ]}
            />
          </Field>
          <Button
            variant="primary"
            block
            disabled={!selfName.trim() || selfGender === '-'}
            onClick={() => {
              const name = selfName.trim()
              /* 到这里 selfGender 一定是 M 或 F —— 上面的 disabled 挡住了 '-' */
              const sex = selfGender === 'F' ? 'f' : 'm'
              if (me) {
                updatePlayer(me.id, { name, gender: selfGender })
                /*
                 * 老球员可能还没有立绘（角色是后来加的）。updatePlayer 里
                 * 那段只在「已有角色但性别不一致」时才换，不会补建。
                 */
                setAvatarSex(me.id, sex)
              } else {
                /*
                 * 建之前先看云端是不是已经有「我」了。
                 *
                 * 拉云端要等网络，这几秒里界面显示的是「还没建角色」，
                 * 人很自然就点了建 —— 于是同一个账号建出第二个自己。
                 * 这里认一下就能挡掉：有主的那个才是我，名字按刚填的改。
                 */
                const existing = uid
                  ? players.find((p) => p.ownerId === uid && !p.archived)
                  : undefined
                if (existing) {
                  setMeId(existing.id)
                  updatePlayer(existing.id, { name, gender: selfGender })
                  setAvatarSex(existing.id, sex)
                } else {
                  const created = addPlayer(name, selfGender)
                  // 登录着就把账号写进去：跟着同步出去，别人手机上就知道这个人有主
                  if (uid) claimPlayer(created.id, uid)
                  else setMeId(created.id)
                  /*
                   * 立绘角色一起建好，不用再去「挑一个角色」。
                   * setAvatarSex 在角色不存在时就是「建一个」——
                   * 性别刚填过，这里已经知道该建男还是女。
                   */
                  setAvatarSex(created.id, sex)
                }
              }
              setPicking(false)
            }}
          >
            {me ? t('保存', 'Save') : t('就是我', "That's me")}
          </Button>
        </div>
      </Sheet>

      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />

      <AuthSheet open={authOpen} onClose={() => setAuthOpen(false)} />

      <CloudSheet open={cloudOpen} onClose={() => setCloudOpen(false)} />
      <DeleteAccountSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} />
      <PasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} />
      <PhotoSheet open={photoOpen} onClose={() => setPhotoOpen(false)} />

      <ClubSheet open={clubOpen} onClose={() => setClubOpen(false)} />

    </Screen>
  )
}
