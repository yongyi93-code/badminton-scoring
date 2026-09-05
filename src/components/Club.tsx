import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { signOut, useAuth } from '@/store/useAuth'
import { cloudReady } from '@/lib/supabase'
import {
  createAndEnterClub,
  enterClub,
  joinAndEnterClub,
  leaveClub,
  renameClub,
} from '@/lib/sync'
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
  inputClass,
} from '@/components/ui'

/* ------------------------------------------------------------------ *
 * 球群
 *
 * 一个人打开 App，第一件事不是记分，是「我跟谁一起打」。
 * 球群就是这个答案：你的球员、球局、排行榜全都只在这个群里，
 * 别的群看不见你，你也看不见别的群。
 *
 * 加入只有邀请码一条路，没有「搜索附近球群」——
 * 球群本来就是熟人关系，谁该进来是群里的人说了算，不是搜出来的。
 * ------------------------------------------------------------------ */

/**
 * 建群 / 加群那两个表单。
 *
 * 引导页和「我的」里的球群弹层用的是同一份 —— 两处写两遍的话，
 * 迟早有一处的错误提示或者按钮状态跟另一处对不上。
 */
function ClubForms({ onDone }: { onDone?: () => void }) {
  const t = useT()
  const [mode, setMode] = useState<'join' | 'new'>('join')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res =
      mode === 'new' ? await createAndEnterClub(name) : await joinAndEnterClub(code)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setName('')
    setCode('')
    onDone?.()
  }

  const ready = mode === 'new' ? name.trim().length > 0 : code.trim().length >= 4

  return (
    <div className="space-y-4">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'join', label: t('用邀请码加入', 'Join with a code') },
          { value: 'new', label: t('建一个球群', 'Start a club') },
        ]}
      />

      {mode === 'join' ? (
        <Field
          label={t('邀请码', 'Invite code')}
          hint={t(
            '找群里的人要 —— 在他的「我的 → 球群」里。',
            'Ask someone in the club — it is under Me → Club on their phone.',
          )}
        >
          <input
            className={inputClass}
            value={code}
            /*
             * 一律转大写。邀请码本来就是大写的，而手机键盘默认小写 ——
             * 打对了却提示「没有这个球群」，没人猜得到是大小写的事。
             */
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
          />
        </Field>
      ) : (
        <Field
          label={t('球群名字', 'Club name')}
          hint={t(
            '你们平时怎么叫这个球局就怎么写，之后能改。',
            'Whatever you call yourselves. You can change it later.',
          )}
        >
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('周五羽球局', 'Friday badminton')}
            maxLength={20}
          />
        </Field>
      )}

      {error && <p className="text-danger-600 text-label">{error}</p>}

      <Button block variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
        {busy
          ? t('请稍等…', 'One moment…')
          : mode === 'new'
            ? t('建群', 'Create')
            : t('加入', 'Join')}
      </Button>
    </div>
  )
}

/**
 * 还没进任何球群时挡在最前面的一屏。
 *
 * 为什么是挡住整个 App 而不是提示一下：没有群的时候，记的分推不上去
 * （数据库那边不收没有群的行），排行榜是空的，开的局别人也看不见。
 * 让人先玩起来再告诉他「刚才那些都没存」，比一开始就拦住难受得多。
 */
export function ClubGate() {
  const t = useT()
  return (
    <Screen>
      <Body className="pt-16">
        <div className="text-center">
          <div className="text-5xl">🏸</div>
          <h1 className="mt-4 text-xl font-semibold">
            {t('先进一个球群', 'Join a club first')}
          </h1>
          <p className="text-ink-500 mx-auto mt-2 max-w-sm text-label">
            {t(
              '你的球员、球局和排行榜都属于某一个球群。球友已经在用了就跟他要邀请码；你是第一个，就建一个群，再把码发给他们。',
              'Your players, sessions and rankings all live inside a club. If your friends already use RALLY, ask them for the invite code — if you are first, start one and send them the code.',
            )}
          </p>
        </div>
        <Card>
          <ClubForms />
        </Card>
        {/*
          登错账号的人不能被锁在这一屏上。这里是整个 App 唯一能点的
          地方，退出登录的入口就得在这里 —— 别的入口都在被挡住的那半边。
        */}
        <button
          onClick={() => void signOut()}
          className="text-ink-500 active:text-ink-900 w-full py-2 text-center text-caption"
        >
          {t('退出登录', 'Sign out')}
        </button>
      </Body>
    </Screen>
  )
}

/**
 * 什么时候该挡。
 *
 * 三个条件缺一不可：
 *   接了云端  —— 没接云端时数据本来就只在这台手机上，没有群这个概念
 *   登录了    —— 没登录时该看到的是「先登录」，不是「先进群」
 *   问过云端  —— 「还没问」和「问过了，一个群都没有」在数据上长得一样，
 *                分不出来的话每次冷启动都会先闪一下这一屏
 */
export function useClubGate(): boolean {
  const { session } = useAuth()
  const clubId = useApp((s) => s.clubId)
  const checked = useApp((s) => s.clubsChecked)
  return cloudReady && !!session && checked && !clubId
}

/** 邀请码那一行：点一下复制，发给球友 */
function CodeRow({ code }: { code: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /*
       * 复制失败不提示错误。码就明明白白印在旁边，照着念、照着打一样
       * 能用 —— 为一个「复制」按钮弹一句红字，反而像是这个码有问题。
       */
    }
  }

  return (
    <div className="border-line flex items-center justify-between rounded-xl border px-3.5 py-3">
      <div>
        <p className="text-ink-500 text-caption">{t('邀请码', 'Invite code')}</p>
        <p className="font-mono text-lg font-semibold tracking-[0.2em]">{code}</p>
      </div>
      <Button size="sm" variant="soft" onClick={() => void copy()}>
        {copied ? t('复制好了', 'Copied') : t('复制', 'Copy')}
      </Button>
    </div>
  )
}

/**
 * 「我的」里的球群弹层：当前是哪个群、邀请码、切换、退出、再加一个。
 */
export function ClubSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const clubs = useApp((s) => s.clubs)
  const clubId = useApp((s) => s.clubId)
  const current = clubs.find((c) => c.id === clubId)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  /** 「加入或新建」那两个表单默认收着，进来的人多半只是要拿邀请码 */
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')

  const rename = async () => {
    if (!clubId) return
    setBusy(true)
    const res = await renameClub(clubId, draft)
    setBusy(false)
    if (!res.ok) {
      setNote(res.error)
      return
    }
    setRenaming(false)
  }

  const switchTo = async (id: string) => {
    setBusy(true)
    await enterClub(id)
    setBusy(false)
    onClose()
  }

  const leave = async () => {
    if (!clubId) return
    setBusy(true)
    const res = await leaveClub(clubId)
    setBusy(false)
    setConfirmLeave(false)
    if (!res.ok) {
      setNote(res.error)
      return
    }
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('球群', 'Club')}>
      <div className="space-y-5">
        {current ? (
          <div className="space-y-3">
            <div>
              <p className="text-ink-500 text-caption">{t('当前球群', 'Current club')}</p>
              {renaming ? (
                <div className="mt-1 flex gap-2">
                  <input
                    className={inputClass}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={20}
                    autoFocus
                  />
                  <Button
                    variant="primary"
                    disabled={busy || draft.trim().length === 0}
                    onClick={() => void rename()}
                  >
                    {t('改', 'Save')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-title">{current.name}</p>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      setDraft(current.name)
                      setRenaming(true)
                    }}
                  >
                    {t('改名', 'Rename')}
                  </Button>
                </div>
              )}
            </div>
            <CodeRow code={current.code} />
            <p className="text-ink-500 text-caption">
              {t(
                '把这个码发给球友，他在这里输一次就进来了。',
                'Send this code to a friend — they type it in here once and they are in.',
              )}
            </p>
          </div>
        ) : (
          <p className="text-ink-500 text-label">
            {t('还没进任何球群。', 'You are not in a club yet.')}
          </p>
        )}

        {/* 在好几个群里的人才需要这一段（一个球局一个群，人是会串场的） */}
        {clubs.length > 1 && (
          <div className="space-y-2">
            <SectionTitle>{t('换一个群', 'Switch club')}</SectionTitle>
            <div className="border-line divide-line divide-y overflow-hidden rounded-card border">
              {clubs.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => void (c.id === clubId ? onClose() : switchTo(c.id))}
                  className="active:bg-fill flex w-full items-center justify-between px-3.5 py-3 text-left"
                >
                  <span className="text-label">{c.name}</span>
                  {c.id === clubId ? (
                    <span className="text-brand-600 text-caption">
                      {t('在这里', 'Here')}
                    </span>
                  ) : (
                    <span className="text-ink-500 text-caption">
                      {t('切过去', 'Switch')}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-ink-500 text-caption">
              {t(
                '切过去会重新拉那个群的数据，本机这一份不会丢 —— 它在云端。',
                'Switching re-downloads that club’s data. Nothing is lost — it all lives in the cloud.',
              )}
            </p>
          </div>
        )}

        {/*
          加入 / 新建那两个表单默认收起来。

          进这个弹层十次有九次是来拿邀请码的 —— 那件事该一眼看见。
          再加一个群是偶尔才做一次的事，值不上占半屏。
        */}
        <div className="space-y-2">
          {adding ? (
            <>
              <SectionTitle>{t('加入或新建', 'Join or start another')}</SectionTitle>
              <ClubForms onDone={onClose} />
              <button
                onClick={() => setAdding(false)}
                className="text-ink-500 w-full py-1 text-center text-caption"
              >
                {t('收起', 'Never mind')}
              </button>
            </>
          ) : (
            <Button block variant="soft" onClick={() => setAdding(true)}>
              {t('加入或新建一个球群', 'Join or start another club')}
            </Button>
          )}
        </div>

        {current && (
          <div className="space-y-2">
            {confirmLeave ? (
              <>
                <p className="text-label">
                  {t(
                    `退出「${current.name}」？这台手机上就看不到这个群的球员和战绩了。群里的数据一点都不会少，之后拿邀请码还能再进来。`,
                    `Leave “${current.name}”? This phone will stop showing its players and records. Nothing is deleted — the invite code gets you back in.`,
                  )}
                </p>
                <div className="flex gap-2">
                  <Button block variant="soft" onClick={() => setConfirmLeave(false)}>
                    {t('算了', 'Never mind')}
                  </Button>
                  <Button block variant="danger" disabled={busy} onClick={() => void leave()}>
                    {t('退出球群', 'Leave')}
                  </Button>
                </div>
              </>
            ) : (
              /* 退群做成一行小字，不做成按钮 —— 它和上面那个「加入或新建」
                 长得一样重的话，两个都会被当成主要操作，而这个是最不该
                 顺手点到的一个 */
              <button
                disabled={busy}
                onClick={() => setConfirmLeave(true)}
                className="text-ink-500 active:text-danger-600 w-full py-2 text-center text-caption"
              >
                {t('退出这个球群', 'Leave this club')}
              </button>
            )}
          </div>
        )}
      </div>
      <Toast message={note} tone="error" onClose={() => setNote(null)} />
    </Sheet>
  )
}
