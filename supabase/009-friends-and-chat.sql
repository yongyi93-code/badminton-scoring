-- ===================================================================
-- 好友和私聊
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 001–006 都要已经跑过。
--
-- -------------------------------------------------------------------
-- 为什么不能塞进 records 那张表
--
-- records 是整个 App 的数据表，策略是「同一个球群的人都读得到」。
-- 而所有人现在都在同一个默认球群里 —— 也就是说，私聊塞进 records
-- 等于把每一条私信贴在全马来西亚人的面前。
--
-- 那不是「有点漏」，那是私聊这个功能根本不成立。所以另起三张表，
-- 各自带一套「只有相关的人看得到」的规则。
--
-- -------------------------------------------------------------------
-- 三张表，各管一件事
--
--   friendships  谁和谁是好友（pending = 发了还没同意）
--   blocks       谁拉黑了谁（单向，各存各的）
--   messages     私信
--
-- 拉黑为什么单独一张表、而不是 friendships 上的一个状态：
-- 拉黑是单向的，好友是双向的，塞进同一行就要回答「这一行现在
-- 到底是谁拉黑了谁、还算不算好友」这种问题，而每多一个状态组合
-- 就多一条能写错的策略。分开之后两件事各自只有两三行规则。
--
-- -------------------------------------------------------------------
-- 顺序有讲究
--
-- 先建三张表，再建两个函数，最后才是策略 —— 策略里要调函数，
-- 函数里要查表。整段包在一个事务里，中间任何一句报错就整体回滚，
-- 不会留下「表建了一半、策略没上」这种最危险的中间态：
-- 那时候 RLS 已经开着但一条策略都没有，看起来「很安全」，
-- 实际上是谁都读不到自己的数据。
-- ===================================================================

begin;

-- ===================================================================
-- 一、三张表
-- ===================================================================

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  -- 谁发起的。默认值由数据库填，客户端伪造不了
  requester uuid not null default auth.uid() references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_no_self check (requester <> addressee)
);

/*
 * 一对人只能有一行，不管是谁先发的。
 *
 * 少了这个索引，A 发给 B、B 同时发给 A，就会留下两行 —— 然后
 * 「我们是不是好友」这个问题有两个答案，界面上会出现一个已经是
 * 好友的人还挂着「等他同意」。
 */
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

-- 拉黑是单向的：我拉黑你，是我这边的一行，你那边没有
create table if not exists public.blocks (
  blocker uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_no_self check (blocker <> blocked)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  -- 2000 字是个上限，不是目标。没有上限的话一条消息能塞进一本书
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_no_self check (sender <> recipient)
);

-- 一段对话按时间倒着翻；未读数走部分索引，不用全表扫
create index if not exists messages_pair_time
  on public.messages (least(sender, recipient), greatest(sender, recipient), created_at desc);
create index if not exists messages_unread
  on public.messages (recipient) where read_at is null;

alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.messages enable row level security;

-- ===================================================================
-- 二、两个函数
--
-- 两个都是 security definer，理由写在各自上面。
-- 两个都只吐一个真假 —— 定义者身份问不出「谁拉黑了谁」这种事。
-- ===================================================================

/*
 * 「这两个人之间有没有拉黑」，哪个方向都算。
 *
 * 必须 security definer：下面那条读策略只让人看到自己拉黑了谁，
 * 而这里要判的是两个方向。
 */
create or replace function public.is_blocked_between(x uuid, y uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker = x and blocked = y) or (blocker = y and blocked = x)
  );
$$;

grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

/*
 * 「这两个人是不是好友」。私信那张表的插入策略靠它把门。
 *
 * 拉黑了就不算好友 —— 哪怕那一行 friendships 还在。这样拉黑立刻
 * 生效，不用先去把好友关系删干净；少一步「还得记得删」，
 * 就少一种漏掉的可能。
 */
create or replace function public.are_friends(x uuid, y uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester = x and addressee = y) or (requester = y and addressee = x))
  ) and not public.is_blocked_between(x, y);
$$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ===================================================================
-- 三、两个触发器
--
-- 它们守的都是「旧值不许被改掉」，而 with check 看不见旧值 ——
-- 这一类事只有触发器做得到。006 里守 created_by 是同一个道理。
-- ===================================================================

/*
 * 「是谁发给谁的」不许改。
 *
 * 不守的话有个绕法：被申请的人在同意的那一下把 requester 改成
 * 第三个人 —— with check 看的是改之后那一行，那时候一切都对。
 */
create or replace function public.keep_friendship_pair() returns trigger
language plpgsql as $fn$
begin
  new.requester := old.requester;
  new.addressee := old.addressee;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists friendships_keep_pair on public.friendships;
create trigger friendships_keep_pair
  before update on public.friendships
  for each row execute function public.keep_friendship_pair();

/*
 * 说过的话不许改。
 *
 * 收信的人要能标记已读，所以他对这一行有 update 权限；而
 * with check 拦不住他顺手把对方说过的每一句都改写。
 * 两边看到的还是同一份 —— 那才是最糟的：被改的人不会发现。
 */
create or replace function public.keep_message_body() returns trigger
language plpgsql as $fn$
begin
  new.sender := old.sender;
  new.recipient := old.recipient;
  new.body := old.body;
  new.created_at := old.created_at;
  return new;
end
$fn$;

drop trigger if exists messages_keep_body on public.messages;
create trigger messages_keep_body
  before update on public.messages
  for each row execute function public.keep_message_body();

-- ===================================================================
-- 四、策略
-- ===================================================================

-- ---------- friendships ----------

-- 读：只看得到自己牵涉在内的
drop policy if exists "看自己的好友关系" on public.friendships;
create policy "看自己的好友关系"
  on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

/*
 * 发起：只能以自己的身份发，而且必须是 pending。
 *
 * 不许直接插一行 accepted —— 那样谁都能把自己塞进别人的好友列表，
 * 而好友列表正是私聊的那把钥匙。
 *
 * 被对方拉黑了也发不了。这一条是拉黑真正起作用的地方：光挡私信
 * 而不挡好友申请的话，被拉黑的人可以一遍一遍地发申请刷屏。
 */
drop policy if exists "只能自己发好友申请" on public.friendships;
create policy "只能自己发好友申请"
  on public.friendships for insert to authenticated
  with check (
    requester = auth.uid()
    and status = 'pending'
    and not public.is_blocked_between(requester, addressee)
  );

/*
 * 同意：只有被申请的那一方点得动，而且只能改成 accepted。
 *
 * using 看改之前，with check 看改之后，两边都判 ——
 * 只判一边的话，发起的人可以自己把自己的申请改成「已同意」。
 */
drop policy if exists "只有被申请的人能同意" on public.friendships;
create policy "只有被申请的人能同意"
  on public.friendships for update to authenticated
  using (addressee = auth.uid() and status = 'pending')
  with check (addressee = auth.uid() and status = 'accepted');

-- 删：两边都能删。撤回申请、拒绝、删好友，都是删这一行
drop policy if exists "两边都能删掉这段关系" on public.friendships;
create policy "两边都能删掉这段关系"
  on public.friendships for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- ---------- blocks ----------

/*
 * 只看得到自己拉黑了谁，看不到谁拉黑了自己。
 *
 * 后半句是故意的：能查出「他把我拉黑了」，就等于给了一个换号
 * 重来的信号。被拉黑的人那边看到的是「发不出去」，不解释为什么。
 */
drop policy if exists "只看自己拉黑的人" on public.blocks;
create policy "只看自己拉黑的人"
  on public.blocks for select to authenticated
  using (blocker = auth.uid());

drop policy if exists "只能以自己的身份拉黑" on public.blocks;
create policy "只能以自己的身份拉黑"
  on public.blocks for insert to authenticated
  with check (blocker = auth.uid());

drop policy if exists "只能解除自己拉的黑" on public.blocks;
create policy "只能解除自己拉的黑"
  on public.blocks for delete to authenticated
  using (blocker = auth.uid());

-- ---------- messages ----------

-- 读：只有这两个人
drop policy if exists "只有收发双方读得到" on public.messages;
create policy "只有收发双方读得到"
  on public.messages for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid());

/*
 * 发：以自己的身份，而且只能发给好友。
 *
 * 「只能发给好友」是整个私聊的安全边界，而且它在数据库里，
 * 不在界面上 —— 界面那份挡不住任何一个会按 F12 的人。
 * are_friends 里已经把拉黑算进去了。
 */
drop policy if exists "只能发给好友" on public.messages;
create policy "只能发给好友"
  on public.messages for insert to authenticated
  with check (sender = auth.uid() and public.are_friends(sender, recipient));

-- 改：只有收信的人，而且上面那个触发器保证他只动得了 read_at
drop policy if exists "收信的人可以标记已读" on public.messages;
create policy "收信的人可以标记已读"
  on public.messages for update to authenticated
  using (recipient = auth.uid())
  with check (recipient = auth.uid());

-- 撤回：只能撤自己发的
drop policy if exists "只能撤回自己发的" on public.messages;
create policy "只能撤回自己发的"
  on public.messages for delete to authenticated
  using (sender = auth.uid());

-- ===================================================================
-- 五、实时
--
-- 聊天不刷新就不算聊天。records 那张表已经在这个 publication 里，
-- 这里把两张新表也加进去。加过了会报 duplicate object，各自吞掉 ——
-- 这一整段要能重复跑。
-- ===================================================================
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null;
end $$;

-- ===================================================================
-- 六、自检
-- ===================================================================
select '三张表都建好了吗' as 项,
       count(*)::text || ' / 3' as 值
from information_schema.tables
where table_schema = 'public' and table_name in ('friendships', 'blocks', 'messages')
union all
select 'friendships 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.friendships'::regclass
union all
select 'blocks 的策略数（应该是 3）', count(*)::text
from pg_policy where polrelid = 'public.blocks'::regclass
union all
select 'messages 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.messages'::regclass
union all
select '守住「谁发给谁」的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.friendships'::regclass and tgname = 'friendships_keep_pair'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '守住「说过的话」的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.messages'::regclass and tgname = 'messages_keep_body'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '一对人只有一行的唯一索引',
       case when exists (
         select 1 from pg_indexes
         where schemaname = 'public' and indexname = 'friendships_pair'
       ) then '有' else '没有 —— 上面那步没成功' end;

notify pgrst, 'reload schema';

commit;
