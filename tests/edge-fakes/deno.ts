/* ------------------------------------------------------------------ *
 * 让那几个 Edge Function 在 vitest 里跑起来的壳
 *
 * 它们是写给 Deno 的：模块顶层就调 Deno.env.get 和 Deno.serve。
 * 所以这个壳**必须在第一次 import 它们之前**就摆好。
 *
 * 放在这儿而不是各个测试文件里抄一份，是因为下面那个「记住 handler」
 * 的坑只值得踩一次。
 * ------------------------------------------------------------------ */

export type Handler = (req: Request) => Promise<Response>

let caught: Handler | null = null

/** 摆好 Deno 那个全局。env 里没写的键返回 undefined */
export function installDeno(env: Record<string, string>) {
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: Handler) => {
      caught = h
    },
  }
}

/*
 * 接住 Deno.serve 交上来的那个 handler，接一次记住。
 *
 * 记住这件事不是省事：ESM 的模块只会执行一次，第二次 import 拿到的是
 * 缓存 —— Deno.serve 不会再被调一遍。不记的话除了第一条用例全会
 * 报「那个函数没有调 Deno.serve」，而那个错看着完全像函数写坏了。
 */
const handlers = new Map<string, Handler>()

/**
 * 载入一个 Edge Function，拿到它的 handler。
 *
 * 路径是**相对这个文件**的（tests/edge-fakes/），
 * 因为动态 import 按调用它的那个模块算 —— 而那就是这里。
 */
export async function load(path: string): Promise<Handler> {
  const had = handlers.get(path)
  if (had) return had
  caught = null
  await import(path)
  if (!caught) throw new Error('那个函数没有调 Deno.serve')
  handlers.set(path, caught)
  return caught
}

/** 这些函数里的 console.log 是给线上排错用的，测试里全部吞掉 */
export const hush = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { log, error } = console
  console.log = () => {}
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.log = log
    console.error = error
  }
}
