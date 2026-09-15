-- ===================================================================
-- 反馈
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 012 要已经跑过（管理员名单在那边建的）。
--
-- -------------------------------------------------------------------
-- 为什么现在要有这个
--
-- 到今天为止，发现 bug 的方式只有一条：球主自己在球场上撞见了，
-- 回来说一句。别人遇到的问题，他永远不会知道 ——
-- 而球群一旦不止一个，这个样本就彻底不够用了。
--
-- 一个装了 App 的陌生人现在撞上问题，手上没有任何出路：
-- App 里没有反馈入口，仓库地址他也不知道。他只会默默卸载。
--
-- -------------------------------------------------------------------
-- 和举报不是一回事
--
--   举报  是「这个人有问题」。对象是人，要留证据，要防滥用，
--         被举报的人一个字都不该看到
--   反馈  是「这个 App 有问题」。对象是软件，没有第三方，
--         也没有什么可隐瞒的
--
-- 所以这张表简单得多：没有证据快照、没有唯一索引防刷、
-- 没有「不能自带结论」那一堆判断。滥用的后果只是球主多看几条废话，
-- 不是有人被冤枉。
--
-- -------------------------------------------------------------------
-- 自动带上版本号和设备
--
-- 「我这里打不开」这句话，没有版本号和机型的话，什么都查不了 ——
-- 而且撞上问题的人多半也答不上来自己跑的是哪一版。
--
-- 所以这两栏由 App 自己填，不问人要。它们不是隐私：
-- 版本号是公开的构建号，设备串是浏览器本来就发给每个网站的那一行。
-- ===================================================================

begin;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  -- 谁提的。默认值由数据库填，客户端伪造不了
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  /*
   * 分三类就够了。再细的分类是给有客服团队的人用的，
   * 而这里看反馈的人和写代码的是同一个。
   */
  kind text not null check (kind in ('bug', 'idea', 'other')),
  body text not null check (char_length(body) between 1 and 2000),
  -- App 自己填的，用来复现问题
  app_build text,
  device text,
  status text not null default 'open' check (status in ('open', 'done')),
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

-- 没处理的排前面，按时间翻
create index if not exists feedback_open_time
  on public.feedback (created_at desc) where status = 'open';

alter table public.feedback enable row level security;

/*
 * 表级权限。RLS 和 GRANT 是两道门，都得开 —— 这一条在 009 和 012
 * 里各栽过一次，这次照着策略来发：
 *   提反馈、看自己提的、撤回自己的、管理员标记处理完
 */
grant select, insert, update, delete on public.feedback to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    -- 推送那个函数只读，用来知道「这条是谁提的、写了什么」
    grant select on public.feedback to service_role;
  end if;
end $$;

/*
 * 提过的话不许改。
 *
 * 管理员对这一行有 update 权限（他要标「处理完了」），而 with check
 * 拦不住他顺手把内容改了。和 012 里那个触发器同一个道理。
 */
create or replace function public.keep_feedback_text() returns trigger
language plpgsql as $fn$
begin
  new.author     := old.author;
  new.kind       := old.kind;
  new.body       := old.body;
  new.app_build  := old.app_build;
  new.device     := old.device;
  new.created_at := old.created_at;
  if new.status is distinct from old.status then
    new.handled_by := case when new.status = 'open' then null else auth.uid() end;
    new.handled_at := case when new.status = 'open' then null else now() end;
  else
    new.handled_by := old.handled_by;
    new.handled_at := old.handled_at;
  end if;
  return new;
end
$fn$;

drop trigger if exists feedback_keep_text on public.feedback;
create trigger feedback_keep_text
  before update on public.feedback
  for each row execute function public.keep_feedback_text();

-- ---------- 策略 ----------

-- 读：自己提的，加上管理员看全部
drop policy if exists "自己的反馈和管理员看得到" on public.feedback;
create policy "自己的反馈和管理员看得到"
  on public.feedback for select to authenticated
  using (author = auth.uid() or public.is_admin(auth.uid()));

-- 提：以自己的身份，开着的状态，不能自带结论
drop policy if exists "只能以自己的身份提反馈" on public.feedback;
create policy "只能以自己的身份提反馈"
  on public.feedback for insert to authenticated
  with check (
    author = auth.uid()
    and status = 'open'
    and handled_by is null
    and handled_at is null
  );

-- 改状态：只有管理员
drop policy if exists "只有管理员能标记处理完" on public.feedback;
create policy "只有管理员能标记处理完"
  on public.feedback for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

/*
 * 撤回：只能撤自己的，而且只在还没处理之前。
 * 打错字了想重提是很正常的事。
 */
drop policy if exists "没处理之前可以撤回自己的反馈" on public.feedback;
create policy "没处理之前可以撤回自己的反馈"
  on public.feedback for delete to authenticated
  using (author = auth.uid() and status = 'open');

-- ===================================================================
-- 自检
-- ===================================================================
select '反馈表建好了吗' as 项,
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'feedback'
       ) then '建好了' else '没有 —— 上面那步没成功' end as 值
union all
select 'feedback 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.feedback'::regclass
union all
select '守住「提过的话不许改」的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.feedback'::regclass and tgname = 'feedback_keep_text'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '我要的那 4 项权限齐了吗',
       case when (
         select count(*) from (values
           ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
         ) as need(p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated' and g.table_schema = 'public'
             and g.table_name = 'feedback' and g.privilege_type = need.p
         )
       ) = 4 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '现在有几个管理员（没有的话反馈没人看得到）',
       case when (select count(*) from public.app_admins) = 0
            then '一个都没有 —— 回去跑 012 最后那句 SQL'
            else (select count(*)::text from public.app_admins) end;

notify pgrst, 'reload schema';

commit;
