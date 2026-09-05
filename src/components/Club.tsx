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
  retryClubs,
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

  /*
   * 这台手机上还剩着多少东西。
   *
   * 建群时要不要把它们带进新群，是个人必须自己回答的问题 ——
   * 代码猜不出来：「我自己先玩了两天」和「我刚被挡在群外面」，
   * 在数据上长得一模一样。猜错一次的代价是把整个球群的战绩
   * 搬进一个新群，原来那个一行不剩。上线当天就发生过。
   */
  const localPlayers = useApp((s) => s.players.length)
  const localMatches = useApp((s) => s.matches.length)
  const hasLocal = localPlayers > 0 || localMatches > 0
  /** 默认不带。带错的后果比不带严重得多，而不带是可以补救的 */
  const [bringLocal, setBringLocal] = useState(false)

  /*
   * 已经在某个群里，又要建新群 —— 这一步必须先说清楚会发生什么。
   *
   * 会发生的是：建完立刻切进新群，而新群是空的。屏幕上的样子
   * （球员没了、排行榜空了、让你重新建一个自己）和「数据全丢了」
   * 一模一样 —— 我自己都被吓到过一次，何况用的人。
   *
   * 数据一条没少，还在原来那个群里。但界面不说，没人猜得到。
   */
  const clubs = useApp((s) => s.clubs)
  const clubId = useApp((s) => s.clubId)
  const currentName = clubs.find((c) => c.id === clubId)?.name
  const [confirmNew, setConfirmNew] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res =
      mode === 'new'
        ? await createAndEnterClub(name, hasLocal && bringLocal)
        : await joinAndEnterClub(code)
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
        onChange={(v) => {
          setMode(v)
          setConfirmNew(false)
        }}
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

      {/*
        本机有数据、又要建新群 —— 这一步必须问清楚。

        不问的后果实测过：整个球群一年的战绩被搬进一个刚建的空群，
        原来的群一行不剩。所以默认不带，而且把「什么时候才该带」
        写在旁边，不让人凭感觉勾。
      */}
      {mode === 'new' && hasLocal && (
        <div className="border-line rounded-xl border p-3.5">
          <p className="text-label">
            {t(
              `这台手机上有 ${localPlayers} 名球员、${localMatches} 场比赛。`,
              `This phone has ${localPlayers} players and ${localMatches} matches on it.`,
            )}
          </p>
          <div className="mt-3">
            <Segmented
              value={bringLocal ? 'yes' : 'no'}
              onChange={(v) => setBringLocal(v === 'yes')}
              options={[
                { value: 'no', label: t('不带过去', 'Leave them') },
                { value: 'yes', label: t('带进新群', 'Bring them') },
              ]}
            />
          </div>
          <p className="text-ink-500 mt-2 text-caption">
            {bringLocal
              ? t(
                  '只有当这些是你自己一个人先记着玩的，才选这个。如果它们是从某个球群同步下来的，带过去等于把那个群的数据复制一份。',
                  'Only if you recorded all of this on your own before joining anyone. If it came from a club, bringing it copies that club’s data.',
                )
              : t(
                  '它们不会丢 —— 还在这台手机上，也还在原来那个球群的云端。',
                  'Nothing is lost — it stays on this phone, and in the cloud of whichever club it came from.',
                )}
          </p>
        </div>
      )}

      {/*
        已经在群里还要建新群 —— 把后果摆出来再让人按。
        「建完会切进一个空群」这件事，不说的话看起来就是数据没了。
      */}
      {mode === 'new' && currentName && (
        <div className="border-warning-600/30 bg-warning-50 rounded-xl border p-3.5">
          <p className="text-label font-semibold">
            {t('建的是一个全新的空球群', 'This starts a brand-new, empty club')}
          </p>
          <p className="text-ink-700 mt-1 text-caption">
            {t(
              `建完会直接进新群，那里一个球员、一场比赛都没有，也会让你重新建一个自己 —— 那是正常的。你在「${currentName}」的球员和战绩一条都不会少，随时从这里切回去。`,
              `You will be taken straight into it — no players, no matches, and it will ask you to create yourself again. That is normal. Everything in “${currentName}” stays untouched, and you can switch back from here any time.`,
            )}
          </p>
        </div>
      )}

      {error && <p className="text-danger-600 text-label">{error}</p>}

      {mode === 'new' && currentName && !confirmNew ? (
        <Button block variant="ghost" disabled={!ready} onClick={() => setConfirmNew(true)}>
          {t('建群', 'Create')}
        </Button>
      ) : (
        <Button block variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
          {busy
            ? t('请稍等…', 'One moment…')
            : mode === 'new'
              ? currentName
                ? t('确定，建一个新的空群', 'Yes, start the empty club')
                : t('建群', 'Create')
              : t('加入', 'Join')}
        </Button>
      )}
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
  /*
   * 本机还留着一整份数据，人却被挡在这一屏 —— 这多半不是「新用户」，
   * 是「本来在某个群里，现在读不到了」。那种时候最不该做的就是建新群。
   */
  const stranded = useApp((s) => s.players.length > 0)
  const failed = useApp((s) => s.clubsError)
  const [retrying, setRetrying] = useState(false)

  /*
   * 问不到球群 —— 这一屏绝不能出现建群按钮。
   *
   * 这是那次事故的正解：当时「问不到」和「你没有群」共用了同一屏，
   * 而那一屏上有个「建一个球群」。一个只是令牌过期的人按了它，
   * 整个球群的数据跟着搬进了新群。
   *
   * 问不到的时候唯一该给的出路是重试。
   */
  if (failed) {
    return (
      <Screen>
        <Body className="pt-16">
          <div className="text-center">
            <div className="text-5xl">📡</div>
            <h1 className="mt-4 text-xl font-semibold">
              {t('暂时读不到你的球群', 'Cannot reach your club right now')}
            </h1>
            <p className="text-ink-500 mx-auto mt-2 max-w-sm text-label">
              {t(
                '不是你被踢了，是这一下没问到。数据都在云端，连上就回来。',
                'You have not been removed — this one request just did not get through. Everything is still in the cloud.',
              )}
            </p>
            <p className="text-ink-500 mx-auto mt-2 max-w-sm text-caption">{failed}</p>
          </div>
          <Button
            block
            variant="primary"
            disabled={retrying}
            onClick={() => {
              setRetrying(true)
              void retryClubs().finally(() => setRetrying(false))
            }}
          >
            {retrying ? t('正在重试…', 'Retrying…') : t('再试一次', 'Try again')}
          </Button>
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
        {stranded && (
          <div className="border-warning-600/30 bg-warning-50 rounded-card border p-4">
            <p className="text-title">
              {t('你本来是在一个球群里的', 'You were in a club before')}
            </p>
            <p className="text-ink-700 mt-1 text-label">
              {t(
                '这台手机上还留着那个群的球员和比赛。会看到这一屏，多半是你被移出了球群，或者一时读不到 —— 找群里的人要邀请码进回去就好。',
                'This phone still holds that club’s players and matches. Seeing this screen usually means you were removed, or it just cannot be reached right now — ask someone for the invite code and come back in.',
              )}
            </p>
            <p className="text-ink-700 mt-2 text-label font-semibold">
              {t(
                '别在这里建新群 —— 那会另起一份，原来的战绩不会跟过来。',
                'Do not start a new club here — it begins an empty one, and your record does not follow.',
              )}
            </p>
          </div>
        )}
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
  const failed = useApp((s) => s.clubsError)
  /*
   * 问失败也要挡：没有球群这个 App 是坏的（记的分推不上去），
   * 让人以为能用比挡住更糟。但挡住之后给的是重试，不是建群 ——
   * 那一屏自己会按 clubsError 分岔。
   */
  return cloudReady && !!session && (checked || failed !== null) && !clubId
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
