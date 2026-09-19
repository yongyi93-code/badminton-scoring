import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Avatar } from '@/components/PlayerBits'
import { Button, Sheet, cx, inputClass } from '@/components/ui'
import {
  checkFile,
  clearMyPhoto,
  myPhotoPath,
  photoUrl,
  setMyPhoto,
} from '@/lib/photo'
import { NAME_MAX, myCard, setMyName } from '@/lib/profile'
import { refreshCards } from '@/store/useCards'
import type { AvatarProfile } from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * 照片头像
 *
 * 两张脸，分工不同（决定见 docs/社交化.md）：
 *
 *   照片     所有头像那个圆      「你是谁」
 *   角色     点进「我的 Avatar」  「你有多强」
 *
 * 画图那件事已经全部收进 Avatar 了（见 PlayerBits）—— 照片、角色、
 * 名字首字的色块三层退路在那一个组件里，所以不会出现「这屏是照片、
 * 那屏是角色」。
 *
 * 这里只剩两件 Avatar 管不了的：
 *
 *   1. 地址是**调用方给的**。朋友圈和 Story 上的人可能根本不在
 *      这个球群里，名片表按球员查不到他 —— 那边手上只有 uid。
 *   2. 点得开。社交那几屏点头像是看大图，球场那一侧点头像是选人，
 *      两种手势不能混在一个组件里。
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
  /*
   * photo 显式传下去（哪怕是 null），Avatar 就不会再去名片表里查。
   *
   * 这一点是有意的：这几屏上的人不一定在这个球群里，查出来的
   * 多半是空，而更坏的情形是**查到了别人的**（同名的球员行）。
   * 调用方手上那个 uid 才是准的。
   */
  const face = (
    <Avatar
      name={name}
      avatar={avatar}
      photo={url ?? null}
      size={size}
      className={className}
    />
  )

  if (!onOpen) return face
  return (
    <button
      onClick={onOpen}
      aria-label={t(`看 ${name} 的照片`, `View ${name}'s photo`)}
      className="shrink-0"
    >
      {face}
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
 * 我的名片 —— 照片和对外的名字
 *
 * 两样放在一起，因为它们是同一件事：**别人点进你的主页看到的你**。
 * 而且它们在数据库里本来就是同一张表上的两列（profiles）。
 *
 * 名字这一样不明显，但它补的窟窿比照片还老：好友是跨球群的，而名字
 * 一直只长在球群里那条球员记录上 —— 于是一个别的球群的好友，在你的
 * 列表上一直显示「不认识的人」。理由全写在 supabase/023-display-name.sql。
 * ------------------------------------------------------------------ */

export function PhotoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const file = useRef<HTMLInputElement>(null)
  const [path, setPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  /* 打开时是什么样。没变就不写一次数据库 */
  const [savedName, setSavedName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    void myPhotoPath().then((p) => {
      if (alive) setPath(p)
    })
    void myCard().then((c) => {
      if (!alive) return
      setName(c?.name ?? '')
      setSavedName(c?.name ?? '')
    })
    return () => {
      alive = false
    }
  }, [open])

  const saveName = async () => {
    if (name.trim() === savedName.trim()) return
    setBusy(true)
    setError(null)
    const r = await setMyName(name)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setSavedName(name.trim())
    setSaved(true)
    void refreshCards()
  }

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
    /*
     * 让全 App 那份名片表跟着变，别等下次开 App。
     *
     * 头像现在出现在十来屏上（排行榜、看板、等待队列……）——
     * 不刷的话，换完照片退回上一屏看到的还是旧的那张，而人会
     * 以为没换上，于是再换一次。
     */
    void refreshCards()
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
    void refreshCards()
  }

  const url = photoUrl(path)

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={t('我的名片', 'My card')}>
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
              '这张照片会出现在所有有你头像的地方 —— 排行榜、场地看板、等待队列、好友、朋友圈。你的换装角色不受影响，它在「我的 Avatar」那一屏，代表你打球有多强。',
              'This shows everywhere your avatar appears — leaderboards, the court board, the waiting queue, friends and posts. Your character is untouched: it lives under “My Avatar” and shows how strong you are.',
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

        {/* ---------------------------------------------------------- *
          对外的名字。

          只有**别的球群的好友**会看到它 —— 同一个群的人看到的永远是
          你在群里那个名字（那是和比赛记录对得上的那个）。这一句要说
          清楚，不然人会以为改了这里群里也跟着改。
        * ---------------------------------------------------------- */}
        <div className="border-line border-t pt-4">
          <label className="text-label font-medium" htmlFor="rally-display-name">
            {t('别的球群的好友看到的名字', 'Name friends in other clubs see')}
          </label>
          <input
            id="rally-display-name"
            className={cx(inputClass, 'mt-2')}
            value={name}
            maxLength={NAME_MAX}
            disabled={busy}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
            onBlur={() => void saveName()}
            placeholder={t('比如 阿伟', 'e.g. Wei')}
          />
          <p className="text-ink-500 mt-2 text-caption">
            {t(
              '同一个球群的人看到的还是你在群里那个名字 —— 那个和比赛记录对得上，不该由这里改。这一个是给不同群的好友看的：不填的话，他们的列表上你是「不认识的人」。',
              'People in your own club still see your club name — that one matches the match records. This one is for friends in other clubs: leave it blank and you show up as “Unknown” on their list.',
            )}
          </p>
          {saved && (
            <p className="text-brand-600 mt-2 text-caption">{t('名字存好了', 'Name saved')}</p>
          )}
        </div>
      </div>
    </Sheet>
  )
}
