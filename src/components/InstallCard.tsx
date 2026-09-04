import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, Card, Sheet } from '@/components/ui'
import {
  hideInstall,
  installHidden,
  promptInstall,
  useInstallHow,
  type InstallHow,
} from '@/lib/install'

/* ------------------------------------------------------------------ *
 * 「装到手机上」的引导
 *
 * 不装的话这就只是个网页：没有桌面图标，每次要翻浏览器历史才找得回来，
 * iOS 上还收不到开局提醒。而浏览器自己几乎不会告诉人这件事 ——
 * 所以得我们说，并且要按他现在用什么打开的来说。
 *
 * 一个原则：能一键装的就别讲步骤，只能手动的才画步骤。
 * ------------------------------------------------------------------ */

/** iOS 的分享图标。系统里就是这个样子，画出来比写「点分享」好认得多 */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3v12M12 3 8.5 6.5M12 3l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 10.5H5.5A1.5 1.5 0 0 0 4 12v7a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-7a1.5 1.5 0 0 0-1.5-1.5H17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 「添加到主屏幕」那一行左边的加号方块 */
function PlusSquare({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** 一步。左边一个图标或序号，右边一句话 */
function Step({ n, icon, children }: { n: number; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="bg-fill text-ink-700 flex size-9 shrink-0 items-center justify-center rounded-xl">
        {icon ?? <span className="text-sm font-semibold">{n}</span>}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug">{children}</span>
    </li>
  )
}

/** 每种情况说什么。标题、一句话、以及（要手动时）画出来的步骤 */
function Guide({ how }: { how: InstallHow }) {
  const t = useT()

  if (how === 'ios-safari') {
    return (
      <>
        <p className="text-ink-500 text-sm">
          {t(
            'iPhone 上装 App 要自己点两下，Safari 不给网页代劳。跟着做，十秒：',
            'On iPhone this takes two taps — Safari does not let a page do it for you. Ten seconds:',
          )}
        </p>
        <ol className="mt-4 space-y-3">
          <Step n={1} icon={<ShareIcon className="size-5" />}>
            {t(
              '点屏幕最下面那排中间的「分享」',
              'Tap Share — the middle icon in the bar at the bottom',
            )}
          </Step>
          <Step n={2} icon={<PlusSquare className="size-5" />}>
            {t(
              '往下滑，找到「添加到主屏幕」',
              'Scroll down and pick “Add to Home Screen”',
            )}
          </Step>
          <Step n={3}>
            {t('右上角「添加」，桌面上就有 RALLY 了', 'Tap “Add” — RALLY lands on your home screen')}
          </Step>
        </ol>
      </>
    )
  }

  if (how === 'ios-other') {
    return (
      <>
        <p className="text-ink-500 text-sm">
          {t(
            'iPhone 上只有 Safari 装得成 —— 别的浏览器加出来的是个书签，打开还是带地址栏，也收不到开局提醒。',
            'On iPhone only Safari can install it. Other browsers make a bookmark that still has an address bar and gets no session alerts.',
          )}
        </p>
        <ol className="mt-4 space-y-3">
          <Step n={1}>{t('复制这一页的网址', 'Copy this page’s address')}</Step>
          <Step n={2}>{t('打开 Safari，粘进去', 'Open Safari and paste it')}</Step>
          <Step n={3}>
            {t('然后「分享 → 添加到主屏幕」', 'Then Share → Add to Home Screen')}
          </Step>
        </ol>
      </>
    )
  }

  if (how === 'in-app') {
    return (
      <>
        <p className="text-ink-500 text-sm">
          {t(
            '你现在是从别的 App 里打开这一页的（WhatsApp、FB 之类）。那种内置浏览器装不了 App —— 得先用手机自己的浏览器打开。',
            'You opened this inside another app (WhatsApp, Facebook…). Those built-in browsers cannot install it — open it in your phone’s own browser first.',
          )}
        </p>
        <ol className="mt-4 space-y-3">
          <Step n={1}>
            {t(
              '点右上角的「⋯」或「⋮」',
              'Tap the “⋯” or “⋮” in the top corner',
            )}
          </Step>
          <Step n={2}>
            {t(
              '选「在浏览器中打开」/「Open in browser」',
              'Choose “Open in browser”',
            )}
          </Step>
          <Step n={3}>
            {t('在那边再回到这一页，就能装了', 'Come back to this page there, and you can install')}
          </Step>
        </ol>
      </>
    )
  }

  /* manual：支持但没拿到事件（有些浏览器要先访问几次才给） */
  return (
    <>
      <p className="text-ink-500 text-sm">
        {t(
          '这个浏览器可以装，但要自己从菜单里点。',
          'This browser can install it, but you have to pick it from the menu.',
        )}
      </p>
      <ol className="mt-4 space-y-3">
        <Step n={1}>{t('点浏览器右上角的菜单', 'Open the browser menu')}</Step>
        <Step n={2}>
          {t(
            '找「安装应用」或「添加到主屏幕」',
            'Look for “Install app” or “Add to Home screen”',
          )}
        </Step>
      </ol>
    </>
  )
}

/**
 * 首页顶上那张卡。装好了、或者他划掉过，就整块不出现。
 */
export function InstallCard() {
  const t = useT()
  const how = useInstallHow()
  const [hidden, setHidden] = useState(installHidden)
  const [sheet, setSheet] = useState(false)

  if (how === 'installed' || hidden) return null

  const dismiss = () => {
    hideInstall()
    setHidden(true)
  }

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-title">{t('把 RALLY 装到手机上', 'Put RALLY on your phone')}</p>
            <p className="text-ink-500 mt-0.5 text-caption">
              {t(
                '桌面上一个图标点开就用，还能收开局提醒',
                'One tap from your home screen, and you get session alerts',
              )}
            </p>
          </div>
          {/*
            「以后再说」做得比「安装」轻。想装的人一眼看到主按钮，
            不想装的人也不用满卡片找关掉的地方。
          */}
          <button
            onClick={dismiss}
            className="text-ink-500 shrink-0 text-caption underline decoration-line underline-offset-4"
          >
            {t('以后再说', 'Later')}
          </button>
        </div>
        <Button
          block
          variant="primary"
          className="mt-3"
          onClick={async () => {
            /*
             * 能一键装就直接装，不给他看步骤 —— 讲得再清楚也不如少两步。
             * 装成了这张卡自己会消失（display-mode 变了，useInstallHow 会重算）。
             * 他点了「取消」也不追问，安静收起来。
             */
            if (how === 'prompt') {
              const ok = await promptInstall()
              if (!ok) dismiss()
              return
            }
            setSheet(true)
          }}
        >
          {how === 'prompt' ? t('安装', 'Install') : t('怎么装？', 'How?')}
        </Button>
      </Card>

      <Sheet open={sheet} onClose={() => setSheet(false)} title={t('装到手机上', 'Install RALLY')}>
        <Guide how={how} />
      </Sheet>
    </>
  )
}

/**
 * 单独的说明弹层，给「我的」里那个长期入口用。
 *
 * 首页那张卡能划掉，划掉不等于永远不想装 —— 所以要有第二个入口。
 * 能一键装的时候这里也照样一键装，不让人白读一遍步骤。
 */
export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const how = useInstallHow()

  return (
    <Sheet open={open} onClose={onClose} title={t('装到手机上', 'Install RALLY')}>
      {how === 'prompt' ? (
        <>
          <p className="text-ink-500 text-sm">
            {t(
              '这个浏览器可以直接装，点一下就好。',
              'This browser can install it directly — one tap.',
            )}
          </p>
          <Button
            block
            variant="primary"
            className="mt-4"
            onClick={async () => {
              await promptInstall()
              onClose()
            }}
          >
            {t('安装', 'Install')}
          </Button>
        </>
      ) : (
        <Guide how={how} />
      )}
    </Sheet>
  )
}
