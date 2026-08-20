# 角色立绘

把立绘图片放进这个文件夹就自动生效，不用改代码。
一张都没放也没关系 —— 那时候用的是 `src/components/Avatar.tsx` 里的 SVG 手绘版。

## 文件名

必须是 `<性别>-<阶段>.<后缀>`，性别是 `m` / `f`，后缀支持 png / webp / jpg。

| 文件           | 阶段            | 从哪个段位开始    |
| -------------- | --------------- | ----------------- |
| `m-rookie.png` | Lv.1 新手 Rookie  | Herald（MMR 0）     |
| `m-player.png` | Lv.10 进阶 Player | Guardian（MMR 100） |
| `m-elite.png`  | Lv.30 精英 Elite  | Archon（MMR 300）   |
| `m-pro.png`    | Lv.50 高手 Pro    | Ancient（MMR 700）  |
| `m-legend.png` | Lv.100 传奇 Legend | Immortal（MMR 1000）|

女生版同理，把 `m-` 换成 `f-`。少放几张也能跑，缺的那几个阶段自动退回 SVG。

## 图片要求

- **背景透明**（PNG 或 WebP）。人物后面的光晕是代码另画的一层，
  图片自带底色的话会糊成一个方块。
- **竖构图，全身**，建议 512×768 左右，人站在画面正中、头顶留一点空。
  头像圆圈是按这个构图裁的，构图差太多就去调
  `src/lib/avatarArt.ts` 里的 `HEAD_CROP`。
- **单张压到 100KB 以内**。这是个离线优先的 App，
  十张图会整个打进 Service Worker 的预缓存里。

## 为什么阶段不是等距的

段位一共八段，形象只有五个，所以是 1 / 2 / 2 / 2 / 1 分的：
先锋 → 卫士·中军 → 统帅·传奇 → 万古·超凡 → 冠绝。
对应关系写在 `src/lib/avatarArt.ts` 的 `STAGES`，要改改那里一处就够。
