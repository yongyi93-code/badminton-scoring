import { useEffect, useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { refreshSocial, useSocial } from '@/store/useSocial'
import {
  Body,
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  Sheet,
  Toast,
  TopBar,
} from '@/components/ui'
import { Avatar } from '@/components/PlayerBits'
import {
  addAdmin,
  adminLabel,
  fetchAdmins,
  removeAdmin,
  setOwner,
  type AdminRow,
} from '@/lib/admins'

/* ------------------------------------------------------------------ *
 * 管理员名单（只有 owner 进得来）
 *
 * -------------------------------------------------------------------
 * 为什么是从名字里点，不是填邮箱
 *
 * 以前加管理员是到后台跑一句 SQL，按邮箱去找人。栽过一次：
 * 那个邮箱地址看起来对，实际是球群里另一个人的。一个字都不报错，
 * 名单上就多了个不该在的人 —— 而这张名单上的人看得到所有举报，
 * 包括举报里附的那段私聊。
 *
 * 所以这一屏不给填邮箱，也不给填 uid，只给点名字：
 * 从球群成员里点一个人，他的账号 id 跟着人走。
 * 点错了顶多是点错了名字，而名字你认得出来。
 *
 * -------------------------------------------------------------------
 * 加人之前那一屏字要说透
 *
 * 「设为管理员」听起来像个荣誉。实际发生的事是：这个人从此
 * 看得到所有球群的每一条举报和里面的私聊记录。
 *
 * 所以确认那一屏不写「确定吗」，写清楚他会看到什么。
 * 一个人点「确定」的时候应该知道自己在同意什么。
 *
 * -------------------------------------------------------------------
 * 界面挡不住任何人
 *
 * 和举报队列那一屏同一条：真正把门的是数据库的策略。
 * 把 isOwner 改成 true，这一屏打得开，但一行都读不到、也改不动。
 * ------------------------------------------------------------------ */

export function Admins() {
  const t = useT()
  const back = useNav((s) => s.back)
  const social = useSocial()
  const players = useApp((s) => s.players)

  const [rows, setRows] = useState<AdminRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** 正要加的那个人。null = 那一屏没开着 */
  const [picking, setPicking] = useState(false)
  const [about, setAbout] = useState<{ uid: string; name: string } | null>(null)

  /* uid → 名字。名单上存的是账号 id，而人认的是名字 */
  const nameByUid = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of players) if (p.ownerId) m.set(p.ownerId, p.name)
    return m
  }, [players])

  const load = async () => setRows(await fetchAdmins())

  useEffect(() => {
    void load()
  }, [])

  /*
   * 能被加进来的人：球群里装了 App 的（有 ownerId）、还不在名单上的。
   * 没装 App 的人根本没有账号，加不了 —— 不列出来，免得点了才知道。
   */
  const candidates = useMemo(() => {
    const already = new Set((rows ?? []).map((r) => r.uid))
    return players.filter((p) => p.ownerId && !p.archived && !already.has(p.ownerId))
  }, [players, rows])

  const run = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) {
      setErr(r.error)
      return
    }
    setNote(done)
    /* 名单和「我的」那一栏一起刷 —— 去掉自己之后那些入口要跟着消失 */
    await Promise.all([load(), refreshSocial()])
  }

  if (!social.isOwner) {
    return (
      <Screen>
        <TopBar title={t('管理员', 'Admins')} onBack={back} />
        <Body>
          <EmptyState
            icon="🔒"
            title={t('这一屏只有 owner 看得到', 'Owners only')}
            hint={t(
              '真正把门的是数据库那边的规则，不是这一屏。',
              'The database rules are what gate this, not this screen.',
            )}
          />
        </Body>
      </Screen>
    )
  }

  const owners = (rows ?? []).filter((r) => r.owner).length

  return (
    <Screen>
      <TopBar
        title={t('管理员', 'Admins')}
        subtitle={
          rows === null
            ? t('正在拿…', 'Loading…')
            : t(`${rows.length} 个人，其中 ${owners} 个 owner`, `${rows.length} admins · ${owners} owner`)
        }
        onBack={back}
      />
      <Body>
        {/*
          这段话摆在最上面，不折叠。它是这一屏唯一真正要紧的信息 ——
          下面那些按钮怎么按都是小事，加错人不是。
        */}
        <Card className="border-danger-600/30">
          <p className="text-ink-900 text-label font-medium">
            {t('管理员看得到什么', 'What an admin can see')}
          </p>
          <p className="text-ink-700 mt-1 text-caption">
            {t(
              '所有球群的每一条举报，以及举报里附的那段私聊记录。那些话是两个人之间说的，他们没同意给第三个人看。只加你真信得过的人。',
              'Every report from every club, including the private chat attached to it. Those messages were between two people who never agreed to show a third. Only add people you actually trust.',
            )}
          </p>
        </Card>

        {rows === null ? (
          <p className="text-ink-500 text-caption">{t('正在拿…', 'Loading…')}</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const label = adminLabel(r, nameByUid)
              const isMe = r.uid === social.meUid
              return (
                <Card key={r.uid}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-ink-900 text-label font-medium">
                        {label}
                        {isMe && (
                          <span className="text-ink-500 font-normal">{t('（你）', ' (you)')}</span>
                        )}
                      </p>
                      {/* 名单上有、球群里找不到的人。说出来比显示半截 uid 强 */}
                      {!nameByUid.has(r.uid) && (
                        <p className="text-ink-500 text-caption">
                          {t('不在你的球群里', 'Not in your club')}
                        </p>
                      )}
                    </div>
                    <Pill tone={r.owner ? 'brand' : 'neutral'} className="shrink-0">
                      {r.owner ? t('owner', 'owner') : t('管理员', 'admin')}
                    </Pill>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="soft"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => setOwner(r.uid, !r.owner),
                          r.owner
                            ? t(`${label} 不再是 owner`, `${label} is no longer an owner`)
                            : t(`${label} 现在是 owner`, `${label} is now an owner`),
                        )
                      }
                    >
                      {r.owner ? t('收回 owner', 'Remove owner') : t('给 owner', 'Make owner')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => removeAdmin(r.uid),
                          t(`${label} 已经不是管理员了`, `${label} is no longer an admin`),
                        )
                      }
                    >
                      {t('去掉', 'Remove')}
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        <Button variant="soft" block disabled={busy} onClick={() => setPicking(true)}>
          {t('加一个管理员', 'Add an admin')}
        </Button>

        <p className="text-ink-500 text-caption">
          {t(
            'owner 能改这张名单，管理员只能处理举报和看反馈。至少要留一个 owner —— 最后一个去不掉，不然没人能再改这张名单。',
            'Owners manage this list; admins only handle reports and feedback. At least one owner must remain — the last one cannot be removed, or nobody could ever change this list again.',
          )}
        </p>
      </Body>

      {/* 挑人 —— 只从球群里装了 App 的人里挑，不给填邮箱也不给填 id */}
      <Sheet open={picking} onClose={() => setPicking(false)} title={t('加谁', 'Add who')}>
        {candidates.length === 0 ? (
          <EmptyState
            icon="🤷"
            title={t('没有人可以加', 'Nobody to add')}
            hint={t(
              '只能加球群里装了 App 的人 —— 代建的球友没有账号。',
              'Only club members with an account can be added.',
            )}
          />
        ) : (
          <div className="space-y-1">
            {candidates.map((p) => (
              <button
                key={p.id}
                className="hover:bg-fill flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left"
                onClick={() => {
                  setPicking(false)
                  setAbout({ uid: p.ownerId!, name: p.name })
                }}
              >
                <Avatar name={p.name} playerId={p.id} size="sm" />
                <span className="text-ink-900 text-label">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </Sheet>

      {/*
        确认那一屏。不写「确定吗」—— 写清楚他会看到什么。
        一个人点「确定」的时候应该知道自己在同意什么。
      */}
      <Sheet
        open={about !== null}
        onClose={() => setAbout(null)}
        title={t(`把 ${about?.name ?? ''} 设为管理员`, `Make ${about?.name ?? ''} an admin`)}
      >
        <p className="text-ink-700 text-body">
          {t(
            `${about?.name ?? ''} 会看得到所有球群的每一条举报，以及举报里附的那段私聊记录。改不了这张名单 —— 那要 owner 才行。`,
            `${about?.name ?? ''} will be able to see every report from every club, including the private chat attached to each one. They will not be able to change this list — that takes an owner.`,
          )}
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1"
            variant="primary"
            disabled={busy}
            onClick={() => {
              const who = about
              if (!who) return
              setAbout(null)
              void run(
                () => addAdmin(who.uid, who.name),
                t(`${who.name} 现在是管理员了`, `${who.name} is now an admin`),
              )
            }}
          >
            {t('设为管理员', 'Make admin')}
          </Button>
          <Button className="flex-1" variant="soft" onClick={() => setAbout(null)}>
            {t('算了', 'Cancel')}
          </Button>
        </div>
      </Sheet>

      <Toast message={note} onClose={() => setNote(null)} />
      <Toast message={err} tone="error" onClose={() => setErr(null)} />
    </Screen>
  )
}
