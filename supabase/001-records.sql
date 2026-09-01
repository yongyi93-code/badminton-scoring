-- ===================================================================
-- RALLY 云同步：建表 + 权限
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑，
-- 每一句都带了 if not exists / or replace。
--
-- ------------------------------------------------------------------
-- 为什么只有一张表、而且用 JSONB 存整个对象
--
-- 这个 App 的架构是「全量数据在本地，MMR、段位、排行榜全部实时算」。
-- 云端不需要当查询引擎 —— 它只要当一个可靠的同步仓库：
-- 客户端把所有行拉下来，剩下的自己算。
--
-- 于是把 players / sessions / matches / avatars 拆成四张规范化的表
-- 只有坏处：字段还在演进（这个项目一路在加字段），每加一个都要写迁移，
-- 而服务端根本没人查这些字段。JSONB 存整个对象，schema 演进免费。
--
-- 拆出来当列的只有同步真正需要的那几个：kind、id、updated_at、deleted。
-- ===================================================================

create table if not exists public.records (
  -- 'player' | 'session' | 'match' | 'avatar'
  kind text not null,
  -- 沿用客户端自己生成的 id，两边对得上
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  -- 软删除。真删掉的话，别人的手机永远不知道这条被删了，
  -- 下次同步又会把它推回来
  deleted boolean not null default false,
  primary key (kind, id)
);

-- 增量拉取就靠这个索引：where updated_at > 上次同步时间
create index if not exists records_updated_at_idx
  on public.records (updated_at);

-- ------------------------------------------------------------------
-- updated_at 由服务器盖章，不信客户端传上来的时间
--
-- 手机时钟不准是常态（差几分钟很普通，有人还手动改过）。
-- 让客户端决定「谁更新」，两台时钟不一致的手机就会互相覆盖，
-- 而且错得毫无规律。统一用数据库的 now()，顺序才是可信的。
-- ------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
  before insert or update on public.records
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- 权限：登录的人能读能写，没登录的什么都不能做
--
-- 打进前端那个 publishable key 是公开的，谁都拿得到 ——
-- 所以拦人的必须是这里，不是那个字符串。
-- ------------------------------------------------------------------
alter table public.records enable row level security;

drop policy if exists "登录的人可以读" on public.records;
create policy "登录的人可以读"
  on public.records for select
  to authenticated
  using (true);

drop policy if exists "登录的人可以新增" on public.records;
create policy "登录的人可以新增"
  on public.records for insert
  to authenticated
  with check (true);

drop policy if exists "登录的人可以修改" on public.records;
create policy "登录的人可以修改"
  on public.records for update
  to authenticated
  using (true)
  with check (true);

-- 故意不给 delete：删除走 deleted = true 那条路。
-- 真 DELETE 出去，别的手机下次同步只会把这条又推回来。

-- ------------------------------------------------------------------
-- 实时推送：别人记的分，你这边不用刷新就能看到
-- ------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.records;
exception
  when duplicate_object then null;  -- 已经加过了，跑第二遍不报错
end;
$$;
