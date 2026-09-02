-- ===================================================================
-- 开局提醒：存订阅的表 + 触发推送的 Webhook 要用的东西
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- 跑之前先确认 001-records.sql 已经跑过（尤其是 grant 那几句）。
-- ===================================================================

-- ------------------------------------------------------------------
-- 一台手机一条订阅
--
-- endpoint 当主键：它本来就是浏览器给这台设备发的唯一地址。
-- 同一个人重复开关不会堆出一堆行；换了手机就是另一个 endpoint，
-- 两台都收得到 —— 这正是想要的。
-- ------------------------------------------------------------------
create table if not exists public.push_subscribers (
  endpoint text primary key,
  -- 加密推送内容要用的两把钥匙，浏览器给的，原样存着
  p256dh text not null,
  auth text not null,
  -- 谁订的。用来「开局的人自己不收自己那条通知」
  player_id text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 这条订阅属于哪个登录账号
--
-- 加它是为了把「谁能碰这一行」说清楚。默认值就是 auth.uid()，
-- 客户端不用传 —— 传了反而给了它冒充别人的机会。
-- ------------------------------------------------------------------
alter table public.push_subscribers
  add column if not exists user_id uuid default auth.uid();

-- 早于 user_id 的那些行没有主人：客户端改不了也删不掉，只会变成
-- 推不动又清不掉的僵尸。反正订阅是「点一下开关」就能重建的东西，
-- 直接清掉最省事。
delete from public.push_subscribers where user_id is null;

-- ------------------------------------------------------------------
-- 权限：每个人只碰得到自己那几条
--
-- 第一版是「只给写、不给读」，想的是订阅地址该藏起来，而客户端
-- 反正只管写自己那条。这个想法是错的，而且错得很隐蔽：
--
--   · 写订阅走的是 upsert（INSERT ... ON CONFLICT DO UPDATE），
--     Postgres 要求对这张表有 SELECT 权限 —— 它得先看得见冲突的
--     那一行，才谈得上更新
--   · 退订走的是 DELETE ... WHERE endpoint = ...，WHERE 里引用了
--     endpoint，同样要 SELECT 权限
--
-- 于是「打开开局提醒」直接报 permission denied。更难认的是中间态：
-- 光补表权限、不补 SELECT 策略的话，DELETE 不报错，只是删掉 0 行 ——
-- 退订看着成功，其实那条订阅还在。
--
-- 所以正确的做法不是不给 SELECT，而是给了 SELECT、再用策略把行框死：
-- 权限放开到表这一层，能看到哪几行由 user_id = auth.uid() 决定。
-- 真正要读全表的是 Edge Function，它走 service_role，绕过 RLS。
-- ------------------------------------------------------------------
grant select, insert, update, delete on public.push_subscribers to authenticated;

-- ------------------------------------------------------------------
-- service_role：Edge Function 靠它读到所有人的订阅
--
-- 「service_role 绕过 RLS」是真的，但绕过的只有策略这道门 ——
-- 表授权那道门照样把它挡在外面，而报的错跟没登录、没策略长得
-- 一模一样。这一条漏掉过一次，推送整个发不出去，而后台一路看过去
-- RLS 开着、策略齐全、给 authenticated 的 grant 也在，全都正常。
--
-- delete 也要给：推不动的死订阅（410 Gone）由函数自己清掉。
-- ------------------------------------------------------------------
grant select, insert, update, delete on public.push_subscribers to service_role;

alter table public.push_subscribers enable row level security;

-- 老版本的策略名，重复跑时先清掉
drop policy if exists "登录的人可以订阅" on public.push_subscribers;
drop policy if exists "登录的人可以更新自己的订阅" on public.push_subscribers;
drop policy if exists "登录的人可以退订" on public.push_subscribers;

drop policy if exists "只看得到自己的订阅" on public.push_subscribers;
create policy "只看得到自己的订阅"
  on public.push_subscribers for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "只能订自己的" on public.push_subscribers;
create policy "只能订自己的"
  on public.push_subscribers for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "只能改自己的" on public.push_subscribers;
create policy "只能改自己的"
  on public.push_subscribers for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "只能退自己的" on public.push_subscribers;
create policy "只能退自己的"
  on public.push_subscribers for delete
  to authenticated
  using (user_id = auth.uid());

-- 让 PostgREST 立刻重新认一遍表结构和权限，不用等它自己刷新缓存 ——
-- 否则刚跑完的那几分钟，客户端拿到的还是「没这一列」「没权限」
notify pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- 跑完对一下账
--
-- 应该看到 14 行：
--   rls                   一行 true
--   user_id 列            一行 uuid
--   grant:authenticated   四行 SELECT / INSERT / UPDATE / DELETE
--   grant:service_role    四行 SELECT / INSERT / UPDATE / DELETE
--   policy                四行（看 / 订 / 改 / 退，全部按 user_id 框死）
--
-- 少了 authenticated 的 SELECT，手机上点「打开开局提醒」会直接报
-- permission denied；少了那条 select 策略，退订会静悄悄地删掉 0 行。
-- ------------------------------------------------------------------
select 'rls' as 项目, relrowsecurity::text as 值
from pg_class where oid = 'public.push_subscribers'::regclass
union all
select 'column:user_id', data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'push_subscribers' and column_name = 'user_id'
union all
select 'grant:' || grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'push_subscribers'
  and grantee in ('authenticated', 'service_role')
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
union all
select 'policy', polname from pg_policy where polrelid = 'public.push_subscribers'::regclass;
