import { lang, pick, useT } from '@/lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { avatarOf, playerMap, useApp } from '@/store/useApp'
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
} from '@/components/ui'
import { AvatarView, GearIcon } from '@/components/Avatar'
import { Avatar as AvatarPic, TitleTag } from '@/components/PlayerBits'
import { RankChip } from '@/components/RankMedal'
import {
  hasArt,
  nextStage,
  slotIsDressable,
  stageOf,
  STAGES,
  stageName,
} from '@/lib/avatarArt'
import { dressDefaultsFor, dressUpFor, hasDressUp } from '@/lib/dressup'
import { RankMedal } from '@/components/RankMedal'
import {
  AVATAR_SEXES,
  balanceOf,
  buyBlocker,
  IMMORTAL_STEP,
  LOSS_POINTS,
  outfitValue,
  itemName,
  PET_LEVELS,
  UPSET_MULTIPLIER,
  progressOf,
  shopFor,
  SKIN_TONES,
  SLOT_LABELS,
  SLOT_ORDER,
  WIN_POINTS,
  type AvatarProfile,
  type AvatarSlot,
  type Progress,
  type ShopItem,
} from '@/lib/avatar'

type Tab = 'dress' | 'shop'

export function Avatar({ playerId }: { playerId: string }) {
  const t = useT()
  const players = useApp((s) => s.players)
  const matches = useApp((s) => s.matches)
  const avatars = useApp((s) => s.avatars)
  const setAvatarSex = useApp((s) => s.setAvatarSex)
  const setAvatarSkin = useApp((s) => s.setAvatarSkin)
  const buyItem = useApp((s) => s.buyItem)
  const equipItem = useApp((s) => s.equipItem)
  const back = useNav((s) => s.back)

  const [tab, setTab] = useState<Tab>('dress')
  const [toast, setToast] = useState<string | null>(null)
  const currentTierRef = useRef<HTMLDivElement | null>(null)

  const player = useMemo(() => playerMap(players).get(playerId), [players, playerId])
  const avatar = avatarOf(avatars, playerId)

  const progress = useMemo(() => progressOf(playerId, matches), [playerId, matches])
  const { wins, losses, mmr, coins, level } = progress
  const balance = balanceOf(avatar, coins)
  const stage = stageOf(level)
  const upcoming = nextStage(level)

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

  /*
   * 加球员时已经选过男女了，这里不该再问一次 ——
   * 直接按球员资料里的性别把角色建出来。
   * 只有「不填」的球员才落到下面那个选男女的界面，因为确实没得推。
   */
  useEffect(() => {
    if (avatar || !player) return
    if (player.gender === 'M') setAvatarSex(playerId, 'm')
    else if (player.gender === 'F') setAvatarSex(playerId, 'f')
  }, [avatar, player, playerId, setAvatarSex])

  if (!player) {
    return (
      <Screen>
        <TopBar title={t('球员不存在', 'Player not found')} onBack={back} />
        <Body>
          <EmptyState title={t('找不到这个球员', 'No such player')} />
        </Body>
      </Screen>
    )
  }

  /*
   * 还没建角色：只有没填性别的球员会走到这里 ——
   * 填了性别的上面那个 effect 已经把角色建好了，这一帧先什么都不画，
   * 免得选男女的界面闪一下又消失。
   */
  if (!avatar) {
    if (player.gender !== '-') {
      return (
        <Screen>
          <TopBar title={t(`${player.name} 的角色`, `${player.name}'s character`)} onBack={back} />
          <Body>{null}</Body>
        </Screen>
      )
    }
    return (
      <Screen>
        <TopBar title={t(`${player.name} 的角色`, `${player.name}'s character`)} onBack={back} />
        <Body>
          <Card className="text-center">
            <p className="text-lg font-bold">{t('先选个角色', 'Pick a character')}</p>
            <p className="mt-1 text-sm text-ink-500">
              {hasDressUp
                ? t(`每赢一场得 ${WIN_POINTS} 金币，买了上衣球鞋球拍就穿上身；段位越高，能买的越好`, `Every win earns ${WIN_POINTS} coins. Buy a top, shoes or a racket and they go straight on. The higher your rank, the better the gear.`)
                : hasArt
                  ? t(`赢球涨 MMR，段位一升角色形象就跟着换，一共 ${STAGES.length} 个阶段`, `Winning raises MMR and the character changes with every rank — ${STAGES.length} stages in all`)
                  : t(`每赢一场比赛得 ${WIN_POINTS} 金币，用金币买发型、战服和武器`, `Every win earns ${WIN_POINTS} coins to spend on hair, kit and rackets`)}
            </p>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            {AVATAR_SEXES.map((s) => (
              <button
                key={s.sex}
                onClick={() => setAvatarSex(playerId, s.sex)}
                className="rounded-2xl border border-line bg-surface p-2 active:bg-fill"
              >
                <AvatarView
                  sex={s.sex}
                  equipped={{
                    hair: s.sex === 'm' ? 'm-short' : 'f-bob',
                    outfit: 'tee',
                    // 分层换装那条路要给默认的一身，不然预览里只有一张底图
                    ...dressDefaultsFor(s.sex),
                  }}
                  stage={STAGES[0]}
                  className="h-40 w-full"
                  title={pick(...s.label)}
                />
                <p className="mt-1 text-base font-semibold">{pick(...s.label)}</p>
              </button>
            ))}
          </div>

          <p className="text-xs text-ink-500">
            {t(
              '这个球员没填性别，所以要在这里选一次。去球员资料里把性别填上，以后建角色就会自动对上，不用再选。选错了就去球员资料里改性别，买过的装备不会没收。',
              'This player has no gender set, so pick once here. Fill it in on their player record and the character matches automatically next time. Got it wrong? Change the gender on the player record — nothing you bought is lost.',
            )}
          </p>
        </Body>
      </Screen>
    )
  }

  const catalog = shopFor(avatar.sex)
  const owned = catalog.filter((i) => avatar.owned.includes(i.id))

  const tryBuy = (item: ShopItem) => {
    const ok = buyItem(playerId, item.id, progress)
    setToast(
      ok
        ? t(`买到了「${itemName(item)}」，已经换上`, `Bought ${itemName(item)} — now equipped`)
        : t('买不了，看看下面的提示', 'Cannot buy that yet — see the note below'),
    )
    window.setTimeout(() => setToast(null), 2200)
  }

  return (
    <Screen>
      <TopBar
        title={t(`${player.name} 的角色`, `${player.name}'s character`)}
        subtitle={t(
          `${level.display}${level.star !== null ? ` ${level.star}★` : ''} · 金币 ${balance}`,
          `${level.display}${level.star !== null ? ` ${level.star}★` : ''} · ${balance} coins`,
        )}
        onBack={back}
      />
      <Body>
        {/* 角色本体 */}
        <Card className="space-y-3">
          <div className="overflow-hidden rounded-2xl bg-fill">
            <AvatarView
              sex={avatar.sex}
              skin={avatar.skin}
              equipped={avatar.equipped}
              stage={stage}
              className="mx-auto h-80 w-full"
              title={player.name}
            />
          </div>

          {/*
            成长阶段：只有放了立绘图片才提，不然说了也看不到变化。
            分层换装那条路不提 —— 她的样子是买了什么就穿什么，
            和段位没关系，这里写「段位一升形象就换」是骗人的。
          */}
          {hasArt && !dressUpFor(avatar.sex) && (
            <div className="text-center">
              <p className="text-lg font-bold" style={{ color: stage.glow }}>
                Lv.{stage.lv} {stageName(stage)}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                {upcoming
                  ? t(`还差 ${PET_LEVELS[upcoming.minTier].min - mmr} 分升 ${stageName(upcoming)}`, `${PET_LEVELS[upcoming.minTier].min - mmr} MMR to reach ${upcoming.en}`)
                  : t('已经是最高形象，无可匹敌的王者', 'Top form reached — untouchable')}
              </p>
            </div>
          )}

          {/*
            排行榜预览。
            头像框和称号都只画在人的外面，大立绘上看不出来 ——
            没有这一条的话，买完框和称号这一屏一点变化都没有，
            会以为是买坏了。这里照排行榜的样子摆一遍，买完立刻看得见。
          */}
          <div className="rounded-xl border border-line bg-fill/60 px-3 py-2.5">
            <p className="mb-2 text-xs text-ink-500">{t('别人在排行榜上看到的你', 'How you look on the leaderboard')}</p>
            <div className="flex items-center gap-3">
              <AvatarPic name={player.name} avatar={avatar} />
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate font-medium">{player.name}</span>
                <TitleTag avatar={avatar} />
                <RankChip level={level} />
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Pill>
              {t(`${wins} 胜 ${losses} 负`, `${wins}W ${losses}L`)}
            </Pill>
            <Pill>{t(`身上行头 ${outfitValue(avatar)} 金币`, `Wearing ${outfitValue(avatar)} coins`)}</Pill>
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
              {/* 中文界面在英文段位名底下补一行中文叫法；英文界面两者同字，省掉 */}
              {lang() === 'zh' && (
                <p className="text-sm text-ink-500">{level.tier.label[0]}</p>
              )}
              <p className="tnum mt-1 text-xs text-ink-500">
                MMR {mmr}
                {level.next
                  ? t(` · 还差 ${level.toNext} 分升 ${level.next.name}`, ` · ${level.toNext} to ${level.next.name}`)
                  : t(` · 还差 ${level.toNext} 分升 ${level.tier.name} ${(level.immortalRank ?? 0) + 1}`, ` · ${level.toNext} to ${level.tier.name} ${(level.immortalRank ?? 0) + 1}`)}
              </p>
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-fill">
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
                      ? 'border-brand-600 bg-brand-100'
                      : 'border-line bg-surface',
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

          <p className="text-xs leading-relaxed text-ink-500">
            {t(
              `MMR：赢一场 +${WIN_POINTS}，输一场 −${LOSS_POINTS}，扣到 0 就打住、不会变负。赢了 MMR 比自己高的一队算爆冷，那一场拿 ${WIN_POINTS * UPSET_MULTIPLIER} 分。每段 5 颗星，星满升段；打到最高段之后每 ${IMMORTAL_STEP} 分加一级。买装备用的是金币，金币只按赢的场次算、输球不扣 —— 段位会掉，但攒下的家当不会被没收。`,
              `MMR: +${WIN_POINTS} a win, −${LOSS_POINTS} a loss, floored at 0 so it never goes negative. Beating a higher-MMR pair is an upset and pays ${WIN_POINTS * UPSET_MULTIPLIER}. Five stars per rank; past the top rank you gain a level every ${IMMORTAL_STEP}. Gear is bought with coins, and coins only count wins — losing never takes them away, so your rank can drop but your wardrobe never does.`,
            )}
          </p>
        </Card>

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'dress', label: t(`衣柜 (${owned.length})`, `Wardrobe (${owned.length})`) },
            { value: 'shop', label: t('商店', 'Shop') },
          ]}
        />

        {toast && (
          <div className="rounded-xl border border-brand-500 bg-brand-100 px-3 py-2 text-sm text-brand-600">
            {toast}
          </div>
        )}

        {tab === 'dress' ? (
          <DressPanel
            avatar={avatar}
            catalog={catalog}
            onToggle={(slot, itemId) => equipItem(playerId, slot, itemId)}
            onSkin={(i) => setAvatarSkin(playerId, i)}
          />
        ) : (
          <ShopPanel
            avatar={avatar}
            catalog={catalog}
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
 * 衣柜
 * ------------------------------------------------------------------ */

function DressPanel({
  avatar,
  catalog,
  onToggle,
  onSkin,
}: {
  avatar: AvatarProfile
  catalog: ShopItem[]
  onToggle: (slot: AvatarSlot, itemId: string | null) => void
  onSkin: (index: number) => void
}) {
  return (
    <>
      {SLOT_ORDER.filter(slotIsDressable).map((slot) => {
        const mine = catalog.filter(
          (i) => i.slot === slot && avatar.owned.includes(i.id),
        )
        if (mine.length === 0) return null
        return (
          <div key={slot}>
            <SectionTitle>{pick(...SLOT_LABELS[slot])}</SectionTitle>
            <div className="grid grid-cols-4 gap-2">
              {mine.map((item) => {
                const on = avatar.equipped[slot] === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => onToggle(slot, on ? null : item.id)}
                    className={cx(
                      'rounded-xl border p-1.5 transition-colors',
                      on
                        ? 'border-brand-600 bg-brand-100'
                        : 'border-line bg-surface active:bg-fill',
                    )}
                  >
                    <span className="block overflow-hidden rounded-lg bg-fill">
                      <GearIcon itemId={item.id} className="h-14 w-full" />
                    </span>
                    {/* 英文装备名比中文长一截，一行截断会把区分度最高的那半截掉 */}
                    <p
                      className={cx(
                        'mt-1 line-clamp-2 text-xs leading-tight',
                        on ? 'text-brand-600' : 'text-ink-700',
                      )}
                    >
                      {itemName(item)}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 肤色只对 SVG 手绘那套有用：立绘是画好的图，改不了肤色 */}
      {!hasArt && (
        <>
          <SectionTitle>{pick('肤色', 'Skin tone')}</SectionTitle>
          <div className="flex gap-2">
            {SKIN_TONES.map((tone, i) => (
              <button
                key={tone}
                onClick={() => onSkin(i)}
                aria-label={pick(`肤色 ${i + 1}`, `Skin tone ${i + 1}`)}
                className={cx(
                  'size-11 rounded-full border-2',
                  avatar.skin === i ? 'border-brand-600' : 'border-line',
                )}
                style={{ backgroundColor: tone }}
              />
            ))}
          </div>
        </>
      )}

      {/*
        角色的男女不在这里改 —— 性别是一件事，只该有一个地方填。
        原来这里有个「换个角色」，于是同一个人可能资料里写着男、
        角色却是女：混双按资料排、立绘按角色画，两边对不上。
        改性别的入口留在球员资料里，改了角色会自动跟过去，
        买过的东西一件不少。
      */}
      <p className="text-ink-500 pb-2 text-caption">
        {pick(
          `角色是${avatar.sex === 'm' ? '男生' : '女生'}形象，跟着球员资料里的性别走。要换的话去球员库里改性别 —— 买过的东西一件都不会没收。`,
          `This is the ${avatar.sex === 'm' ? 'male' : 'female'} character, which follows the gender on the player record. To change it, edit their gender in Players — nothing you bought is lost.`,
        )}
      </p>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * 商店
 * ------------------------------------------------------------------ */

function ShopPanel({
  avatar,
  catalog,
  progress,
  balance,
  onBuy,
}: {
  avatar: AvatarProfile
  catalog: ShopItem[]
  progress: Progress
  balance: number
  onBuy: (item: ShopItem) => void
}) {
  /*
   * 商店按槽位分页，一次只看一类。
   *
   * 原来是四类全展开、上下接成一长条 —— 想看球拍要先滚过三十件衣服，
   * 而买东西的人心里想的是「我要一把拍」，不是「我要逛完全部」。
   *
   * 页签从「真的有东西卖」的槽位算出来，不写死：以后加了称号、背景，
   * 页签自己会多一个；某一类清空了也不会留一个点进去是空的页签。
   */
  const slots = SLOT_ORDER.filter(
    (s) => slotIsDressable(s) && catalog.some((i) => i.slot === s && i.price > 0),
  )
  const [slot, setSlot] = useState<AvatarSlot>(slots[0] ?? 'top')
  const shown = slots.includes(slot) ? slot : (slots[0] ?? 'top')
  const items = catalog.filter((i) => i.slot === shown && i.price > 0)

  return (
    <>
      <Card className="flex items-center justify-between">
        <span className="text-sm text-ink-500">
          {pick('可用金币', 'Coins available')}
          <span className="mt-0.5 block text-xs text-ink-500">
            {pick('只按赢的场次算，输球不扣', 'Earned from wins only — losses never cost you any')}
          </span>
        </span>
        <span className="tnum text-2xl font-bold text-brand-600">{balance}</span>
      </Card>

      {/*
        页签横向滚动，不用 Segmented。
        Segmented 把宽度平分给每一项 —— 实测有七类在卖，390 宽的手机上
        每个只剩五十几像素，「Background」直接挤成一团。这里改成按内容
        撑开、一排滚过去，再多几类也不会挤。
      */}
      {slots.length > 1 && (
        <div className="-mx-5 overflow-x-auto px-5">
          <div className="flex w-max gap-1.5 pb-1">
            {slots.map((s) => (
              <button
                key={s}
                onClick={() => setSlot(s)}
                className={cx(
                  'shrink-0 rounded-full border px-3.5 py-1.5 text-label whitespace-nowrap',
                  s === shown
                    ? 'border-brand-500 bg-brand-100 font-semibold text-brand-600'
                    : 'border-line bg-surface text-ink-500',
                )}
              >
                {pick(...SLOT_LABELS[s])}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
              {items.map((item) => {
                const block = buyBlocker(item, avatar, progress)
                const need = PET_LEVELS[item.minLevel]
                return (
                  <Card key={item.id}>
                    <div className="flex items-center gap-3">
                      <span className="size-16 shrink-0 overflow-hidden rounded-xl bg-fill">
                        <GearIcon itemId={item.id} className="h-full w-full" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{itemName(item)}</p>
                        <p className="tnum text-sm text-ink-500">
                          {pick(`${item.price} 金币`, `${item.price} coins`)}
                          {item.minLevel > 0 && pick(` · 需 ${need.name}`, ` · needs ${need.name}`)}
                        </p>
                        {block === 'level' && (
                          <p className="text-xs text-ink-500">
                            {pick(`MMR 不够，到 ${need.min}（${need.name}）才能买，现在 `, `Needs ${need.min} MMR (${need.name}) — you have `)}
                            {progress.mmr}
                          </p>
                        )}
                        {block === 'money' && (
                          <p className="text-xs text-ink-500">
                            {pick(
                              `还差 ${item.price - balance} 金币，再赢 ${Math.ceil((item.price - balance) / WIN_POINTS)} 场`,
                              `${item.price - balance} coins short — ${Math.ceil((item.price - balance) / WIN_POINTS)} more wins`,
                            )}
                          </p>
                        )}
                      </div>
                      {block === 'owned' ? (
                        <Pill tone="brand">{pick('已拥有', 'Owned')}</Pill>
                      ) : (
                        <Button
                          size="sm"
                          variant={block === null ? 'primary' : 'ghost'}
                          disabled={block !== null}
                          onClick={() => onBuy(item)}
                        >
                          {block === 'level' ? pick('锁定', 'Locked') : pick('买下', 'Buy')}
                        </Button>
                      )}
                    </div>
                  </Card>
                )
              })}
      </div>

      <p className="pb-4 text-xs leading-relaxed text-ink-500">
        {pick(
          `价格看金币（赢一场 +${WIN_POINTS}，输球不扣），门槛看 MMR（赢一场 +${WIN_POINTS}，输一场 −${LOSS_POINTS}）。现在 ${progress.level.display}，MMR ${progress.mmr}，金币 ${balance}。两个数都是从比赛记录实时算的 —— 改了战绩会跟着一起变。`,
          `Prices are in coins (+${WIN_POINTS} a win, losses cost nothing); the rank gate is MMR (+${WIN_POINTS} a win, −${LOSS_POINTS} a loss). You are ${progress.level.display}, MMR ${progress.mmr}, ${balance} coins. Both are worked out live from the match records — change a result and they change too.`,
        )}
      </p>
    </>
  )
}
