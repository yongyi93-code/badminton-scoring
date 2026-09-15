-- ===================================================================
-- 自动报错
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 012（管理员名单）要已经跑过。
--
-- -------------------------------------------------------------------
-- 为什么反馈不够
--
-- 014 那个「说点什么」只收得到**人家注意到、而且愿意打字告诉你**
-- 的那部分。而最该知道的那几类 —— 白屏、点了没反应、一进去就退出
-- —— 人多半不会打字，只会卸载。
--
-- 所以这张表收的是 App 自己撞上的异常：没接住的报错和 Promise。
--
-- -------------------------------------------------------------------
-- 这张表最大的风险是「量」，不是别的
--
-- 一个渲染循环里的错误，一秒能报几百条。免费版数据库 500 MB，
-- 淹掉它比想象中容易，而且淹掉之后真正的那条也就看不见了。
--
-- 挡在三层：
--   1. 客户端同一个错一次会话只报一次（见 lib/errorlog.ts）
--   2. 客户端一次会话最多报 5 条
--   3. 这里：每一栏都有长度上限，堆栈截断到 2000 字
--
-- 第 1、2 层是主力。这一层是兜底 —— 客户端那两层是可以被绕过的
-- （改一行 JS 就行），而这一层不行。
--
-- -------------------------------------------------------------------
-- 不收什么
--
-- **不收完整网址。** 重设密码那条链接回来时，地址栏里是
-- `#access_token=...`，而那是一把能登录的钥匙。真在那一屏上崩了，
-- 把网址原样存进数据库等于把钥匙抄了一份留在日志里。
-- 所以客户端只报「当时在哪一屏」（路由名），不报地址。
--
-- 也不收用户输入、消息内容、任何人的名字。
-- ===================================================================

begin;

create table if not exists public.errors (
  id uuid primary key default gen_random_uuid(),
  /*
   * 谁撞上的。默认值由数据库填。
   *
   * 只收登录之后的 —— 没登录的时候根本没有身份，要收就得给
   * anon 开一个谁都能写的口子，那是往免费版数据库上开一个
   * 没有门的洞。代价是登录之前的崩溃收不到，这一条记在
   * ROADMAP 里，不假装没有。
   */
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- 报错本身。太长的没有信息量，截断了反而好读
  message text not null check (char_length(message) between 1 and 500),
  stack text check (stack is null or char_length(stack) <= 2000),
  /*
   * 当时在哪一屏（路由名，比如 'score'、'board'）。
   * 不是网址 —— 网址里可能有令牌，见文件开头。
   */
  route text check (route is null or char_length(route) <= 60),
  app_build text check (app_build is null or char_length(app_build) <= 40),
  device text check (device is null or char_length(device) <= 120),
  /*
   * 同一个错的指纹（报错文本 + 第一帧堆栈算出来的）。
   * 管理员那一屏靠它把「同一个 bug 撞了 40 次」收成一行。
   */
  fingerprint text not null check (char_length(fingerprint) between 1 and 64),
  status text not null default 'open' check (status in ('open', 'done')),
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists errors_open_time
  on public.errors (created_at desc) where status = 'open';
create index if not exists errors_fingerprint
  on public.errors (fingerprint, created_at desc);

alter table public.errors enable row level security;

-- RLS 和 GRANT 是两道门，都得开。这一条栽过三次了
grant select, insert, update, delete on public.errors to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.errors to service_role;
  end if;
end $$;

/*
 * 报过的内容不许改。和 012 / 014 里那两个触发器同一个道理：
 * 管理员要能标「看过了」，而 with check 拦不住他顺手改内容。
 */
create or replace function public.keep_error_text() returns trigger
language plpgsql as $fn$
begin
  new.author      := old.author;
  new.message     := old.message;
  new.stack       := old.stack;
  new.route       := old.route;
  new.app_build   := old.app_build;
  new.device      := old.device;
  new.fingerprint := old.fingerprint;
  new.created_at  := old.created_at;
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

drop trigger if exists errors_keep_text on public.errors;
create trigger errors_keep_text
  before update on public.errors
  for each row execute function public.keep_error_text();

-- ---------- 策略 ----------

/*
 * 读：只有管理员。
 *
 * 和反馈不一样 —— 反馈是「我说的话我看得到」，而报错是 App 自己
 * 悄悄报的，本人根本不知道有这回事，给他看一堆堆栈没有任何意义。
 */
drop policy if exists "只有管理员看得到报错" on public.errors;
create policy "只有管理员看得到报错"
  on public.errors for select to authenticated
  using (public.is_admin(auth.uid()));

-- 报：以自己的身份，开着的状态，不能自带结论
drop policy if exists "只能以自己的身份报错" on public.errors;
create policy "只能以自己的身份报错"
  on public.errors for insert to authenticated
  with check (
    author = auth.uid()
    and status = 'open'
    and handled_by is null
    and handled_at is null
  );

drop policy if exists "只有管理员能标记看过" on public.errors;
create policy "只有管理员能标记看过"
  on public.errors for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

/*
 * 删：只有管理员。
 *
 * 这是这张表和别的不一样的一处：报错是会堆积的，而且堆积的是
 * 同一个 bug 的几十份副本。修好之后整批清掉是常规操作，
 * 不是什么危险动作。
 */
drop policy if exists "只有管理员能清掉报错" on public.errors;
create policy "只有管理员能清掉报错"
  on public.errors for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ===================================================================
-- 自检
-- ===================================================================
select '报错表建好了吗' as 项,
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'errors'
       ) then '建好了' else '没有 —— 上面那步没成功' end as 值
union all
select 'errors 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.errors'::regclass
union all
select '守住「报过的内容不许改」的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.errors'::regclass and tgname = 'errors_keep_text'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '我要的那 4 项权限齐了吗',
       case when (
         select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as need(p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated' and g.table_schema = 'public'
             and g.table_name = 'errors' and g.privilege_type = need.p
         )
       ) = 4 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '现在有几个管理员（没有的话报错没人看得到）',
       case when (select count(*) from public.app_admins) = 0
            then '一个都没有 —— 回去跑 012 最后那句 SQL'
            else (select count(*)::text from public.app_admins) end;

notify pgrst, 'reload schema';

commit;
