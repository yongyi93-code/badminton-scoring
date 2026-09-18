-- ===================================================================
-- 朋友圈：评论
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 024（朋友圈）、025（封号）、026（公开）要已经跑过。
--
-- -------------------------------------------------------------------
-- 为什么这一步值得做
--
-- 只能点赞的时间线是个**广播**，不是社交。一个人发了「今晚三缺一」，
-- 十个赞回答不了「几点？哪个馆？」——而那正是这个 App 里最常见的
-- 一句话。
--
-- -------------------------------------------------------------------
-- 看得到那条动态，就看得到它下面所有的评论
--
-- 微信不是这样的：那边只让你看到**共同好友**的评论。我们不抄那一条，
-- 而且这是个决定，不是偷懒：
--
--   · 这个 App 的一群人多半互相都认识（一个球群十几个人）
--   · 「有人回了但你看不见」会让对话断掉，而对话正是这一步的目的
--   · 那条规则要在策略里再套一层「评论者和看的人是不是好友」，
--     而每多一层，写错一次的代价就是一次内容泄漏
--
-- 代价说清楚：A 的动态下面 B 和 C 各留了一句，而 B 和 C 互相不认识 ——
-- B 看得到 C 说了什么。名字未必看得到（profiles 的策略还是
-- 自己/好友/同群/发过公开动态），那种情况下显示「不认识的人」。
--
-- 哪天真的需要微信那条规则，改的是下面这一条读策略，不是一堆地方。
--
-- -------------------------------------------------------------------
-- 删得掉的有两种人，理由不一样
--
--   评论的人自己   收回自己说过的话
--   **动态的作者**  这是你的地盘 —— 别人在你家门口喷漆，你得能擦掉，
--                   而不是只能等管理员
--
-- 管理员那一路是**下架**不是删：留着证据。和动态那边同一条（025）。
--
-- -------------------------------------------------------------------
-- 评论不能改
--
-- 和动态、语音消息同一条规矩：改过的评论意味着别人回的那句话突然
-- 对不上原文了。要改就是删了重发。
-- ===================================================================

begin;

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  /*
   * 500 字。比动态正文（1000）短一半：评论是接话，不是发表 ——
   * 一条比原帖还长的评论，在手机上会把整条动态淹掉。
   */
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  /* 管理员下架。作者自己还看得到（和动态那边一样，025） */
  hidden_at timestamptz,
  hidden_by uuid references auth.users(id) on delete set null
);

/* 一条动态下面按时间顺着读。评论顺着排，不像动态那样倒着 —— 对话要顺着看 */
create index if not exists post_comments_post
  on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;
/* RLS 和 GRANT 是两道门，都得开 —— 这个仓库栽过好几次 */
grant select, insert, update, delete on public.post_comments to authenticated;

/*
 * 读：看得到那条动态，就看得到它下面的评论。
 *
 * 靠的是 **RLS 会套进策略里的子查询**：下面这个 exists 去查 posts 的
 * 时候，posts 自己那条读策略照样生效（自己 / 好友 / 公开，减去拉黑、
 * 减去下架的）。不用把那一长串条件再抄一遍 —— 抄一遍就有了两份，
 * 而它们迟早会不一样。点赞那张表（024）用的是同一招。
 *
 * 被下架的评论：只有写它的人和管理员还看得到。让作者看得到是故意的，
 * 和动态那边同一条理由 —— 一条悄悄消失的评论，他只会以为没发出去，
 * 然后再发一遍。
 */
drop policy if exists "看得到那条动态就看得到评论" on public.post_comments;
create policy "看得到那条动态就看得到评论"
  on public.post_comments for select to authenticated
  using (
    exists (select 1 from public.posts p where p.id = post_id)
    and (hidden_at is null or author = auth.uid() or public.is_admin(auth.uid()))
  );

/* 写：以自己的身份，而且只能评自己看得到的那条动态 */
drop policy if exists "只能以自己的身份评论" on public.post_comments;
create policy "只能以自己的身份评论"
  on public.post_comments for insert to authenticated
  with check (
    author = auth.uid()
    and hidden_at is null
    and exists (select 1 from public.posts p where p.id = post_id)
  );

/*
 * 删：自己说的话，或者**自己动态下面的**任何一句。
 *
 * 后半句是这张表上最容易被忘掉的一条权限：这是你的地盘。
 * 没有它的话，别人在你的动态下面留一句难听的，你只能等管理员 ——
 * 而管理员可能明天才看手机。
 */
drop policy if exists "自己的评论和自己动态下面的" on public.post_comments;
create policy "自己的评论和自己动态下面的"
  on public.post_comments for delete to authenticated
  using (
    author = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid())
  );

/* 改：只有管理员，而且只翻得动「下架」那一个开关（见下面的触发器） */
drop policy if exists "只有管理员能下架评论" on public.post_comments;
create policy "只有管理员能下架评论"
  on public.post_comments for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

/*
 * 说过的话不许改 —— 连管理员也不行。
 *
 * 他有 update 权限（要下架），而 with check 看不见旧值，所以这一层
 * 只能是触发器。created_at 也钉死：不然可以把一句话挪到别人那句
 * 前面去，而对话是靠顺序读的。
 */
create or replace function public.keep_comment_facts() returns trigger
language plpgsql as $fn$
begin
  new.post_id    := old.post_id;
  new.author     := old.author;
  new.body       := old.body;
  new.created_at := old.created_at;
  if (new.hidden_at is null) is distinct from (old.hidden_at is null) then
    new.hidden_at := case when new.hidden_at is null then null else now() end;
    new.hidden_by := case when new.hidden_at is null then null else auth.uid() end;
  else
    new.hidden_at := old.hidden_at;
    new.hidden_by := old.hidden_by;
  end if;
  return new;
end
$fn$;

drop trigger if exists comments_keep_facts on public.post_comments;
create trigger comments_keep_facts
  before update on public.post_comments
  for each row execute function public.keep_comment_facts();

/*
 * 插入时也钉一次时间。
 *
 * 和动态那边（024 的 guard_post）同一条：不钉的话可以伪造一条
 * 「三年前说的」插到对话中间去。
 */
create or replace function public.stamp_comment() returns trigger
language plpgsql as $fn$
begin
  new.created_at := now();
  return new;
end
$fn$;

drop trigger if exists comments_stamp on public.post_comments;
create trigger comments_stamp
  before insert on public.post_comments
  for each row execute function public.stamp_comment();

/*
 * 被禁言的人评论不了。
 *
 * 和私信、动态、点赞同一条（025）—— 评论是这几样里最像「说话」的，
 * 漏掉它等于禁言只禁了一半，而被骚扰的人会在自己的动态下面
 * 一条条看着他接着说。
 */
drop trigger if exists comments_not_silenced on public.post_comments;
create trigger comments_not_silenced
  before insert on public.post_comments
  for each row execute function public.block_if_silenced();

-- ===================================================================
-- 自检
-- ===================================================================
select 'post_comments 这张表建好了吗' as 项,
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'post_comments'
       ) then '建好了' else '没有 —— 上面那步没成功' end as 值
union all
select 'post_comments 的策略数（应该是 4：读 / 写 / 删 / 下架）', count(*)::text
from pg_policy where polrelid = 'public.post_comments'::regclass
union all
select '被禁言的人评论不了吗（触发器在不在）',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.post_comments'::regclass
           and tgname = 'comments_not_silenced'
       ) then '在' else '不在 —— 禁言只禁了一半' end
union all
select '「说过的话不许改」那个触发器在不在',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.post_comments'::regclass
           and tgname = 'comments_keep_facts'
       ) then '在' else '不在' end
union all
select '时间戳由数据库盖吗（挡住伪造顺序）',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.post_comments'::regclass and tgname = 'comments_stamp'
       ) then '是' else '不是' end
union all
select '删除那条策略认得「动态的作者」吗（你的地盘你能擦）',
       case when exists (
         select 1 from pg_policy
         where polrelid = 'public.post_comments'::regclass
           and polcmd = 'd'
           and pg_get_expr(polqual, polrelid) like '%p.author = auth.uid()%'
       ) then '认得' else '不认得 —— 作者只能等管理员' end
union all
select '我要的那 4 项权限齐了吗',
       case when (
         select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as need(p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated' and g.table_schema = 'public'
             and g.table_name = 'post_comments' and g.privilege_type = need.p
         )
       ) = 4 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '现在有几条评论（第一次跑是 0）',
       (select count(*)::text from public.post_comments);

notify pgrst, 'reload schema';

commit;
