import { useState } from 'react'
import { useLang, useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { inviteUrl, shareText } from '@/lib/invite'
import { formatDate } from '@/lib/format'
import { venueLabel } from '@/lib/venues'
import { Button, Sheet, inputClass } from '@/components/ui'
import type { Session } from '@/types'

/* ------------------------------------------------------------------ *
 * 把球局分享出去
 *
 * 开完局甩一条链接到 WhatsApp 群里，球友点一下就进来 —— 不用先教他
 * 注册、再念一遍邀请码、再告诉他在哪一场。链接里两样都带着。
 * ------------------------------------------------------------------ */

const SHARE = (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
    <path d="M12 3v13M12 3 8 7M12 3l4 4" />
  </svg>
)

export function ShareSessionButton({ session }: { session: Session }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="soft" onClick={() => setOpen(true)}>
        <span className="flex items-center gap-1.5">
          {SHARE}
          {t('分享', 'Share')}
        </span>
      </Button>
      {open && <ShareSheet session={session} onClose={() => setOpen(false)} />}
    </>
  )
}

function ShareSheet({ session, onClose }: { session: Session; onClose: () => void }) {
  const t = useT()
  const { lang } = useLang()
  const players = useApp((s) => s.players)
  const clubs = useApp((s) => s.clubs)
  const clubId = useApp((s) => s.clubId)
  const [copied, setCopied] = useState(false)

  const club = clubs.find((c) => c.id === clubId)
  const host = session.createdBy
    ? players.find((p) => p.id === session.createdBy)?.name
    : undefined

  const url = inviteUrl({ sessionId: session.id, clubCode: club?.code })
  const message = shareText(
    {
      venue: venueLabel(session.venue),
      when: formatDate(session.date),
      host,
      url,
    },
    lang === 'zh',
  )

  /*
   * 优先用系统的分享面板：一按就直接选 WhatsApp 里的哪个群，
   * 比「复制 → 切到 WhatsApp → 找到群 → 粘贴」少三步。
   * 没有这个 API 的（多半是桌面浏览器）退回复制。
   */
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator

  const doShare = async () => {
    try {
      await navigator.share({ text: message })
      onClose()
    } catch {
      /*
       * 用户自己取消了分享面板也会走到这里 —— 分不出「取消」和「失败」，
       * 所以什么都不做：面板关掉，弹层留着，他还能改用复制。
       */
    }
  }

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 复制不了就算了 —— 下面那个框里的字是选得中的，手动复制一样
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('分享这场球局', 'Share this session')}>
      <div className="space-y-4">
        <p className="text-ink-500 text-label">
          {club
            ? t(
                `链接里带着「${club.name}」的邀请码 —— 球友点进去会自动进群，然后落在这场球局上。`,
                `The link carries the invite code for “${club.name}” — tapping it puts them in the club and lands them on this session.`,
              )
            : t(
                '还没进球群，链接只能带到这场球局，别人进不来。先在「我的 → 球群」建一个或加一个。',
                'You are not in a club yet, so the link cannot let anyone in. Start or join one under Me → Club first.',
              )}
        </p>

        <textarea
          readOnly
          className={`${inputClass} h-32 resize-none py-2.5 text-caption`}
          value={message}
          onFocus={(e) => e.currentTarget.select()}
        />

        <div className="space-y-2">
          {canShare && (
            <Button block variant="primary" onClick={() => void doShare()}>
              {t('分享到…', 'Share to…')}
            </Button>
          )}
          <Button block variant={canShare ? 'soft' : 'primary'} onClick={() => void doCopy()}>
            {copied ? t('复制好了', 'Copied') : t('复制这段话', 'Copy the message')}
          </Button>
        </div>

        {/*
          先说清楚，免得有人以为是坏了。
          iPhone 上装成主屏幕图标的网页应用没法接管链接，这是 iOS 的
          限制，不是这个 App 少做了什么 —— 点开会在 Safari 里打开，
          照样能用，只是多顶一条地址栏。
        */}
        <p className="text-ink-500 text-caption">
          {t(
            '安卓上装过 App 的会直接跳进 App；iPhone 上会在 Safari 里打开（苹果不让网页应用接管链接），一样能用。没装过的会先看到怎么装。',
            'On Android the link opens the installed app. On iPhone it opens in Safari — Apple does not let installed web apps take over links — and works the same. People without it get install instructions first.',
          )}
        </p>
      </div>
    </Sheet>
  )
}
