import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { activeSessionOf, isFull, lastActivityAt, spotsLeft, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import { Button, Card, Pill, SectionTitle, cx, inputClass } from '@/components/ui'
import { formatDate, formatTime } from '@/lib/format'
import { venueLabel } from '@/lib/venues'

/* ------------------------------------------------------------------ *
 * 别人开的局
 *
 * 球局是公开的：谁开了局，所有装了 App 的人都在首页看得见 ——
 * 谁开的、在哪、几个人了 —— 点一下就加入，不用等人拉。
 *
 * 这一块取代了原来「一个人管名册、开局时替所有人勾到场」的做法。
 * 那种做法的毛病不是麻烦，是它要求开局的人知道今晚谁会来；
 * 而实际上人是陆陆续续到的。
 * 只显示「还新鲜的」几场：球局要靠人按「结束」才收摊，而没人记得按，
 * 不挡的话首页会堆满上个月那些早就散了的局。
 * ------------------------------------------------------------------ */

/**
 * 最后一次有动静之后过了这么久，就当这一局已经散了，首页不再显示。
 *
 * 按「最后一次有动静」算，不是按开局时间：一场从傍晚打到第二天早上
 * 的长局，按开局算会在还在打的时候从首页消失 —— 而首页正是别人找它
 * 加入的地方。
 */
const STALE_MS = 12 * 60 * 60 * 1000

/** 就算都新鲜，首页也最多列这么多 —— 首页不是球局列表 */
const MAX_SHOWN = 5

export function OpenSessions() {
  const t = useT()
  const { sessions, players, matches, meId } = useApp()
  const joinSession = useApp((s) => s.joinSession)
  const push = useNav((s) => s.push)
  const switchTab = useNav((s) => s.switchTab)
  const [query, setQuery] = useState('')

  const nameOf = useMemo(
    () => new Map(players.map((p) => [p.id, p.name])),
    [players],
  )

  const playedIn = (sessionId: string) =>
    matches.filter((m) => m.sessionId === sessionId && m.status === 'done').length

  /** 我现在在哪一场里。在的话，别的局一概加不进去 */
  const mine = useMemo(() => activeSessionOf(sessions, meId), [sessions, meId])

  /*
   * 进行中、我不在里面、而且还「新鲜」的那几场。
   *
   * 新鲜是关键：球局要靠人按「结束」才会收摊，而没人记得按 —— 打完
   * 就各回各家了。于是首页会越堆越长，全是上个月开的、早就散了的局，
   * 真正今晚那一场反而埋在里面。
   *
   * 计时从「最后一场比赛」起，不是从开局起 —— 只要还在打就一直算
   * 活的，真散了才开始倒数。12 小时是按羽球的节奏定的：散场之后
   * 隔了半天还没人碰，那一定是忘了按结束。
   */
  const fresh = useMemo(() => {
    const cutoff = Date.now() - STALE_MS
    return sessions
      .filter(
        (s) =>
          s.status === 'active' &&
          (!meId || !s.playerIds.includes(meId)) &&
          lastActivityAt(s, matches) >= cutoff,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [sessions, matches, meId])

  /*
   * 搜索：球馆名或者开局的人。
   *
   * 只搜这两样，因为找球局时人脑子里想的就是这两句 ——
   * 「今晚城中有没有人打」或者「阿伟开局了没」。
   *
   * 搜的时候不再截断到 MAX_SHOWN：那个上限是为了「首页不是球局列表」，
   * 而一个人特意打了字，他要的就是全部结果。
   */
  const key = query.trim().toLowerCase()
  const others = useMemo(() => {
    if (!key) return fresh.slice(0, MAX_SHOWN)
    return fresh.filter((s) => {
      const host = s.createdBy ? (nameOf.get(s.createdBy) ?? '') : ''
      return (
        s.venue.toLowerCase().includes(key) || host.toLowerCase().includes(key)
      )
    })
  }, [fresh, key, nameOf])

  /*
   * 一个球局都没有的时候整块不出现 —— 包括搜索框。
   * 摆一个搜不到任何东西的搜索框，只会让人以为是自己搜错了。
   */
  if (fresh.length === 0) return null

  return (
    <>
      <SectionTitle>{t('正在开放的球局', 'Open sessions')}</SectionTitle>

      {/* 球局多起来之后，翻列表不如打两个字 —— 所以搜索框摆在列表正上方 */}
      <div className="relative">
        <span className="text-ink-300 pointer-events-none absolute inset-y-0 left-3.5 flex items-center">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <input
          className={cx(inputClass, 'pl-11')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('搜球馆、搜开局的人', 'Search venue or host')}
          aria-label={t('搜索球局', 'Search sessions')}
        />
      </div>

      {others.length === 0 && (
        <p className="text-ink-500 py-2 text-center text-label">
          {t(
            `没有球局对得上「${query.trim()}」`,
            `No open session matches “${query.trim()}”`,
          )}
        </p>
      )}
      {others.map((s) => {
        const host = s.createdBy ? nameOf.get(s.createdBy) : undefined
        const full = isFull(s)
        const left = spotsLeft(s)
        return (
          /*
            卡片本身不做成可点的。Card 带 onClick 时渲染的是 <button>，
            再往里塞一个「加入」按钮就是按钮套按钮 —— HTML 不合法，
            浏览器会自作主张把外层收掉，点击行为跟着乱。
            所以两个按钮并排放，各管各的。
          */
          <Card key={s.id}>
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => push({ name: 'board', sessionId: s.id })}
                className="min-w-0 flex-1 text-left"
              >
                <Pill tone="brand">{t('进行中', 'Live')}</Pill>
                <p className="mt-2 truncate text-h2">{venueLabel(s.venue)}</p>
                {/*
                  什么时候，单独一行、颜色更重。
                  这张卡是给不认识这一局的人看的，而「去不去」是靠时间决定的 ——
                  八点的局和十点的局是两回事，挤在一堆人数场数里根本看不见。
                  老球局没有时间，那就只显示日期。
                */}
                <p className="text-ink-700 mt-1 truncate text-label font-medium">
                  {formatDate(s.date)}
                  {formatTime(s.time) ? ` · ${formatTime(s.time)}` : ''}
                </p>
                <p className="text-ink-500 mt-0.5 truncate text-label">
                  {host ? t(`${host} 开的 · `, `${host} started it · `) : ''}
                  {s.maxPlayers
                    ? t(
                        `${s.playerIds.length}/${s.maxPlayers} 人 · 已打 ${playedIn(s.id)} 场`,
                        `${s.playerIds.length}/${s.maxPlayers} players · ${playedIn(s.id)} played`,
                      )
                    : t(
                        `${s.playerIds.length} 人 · 已打 ${playedIn(s.id)} 场`,
                        `${s.playerIds.length} players · ${playedIn(s.id)} played`,
                      )}
                </p>
                {/* 还剩一两个位置的时候说出来，比一个数字更能催人 */}
                {left !== null && left > 0 && left <= 2 && (
                  <p className="text-warning-600 mt-0.5 text-caption">
                    {t(`只剩 ${left} 个位置`, `Only ${left} ${left === 1 ? 'spot' : 'spots'} left`)}
                  </p>
                )}
              </button>
              {/*
                加入是这张卡的重点，不能藏进详情页里 ——
                人到了球馆，最想做的第一件事就是「我来了」。
              */}
              <Button
                size="sm"
                variant={full || mine ? 'soft' : 'primary'}
                className="shrink-0"
                disabled={full || Boolean(mine)}
                onClick={() => {
                  if (!meId) {
                    switchTab('me')
                    return
                  }
                  /*
                   * 上限和「已经在别的局里」都由 store 判定，不看这里
                   * 算出来的 full / mine —— 界面这份是同步过来的数据，
                   * 可能已经过时；加不进去就别跳转，留在原地能看见原因。
                   */
                  if (joinSession(s.id, meId)) push({ name: 'board', sessionId: s.id })
                }}
              >
                {full ? t('已满', 'Full') : mine ? t('加不了', 'Busy') : t('加入', 'Join')}
              </Button>
            </div>
            {!meId && (
              <p className="text-ink-500 mt-2 text-caption">
                {t(
                  '先在「我的」里登录、建好你自己，才能加入',
                  'Sign in and create yourself under “Me” before joining',
                )}
              </p>
            )}
            {/*
              已经在别的局里 —— 按钮灰着不说原因，人只会以为坏了。
              这句话还得带上是哪一场，否则他不知道该去哪儿退。
            */}
            {meId && mine && (
              <button
                className="text-brand-600 mt-2 block text-left text-caption"
                onClick={() => push({ name: 'board', sessionId: mine.id })}
              >
                {t(
                  `你还在「${venueLabel(mine.venue)}」那一场里 —— 先结束或退出才能加别的`,
                  `You are still in the session at ${venueLabel(mine.venue)} — end or leave it first`,
                )}
              </button>
            )}
          </Card>
        )
      })}
    </>
  )
}
