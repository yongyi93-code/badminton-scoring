/* ------------------------------------------------------------------ *
 * 够用的假 supabase client
 *
 * 只支持那两个推送函数真正用到的几种查询：select + eq + filter(data->>x)
 * + maybeSingle / limit / delete，外加 auth.getUser。
 *
 * 做成假的而不是连真库，是因为这一组测试要钉的是**谁能调这个函数**，
 * 不是查询本身对不对 —— 而「谁能调」正好是唯一一处没法在本机跑真
 * Postgres 撞出来的（它在 Deno 那一侧，不在数据库里）。
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>

/** 这一轮测试的库和令牌表。每条用例自己摆 */
export const fake = {
  db: {} as Record<string, Row[]>,
  /** 令牌 → uid。查不到就是「认不出这个人」 */
  tokens: {} as Record<string, string>,
  /** 这一轮真发出去的推送 */
  pushed: [] as { endpoint: string; payload: Record<string, unknown> }[],
}

export function createClient(_url: string, _key: string) {
  const mk = (table: string) => {
    const eqs: [string, unknown][] = []
    const filters: [string, unknown][] = []
    const rows = () =>
      (fake.db[table] ?? []).filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          filters.every(([path, v]) => {
            const m = /^data->>(.+)$/.exec(path)
            return m ? ((r.data ?? {}) as Row)[m[1]] === v : true
          }),
      )
    const api = {
      select: () => api,
      eq: (c: string, v: unknown) => {
        eqs.push([c, v])
        return api
      },
      filter: (path: string, _op: string, v: unknown) => {
        filters.push([path, v])
        return api
      },
      limit: (n: number) => Promise.resolve({ data: rows().slice(0, n), error: null }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      delete: () => api,
      then: (res: (x: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(res),
    }
    return api
  }
  return {
    from: mk,
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
