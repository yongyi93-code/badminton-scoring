import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Avatar } from '@/components/PlayerBits'
import { Button, Sheet, cx } from '@/components/ui'
import {
  checkFile,
  clearMyPhoto,
  myPhotoPath,
  photoUrl,
  setMyPhoto,
} from '@/lib/photo'
import type { AvatarProfile } from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * 照片头像
 *
 * 两张脸，分工不同（决定见 docs/社交化.md）：
 *
 *   照片     名字旁边那个小圆      「你是谁」
 *   角色     点进个人主页才看到    「你有多强」
 *
 * 所以这个组件只在**社交那几屏**用（好友、私聊、以后的朋友圈）。
 * 球场那一侧（看板、排队、排行榜）照旧用 Avatar 画角色 —— 那里问的
 * 是「这个人球打得怎么样」，一张自拍回答不了。
 *
 * 没设照片的人自动退回 Avatar：角色、或者名字首字的色块。
 * 所以这个组件可以直接替换掉社交屏上的 Avatar，不用每处判断。
 * ------------------------------------------------------------------ */

export function PhotoAvatar({
  url,
  name,
  avatar,
  size = 'md',
  onOpen,
  className,
}: {
  url?: string | null
  name: string
  avatar?: AvatarProfile
  size?: 'sm' | 'md' | 'lg'
  /** 给了就可以点开看大图。没给就是个普通的圆圈 */
  onOpen?: () => void
  className?: string
}) {
  const t = useT()
  const sizes = { sm: 'size-7', md: 'size-10', lg: 'size-16' }
  /*
   * 这张图加载失败过没有。
   *
   * 会失败的情形是真的：桶里那个文件被删了，而 profiles 那一行还指着它
   * （换头像时删旧文件那一步失败过、或者有人从后台清了桶）。不管的话
   * 好友列表上会出现一个碎掉的图标 —— 比没有照片难看得多，
   * 而且人会以为是 App 坏了。
   *
   * 失败就退回 Avatar，和从来没设过照片一模一样。
   */
  const [broken, setBroken] = useState(false)

  if (!url || broken) {
    return <Avatar name={name} avatar={avatar} size={size} className={className} />
  }

  const img = (
    <img
      src={url}
      alt={name}
      onError={() => setBroken(true)}
      /*
       * 懒加载 + 异步解码：好友列表上十几个圆圈，同步解码会让整屏卡一下。
       * 这几个属性是白送的，加了没有代价。
       *
       * shrink-0 不能少：这些圆圈都在 flex 行里，不写的话名字一长
       * 头像就被压扁成椭圆。Avatar 那边一直有这一条，照抄。
       */
      loading="lazy"
      decoding="async"
      className={cx('shrink-0 rounded-full object-cover', sizes[size], className)}
    />
  )

  if (!onOpen) return img
  return (
    <button
      onClick={onOpen}
      aria-label={t(`看 ${name} 的照片`, `View ${name}'s photo`)}
      className="shrink-0"
    >
      {img}
    </button>
  )
}

/** 点开的大图。就一张图加一个关掉 —— 不做缩放和左右翻，那是相册干的事 */
export function PhotoViewer({
  url,
  name,
  onClose,
}: {
  url: string | null
  name: string
  onClose: () => void
}) {
  const t = useT()
  if (!url) return null
  return (
    <button
      onClick={onClose}
      aria-label={t('关掉', 'Close')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <img
        src={url}
        alt={name}
        className="max-h-full max-w-full rounded-card object-contain"
      />
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * 设置自己的照片
 * ------------------------------------------------------------------ */

export function PhotoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const file = useRef<HTMLInputElement>(null)
  const [path, setPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    void myPhotoPath().then((p) => {
      if (alive) setPath(p)
    })
    return () => {
      alive = false
    }
  }, [open])

  const pick = async (f: File) => {
    /*
     * 先判格式和大小，再压。
     * 压一张手机原图要好几秒，而那几秒之后再说「不行」，人已经等过了。
     */
    const bad = checkFile(f)
    if (bad) {
      setError(bad)
      return
    }
    setBusy(true)
    setError(null)
    const r = await setMyPhoto(f)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setPath(r.path)
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    const r = await clearMyPhoto()
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setPath(null)
  }

  const url = photoUrl(path)

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={t('我的照片', 'My photo')}>
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3">
          {url ? (
            <img
              src={url}
              alt={t('我的照片', 'My photo')}
              className="size-28 rounded-full object-cover"
            />
          ) : (
            <div className="bg-fill text-ink-500 flex size-28 items-center justify-center rounded-full text-caption">
              {t('还没设', 'Not set')}
            </div>
          )}
          <p className="text-ink-500 px-2 text-center text-caption">
            {t(
              '这张照片会出现在好友列表和你发的动态旁边。你的换装角色不受影响 —— 它还在个人主页上，代表你打球有多强。',
              'This shows next to your name for friends and on anything you post. Your character is untouched — it still lives on your profile and shows how strong you are.',
            )}
          </p>
        </div>

        {error && (
          <div className="border-danger-600/30 bg-danger-50 rounded-card border p-3.5">
            <p className="text-danger-600 text-label font-medium">{t('没设上', 'Not saved')}</p>
            <p className="text-ink-700 mt-1 text-caption">{error}</p>
          </div>
        )}

        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            /* 清空 value，不然选同一张照片第二次不会触发 change */
            e.target.value = ''
            if (f) void pick(f)
          }}
        />

        <div className="space-y-2">
          <Button block variant="primary" disabled={busy} onClick={() => file.current?.click()}>
            {busy
              ? t('正在处理…', 'Working…')
              : url
                ? t('换一张', 'Change photo')
                : t('选一张照片', 'Choose a photo')}
          </Button>
          {url && (
            <button
              disabled={busy}
              onClick={() => void remove()}
              className="text-ink-500 active:text-danger-600 w-full py-2 text-center text-caption"
            >
              {t('撤掉照片', 'Remove photo')}
            </button>
          )}
        </div>

        {/*
          这两句不是免责声明，是实话，而且第二句是很多人不知道的：
          手机拍的照片里带着拍摄地点的经纬度。
        */}
        <p className="text-ink-500 text-caption">
          {t(
            '照片会在你手机上先压小再上传 —— 顺带把里面的拍摄地点信息（手机照片默认带着经纬度）一起去掉。',
            'Your photo is shrunk on your phone before upload — which also strips the location data your camera embeds in it.',
          )}
        </p>
      </div>
    </Sheet>
  )
}
