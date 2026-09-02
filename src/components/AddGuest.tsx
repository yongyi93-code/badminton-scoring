import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { Button, Field, Segmented, Sheet, inputClass } from '@/components/ui'
import type { Gender } from '@/types'

/* ------------------------------------------------------------------ *
 * 加一个没装 App 的人
 *
 * 球员库拿掉之后，装了 App 的人各自注册、各自建自己、自己加入球局，
 * 没有人需要「翻一遍所有人」。但一晚上总有一两个临时来的客人 ——
 * 不给这条路，那场球就记不了分。
 *
 * 关键是「以前来过的」那一段：不给它，每周都会新建一个同名的人，
 * 他的 MMR 每次从零开始，球馆排行也会挂着一串重名的影子。
 * 这不是把球员库偷偷放回来 —— 这里只有无主的客人（装了 App 的人
 * 有自己的账号，永远不会出现在这），而且只在开局这一步出现。
 * ------------------------------------------------------------------ */

export function AddGuest({
  open,
  onClose,
  exclude,
  onPick,
}: {
  open: boolean
  onClose: () => void
  /** 已经在这场里的人，别再列出来 */
  exclude: string[]
  onPick: (playerId: string) => void
}) {
  const t = useT()
  const players = useApp((s) => s.players)
  const matches = useApp((s) => s.matches)
  const addPlayer = useApp((s) => s.addPlayer)
  const [name, setName] = useState('')
  const [gender, setGender] = useState<Gender>('-')

  /** 无主 = 没人用账号认领过 = 没装 App 的客人 */
  const guests = useMemo(() => {
    const lastSeen = new Map<string, number>()
    for (const m of matches) {
      const at = m.endedAt ?? m.startedAt ?? 0
      for (const id of [...m.teamA, ...m.teamB]) {
        if (at > (lastSeen.get(id) ?? 0)) lastSeen.set(id, at)
      }
    }
    return players
      .filter((p) => !p.archived && !p.ownerId && !exclude.includes(p.id))
      .sort(
        (a, b) =>
          (lastSeen.get(b.id) ?? 0) - (lastSeen.get(a.id) ?? 0) ||
          b.createdAt - a.createdAt,
      )
  }, [players, matches, exclude])

  const trimmed = name.trim()
  /* 重名的客人分不出谁是谁，挡在这里 —— 加完才发现有两个阿明就晚了 */
  const dupe = guests.some((p) => p.name === trimmed)

  function create() {
    if (!trimmed || dupe) return
    onPick(addPlayer(trimmed, gender).id)
    setName('')
    setGender('-')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('加一个人', 'Add someone')}>
      <div className="space-y-4">
        <p className="text-ink-500 text-caption">
          {t(
            '装了 App 的球友自己就能加进来 —— 这里加的是没装的：临时来的客人、不想装的老球友。',
            'People with the app join by themselves. Add someone here only if they do not have it — a guest, or a regular who would rather not install it.',
          )}
        </p>

        <Field label={t('名字', 'Name')}>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('例如 阿明', 'e.g. Alvin')}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </Field>
        {dupe && (
          <p className="text-warning-600 text-caption">
            {t(
              '已经有一个同名的客人了 —— 在下面点他，别再建一个，不然战绩会分成两份',
              'A guest with that name already exists — tap them below instead, or their record gets split in two',
            )}
          </p>
        )}

        <Field
          label={t('性别', 'Gender')}
          hint={t('混双排场要用；不填也能打，只是排混双时会跳过他', 'Used for mixed doubles; leave it blank and mixed rounds skip them')}
        >
          <Segmented
            value={gender}
            onChange={setGender}
            options={[
              { value: 'M', label: t('男', 'Male') },
              { value: 'F', label: t('女', 'Female') },
              { value: '-', label: t('不填', 'Skip') },
            ]}
          />
        </Field>

        <Button variant="primary" block onClick={create} disabled={!trimmed || dupe}>
          {t('加进来', 'Add')}
        </Button>

        {guests.length > 0 && (
          <div className="border-line border-t pt-4">
            <p className="text-ink-500 mb-2 text-label">
              {t('以前来过的', 'Been here before')}
            </p>
            <div className="max-h-[40vh] space-y-2 overflow-y-auto">
              {guests.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onPick(p.id)
                    onClose()
                  }}
                  className="border-line hover:bg-fill flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left"
                >
                  <span className="truncate font-semibold">{p.name}</span>
                  <span className="text-brand-600 shrink-0 text-label">
                    {t('加进来', 'Add')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
