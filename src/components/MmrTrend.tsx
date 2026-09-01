import { useT } from '@/lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { levelOf, PET_LEVELS, tierName, type MmrPoint } from '@/lib/avatar'
import { formatDate, signed } from '@/lib/format'
import { cx } from './ui'

/* ------------------------------------------------------------------ *
 * MMR 走势图
 *
 * 单序列的折线 + 面积。几条定下来的做法：
 *
 * - 横轴是「第几场」不是日期。羽球是一晚打六场、隔一周再打，
 *   按日期铺开的话所有起伏挤成几根竖线，中间全是空白。
 * - 只有一条线，所以不要图例 —— 标题已经说了这是谁的 MMR。
 * - 不给每个点标数字，只标最后一个（当前分）。每点都标就没人看了。
 * - 网格线是实心发丝线，比底色深一档就够，不用虚线。
 * - 线用 var(--t-brand-600)：这是全 App 的强调色，深浅两套主题各有一组值。
 *   浅色下跑过 dataviz 的六项检查全通过；深色下亮度超出「分类色带」，
 *   但那条带是为了多序列互相分得开而设的，单序列只需要对底色有对比度，
 *   3:1 那一项是过的。
 * ------------------------------------------------------------------ */

/** 毫秒时刻 → 本地的 yyyy-mm-dd，交给 formatDate 去排版 */
const dayISO = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 最多画这么多场，再多横轴就挤成一团了 */
const MAX_POINTS = 40

/* 右边只留给末端那个数字，段位名改放左边，两个再也撞不到一起 */
const PAD = { top: 14, right: 34, bottom: 22, left: 34 }
const HEIGHT = 168

export function MmrTrend({ points }: { points: MmrPoint[] }) {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  /** 手指按住时高亮的那个点；没按住是 null */
  const [active, setActive] = useState<number | null>(null)
  /* 是否正在拖。用 ref 不用 state —— pointerdown 之后紧跟着的那个
     move 事件里，state 还是旧值，会把第一段拖动吃掉 */
  const dragging = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const sync = () => setWidth(el.clientWidth)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const shown = useMemo(
    () => (points.length > MAX_POINTS ? points.slice(-MAX_POINTS) : points),
    [points],
  )

  const geom = useMemo(() => {
    if (width === 0 || shown.length < 2) return null
    const w = width
    const plotW = w - PAD.left - PAD.right
    const plotH = HEIGHT - PAD.top - PAD.bottom

    const values = shown.map((p) => p.mmr)
    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    /*
     * 上下各留一档，线不会贴着边框跑。
     * 全程一条水平线（比如一直是 0 分）时给个固定跨度，
     * 不然 span 是 0，等下要除以它。
     */
    const span = Math.max(rawMax - rawMin, 20)
    const pad = span * 0.15
    const min = Math.max(0, rawMin - pad)
    const max = rawMax + pad

    const x = (i: number) =>
      PAD.left + (shown.length === 1 ? plotW / 2 : (i / (shown.length - 1)) * plotW)
    const y = (v: number) =>
      PAD.top + plotH - ((v - min) / (max - min)) * plotH

    const line = shown.map((p, i) => `${x(i)},${y(p.mmr)}`).join(' ')
    const area = `${PAD.left},${PAD.top + plotH} ${line} ${PAD.left + plotW},${PAD.top + plotH}`

    /* 落在可见范围内的段位门槛 —— 「这条线是我跨进卫士的地方」 */
    const tiers = PET_LEVELS.filter((tier) => tier.min > min && tier.min < max).map(
      (tier) => ({ tier, y: y(tier.min) }),
    )

    return { w, plotW, plotH, min, max, x, y, line, area, tiers }
  }, [width, shown])

  const last = shown[shown.length - 1]
  const first = shown[0]

  if (shown.length < 2) {
    return (
      <p className="text-ink-500 text-caption">
        {t(
          '再打几场就能看到走势了',
          'Play a few more matches and the trend shows up',
        )}
      </p>
    )
  }

  const net = last.mmr - first.mmr
  /* 读屏读不了折线，所以把这张图一句话说清楚 */
  const summary = t(
    `MMR 走势：最近 ${shown.length - 1} 场，从 ${first.mmr} 到 ${last.mmr}，净 ${signed(net)}`,
    `MMR trend over the last ${shown.length - 1} matches: ${first.mmr} to ${last.mmr}, ${signed(net)} net`,
  )

  /** 按住／拖动时挑离手指最近的点 */
  const scrub = (clientX: number) => {
    if (!geom) return
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box) return
    const rel = clientX - box.left
    const step = geom.plotW / (shown.length - 1)
    const i = Math.round((rel - PAD.left) / step)
    setActive(Math.max(0, Math.min(shown.length - 1, i)))
  }

  const hot = active === null ? null : shown[active]

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative touch-pan-y select-none"
        onPointerDown={(e) => {
          dragging.current = true
          scrub(e.clientX)
          /* 捕获不到就算了（有的浏览器对已结束的指针会抛），
             上面那一下已经生效，后面的 move 照样收得到 */
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* 忽略 */
          }
        }}
        onPointerMove={(e) => dragging.current && scrub(e.clientX)}
        onPointerUp={() => {
          dragging.current = false
          setActive(null)
        }}
        onPointerCancel={() => {
          dragging.current = false
          setActive(null)
        }}
        onPointerLeave={() => {
          dragging.current = false
          setActive(null)
        }}
      >
        {geom && (
          <svg
            width={geom.w}
            height={HEIGHT}
            role="img"
            aria-label={summary}
            className="block overflow-visible"
          >
            {/* 段位门槛：发丝线 + 段位名，比网格更有信息量 */}
            {geom.tiers.map(({ tier, y }) => (
              <g key={tier.name}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + geom.plotW}
                  y1={y}
                  y2={y}
                  stroke="var(--t-line)"
                  strokeWidth={1}
                />
                {/* 垫一块底色：段位名压在折线上时也读得出来 */}
                <rect
                  x={PAD.left + 2}
                  y={y - 13}
                  width={tier.name.length * 5.6 + 6}
                  height={12}
                  rx={3}
                  fill="var(--t-surface)"
                  opacity={0.9}
                />
                <text
                  x={PAD.left + 5}
                  y={y - 4}
                  fontSize={10}
                  fill="var(--t-ink-500)"
                >
                  {tier.name}
                </text>
              </g>
            ))}

            {/* 上下界各一个刻度就够，中间靠段位线 */}
            {[geom.max, geom.min].map((v, i) => (
              <text
                key={i}
                x={PAD.left - 6}
                y={geom.y(v) + (i === 0 ? 8 : 0)}
                fontSize={10}
                textAnchor="end"
                fill="var(--t-ink-500)"
              >
                {Math.round(v)}
              </text>
            ))}

            {/*
              横轴是场次不是日期，但「这段是什么时候的」还是要说一句，
              所以两端各标一个日期，中间不标 —— 中间那些点靠按住看。
            */}
            <text
              x={PAD.left}
              y={HEIGHT - 6}
              fontSize={10}
              fill="var(--t-ink-500)"
            >
              {formatDate(dayISO(first.at))}
            </text>
            <text
              x={PAD.left + geom.plotW}
              y={HEIGHT - 6}
              fontSize={10}
              textAnchor="end"
              fill="var(--t-ink-500)"
            >
              {formatDate(dayISO(last.at))}
            </text>

            <polygon points={geom.area} fill="var(--t-brand-600)" opacity={0.1} />
            <polyline
              points={geom.line}
              fill="none"
              stroke="var(--t-brand-600)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* 按住时的十字线和高亮点 */}
            {hot && active !== null && (
              <g>
                <line
                  x1={geom.x(active)}
                  x2={geom.x(active)}
                  y1={PAD.top}
                  y2={PAD.top + geom.plotH}
                  stroke="var(--t-ink-300)"
                  strokeWidth={1}
                />
                <circle
                  cx={geom.x(active)}
                  cy={geom.y(hot.mmr)}
                  r={5}
                  fill="var(--t-brand-600)"
                  stroke="var(--t-surface)"
                  strokeWidth={2}
                />
              </g>
            )}

            {/* 最后一个点直接标数，其余交给按住看 */}
            {active === null && (
              <>
                <circle
                  cx={geom.x(shown.length - 1)}
                  cy={geom.y(last.mmr)}
                  r={4.5}
                  fill="var(--t-brand-600)"
                  stroke="var(--t-surface)"
                  strokeWidth={2}
                />
                <text
                  x={geom.x(shown.length - 1) + 8}
                  y={geom.y(last.mmr) + 4}
                  fontSize={12}
                  fontWeight={700}
                  fill="var(--t-brand-600)"
                >
                  {last.mmr}
                </text>
              </>
            )}
          </svg>
        )}
      </div>

      {/* 说明行。按住时换成那一场的详情，松手换回来 */}
      <p className="text-ink-500 mt-1 text-caption">
        {hot ? (
          <span className="text-ink-700">
            {t(
              `第 ${active} 场 · MMR ${hot.mmr}`,
              `Match ${active} · MMR ${hot.mmr}`,
            )}
            {hot.delta !== 0 && (
              <span
                className={cx(
                  'ml-1.5 font-semibold',
                  hot.delta > 0 ? 'text-brand-600' : 'text-danger-600',
                )}
              >
                {signed(hot.delta)}
              </span>
            )}
            {' · '}
            {tierName(levelOf(hot.mmr).tier)}
          </span>
        ) : (
          t(
            `最近 ${shown.length - 1} 场 · 净 ${signed(net)} · 按住看每一场`,
            `Last ${shown.length - 1} matches · ${signed(net)} net · hold to inspect`,
          )
        )}
      </p>
    </div>
  )
}
