import { useEffect } from 'react'

type SentinelLike = { release: () => Promise<void>; released?: boolean }

/**
 * 记分时保持屏幕常亮 —— 打球中途屏幕自己黑掉是最烦的。
 * 不支持 Wake Lock 的浏览器（目前主要是 iOS Safari）静默跳过。
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<SentinelLike> }
    }
    if (!nav.wakeLock) return

    let sentinel: SentinelLike | null = null
    let cancelled = false

    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request('screen')
        if (cancelled) void s.release()
        else sentinel = s
      } catch {
        // 用户拒绝或系统不允许，忽略
      }
    }

    // 切回前台后锁会失效，需要重新申请
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !sentinel?.released) void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
