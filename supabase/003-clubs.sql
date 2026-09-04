-- ===================================================================
-- RALLY 球群：把数据按群隔离
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- ------------------------------------------------------------------
-- 为什么要这个
--
-- 现在所有人共用一张表，策略是 using(true)：任何注册的人能读、能改、
-- 能删任何一行。8 个熟人的球群无所谓，开放给全马来西亚就是三个问题
-- 挤在一起 ——
--
--   权限：陌生人能删掉你一年的战绩
--   流量：每台手机都要把全国的数据拉一遍
--   产品：首页会列出你根本不认识的人开的局
--
-- 三个问题只有一个解法：一行数据属于哪个球群，只有那个群的人碰得到。
--
-- ------------------------------------------------------------------
-- 为什么成员关系单独一张表，不塞进 club 那条记录里
--
-- 塞进去的话，每个人加入都要改同一行 —— 而「谁能改这一行」正是我们
-- 要用它来判断的东西，绕回去了。
--
-- 单独一张表，一个人一行，自己那行自己建：加入群是「插入我自己的
-- 成员行」，谁也改不了别人的。RLS 判断也就成了一句子查询，走主键索引。
-- ===================================================================

-- ------------------------------------------------------------------
-- 1. 成员表
-- ------------------------------------------------------------------
create table if not exists public.club_members (
  club_id text not null,
  -- 默认 auth.uid()：客户端不用传，也传不了假的
  user_id uuid not null default auth.uid(),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- 「我在哪些群」要频繁查（每次 RLS 判断都查），按 user_id 建索引
create index if not exists club_members_user_idx
  on public.club_members (user_id);

alter table public.club_members enable row level security;

grant select, insert, delete on public.club_members to authenticated;
grant select on public.club_members to service_role;

-- 看得到自己的成员关系就够了。
-- 「这个群有哪些人」不从这里读 —— 那是 records 里的 player 行，
-- 有名字有头像；这张表只有 uuid，读了也没用。
drop policy if exists "看自己的成员关系" on public.club_members;
create policy "看自己的成员关系"
  on public.club_members for select
  to authenticated
  using (user_id = auth.uid());

-- 加入 = 插入自己那行。user_id 有 default auth.uid()，
-- with check 再挡一道：传别人的 uid 进来会被拒。
drop policy if exists "自己加入" on public.club_members;
create policy "自己加入"
  on public.club_members for insert
  to authenticated
  with check (user_id = auth.uid());

-- 退群 = 删自己那行。删不了别人的。
drop policy if exists "自己退出" on public.club_members;
create policy "自己退出"
  on public.club_members for delete
  to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------------
-- 2. records 加上 club_id
--
-- 为什么是独立的列，不是 data 里的一个字段：RLS 每次读写都要判断它，
-- 得走索引。JSONB 里的字段也能建索引，但写法绕、优化器也更难办 ——
-- 一个天天要用的判据，值得一个真正的列。
--
-- 先允许为空：这一步跑完，老数据还没归群，客户端也还没开始写这个字段。
-- 收紧留到最后一步（005），中间这段时间新旧客户端都能正常跑。
-- ------------------------------------------------------------------
alter table public.records add column if not exists club_id text;

-- 拉取的主力查询是「我这个群的、比上次新的」，两个条件一起走这个索引
create index if not exists records_club_updated_idx
  on public.records (club_id, updated_at);

-- ------------------------------------------------------------------
-- 3. 邀请码查群：唯一一个「跨群可读」的口子
--
-- 加群的人在加入之前不是成员，按 RLS 读不到那条 club 记录 ——
-- 也就查不到邀请码对应哪个群，加不进去。
--
-- 开一个函数专门做这件事：只按邀请码查，只回 id 和名字，
-- 不回成员、不回任何球局数据。security definer 让它绕过 RLS，
-- 但它能做的事就这么点。
--
-- 邀请码本身当密码用 —— 猜不到就进不来。
-- ------------------------------------------------------------------
create or replace function public.club_by_code(invite_code text)
returns table (id text, name text)
language sql
security definer
set search_path = public
as $$
  select r.id, r.data->>'name'
  from public.records r
  where r.kind = 'club'
    and r.deleted = false
    and upper(r.data->>'code') = upper(trim(invite_code))
  limit 1;
$$;

revoke all on function public.club_by_code(text) from public;
grant execute on function public.club_by_code(text) to authenticated;

-- ------------------------------------------------------------------
-- 4. 自检：跑完应该看到
--      club_members  三条策略（看 / 加入 / 退出）
--      records       多了 club_id 这一列
--      club_by_code  一行
-- ------------------------------------------------------------------
select 'policy:club_members', polname
from pg_policy where polrelid = 'public.club_members'::regclass
union all
select 'column:records', column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'records' and column_name = 'club_id'
union all
select 'function', proname::text
from pg_proc where proname = 'club_by_code';

notify pgrst, 'reload schema';
