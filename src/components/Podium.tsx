import { Avatar } from '@/components/PlayerBits'
import { cx } from '@/components/ui'
import type { AvatarProfile } from '@/lib/avatar'

/* ------------------------------------------------------------------ *
 * 领奖台
 *
 * 前三名单独站出来。名次这件事，第一眼要看到的是「谁在最上面」，
 * 不是「第 17 名是谁」—— 一条从上往下的列表把这两件事压成同一个
 * 动作，谁都得从头读。
 *
 * 两处在用：全体排名（按 MMR）和球馆榜（按胜率）。口径不一样，
 * 所以副标题由调用方给；台子长什么样是同一件事，就别画两遍 ——
 * 画两遍的结果上次已经发生过了：一边是奖牌，一边是皇冠。
 * ------------------------------------------------------------------ */

export type PodiumEntry = {
  id: string
  name: string
  avatar?: AvatarProfile
  /** 名字底下那一行，比如「MMR 120」或者「70% · 20 场」 */
  sub: string
}

/**
 * entries 按名次给：[第一, 第二, 第三]。
 * 不足三个人就不要调 —— 一个人的领奖台看着像在庆祝
 * 「我是这里唯一的人」。
 */
export function Podium({
  entries,
  onPick,
}: {
  entries: PodiumEntry[]
  onPick: (id: string) => void
}) {
  if (entries.length < 3) return null
  /* 摆的顺序是 2-1-3，读的顺序才是「中间最高」 */
  const order: [PodiumEntry, number][] = [
    [entries[1], 2],
    [entries[0], 1],
    [entries[2], 3],
  ]

  return (
    <div className="grid grid-cols-3 items-end gap-2">
      {order.map(([e, place]) => (
        <button
          key={e.id}
          onClick={() => onPick(e.id)}
          className="flex min-w-0 flex-col items-center"
        >
          <span className={place === 1 ? 'text-2xl leading-none' : 'text-lg leading-none'} aria-hidden>
            {place === 1 ? '👑' : place === 2 ? '🥈' : '🥉'}
          </span>
          <Avatar
            name={e.name}
            avatar={e.avatar}
            playerId={e.id}
            size={place === 1 ? 'lg' : 'md'}
            className="mt-1.5"
          />
          <span className="mt-1.5 w-full truncate text-center text-label font-semibold">
            {e.name}
          </span>
          <span className="tnum text-ink-500 w-full truncate text-center text-caption">
            {e.sub}
          </span>
          {/*
            台子的高度差就是名次，数字写在台子上 ——
            不靠金银铜那三个颜色分辨：强光下的球馆里它们是分不开的。
          */}
          <span
            className={cx(
              'mt-2 flex w-full items-start justify-center rounded-t-xl pt-1.5 text-title',
              place === 1
                ? 'bg-brand-solid text-on-brand h-14'
                : 'bg-brand-100 text-brand-600 h-9',
            )}
          >
            {place}
          </span>
        </button>
      ))}
    </div>
  )
}
