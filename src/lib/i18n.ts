import { useSyncExternalStore } from 'react'

/*
 * 中英双语。
 *
 * 没有用 key + 字典那一套，而是把两种语言直接写在用到的地方：
 *
 *   t('开新球局', 'New session')
 *
 * 理由是这个 App 只有两种语言、一个人维护。key 那套的成本全在
 * 「改文案要跑去另一个文件找 key」和「key 打错了只会在运行时冒出
 * 一串 missing.translation.key」—— 而写在原地，改文案时两种语言就在
 * 眼皮底下，漏翻一句 TypeScript 当场就报参数不够。
 *
 * 代价是同一句话在两个地方要写两遍。真到了那一步再抽公共的。
 */

export type Lang = 'zh' | 'en'

const KEY = 'rally-lang'

/** 没设置过就跟着手机的语言走：中文环境给中文，其余一律英文 */
const detect = (): Lang => {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // 隐私模式下 localStorage 会直接抛，别让整个 App 起不来
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

let current: Lang = 'zh'
const listeners = new Set<() => void>()

export function setLang(lang: Lang) {
  current = lang
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    /* 存不下就只在这一次会话里生效 */
  }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  listeners.forEach((fn) => fn())
}

/** 当前语言。给不是组件的地方用（lib/ 里那些算文案的函数） */
export const lang = (): Lang => current

/**
 * 挑一句。组件外面也能直接用 —— 但那样不会跟着切换语言重渲染，
 * 所以组件里一律用 useT()。
 */
export const pick = (zh: string, en: string): string =>
  current === 'zh' ? zh : en

/** 在 React 渲染之前调一次，免得中文用户先看到一帧英文 */
export function initLang() {
  current = detect()
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en'
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/**
 * 组件里用这个。返回的 t 认得当前语言，切换时这一屏会重渲染。
 *
 *   const t = useT()
 *   <Button>{t('开新球局', 'New session')}</Button>
 */
export function useT() {
  useSyncExternalStore(
    subscribe,
    () => current,
    () => 'zh' as Lang,
  )
  return pick
}

/** 语言本身也要显示，而且两种语言下都写自己的名字 */
export const LANG_LABELS: Record<Lang, string> = {
  zh: '中文',
  en: 'English',
}

export function useLang() {
  const value = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'zh' as Lang,
  )
  return { lang: value, setLang }
}
