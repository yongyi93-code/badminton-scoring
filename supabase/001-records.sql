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

-- ------------------------------------------------------------------
-- 先授权，再谈策略 —— 这两件事完全是两回事，缺哪个都写不进去
--
-- 授权（grant）管的是「这张表你能不能碰」，
-- 策略（policy）管的是「表里哪些行你能碰」。
-- 只写策略不授权，Postgres 在还没轮到策略之前就把你挡了，
-- 报的是 permission denied for table records。
--
-- 这一步曾经漏掉过，症状极难认：后台查出来 RLS 是开的、三条策略
-- 一条不少，看起来完全正常，手机上就是写不进去。
--
-- 之所以容易漏，是因为在老一些的项目里它是自动的：Supabase 给
-- postgres 配过 alter default privileges，SQL Editor 里新建的表
-- 会自动授给 anon 和 authenticated。不能指望这条 —— 写出来，
-- 到哪个项目上都成立。
--
-- 注意没有 delete：删除走 deleted = true 那条路，见下面。
-- ------------------------------------------------------------------
grant select, insert, update on public.records to authenticated;

-- ------------------------------------------------------------------
-- service_role 也要单独授权 —— 「绕过 RLS」不等于「什么都能碰」
--
-- Edge Function 用的是 service_role。它确实绕过 RLS（策略拦不住它），
-- 但表授权是另一道门，照样拦得住 —— 而报出来的错跟没登录、
-- 没策略长得一模一样。
--
-- 这一条漏掉过一次，代价是开局提醒整个发不出去：函数读不到
-- push_subscribers，日志里只有一句 permission denied，
-- 而后台看过去 RLS、策略、grant（给 authenticated 的那几条）
-- 全都正常。
-- ------------------------------------------------------------------
grant select on public.records to service_role;

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

-- ------------------------------------------------------------------
-- 跑完对一下账
--
-- 上面全是「跑了不报错」的语句，成功和「其实只跑了前半段」在
-- SQL Editor 里看起来一样。这一句会把结果打出来，照着看一眼就知道
-- 到底成没成 —— 手机上那条「数据库不让写」的错误，根源多半就是
-- 只跑了建表、权限那几句没跑到。
--
-- 应该看到 8 行：
--   rls                   一行 true
--   grant:authenticated   三行 SELECT / INSERT / UPDATE（缺了就 permission denied）
--   grant:service_role    一行 SELECT（缺了 Edge Function 读不到开局的人叫什么）
--   policy                三行 读 / 新增 / 修改
--
-- grant 那几行少了任何一行，对应的操作都会失败 —— 而且失败的样子和
-- 「策略没建好」一模一样，光看手机上的报错分不出来。
-- ------------------------------------------------------------------
select 'rls' as 项目, relrowsecurity::text as 值
from pg_class where oid = 'public.records'::regclass
union all
select 'grant:' || grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'records'
  and grantee in ('authenticated', 'service_role')
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
union all
select 'policy', polname from pg_policy where polrelid = 'public.records'::regclass;
