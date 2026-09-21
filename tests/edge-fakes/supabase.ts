/* ------------------------------------------------------------------ *
 * 够用的假 supabase client
 *
 * 只支持那几个 Edge Function 真正用到的东西：select + eq +
 * filter(data->>x) + in + maybeSingle / limit / delete、按 head 数条数、
 * storage.remove，外加 auth.getUser。
 *
 * 做成假的而不是连真库，是因为这些测试要钉的是**函数自己的判断**
 * （谁调得动、删了 0 行算不算成功），不是查询对不对 —— 而那正好是
 * 唯一一处没法在本机跑真 Postgres 撞出来的：它在 Deno 那一侧。
 *
 * 查询本身对不对，那一半在真 Postgres 上撞（见 supabase/*.sql 的自检）。
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>

/** 这一轮测试的库和令牌表。每条用例自己摆 */
export const fake = {
  db: {} as Record<string, Row[]>,
  /**
   * 视图：名字 → 这一刻它该是哪几行。
   *
   * 假客户端里视图不会自己跟着表变，得说一声。不说的话
   * 「删完之后视图里还剩几条」会永远是删之前那个数 —— 而这个函数
   * 返回的「还剩」正是从视图来的。
   */
  views: {} as Record<string, () => Row[]>,
  /** 令牌 → uid。查不到就是「认不出这个人」 */
  tokens: {} as Record<string, string>,
  /** 这一轮真发出去的推送 */
  pushed: [] as { endpoint: string; payload: Record<string, unknown> }[],
  /** 这一轮真从桶里删掉的路径 */
  removed: [] as string[],
  /** 让 storage.remove 报错，模拟桶那边出事 */
  storageError: null as string | null,
  /**
   * 这些表上的 delete **不报错，但一行都删不掉**。
   *
   * 这正是线上那次的形状（029）：权限不够、PostgREST 返回 0 行。
   * 没有这个开关就没法把那件事钉成一条测试。
   */
  undeletable: new Set<string>(),
}

export function createClient(_url: string, _key: string) {
  const mk = (table: string) => {
    const eqs: [string, unknown][] = []
    const ins: [string, unknown[]][] = []
    const filters: [string, unknown][] = []
    let deleting = false
    let headCount = false

    const all = () => fake.views[table]?.() ?? fake.db[table] ?? []
    const rows = () =>
      all().filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          ins.every(([c, vs]) => vs.includes(r[c])) &&
          filters.every(([path, v]) => {
            const m = /^data->>(.+)$/.exec(path)
            return m ? ((r.data ?? {}) as Row)[m[1]] === v : true
          }),
      )

    /** 真去删。删不动的表返回空数组而**不报错** —— 就是线上那个样子 */
    const runDelete = () => {
      const hit = rows()
      if (fake.undeletable.has(table)) return []
      fake.db[table] = (fake.db[table] ?? []).filter((r) => !hit.includes(r))
      return hit
    }

    const settle = () => {
      if (deleting) return { data: runDelete(), error: null }
      if (headCount) return { data: null, error: null, count: rows().length }
      return { data: rows(), error: null }
    }

    const api = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) headCount = true
        return api
      },
      eq: (c: string, v: unknown) => {
        eqs.push([c, v])
        return api
      },
      in: (c: string, vs: unknown[]) => {
        ins.push([c, vs])
        return api
      },
      filter: (path: string, _op: string, v: unknown) => {
        filters.push([path, v])
        return api
      },
      limit: (n: number) =>
        Promise.resolve({ data: rows().slice(0, n), error: null }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      delete: () => {
        deleting = true
        return api
      },
      then: (res: (x: unknown) => unknown) => Promise.resolve(settle()).then(res),
    }
    return api
  }

  return {
    from: mk,
    storage: {
      from: (_bucket: string) => ({
        remove: async (paths: string[]) => {
          if (fake.storageError) return { data: null, error: { message: fake.storageError } }
          fake.removed.push(...paths)
          return { data: paths.map((p) => ({ name: p })), error: null }
        },
      }),
    },
    auth: {
      getUser: async (token: string) => {
        const uid = fake.tokens[token]
        return uid
          ? { data: { user: { id: uid } }, error: null }
          : { data: { user: null }, error: { message: 'bad token' } }
      },
    },
  }
}
