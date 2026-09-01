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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
