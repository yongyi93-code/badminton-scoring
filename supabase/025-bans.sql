-- ===================================================================
-- 封号 / 禁言 / 申诉 / 下架
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 012（举报）和 024（朋友圈）要已经跑过。
--
-- -------------------------------------------------------------------
-- 这一步补的是 012 留下的那个口子
--
-- 举报系统做完之后，管理员看完一条举报，能做的只有标一下「处理了」。
-- 真遇到一个一直骚扰人的，没有任何手段 —— 只能让每个人各自去拉黑他。
--
-- 而且它现在是**硬前置**：朋友圈的「单条可以选公开」那一档等着它
-- （024 开头写了为什么），应用商店指南 1.2 也要求带用户内容的 App
-- 有「24 小时内处理」的手段。
--
-- -------------------------------------------------------------------
-- 一、没有申诉的封号按钮，是另一种伤害
--
-- 这句话是 ROADMAP 里自己写下的，所以申诉和封号在同一个文件里，
-- 不是「以后补」。具体是三条：
--
--   · 被封的人**看得到**自己那一行：什么时候、为什么、到什么时候为止
--   · 他可以写一段话申诉，而且**申诉这条路不受封号影响** ——
--     封了还不让人说话，那就不是处理，是消失
--   · 管理员接受申诉的那一下，封号自动解除（触发器管着），
--     不用管理员记得再去点一下「解封」
--
-- -------------------------------------------------------------------
-- 二、封号不碰打球
--
-- 被封的人**照样记分、照样看排行榜、照样进球局**。挡住的是社交那一面：
-- 私信、动态、好友申请、上榜、「正在打」。
--
-- 这是想清楚的，不是漏了：球馆里常常是一台手机轮流记分，而记分的人
-- 可能正好是被封的那个。为了一件社交上的事让整场球记不了分，
-- 伤的是另外七个没做错事的人。
--
-- 两档：
--   禁言 mute   发不了私信、发不了动态、点不了赞
--   封号 ban    禁言的全部，另加：加不了好友、上不了全国榜、
--               报不了「正在打」、改不了名片（改名换脸是最常见的绕法）
--
-- -------------------------------------------------------------------
-- 三、用触发器挡，不改已有的那些策略
--
-- 两个理由，第二个才是主要的：
--
--   1. 009/024 那些插入策略是这个 App 的地基，为了加一句「没被封」
--      去重写它们，风险比收益大
--   2. **被策略挡下来的错，人看不懂**。RLS 拒绝只会说
--      「violates row-level security policy」—— 而一个被封的人
--      最该知道的就是「为什么、到什么时候」。触发器可以把话说明白。
--
-- 抛的是一个带前缀的暗号（RALLY_SILENCED:kind:until），由客户端翻成
-- 人话 —— 数据库不知道这个人用的是中文还是英文，所以不在这儿写文案。
--
-- -------------------------------------------------------------------
-- 四、下架一条动态，而不是删掉它
--
-- 删掉的话证据就没了，而「这条到底说了什么」正是以后要回头看的东西。
-- 所以是软下架：作者自己和管理员还看得到（作者那边标着「已下架」——
-- 他有权知道），别人看不到。
--
-- 注意 024 定过一条规矩：**动态不能改**。这一步给了管理员 update，
-- 所以同时加一个触发器，把除了「下架」这两栏之外的所有东西按回原值 ——
-- 那条规矩对管理员一样成立，他只能翻这一个开关。
-- ===================================================================

begin;

-- ===================================================================
-- 一、封号 / 禁言
-- ===================================================================

/*
 * 一次封号一行，不是一人一行。
 *
 * 一人一行的话，「他被封过三次」这件事第二次就没了 —— 而那正是
 * 决定这次封多久时最该看到的东西。解封也不删行，是盖一个 lifted_at：
 * 删掉等于把发生过的事抹掉。
 */
create table if not exists public.bans (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('mute', 'ban')),
  /* 和举报那张表同一份清单（012）—— 两处对不上就统计不出来 */
  reason text not null check (
    reason in ('harassment', 'abuse', 'spam', 'fake', 'cheating', 'other')
  ),
  /*
   * 管理员写的一句话。**被封的人看得到这一栏** —— 所以它不是内部备注，
   * 是给当事人的通知。写「骂人」而不是「这家伙有病」。
   */
  note text check (note is null or char_length(note) <= 1000),
  /* 到什么时候为止。空 = 永久 */
  until timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null
);

/*
 * 「还生效着的」要查得飞快 —— 每发一条私信、每发一条动态都要问一次。
 * 部分索引：解封了的、过期的那些行永远不用扫。
 */
create index if not exists bans_active
  on public.bans (uid) where lifted_at is null;
create index if not exists bans_uid_time
  on public.bans (uid, created_at desc);

alter table public.bans enable row level security;
/* RLS 和 GRANT 是两道门，都得开 —— 这个仓库栽过好几次 */
grant select, insert, update on public.bans to authenticated;

/*
 * 故意不给 delete：封号和解封都是发生过的事，只能加一行、盖一个章，
 * 不能让它从来没存在过。
 */

-- ===================================================================
-- 二、还生效着吗
--
-- 两个函数都必须 security definer：它们要读**别人**那几行
-- （触发器里判的是当前这个人，但策略里也会判别人），而下面那条读策略
-- 只让人看到自己的。不加的话它们永远返回 false，而且不报错 ——
-- 封了等于没封，没人查得出为什么。022 的 shares_club 栽过同一个坑。
-- ===================================================================

create or replace function public.active_ban(u uuid)
returns public.bans
language sql
stable
security definer
set search_path = public
as $$
  select b.* from public.bans b
  where b.uid = u
    and b.lifted_at is null
    and (b.until is null or b.until > now())
  /* 有好几条同时生效时，以最重、最长的那条为准 */
  order by (b.kind = 'ban') desc, (b.until is null) desc, b.until desc nulls first
  limit 1;
$$;

/** 发不了东西（禁言或封号都算） */
create or replace function public.is_silenced(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bans b
    where b.uid = u and b.lifted_at is null
      and (b.until is null or b.until > now())
  );
$$;

/** 被封号（禁言不算） */
create or replace function public.is_banned(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bans b
    where b.uid = u and b.kind = 'ban' and b.lifted_at is null
      and (b.until is null or b.until > now())
  );
$$;

grant execute on function public.active_ban(uuid) to authenticated;
grant execute on function public.is_silenced(uuid) to authenticated;
grant execute on function public.is_banned(uuid) to authenticated;

-- ===================================================================
-- 三、挡住
--
-- 抛的是暗号不是人话：数据库不知道这个人用中文还是英文。
-- 客户端认得 RALLY_SILENCED: 这个前缀，翻成一句带日期的话。
-- ===================================================================

create or replace function public.block_if_silenced() returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare b public.bans;
begin
  b := public.active_ban(auth.uid());
  if b.id is not null then
    raise exception 'RALLY_SILENCED:%:%', b.kind, coalesce(b.until::text, '');
  end if;
  return new;
end
$fn$;

/** 封号才挡，禁言放行 —— 加好友、上榜这些不是「说话」 */
create or replace function public.block_if_banned() returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare b public.bans;
begin
  b := public.active_ban(auth.uid());
  if b.id is not null and b.kind = 'ban' then
    raise exception 'RALLY_SILENCED:%:%', b.kind, coalesce(b.until::text, '');
  end if;
  return new;
end
$fn$;

/* 说话那一类：私信、动态、点赞 */
drop trigger if exists messages_not_silenced on public.messages;
create trigger messages_not_silenced
  before insert on public.messages
  for each row execute function public.block_if_silenced();

drop trigger if exists posts_not_silenced on public.posts;
create trigger posts_not_silenced
  before insert on public.posts
  for each row execute function public.block_if_silenced();

drop trigger if exists post_likes_not_silenced on public.post_likes;
create trigger post_likes_not_silenced
  before insert on public.post_likes
  for each row execute function public.block_if_silenced();

/* 封号才挡的那一类 */
drop trigger if exists friendships_not_banned on public.friendships;
create trigger friendships_not_banned
  before insert on public.friendships
  for each row execute function public.block_if_banned();

/*
 * 全国榜和「正在打」是后加的（017 / 021）。有的项目可能还没跑过那两个，
 * 所以先看表在不在 —— 整段 SQL 因为一张还不存在的表全军覆没，
 * 比少挂一个触发器糟得多。
 *
 * **但不能就这么算了**：下面自检里那一行数的就是这几个触发器，
 * 少一个数字就对不上，看得见。悄悄跳过才是真正危险的做法。
 */
do $$
begin
  if to_regclass('public.leaderboard') is not null then
    drop trigger if exists leaderboard_not_banned on public.leaderboard;
    create trigger leaderboard_not_banned
      before insert on public.leaderboard
      for each row execute function public.block_if_banned();
  end if;
  if to_regclass('public.now_playing') is not null then
    drop trigger if exists now_playing_not_banned on public.now_playing;
    create trigger now_playing_not_banned
      before insert on public.now_playing
      for each row execute function public.block_if_banned();
  end if;
end $$;

/*
 * 名片也挡（封号那一档）。
 *
 * 改名换脸是最常见的一条绕法：被封之后换个名字换张照片接着来。
 * update 也要挡，不只是 insert —— 绝大多数人那一行早就存在了。
 */
drop trigger if exists profiles_not_banned on public.profiles;
create trigger profiles_not_banned
  before insert or update on public.profiles
  for each row execute function public.block_if_banned();

-- ===================================================================
-- 四、bans 的策略
-- ===================================================================

/*
 * 读：自己那几行，加上管理员看全部。
 *
 * 「自己看得到」是这一整套里最要紧的一条：被封的人有权知道
 * 什么时候、为什么、到什么时候为止。一个说不出理由的封号，
 * 和坏掉的 App 在当事人那里是同一件事。
 */
drop policy if exists "自己的封号和管理员看得到" on public.bans;
create policy "自己的封号和管理员看得到"
  on public.bans for select to authenticated
  using (uid = auth.uid() or public.is_admin(auth.uid()));

/*
 * 封人：只有管理员，而且不能封自己（手滑把自己封了就没人能解了 ——
 * 解封也要管理员身份，而那一行还在生效着）。
 */
drop policy if exists "只有管理员能封人" on public.bans;
create policy "只有管理员能封人"
  on public.bans for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    and created_by = auth.uid()
    and uid <> auth.uid()
    and lifted_at is null
  );

drop policy if exists "只有管理员能解封" on public.bans;
create policy "只有管理员能解封"
  on public.bans for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

/*
 * 封过的事实不许改，只许解封。
 *
 * 和 012 里那个 keep_report_facts 是同一类：with check 看不见旧值，
 * 所以一个管理员可以顺手把 reason 从「骚扰」改成「广告」、
 * 或者把 uid 换成另一个人，而被改的人不会知道。
 */
create or replace function public.keep_ban_facts() returns trigger
language plpgsql as $fn$
begin
  new.uid        := old.uid;
  new.kind       := old.kind;
  new.reason     := old.reason;
  new.note       := old.note;
  new.until      := old.until;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  /* 解封盖一次章就冻住：不能解了又「反悔」把它改回生效 */
  if old.lifted_at is null and new.lifted_at is not null then
    new.lifted_at := now();
    new.lifted_by := auth.uid();
  else
    new.lifted_at := old.lifted_at;
    new.lifted_by := old.lifted_by;
  end if;
  return new;
end
$fn$;

drop trigger if exists bans_keep_facts on public.bans;
create trigger bans_keep_facts
  before update on public.bans
  for each row execute function public.keep_ban_facts();

-- ===================================================================
-- 五、申诉
-- ===================================================================

create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  ban_id uuid not null references public.bans(id) on delete cascade,
  uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

/*
 * 一条封号同时只能有一条没处理的申诉。
 *
 * 和举报那边同一条防刷（012）：没有它，被封的人可以对着管理员那一屏
 * 连点五十下，而淹掉之后真正该看的那一条也就看不见了。
 */
create unique index if not exists appeals_one_open
  on public.appeals (ban_id) where status = 'open';
create index if not exists appeals_open_time
  on public.appeals (created_at) where status = 'open';

alter table public.appeals enable row level security;
grant select, insert, update on public.appeals to authenticated;

/*
 * **申诉这条路不受封号影响** —— 这张表上一个 block_if_silenced 都没有。
 *
 * 封了还不让人说话，那不是处理，是让人消失。整个文件里这一条最重要，
 * 所以写在这儿而不是藏在注释里：以后往这张表上加触发器之前，
 * 先回来读这一段。
 */
drop policy if exists "自己的申诉和管理员看得到" on public.appeals;
create policy "自己的申诉和管理员看得到"
  on public.appeals for select to authenticated
  using (uid = auth.uid() or public.is_admin(auth.uid()));

/* 只能为**自己那条**封号申诉，而且只能是开着的状态 */
drop policy if exists "只能为自己那条封号申诉" on public.appeals;
create policy "只能为自己那条封号申诉"
  on public.appeals for insert to authenticated
  with check (
    uid = auth.uid()
    and status = 'open'
    and handled_by is null
    and handled_at is null
    and exists (select 1 from public.bans b where b.id = ban_id and b.uid = auth.uid())
  );

drop policy if exists "只有管理员能回申诉" on public.appeals;
create policy "只有管理员能回申诉"
  on public.appeals for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

/*
 * 申诉的内容不许改，状态可以改；而且**接受申诉的那一下自动解封**。
 *
 * 自动解封不是省事，是防止一种很难发现的错：管理员点了「接受」，
 * 忘了再去点一次「解封」—— 于是这个人看到自己的申诉写着「通过了」，
 * 却还是发不出话。那比直接驳回更伤人。
 */
create or replace function public.keep_appeal_facts() returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  new.ban_id     := old.ban_id;
  new.uid        := old.uid;
  new.body       := old.body;
  new.created_at := old.created_at;
  if new.status is distinct from old.status then
    new.handled_by := case when new.status = 'open' then null else auth.uid() end;
    new.handled_at := case when new.status = 'open' then null else now() end;
  else
    new.handled_by := old.handled_by;
    new.handled_at := old.handled_at;
  end if;

  if new.status = 'accepted' and old.status <> 'accepted' then
    update public.bans
       set lifted_at = now(), lifted_by = auth.uid()
     where id = new.ban_id and lifted_at is null;
  end if;
  return new;
end
$fn$;

drop trigger if exists appeals_keep_facts on public.appeals;
create trigger appeals_keep_facts
  before update on public.appeals
  for each row execute function public.keep_appeal_facts();

-- ===================================================================
-- 六、下架一条动态
-- ===================================================================

alter table public.posts
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null;

grant update on public.posts to authenticated;

/*
 * 下架了别人就看不到了，但**作者自己还看得到**（界面上标着「已下架」）。
 *
 * 让作者看得到是故意的：一条悄悄消失的动态，作者只会以为 App 坏了，
 * 然后再发一遍。告诉他被下架了，他才知道发生了什么。
 */
drop policy if exists "自己和好友的动态" on public.posts;
create policy "自己和好友的动态"
  on public.posts for select to authenticated
  using (
    author = auth.uid()
    or public.is_admin(auth.uid())
    or (hidden_at is null and public.are_friends(auth.uid(), author))
  );

drop policy if exists "只有管理员能下架" on public.posts;
create policy "只有管理员能下架"
  on public.posts for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

/*
 * 024 那条「动态不能改」对管理员一样成立。
 *
 * 他有了 update 权限，但这个触发器把除了下架那两栏之外的所有东西
 * 按回原值 —— 管理员能做的只有翻那一个开关，改不了一个字。
 */
create or replace function public.keep_post_facts() returns trigger
language plpgsql as $fn$
begin
  new.author     := old.author;
  new.body       := old.body;
  new.photos     := old.photos;
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

drop trigger if exists posts_keep_facts on public.posts;
create trigger posts_keep_facts
  before update on public.posts
  for each row execute function public.keep_post_facts();

-- ===================================================================
-- 自检
-- ===================================================================
select 'bans 这张表建好了吗' as 项,
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'bans'
       ) then '建好了' else '没有 —— 上面那步没成功' end as 值
union all
select 'appeals 这张表建好了吗',
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'appeals'
       ) then '建好了' else '没有' end
union all
select '三个判断函数都是 security definer 吗（不是的话封了等于没封）',
       case when (
         select count(*) from pg_proc
         where proname in ('active_ban', 'is_silenced', 'is_banned') and prosecdef
       ) = 3 then '是' else '不是 —— 会静悄悄地永远放行' end
union all
select '挡住发言的触发器（私信 / 动态 / 点赞，应该是 3）',
       (select count(*)::text from pg_trigger
        where tgname in ('messages_not_silenced', 'posts_not_silenced',
                         'post_likes_not_silenced'))
union all
select '封号才挡的触发器（好友 / 上榜 / 正在打 / 名片，应该是 4）',
       (select count(*)::text from pg_trigger
        where tgname in ('friendships_not_banned', 'leaderboard_not_banned',
                         'now_playing_not_banned', 'profiles_not_banned'))
union all
select '申诉那张表上有没有挡发言的触发器（必须一个都没有）',
       case when exists (
         select 1 from pg_trigger t
         where t.tgrelid = 'public.appeals'::regclass
           and t.tgfoid in ('public.block_if_silenced'::regproc, 'public.block_if_banned'::regproc)
       ) then '有 —— 不对，封了还不让人申诉等于让人消失' else '一个都没有，对' end
union all
select 'bans 的策略数（应该是 3：读 / 封 / 解封，没有删）', count(*)::text
from pg_policy where polrelid = 'public.bans'::regclass
union all
select 'bans 上有 delete 策略吗（必须没有 —— 封过的事不能抹掉）',
       case when exists (
         select 1 from pg_policy
         where polrelid = 'public.bans'::regclass and polcmd = 'd'
       ) then '有 —— 不对' else '没有，对' end
union all
select 'appeals 的策略数（应该是 3）', count(*)::text
from pg_policy where polrelid = 'public.appeals'::regclass
union all
select 'posts 上多了下架那两栏吗',
       case when (
         select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'posts'
           and column_name in ('hidden_at', 'hidden_by')
       ) = 2 then '多了' else '没有' end
union all
select '「动态不能改」那个触发器在不在（管理员也只能翻下架那个开关）',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.posts'::regclass and tgname = 'posts_keep_facts'
       ) then '在' else '不在' end
union all
select '现在有几个人被封着',
       (select count(*)::text from public.bans
        where lifted_at is null and (until is null or until > now()));

notify pgrst, 'reload schema';

commit;
