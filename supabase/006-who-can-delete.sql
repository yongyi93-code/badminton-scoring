-- ===================================================================
-- 谁能删：只有建这一行的人
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 003 / 004 / 005 都要已经跑过。
--
-- ------------------------------------------------------------------
-- 为什么现在要这一条
--
-- 「所有人自动进同一个球群」上线之后，全马来西亚的人都在一个群里。
-- 而 005 的策略是「同一个群里的人都能改」—— 那就等于：
-- 任何一个注册过的陌生人，都能删掉你一年的战绩。
--
-- 自己人玩的时候无所谓，开放给大众就不是了。
--
-- ------------------------------------------------------------------
-- 这一条挡住什么、挡不住什么
--
-- 挡住：删别人建的东西（软删除也算，我们的删除就是把 deleted 置 true）
-- 挡不住：改别人建的东西
--
-- 后一半是故意留着的：记分本来就是几个人轮流拿一台手机记，
-- 谁都改不了别人记的那一场，这个 App 当场就没法用了。
--
-- 真正完整的权限（谁能改哪一场、管理员是谁）要等「管理员角色」
-- 那一步，那是另一件事。这一条先把最狠的那一刀挡下来。
--
-- ------------------------------------------------------------------
-- 副作用，用之前想清楚
--
-- 别人记错的那一场，你删不掉了 —— 只能改。
-- 群里如果习惯了「谁看到错就顺手删」，这条会挡着他们。
-- 觉得不合适就把最后那段策略换回 005 的版本。
-- ===================================================================

begin;

-- ------------------------------------------------------------------
-- 1. 记下每一行是谁建的
--
-- 默认值是 auth.uid()：客户端不用传，也传不了假的 —— 它写不进
-- 一个不是自己的 uid，因为默认值是数据库自己填的，而下面的策略
-- 又不允许把它改成别人。
--
-- 老数据这一列是空的。空的一律放行删除：不放行的话，
-- 003 之前建的那些球局谁都删不掉，而那不是我们要的。
-- ------------------------------------------------------------------
alter table public.records
  add column if not exists created_by uuid default auth.uid();

-- ------------------------------------------------------------------
-- 2. 不许改「是谁建的」
--
-- 这一步是测出来的，不是想出来的。
--
-- 只有上面那条策略的话，有一个绕法：把 created_by 改成自己，
-- 同时把 deleted 置成 true —— 一条 UPDATE 干完。策略里的 with check
-- 看的是「改之后」那一行，那时候 created_by 已经是他自己了，check 通过。
-- 在本地 Postgres 上照着这个思路试了一次，真的删掉了。
--
-- 所以得有人守住「这一列不许动」，而 with check 做不到（它看不见旧值）。
-- 触发器看得见：改之前是谁，改之后还是谁。
-- ------------------------------------------------------------------
create or replace function public.keep_created_by() returns trigger
language plpgsql as $fn$
begin
  new.created_by := old.created_by;
  return new;
end
$fn$;

drop trigger if exists records_keep_created_by on public.records;
create trigger records_keep_created_by
  before update on public.records
  for each row execute function public.keep_created_by();

-- ------------------------------------------------------------------
-- 3. 换掉「改自己群的」那条策略
--
-- using     看的是改之前那一行 —— 得是自己群里的
-- with check 看的是改之后那一行 —— 还得是自己群里的，
--            而且如果这一改是「删除」，那得是自己建的
-- ------------------------------------------------------------------
drop policy if exists "改自己群的" on public.records;

create policy "改自己群的" on public.records
  for update to authenticated
  using (public.is_club_member(club_id))
  with check (
    club_id is not null
    and public.is_club_member(club_id)
    and (
      -- 不是在删东西：随便改
      deleted = false
      -- 老数据，没记是谁建的：放行，否则它们永远删不掉
      or created_by is null
      -- 在删东西：得是自己建的
      or created_by = auth.uid()
    )
  );

-- ------------------------------------------------------------------
-- 4. 自检
--
-- 「还没记建立人的行」大于 0 是正常的 —— 那是这次改动之前就有的老数据，
-- 它们按上面的规则一律可删。新写进去的行会自动带上建立人。
-- ------------------------------------------------------------------
select '有 created_by 这一列了吗' as 项,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'records'
           and column_name = 'created_by'
       ) then '有' else '没有 —— 上面那步没成功' end as 值
union all
select 'records 上的策略数（应该是 3）', count(*)::text
from pg_policy where polrelid = 'public.records'::regclass
union all
select '守住建立人的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.records'::regclass
           and tgname = 'records_keep_created_by'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '还没记建立人的行（老数据，可删）', count(*)::text
from public.records where created_by is null
union all
select '已经记了建立人的行', count(*)::text
from public.records where created_by is not null;

commit;
