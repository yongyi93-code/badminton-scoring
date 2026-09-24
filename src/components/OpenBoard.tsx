import { useEffect, useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useApp } from '@/store/useApp'
import { useOpenBoard } from '@/store/useOpenBoard'
import { Card, EmptyState, Pill, Segmented, cx, inputClass } from '@/components/ui'
import { formatDate, formatTime } from '@/lib/format'
import { othersOnly, spotsLeftOn, type OpenRow } from '@/lib/openBoard'
import { STATES, stateName } from '@/lib/region'
import { inviteUrl } from '@/lib/invite'
import { useLang } from '@/lib/i18n'

/* ------------------------------------------------------------------ *
 * 公开球局：全 App 的那一张列表
 *
 * 这一屏回答一个问题：**今晚我能去哪打**。所以它按日期时间排，
 * 不按「谁刚开的」—— 后者是给开局的人看的虚荣数据，不是给找局的人用的。
 *
 * -------------------------------------------------------------------
 * 自己球群的局不在这儿显示
 *
 * 它们已经在「按日期」那一栏里了，而且那一栏上能直接点进去。
 * 两处都显示的话，人会以为是两场不同的局。
 * ------------------------------------------------------------------ */

export function OpenBoard() {
  const t = useT()
  const { lang } = useLang()
  const rows = useOpenBoard((s) => s.rows)
  const load = useOpenBoard((s) => s.load)
  const sessions = useApp((s) => s.sessions)
  const [state, setState] = useState<string>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  /* 自己群里已经有的那几场不重复显示（理由见文件开头） */
  const mineIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions])

  /*
   * 州的选项只列**列表上真有局的那几个**。
   *
   * 十六个州全摆出来的话，绝大多数点进去是空的 —— 那不是筛选，
   * 那是让人一个一个试。
   */
  const states = useMemo(() => {
    const seen = new Set(rows.map((r) => r.state).filter(Boolean) as string[])
    return STATES.filter((s) => seen.has(s.id))
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return othersOnly(rows, mineIds)
      .filter((r) => state === 'all' || r.state === state)
      .filter((r) => !q || r.venue.toLowerCase().includes(q))
  }, [rows, mineIds, state, query])

  return (
    <div className="space-y-3">
      {states.length > 1 && (
        <Segmented
          value={state}
          onChange={setState}
          options={[
            { value: 'all', label: t('全部', 'All') },
            ...states.map((s) => ({ value: s.id, label: lang === 'zh' ? s.zh : s.en })),
          ]}
        />
      )}

      {rows.length > 3 && (
        <input
          className={inputClass}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('找球馆…', 'Search venues…')}
          aria-label={t('找球馆', 'Search venues')}
        />
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon="🏸"
          title={t('这会儿没有公开的局', 'No open sessions right now')}
          hint={t(
            '别人开局的时候，只要没勾「私人局」就会出现在这儿。你自己开一个，装了 App 的人也都看得到。',
            'Sessions show up here unless the host marks them private. Start one and everyone with the app can see it.',
          )}
        />
      ) : (
        shown.map((r) => <OpenCard key={r.session_id} row={r} />)
      )}
    </div>
  )
}

/*
 * 一场公开局长什么样。
 *
 * 卡上只放决定「去不去」要用的东西：在哪、几点、还差几个、谁开的。
 * 比分、名单那些不在这张表上，也不该在 —— 它们没出球群（030）。
 */
function OpenCard({ row }: { row: OpenRow }) {
  const t = useT()
  const spots = spotsLeftOn(row)
  const full = spots === 0

  /*
   * 「我要来」= 打开那条邀请链接。
   *
   * 没有球群码的话点不动 —— 数据是按球群隔离的，没码进不去。
   * 那种行理论上不该出现（发布的时候一定带码），但真出现了要说清楚
   * 为什么点不动，而不是给一个按了没反应的按钮。
   */
  const href = row.club_code ? inviteUrl({ sessionId: row.session_id, clubCode: row.club_code }) : null

  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-title truncate">{row.venue}</p>
          <p className="text-ink-500 mt-0.5 text-label">
            {formatDate(row.date)}
            {formatTime(row.time ?? '') ? ` · ${formatTime(row.time ?? '')}` : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill tone={full ? 'warn' : 'neutral'}>
              {row.max_players
                ? t(`${row.joined} / ${row.max_players} 人`, `${row.joined} / ${row.max_players}`)
                : t(`${row.joined} 人`, `${row.joined} playing`)}
            </Pill>
            {spots !== null && spots > 0 && (
              <Pill tone="neutral">{t(`还差 ${spots} 个`, `${spots} spot${spots > 1 ? 's' : ''} left`)}</Pill>
            )}
            {full && <Pill tone="warn">{t('满了', 'Full')}</Pill>}
            {row.state && <Pill tone="neutral">{stateName(row.state, true)}</Pill>}
          </div>
          {row.host_name && (
            <p className="text-ink-500 mt-1.5 text-caption">
              {t(`${row.host_name} 开的`, `Started by ${row.host_name}`)}
            </p>
          )}
        </div>
      </div>

      {/*
        点「我要来」= 走那条邀请链接（进群 + 落进那一场）。
        用 <a> 而不是按钮：这条路和球友发给你的链接**必须是同一条**，
        两套实现迟早有一套忘了改。

        满了就按不动，写法和群里那张列表一致（components/OpenSessions
        那边也是显示「已满」而不是让人点进去再被拒）—— 同一件事在两处
        长得不一样，人会以为是两回事。

        这里的「满了」是**上一次同步时的人数**，可能有人刚退出。
        所以文案是「满了」而不是「你来不了」：说的是这张卡上的数，
        不是一个承诺。
      */}
      <span
        className={cx(
          'mt-3 block rounded-btn py-2.5 text-center text-label font-medium',
          href && !full ? 'bg-brand-600 text-canvas' : 'bg-fill text-ink-500',
        )}
      >
        {!href ? (
          t('这条局没带邀请码，进不去', 'No club code on this one')
        ) : full ? (
          t('已满', 'Full')
        ) : (
          <a href={href} className="block active:opacity-90">
            {t('我要来', 'I want in')}
          </a>
        )}
      </span>
    </Card>
  )
}
