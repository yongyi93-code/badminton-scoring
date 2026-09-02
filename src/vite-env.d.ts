/// <reference types="vite/client" />

/*
 * 把 .env 里那几个变量声明出来。
 * 不声明的话 import.meta.env.VITE_XXX 是 any —— 名字打错了
 * TypeScript 一声不吭，运行时才发现连不上云端。
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  /** publishable / anon key。公开的，见 lib/supabase.ts 的说明 */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /**
   * 推送用的 VAPID 公钥。公开的 —— 它的作用只是让推送服务
   * 认得出消息是谁发的，私钥在 Supabase 那边，永远不进这个仓库。
   */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
