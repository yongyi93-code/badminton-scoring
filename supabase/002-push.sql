-- ===================================================================
-- 开局提醒：存订阅的表 + 触发推送的 Webhook 要用的东西
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- 跑之前先确认 001-records.sql 已经跑过（尤其是 grant 那句）。
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
-- 权限：登录的人能给自己订阅、能退订，但看不到别人的订阅
--
-- 为什么不给 select：订阅表里是每个人的推送地址，属于该藏起来的东西。
-- 而客户端根本不需要读它 —— 它只管写自己那条。真正要读全表的是
-- Edge Function，那边用 service_role，绕过 RLS。
-- ------------------------------------------------------------------
grant insert, update, delete on public.push_subscribers to authenticated;

alter table public.push_subscribers enable row level security;

drop policy if exists "登录的人可以订阅" on public.push_subscribers;
create policy "登录的人可以订阅"
  on public.push_subscribers for insert
  to authenticated
  with check (true);

drop policy if exists "登录的人可以更新自己的订阅" on public.push_subscribers;
create policy "登录的人可以更新自己的订阅"
  on public.push_subscribers for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "登录的人可以退订" on public.push_subscribers;
create policy "登录的人可以退订"
  on public.push_subscribers for delete
  to authenticated
  using (true);

-- ------------------------------------------------------------------
-- 跑完对一下账
--
-- 应该看到 4 行：rls 一行 true，grant 三行（INSERT / UPDATE / DELETE）。
-- 没有 SELECT 是对的 —— 见上面。
-- ------------------------------------------------------------------
select 'rls' as 项目, relrowsecurity::text as 值
from pg_class where oid = 'public.push_subscribers'::regclass
union all
select 'grant', privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'push_subscribers'
  and grantee = 'authenticated';
