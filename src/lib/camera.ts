/* ------------------------------------------------------------------ *
 * 自己做的那个相机：纯逻辑那一半
 *
 * 真正拿摄像头、画到画布上的在 components/Camera.tsx。这个文件只放
 * 「按多久算拍视频」「录出来的是什么格式」这类**判断**，因为它们
 * 错了之后的样子都是「录出来发不出去」，而那个在手机上很难查。
 *
 * -------------------------------------------------------------------
 * 为什么不用系统那个相机
 *
 * `<input type="file" capture>` 在 iOS 上直接开取景器，在 **Android
 * Chrome 上只有 accept 是单一一类时才认**（只 image/* 或只 video/*）。
 * 我们两样都要，于是 Chrome 当没看见，退回相册 —— 用户报的正是这个。
 *
 * 二选一的话要么拍不了照、要么录不了像，所以只剩「自己做一个」。
 *
 * -------------------------------------------------------------------
 * 自己做还顺手解决了大小
 *
 * 系统相机录出来多大就是多大（iPhone 1080p60 十几秒就二十几兆），
 * 只能事后拦住说「太大了」—— 人已经拍完了才被拒，最难受的一种。
 *
 * 自己录就能**先把码率定下来**：2.5 Mbps 视频 + 96 kbps 声音，
 * 最长 15 秒，算出来最多 4.9 MB，永远撞不到那个 20 MB 的上限。
 * 从「事后拒绝」变成「根本不会超」。
 * ------------------------------------------------------------------ */

/** 最长录多久。到点自动停 —— Story 本来就没人看完十五秒 */
export const MAX_RECORD_MS = 15_000

/** 视频码率。720p 下 2.5 Mbps 够清楚，再高就是白花流量 */
export const VIDEO_BPS = 2_500_000
/** 声音码率。说话够用 */
export const AUDIO_BPS = 96_000

/**
 * 按住多久算「要录像」。
 *
 * 短了的话手抖一下就录出半秒的片子；长了的话人觉得「按了没反应」。
 * 250ms 是拍照那一下的手感上限 —— 再久人就开始怀疑了。
 */
export const HOLD_MS = 250

/** 这一下是拍照还是录像 */
export function gesture(heldMs: number): 'photo' | 'video' {
  return heldMs < HOLD_MS ? 'photo' : 'video'
}

/**
 * 录出来大概多大。用来确认那两个码率不会撞上限。
 *
 * 这个函数存在的唯一理由是**让上限这件事有测试钉着**：
 * 哪天有人把码率调高，测试会先红，而不是等某个人录满 15 秒才发现发不出去。
 */
export function estimateBytes(ms: number, videoBps = VIDEO_BPS, audioBps = AUDIO_BPS): number {
  return Math.round(((videoBps + audioBps) * ms) / 8 / 1000)
}

/*
 * 录什么格式，按浏览器认哪个来。
 *
 * 顺序有讲究：
 *   mp4   Safari 只给这个，而且它是唯一到处都播得了的
 *   vp9   比 vp8 小三成，新一点的 Android 都有
 *   vp8   兜底，老 Android
 *
 * 每一个都必须配声音（opus）—— 球场上录一段没声音的片子没什么意思。
 */
export const CANDIDATES = [
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

/**
 * 挑一个这台设备录得出来的格式。一个都不行就返回 null
 * （那时候整个相机不该出现，退回系统那条路）。
 *
 * 把「支持不支持」做成参数而不是直接调 MediaRecorder.isTypeSupported：
 * 那样这个函数在 node 里也测得了，而它正是最该测的一个。
 */
export function pickMimeType(supported: (t: string) => boolean): string | null {
  return CANDIDATES.find((t) => supported(t)) ?? null
}

/* 切掉 `;codecs=…` 那一串的是 lib/media.ts 里的 baseType —— 那边是
 * 「什么算媒体文件」的老家，这个文件只管相机本身 */
