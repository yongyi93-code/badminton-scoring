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
-- Edge Function。
-- ------------------------------------------------------------------
grant insert, update, delete on public.push_subscribers to authenticated;

-- ------------------------------------------------------------------
-- service_role：Edge Function 靠它读到所有人的订阅
--
-- 这一条最初漏了，推送整个发不出去，而且极难认：
-- 「service_role 绕过 RLS」是真的，但绕过的只有策略这道门，
-- 表授权那道门照样把它挡在外面 —— 报的错跟没登录、没策略
-- 长得一模一样。后台一路看过去 RLS 开着、三条策略齐全、
-- 给 authenticated 的 grant 也在，全都正常，就是读不到。
--
-- delete 也要给：推不动的死订阅（410 Gone）由函数自己清掉。
-- ------------------------------------------------------------------
grant select, insert, update, delete on public.push_subscribers to service_role;

-- 让 PostgREST 立刻重新认一遍权限，不用等它自己刷新缓存 ——
-- 否则刚 grant 完那几分钟，函数拿到的还是「没权限」
notify pgrst, 'reload schema';

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
-- 应该看到 8 行：
--   rls                   一行 true
--   grant:authenticated   三行 INSERT / UPDATE / DELETE
--                         （没有 SELECT 是对的 —— 客户端不该读别人的订阅）
--   grant:service_role    四行 SELECT / INSERT / UPDATE / DELETE
--                         （SELECT 缺了，开局提醒一条都发不出去）
-- ------------------------------------------------------------------
select 'rls' as 项目, relrowsecurity::text as 值
from pg_class where oid = 'public.push_subscribers'::regclass
union all
select 'grant:' || grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'push_subscribers'
  and grantee in ('authenticated', 'service_role')
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
