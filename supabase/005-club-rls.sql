-- ===================================================================
-- 收紧权限：一行数据只有它那个群的人碰得到
--
-- ⚠️ 跑之前必须先跑完 003 和 004。
--    004 没跑的话，老数据的 club_id 还是空的，这段一生效
--    你现有的战绩全部读不到 —— 数据还在，但谁都看不见。
--
--    下面第一段有个检查，空的行不是 0 就直接报错停下，不会让你踩这个坑。
--
-- ------------------------------------------------------------------
-- 这一段替换掉了什么
--
-- 001 里的三条策略全是 using(true)：任何注册的人能读、能改所有行。
-- 那在 8 个熟人的球群里没问题，开放给大众之后意味着 ——
-- 随便谁注册一个账号，就能删掉你一年的战绩。
--
-- 换成：你是这一行所属球群的成员，才碰得到它。
-- ===================================================================

-- ------------------------------------------------------------------
-- 整段包在一个事务里。
--
-- 这不是讲究，是实测出来的：下面那道安全闸单靠 raise exception 挡不住
-- 后面的语句 —— psql 默认每条语句各自提交，闸报了错，DROP POLICY 和
-- CREATE POLICY 照样一条不落地执行完。试过一次：结果是策略换成了按群
-- 隔离，而没归群的那些行对所有人消失。数据还在，谁都看不见。
--
-- 包进事务，闸一报错就整体回滚，一条策略都不会动。
-- ------------------------------------------------------------------
begin;

-- ------------------------------------------------------------------
-- 0. 安全闸：还有没归群的行就不许往下走
-- ------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.records where club_id is null;
  if n > 0 then
    raise exception
      '还有 % 行没有 club_id。先跑 004-migrate-to-club.sql，否则这些数据会变成谁都读不到。', n;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 1. 「我是不是这个群的人」
--
-- 单独抽成函数有两个原因：
--   三条策略共用同一句判断，写三遍迟早改漏一处
--   stable + 走主键，同一条语句里多次调用只算一次
--
-- 不用 security definer：这里读的是 club_members，而那张表的策略
-- 本来就允许「看自己的成员关系」—— 用调用者自己的身份查就够了，
-- 不需要提权。能不提权就不提权。
-- ------------------------------------------------------------------
create or replace function public.is_club_member(cid text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = cid and user_id = auth.uid()
  );
$$;

grant execute on function public.is_club_member(text) to authenticated;

-- ------------------------------------------------------------------
-- 2. 换掉那三条 using(true)
-- ------------------------------------------------------------------
drop policy if exists "登录的人可以读" on public.records;
drop policy if exists "登录的人可以新增" on public.records;
drop policy if exists "登录的人可以修改" on public.records;

drop policy if exists "读自己群的" on public.records;
create policy "读自己群的"
  on public.records for select
  to authenticated
  using (public.is_club_member(club_id));

-- 新增：只能往自己的群里写。
-- club_id 为空也不许 —— 不然就绕过了整套判断，写出一行谁都读不到、
-- 也谁都删不掉的孤儿数据。
drop policy if exists "写进自己群" on public.records;
create policy "写进自己群"
  on public.records for insert
  to authenticated
  with check (club_id is not null and public.is_club_member(club_id));

-- 修改：改前改后都得是自己群的。
-- 两边都要判：只判 using 的话，成员可以把一行的 club_id 改成别的群，
-- 等于往别人群里塞东西。
drop policy if exists "改自己群的" on public.records;
create policy "改自己群的"
  on public.records for update
  to authenticated
  using (public.is_club_member(club_id))
  with check (club_id is not null and public.is_club_member(club_id));

-- 照旧不给 delete：删除走 deleted = true。
-- 真 DELETE 出去，别人的手机下次同步只会把这条又推回来。

-- ------------------------------------------------------------------
-- 3. 自检
-- ------------------------------------------------------------------
select 'policy', polname, case polcmd
  when 'r' then 'select' when 'a' then 'insert'
  when 'w' then 'update' when 'd' then 'delete' else polcmd::text end
from pg_policy where polrelid = 'public.records'::regclass
order by polname;

notify pgrst, 'reload schema';

commit;
