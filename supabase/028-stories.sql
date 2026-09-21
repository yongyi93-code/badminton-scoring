-- ===================================================================
-- Story：24 小时之后自己消失的那一条
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 024（朋友圈）、025（封号）、026（公开）要已经跑过。
--
-- 跑完还有一步：部署 cleanup-stories 那个函数，并且给它排个班。
-- 那一步不做的话，过期的动态在界面上会消失，**但文件永远留在桶里**。
-- 具体见文件最后。
--
-- -------------------------------------------------------------------
-- 不另起一张表
--
-- docs/社交化.md 里早写过：「朋友圈和 Story 是同一套东西，Story 只是
-- 会过期的朋友圈。分开做会有两套发布、两套举报、两套删除，而它们
-- 本该一模一样。」
--
-- 那句话现在更硬了：024 之后 posts 上已经挂着可见范围（026）、下架
-- （025）、评论（027）、点赞、禁言触发器、照片路径守卫。另起一张表
-- 意味着这六样全要抄一遍 —— 而抄出来的第二份迟早和第一份不一样，
-- 那时候出问题的会是「Story 上可以绕过禁言」这种。
--
-- 所以 Story = posts 上多一列 expires_at。空 = 永久，有值 = 到点消失。
--
-- -------------------------------------------------------------------
-- 「查询时过滤掉过期的」不算做完
--
-- 那样文件永远留在桶里，存储只涨不跌，而且那些照片其实还在 ——
-- 只是没人显示它。docs/社交化.md 里点名说过别这么糊弄。
--
-- 所以这一步是**两半**：
--   策略这边把过期的挡住（立刻生效，不用等清理）
--   cleanup-stories 那个函数把行和文件真删掉（排班跑）
--
-- 两半都要有。只有前一半是自欺，只有后一半的话，清理跑之前
-- 那条动态还看得见 —— 而作者以为它已经没了。
--
-- -------------------------------------------------------------------
-- 到期时间由数据库说了算，不由手机说了算
--
-- 客户端报一个 expires_at 上来，触发器**夹住**它：最多 24 小时，
-- 已经过去的当成 24 小时。夹而不是拒 —— 021 那次学到的：
-- 拒掉的话，一台时钟走偏的手机会永远发不出 Story，而且没人查得出为什么。
-- ===================================================================

begin;

alter table public.posts
  add column if not exists expires_at timestamptz;

/*
 * 找「谁还有没过期的 Story」要快 —— 朋友圈顶上那一排圈圈每次进来都问。
 * 部分索引：绝大多数动态是永久的，它们不该进这个索引。
 */
create index if not exists posts_stories
  on public.posts (author, expires_at desc) where expires_at is not null;

-- ===================================================================
-- 一、过期的谁都看不到（管理员除外）
-- ===================================================================

/*
 * 在 026 那版上多一句「还没过期」。
 *
 * **作者自己也看不到过期的** —— 这一条和「下架」不一样：下架是别人
 * 做的决定，作者有权知道；过期是他自己选的，时间到了就是没了，
 * 再给他看反而奇怪。
 *
 * 管理员看得到，因为一条被举报的 Story 在处理的时候可能已经过期了 ——
 * 而那正是最需要看一眼的时候。
 */
drop policy if exists "自己和好友的动态" on public.posts;
create policy "自己和好友的动态"
  on public.posts for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      (expires_at is null or expires_at > now())
      and (
        author = auth.uid()
        or (
          hidden_at is null
          and not public.is_blocked_between(auth.uid(), author)
          and (visibility = 'public' or public.are_friends(auth.uid(), author))
        )
      )
    )
  );

-- ===================================================================
-- 二、到期时间由数据库夹住
-- ===================================================================

create or replace function public.guard_post() returns trigger
language plpgsql as $fn$
declare p text;
begin
  new.created_at := now();

  /*
   * Story 最多活 24 小时。
   *
   * 夹住而不是拒掉（021 那次学到的）：拒掉的话，一台时钟走偏的手机
   * 会永远发不出 Story，而且不报错、没人查得出为什么。
   *
   * 已经过去的时间当成 24 小时 —— 那多半是时钟偏了，不是他想发一条
   * 生下来就死的动态。
   */
  if new.expires_at is not null then
    new.expires_at := least(new.expires_at, now() + interval '24 hours');
    if new.expires_at <= now() then
      new.expires_at := now() + interval '24 hours';
    end if;
  end if;

  foreach p in array coalesce(new.photos, '{}') loop
    if p !~ ('^' || new.author::text || '/') then
      raise exception '照片路径不属于作者本人: %', p;
    end if;
    if array_length(string_to_array(p, '/'), 1) <> 2 then
      raise exception '照片路径层数不对: %', p;
    end if;
  end loop;
  return new;
end
$fn$;

/*
 * 发出去之后**改不了到期时间**。
 *
 * 不冻的话有一条很像样的绕法：发一条 Story，等看的人少了再往后延，
 * 或者反过来 —— 有人截图之后立刻改成马上过期，装作从来没发过。
 * 和正文、照片、可见范围同一条规矩（024 / 026）。
 */
create or replace function public.keep_post_facts() returns trigger
language plpgsql as $fn$
begin
  new.author     := old.author;
  new.body       := old.body;
  new.photos     := old.photos;
  new.created_at := old.created_at;
  new.visibility := old.visibility;
  new.expires_at := old.expires_at;
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

-- ===================================================================
-- 三、给清理那个函数用的一张视图
--
-- 它要拿「过期的那些行和它们的照片路径」。用视图而不是让函数自己写
-- 查询，是为了让「什么算过期」只有一个定义 —— 函数里再写一遍 where，
-- 迟早和上面那条策略对不上。
-- ===================================================================

create or replace view public.expired_stories as
  select id, author, photos
  from public.posts
  where expires_at is not null and expires_at <= now();

/*
 * 只给 service_role。
 *
 * 普通人一行都不该读得到 —— 过期的 Story 已经从策略那边消失了，
 * 开一扇视图的后门把它们放回来，等于那一条策略白写。
 *
 * 视图默认跟着建它的人的权限走，所以这里明确地只发给 service_role，
 * 并且**不**发给 authenticated / anon。
 */
revoke all on public.expired_stories from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.expired_stories to service_role;
    /*
     * 这两句都要。
     *
     * 只写 delete 是不够的 —— 清理函数发的是**带 where 的 delete**，
     * 而带 where 的 DELETE 要读那些列。线上就因为漏了 select 白跑了
     * 一整天（见 029-cleanup-grants.sql，那儿有本机撞出来的两句对比）。
     */
    grant select, delete on public.posts to service_role;
  end if;
end $$;

-- ===================================================================
-- 自检
-- ===================================================================
select 'posts 上多了 expires_at 这一栏吗' as 项,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'posts'
           and column_name = 'expires_at'
       ) then '多了' else '没有 —— 上面那步没成功' end as 值
union all
select '老的动态一条都没被改成会过期的吗（必须是）',
       case when (select count(*) from public.posts where expires_at is not null) = 0
            then '是' else '不是 —— 有 ' ||
                 (select count(*)::text from public.posts where expires_at is not null) ||
                 ' 条有到期时间了' end
union all
select '读策略认得「过期」了吗',
       case when exists (
         select 1 from pg_policy
         where polrelid = 'public.posts'::regclass
           and polname = '自己和好友的动态'
           and pg_get_expr(polqual, polrelid) like '%expires_at%'
       ) then '认得' else '不认得 —— 过期了还看得见' end
union all
select '「动态不能改」现在也冻到期时间了吗',
       case when exists (
         select 1 from pg_proc
         where proname = 'keep_post_facts'
           and prosrc like '%new.expires_at := old.expires_at%'
       ) then '冻了' else '没冻 —— 可以发完再往后延' end
union all
select '到期时间会被夹在 24 小时以内吗',
       case when exists (
         select 1 from pg_proc
         where proname = 'guard_post' and prosrc like '%24 hours%'
       ) then '会' else '不会 —— 可以发一条一年后才消失的 Story' end
union all
select 'expired_stories 这个视图建好了吗（清理函数要用）',
       case when exists (
         select 1 from information_schema.views
         where table_schema = 'public' and table_name = 'expired_stories'
       ) then '建好了' else '没有' end
union all
select '普通人读得到那个视图吗（必须读不到）',
       case when exists (
         select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'expired_stories'
           and grantee in ('anon', 'authenticated', 'PUBLIC')
       ) then '读得到 —— 不对，过期的又被放回来了' else '读不到，对' end
union all
select 'posts 的策略数（还该是 4：读 / 发 / 删 / 下架）', count(*)::text
from pg_policy where polrelid = 'public.posts'::regclass
union all
select '现在有几条还没过期的 Story',
       (select count(*)::text from public.posts
        where expires_at is not null and expires_at > now());

notify pgrst, 'reload schema';

commit;

-- ===================================================================
-- 跑完之后还有一步，别跳过
-- ===================================================================
--
-- 到这里为止，过期的 Story 在界面上已经看不到了 —— 但**行还在、
-- 文件还在桶里**。存储只涨不跌。
--
-- 剩下那一半在 supabase/functions/cleanup-stories：
--
--   1. 后台 Edge Functions → Deploy 一个新函数，名字叫 cleanup-stories，
--      内容贴 supabase/functions/cleanup-stories/index.ts
--   2. 那个函数**不需要**任何人登录就该跑得动（是排班调它，不是人），
--      所以它自己检查一个约定的密钥：
--      后台 Edge Functions → Secrets 里加一条
--        CLEANUP_SECRET = 你自己随便编一串长的
--   3. 后台 Integrations → Cron（或 Database → Cron）新建一个任务，
--      每小时跑一次，调那个函数，请求头带
--        x-cleanup-secret: 你刚才那串
--
-- 排班这一步做不做，界面上都看不出区别 —— 这正是它容易被忘掉的原因。
-- 想确认它真的在跑，就看下面这个数会不会一直涨：
--
--   select count(*) from public.posts
--    where expires_at is not null and expires_at <= now();
--
-- 正常应该长期是 0 或者个位数（刚过期还没轮到清理的那几条）。
-- ===================================================================
