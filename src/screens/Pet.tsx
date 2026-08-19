import { useEffect, useMemo, useRef, useState } from 'react'
import { petOf, playerMap, useApp } from '@/store/useApp'
import { useNav } from '@/store/useNav'
import {
  Body,
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  SectionTitle,
  Segmented,
  TopBar,
  cx,
  inputClass,
} from '@/components/ui'
import { GearIcon, PetView } from '@/components/Pet'
import { RankMedal } from '@/components/RankMedal'
import {
  balanceOf,
  buyBlocker,
  IMMORTAL_STEP,
  LOSS_POINTS,
  progressOf,
  type Progress,
  outfitValue,
  PET_KINDS,
  PET_LEVELS,
  SHOP_ITEMS,
  SLOT_LABELS,
  SLOT_ORDER,
  WIN_POINTS,
  type PetKind,
  type PetSlot,
  type ShopItem,
} from '@/lib/pet'

type Tab = 'dress' | 'shop'

export function Pet({ playerId }: { playerId: string }) {
  const players = useApp((s) => s.players)
  const matches = useApp((s) => s.matches)
  const pets = useApp((s) => s.pets)
  const adoptPet = useApp((s) => s.adoptPet)
  const renamePet = useApp((s) => s.renamePet)
  const buyItem = useApp((s) => s.buyItem)
  const equipItem = useApp((s) => s.equipItem)
  const back = useNav((s) => s.back)

  const [tab, setTab] = useState<Tab>('dress')
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const currentTierRef = useRef<HTMLDivElement | null>(null)

  const player = useMemo(() => playerMap(players).get(playerId), [players, playerId])
  const pet = petOf(pets, playerId)

  const progress = useMemo(() => progressOf(playerId, matches), [playerId, matches])
  const { wins, losses, rankPoints, coins, level } = progress
  const balance = balanceOf(pet, coins)

  /**
   * 段位横条一屏放不下八段，高段位的人一进来自己那格在屏幕外。
   * 只横向滚这一条，不用 scrollIntoView —— 那个会把整页也一起滚动。
   */
  useEffect(() => {
    const el = currentTierRef.current
    const row = el?.parentElement?.parentElement
    if (!el || !row) return
    row.scrollLeft = Math.max(
      0,
      el.offsetLeft - row.clientWidth / 2 + el.clientWidth / 2,
    )
  }, [level.index])

  if (!player) {
    return (
      <Screen>
        <TopBar title="球员不存在" onBack={back} />
        <Body>
          <EmptyState title="找不到这个球员" />
        </Body>
      </Screen>
    )
  }

  /* 还没领养：先挑一只 */
  if (!pet) {
    return (
      <Screen>
        <TopBar title={`${player.name} 的宠物`} onBack={back} />
        <Body>
          <Card className="text-center">
            <p className="text-lg font-bold">挑一只宠物开始养</p>
            <p className="mt-1 text-sm text-ink-400">
              每赢一场比赛得 {WIN_POINTS} 金币，用金币给它买装备打扮
            </p>
          </Card>

          <div className="grid grid-cols-3 gap-2">
            {PET_KINDS.map((k) => (
              <button
                key={k.kind}
                onClick={() => adoptPet(playerId, k.kind)}
                className="rounded-2xl border border-ink-700 bg-ink-850 p-2 active:bg-ink-800"
              >
                <PetView kind={k.kind} className="h-24 w-full" title={k.label} />
                <p className="mt-1 text-sm font-semibold">{k.label}</p>
              </button>
            ))}
          </div>

          <p className="text-xs text-ink-400">
            选错了也没关系，之后随时能换种类，买过的装备不会没收。
          </p>
        </Body>
      </Screen>
    )
  }

  const owned = SHOP_ITEMS.filter((i) => pet.owned.includes(i.id))

  const tryBuy = (item: ShopItem) => {
    const ok = buyItem(playerId, item.id, progress)
    setToast(ok ? `买到了「${item.name}」，已经戴上` : '买不了，看看下面的提示')
    window.setTimeout(() => setToast(null), 2200)
  }

  const saveName = () => {
    const next = draftName.trim()
    if (next) renamePet(playerId, next)
    setNaming(false)
  }

  return (
    <Screen>
      <TopBar
        title={`${player.name} 的宠物`}
        subtitle={`${level.display}${level.star !== null ? ` ${level.star}★` : ''} · 金币 ${balance}`}
        onBack={back}
      />
      <Body>
        {/* 宠物本体 */}
        <Card className="space-y-3">
          <div className="overflow-hidden rounded-2xl bg-ink-800">
            <PetView
              kind={pet.kind}
              equipped={pet.equipped}
              className="mx-auto h-56 w-full max-w-64"
              title={pet.name}
            />
          </div>

          <div className="flex items-center justify-center gap-2">
            {naming ? (
              <>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={12}
                  autoFocus
                  className={cx(inputClass, 'max-w-40 text-center')}
                />
                <Button size="sm" variant="primary" onClick={saveName}>
                  好了
                </Button>
              </>
            ) : (
              <button
                onClick={() => {
                  setDraftName(pet.name)
                  setNaming(true)
                }}
                className="text-lg font-bold"
              >
                {pet.name} <span className="text-sm text-ink-400">✎</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Pill>
              {wins} 胜 {losses} 负
            </Pill>
            <Pill>身上行头 {outfitValue(pet)} 金币</Pill>
          </div>
        </Card>

        {/* 段位 */}
        <Card className="space-y-3">
          <div className="flex items-center gap-4">
            <RankMedal level={level} className="size-20 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xl font-bold" style={{ color: level.tier.color }}>
                {level.display}
                {level.star !== null && (
                  <span className="ml-1.5 text-base">{level.star}★</span>
                )}
              </p>
              <p className="text-sm text-ink-400">{level.tier.label}</p>
              <p className="tnum mt-1 text-xs text-ink-400">
                段位分 {rankPoints}
                {level.next
                  ? ` · 还差 ${level.toNext} 分升 ${level.next.name}`
                  : ` · 还差 ${level.toNext} 分升 ${level.tier.name} ${(level.immortalRank ?? 0) + 1}`}
              </p>
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                width: `${Math.min(100, Math.max(0, level.progress * 100))}%`,
                backgroundColor: level.tier.color,
              }}
            />
          </div>

          {/* 八段全景，看得见自己在哪、后面还有什么 */}
          <div className="-mx-4 overflow-x-auto px-4">
            <div className="flex w-max items-end gap-1.5">
              {PET_LEVELS.map((t, i) => (
                <div
                  key={t.name}
                  ref={i === level.index ? currentTierRef : undefined}
                  className={cx(
                    'w-16 shrink-0 rounded-lg border px-1 py-1.5 text-center',
                    i === level.index
                      ? 'border-lime-glow bg-lime-glow/10'
                      : 'border-ink-700/70 bg-ink-850',
                  )}
                >
                  <RankMedal
                    level={{ ...level, index: i, tier: t, star: null }}
                    className={cx('mx-auto size-7', i > level.index && 'opacity-35')}
                    compact
                  />
                  <p
                    className="mt-0.5 truncate text-[10px]"
                    style={{ color: i <= level.index ? t.color : undefined }}
                  >
                    {t.name}
                  </p>
                  <p className="tnum text-[9px] text-ink-500">{t.min}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink-400">
            段位分：赢一场 +{WIN_POINTS}，输一场 −{LOSS_POINTS}。每段 5 颗星，星满升段。
            打到最高段之后还能继续往上，每 {IMMORTAL_STEP} 分加一级。
            <br />
            买装备用的是金币，金币只按赢的场次算、输球不扣 ——
            段位会掉，但攒下的家当不会被没收。
          </p>
        </Card>

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'dress', label: `装扮${owned.length ? ` (${owned.length})` : ''}` },
            { value: 'shop', label: '商店' },
          ]}
        />

        {toast && (
          <div className="rounded-xl border border-lime-glow/40 bg-lime-glow/10 px-3 py-2 text-sm text-lime-glow">
            {toast}
          </div>
        )}

        {tab === 'dress' ? (
          <DressPanel
            slots={SLOT_ORDER}
            ownedIds={pet.owned}
            equipped={pet.equipped}
            onToggle={(slot, itemId) => equipItem(playerId, slot, itemId)}
            kind={pet.kind}
            onSwitchKind={(kind) => adoptPet(playerId, kind)}
          />
        ) : (
          <ShopPanel
            pet={pet}
            progress={progress}
            balance={balance}
            onBuy={tryBuy}
          />
        )}
      </Body>
    </Screen>
  )
}

/* ------------------------------------------------------------------ *
 * 装扮
 * ------------------------------------------------------------------ */

function DressPanel({
  slots,
  ownedIds,
  equipped,
  onToggle,
  kind,
  onSwitchKind,
}: {
  slots: PetSlot[]
  ownedIds: string[]
  equipped: Partial<Record<PetSlot, string>>
  onToggle: (slot: PetSlot, itemId: string | null) => void
  kind: PetKind
  onSwitchKind: (kind: PetKind) => void
}) {
  const hasAnything = ownedIds.length > 0

  return (
    <>
      {!hasAnything && (
        <EmptyState
          icon="🎽"
          title="还没有任何装备"
          hint="去商店逛逛，赢球攒的分就是拿来花的"
        />
      )}

      {hasAnything &&
        slots.map((slot) => {
          const mine = SHOP_ITEMS.filter(
            (i) => i.slot === slot && ownedIds.includes(i.id),
          )
          if (mine.length === 0) return null
          return (
            <div key={slot}>
              <SectionTitle>{SLOT_LABELS[slot]}</SectionTitle>
              <div className="grid grid-cols-4 gap-2">
                {mine.map((item) => {
                  const on = equipped[slot] === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => onToggle(slot, on ? null : item.id)}
                      className={cx(
                        'rounded-xl border p-1.5 transition-colors',
                        on
                          ? 'border-lime-glow bg-lime-glow/15'
                          : 'border-ink-700 bg-ink-850 active:bg-ink-800',
                      )}
                    >
                      <span className="block overflow-hidden rounded-lg bg-ink-800">
                        <GearIcon itemId={item.id} className="h-14 w-full" />
                      </span>
                      <p
                        className={cx(
                          'mt-1 truncate text-xs',
                          on ? 'text-lime-glow' : 'text-ink-300',
                        )}
                      >
                        {item.name}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

      <SectionTitle>换个宠物</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {PET_KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => onSwitchKind(k.kind)}
            className={cx(
              'rounded-xl border p-1.5',
              k.kind === kind
                ? 'border-lime-glow bg-lime-glow/15'
                : 'border-ink-700 bg-ink-850 active:bg-ink-800',
            )}
          >
            <PetView kind={k.kind} className="h-16 w-full" title={k.label} />
            <p className="mt-0.5 text-xs">{k.label}</p>
          </button>
        ))}
      </div>
      <p className="pb-2 text-xs text-ink-400">换种类不花分，买过的装备也都还在。</p>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * 商店
 * ------------------------------------------------------------------ */

function ShopPanel({
  pet,
  progress,
  balance,
  onBuy,
}: {
  pet: Parameters<typeof outfitValue>[0]
  progress: Progress
  balance: number
  onBuy: (item: ShopItem) => void
}) {
  return (
    <>
      <Card className="flex items-center justify-between">
        <span className="text-sm text-ink-400">
          可用金币
          <span className="mt-0.5 block text-xs text-ink-500">
            只按赢的场次算，输球不扣
          </span>
        </span>
        <span className="tnum text-2xl font-bold text-lime-glow">{balance}</span>
      </Card>

      {SLOT_ORDER.map((slot) => {
        const items = SHOP_ITEMS.filter((i) => i.slot === slot)
        return (
          <div key={slot}>
            <SectionTitle>{SLOT_LABELS[slot]}</SectionTitle>
            <div className="space-y-2">
              {items.map((item) => {
                const block = buyBlocker(item, pet, progress)
                const need = PET_LEVELS[item.minLevel]
                return (
                  <Card key={item.id}>
                    <div className="flex items-center gap-3">
                      <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-ink-800">
                        <GearIcon itemId={item.id} className="h-full w-full" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{item.name}</p>
                        <p className="tnum text-sm text-ink-400">
                          {item.price} 金币
                          {item.minLevel > 0 && ` · 需 ${need.name}`}
                        </p>
                        {block === 'level' && (
                          <p className="text-xs text-ink-400">
                            段位不够，段位分到 {need.min}（{need.name}）才能买，
                            现在 {progress.rankPoints}
                          </p>
                        )}
                        {block === 'money' && (
                          <p className="text-xs text-ink-400">
                            还差 {item.price - balance} 金币，再赢{' '}
                            {Math.ceil((item.price - balance) / WIN_POINTS)} 场
                          </p>
                        )}
                      </div>
                      {block === 'owned' ? (
                        <Pill tone="lime">已拥有</Pill>
                      ) : (
                        <Button
                          size="sm"
                          variant={block === null ? 'primary' : 'ghost'}
                          disabled={block !== null}
                          onClick={() => onBuy(item)}
                        >
                          {block === 'level' ? '锁定' : '买下'}
                        </Button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}

      <p className="pb-4 text-xs leading-relaxed text-ink-400">
        价格看金币（赢一场 +{WIN_POINTS}，输球不扣），
        门槛看段位分（赢一场 +{WIN_POINTS}，输一场 −{LOSS_POINTS}）。
        现在 {progress.level.display}，段位分 {progress.rankPoints}，金币 {balance}。
        两个数都是从比赛记录实时算的 —— 改了战绩会跟着一起变。
      </p>
    </>
  )
}
