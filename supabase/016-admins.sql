-- ===================================================================
-- 多个管理员
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 012（举报和管理员名单）要已经跑过。
--
-- -------------------------------------------------------------------
-- 先说清楚这次加的人能看到什么
--
-- 管理员是**全 App 的**，不是按球群分的。加一个人进这张表，他就
-- 看得到：所有球群的每一条举报，以及每条举报里附的那段私聊记录。
--
-- 那些聊天是两个人之间的话，他们没同意给第三个人看 —— 是这个 App
-- 替他们决定了「出事的时候要有人能看」。所以这张名单上多一个人，
-- 就是多一个人有这个权力。**只加你真信得过的人。**
--
-- 这不是修辞。之前有一次，管理员是照着邮箱地址加的，而那个邮箱
-- 是球群里另一个人的 —— 邮箱看起来对，人不对。一个字都不会报错，
-- 只是名单上多了个不该在的人。
--
-- 所以这次改的重点不是「能加几个」（一直都能加），而是**怎么加**：
--
--   以前：到后台手敲 uuid 或者对邮箱。对错了没有任何提示。
--   现在：在 App 里从球群成员里点一个名字，uid 跟着人走。
--         点错了顶多是点错了名字，而名字你认得。
--
-- -------------------------------------------------------------------
-- 两级：owner 和普通管理员
--
--   owner   能改这张名单（加人、去人、给人 owner）
--   admin   只能处理举报、看反馈和报错
--
-- 分两级是因为「处理举报」和「决定谁能处理举报」是两件事。
-- 都揉成一个的话，你请来帮忙看一晚上队列的人，顺手就能把你去掉。
--
-- 至少留一个 owner，最后一个删不掉、也降不了级 —— 见下面的触发器。
-- 没有那道闸的话，这张表可以变成空的，而空了之后**没有任何人**
-- 能再往里加人，只能回后台跑 SQL。
-- ===================================================================

begin;

-- ===================================================================
-- 一、多一列
-- ===================================================================

alter table public.app_admins
  add column if not exists owner boolean not null default false;

/*
 * 把现在这个管理员升成 owner。
 *
 * 只在一个 owner 都没有的时候做（也就是只在第一次跑这个文件时），
 * 挑最早加进来的那一个 —— 那就是你自己。
 *
 * 重复跑不会再动它：已经有 owner 了，下面那个 not exists 就是假。
 */
update public.app_admins
   set owner = true
 where uid = (select uid from public.app_admins order by created_at limit 1)
   and not exists (select 1 from public.app_admins where owner);

-- ===================================================================
-- 二、「他是不是 owner」
-- ===================================================================

/*
 * 和 is_admin 一样必须 security definer。
 *
 * 下面的策略要判「当前这个人是不是 owner」，而普通身份在这张表上
 * 只看得到自己那一行 —— 普通管理员查不到别人是不是 owner，
 * 这个判断在策略里会永远是假，整张表就锁死了。
 *
 * 只吐一个真假，问不出名单里都有谁。
 */
create or replace function public.is_owner(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where uid = u and owner);
$$;

grant execute on function public.is_owner(uuid) to authenticated;

-- ===================================================================
-- 三、最后一个 owner 动不得
-- ===================================================================

/*
 * 删掉最后一个 owner，或者把最后一个 owner 降成普通管理员，都不行。
 *
 * 这道闸挡的是一个没有回头路的状态：名单上没有 owner 之后，
 * App 里再没有任何人能改这张名单 —— 包括剩下的那些管理员 ——
 * 只能回后台跑 SQL 才救得回来。
 *
 * 为什么用触发器而不是 RLS：with check 看不见「删完之后还剩几个」。
 * 这是「跨行的不变量」，策略表达不了，只有触发器做得到。
 */
create or replace function public.keep_one_owner() returns trigger
language plpgsql as $fn$
begin
  /* 这一次动的不是 owner，随便动 */
  if tg_op = 'DELETE' and not old.owner then
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.owner = false or new.owner = true) then
    return new;
  end if;

  if (select count(*) from public.app_admins where owner) <= 1 then
    raise exception '至少要留一个 owner —— 先给别人 owner，再把自己去掉'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$fn$;

drop trigger if exists app_admins_keep_owner on public.app_admins;
create trigger app_admins_keep_owner
  before update or delete on public.app_admins
  for each row execute function public.keep_one_owner();

-- ===================================================================
-- 四、权限
--
-- RLS 和 GRANT 是两道门，都得开。012 那边只发了 select，
-- 因为那时候加管理员只有后台一条路。现在 App 里要改这张表了。
-- ===================================================================

grant select, insert, update, delete on public.app_admins to authenticated;

-- ===================================================================
-- 五、策略
-- ===================================================================

/*
 * 读：自己那一行，加上 owner 看全部。
 *
 * 012 里那条只让人看到自己，理由是「管理员名单公开的话，想骚扰的人
 * 就知道该绕开谁」。那条理由现在还成立，所以普通管理员依然只看得到
 * 自己 —— 放开的只有 owner，而他本来就是管这张名单的人。
 */
drop policy if exists "只知道自己是不是管理员" on public.app_admins;
drop policy if exists "自己那一行，owner 看全部" on public.app_admins;
create policy "自己那一行，owner 看全部"
  on public.app_admins for select to authenticated
  using (uid = auth.uid() or public.is_owner(auth.uid()));

/*
 * 加人、去人、改级别：只有 owner。
 *
 * insert 的 with check 里再判一次 is_owner，不是多余的 ——
 * 没有它的话，任何登录用户都能往这张表里塞一行把自己变成管理员。
 * 这是这个文件里最要紧的一条。
 */
drop policy if exists "只有 owner 能加管理员" on public.app_admins;
create policy "只有 owner 能加管理员"
  on public.app_admins for insert to authenticated
  with check (public.is_owner(auth.uid()));

drop policy if exists "只有 owner 能改管理员" on public.app_admins;
create policy "只有 owner 能改管理员"
  on public.app_admins for update to authenticated
  using (public.is_owner(auth.uid()))
  with check (public.is_owner(auth.uid()));

drop policy if exists "只有 owner 能去掉管理员" on public.app_admins;
create policy "只有 owner 能去掉管理员"
  on public.app_admins for delete to authenticated
  using (public.is_owner(auth.uid()));

-- ===================================================================
-- 自检
-- ===================================================================
select 'owner 这一列加上了吗' as 项,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'app_admins'
           and column_name = 'owner'
       ) then '加上了' else '没有 —— 上面那步没成功' end as 值
union all
select 'app_admins 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.app_admins'::regclass
union all
select '守住「最后一个 owner」的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.app_admins'::regclass
           and tgname = 'app_admins_keep_owner'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select 'is_owner 这个函数有了吗',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_owner'
       ) then '有' else '没有' end
union all
select '我要的那 4 项权限齐了吗',
       case when (
         select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as need(p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated' and g.table_schema = 'public'
             and g.table_name = 'app_admins' and g.privilege_type = need.p
         )
       ) = 4 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '现在有几个 owner（应该是 1，就是你）',
       case when (select count(*) from public.app_admins where owner) = 0
            then '一个都没有 —— 说明这张表原本是空的，回去跑 012 最后那句'
            else (select count(*)::text from public.app_admins where owner) end;

notify pgrst, 'reload schema';

commit;
