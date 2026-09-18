-- ===================================================================
-- 「正在打」—— 好友列表上那一行「正在 Twin ark 开打轮转局」
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- -------------------------------------------------------------------
-- 为什么不能直接读球局
--
-- 球局就在 records 里，status='active'、playerIds 里有谁，全都算得出来。
-- 但 records 的读策略是 `is_club_member(club_id)` —— **你的好友多半
-- 不在你的球群里**，他的手机根本读不到那一行。
--
-- 这和串场（017 全国榜）撞的是同一堵墙，解法也同源：
-- **各自报各自的状态**。开局的人自己往这张表写一行，好友读这张表。
-- 比赛记录、球员名单、对手是谁，一行都不出自己的球群。
--
-- -------------------------------------------------------------------
-- 存的是字符串，不是 session_id —— 这一条是整张表的关键
--
-- 存 session_id 看起来更「规范」，但那样好友拿到 id 之后还是读不到
-- 那场球局（RLS 拦着），等于给了一把打不开任何门的钥匙。
--
-- 所以直接存**要显示的那两样**：球馆名，和赛制的 key。这一行是自足的，
-- 读的人不需要再去问别的表。顺带一个好处：就算哪天读策略写松了，
-- 泄漏的也只是「他在打球」，不是他和谁打、打了多少分。
--
-- **赛制存 key（`rotation`），不存译好的名字（「轮转赛」）。**
-- 这一条是在浏览器里看出来的：第一版存译文，于是一个中文界面的人
-- 开局，他英文界面的朋友看到的是「Playing 轮转赛 at Twin ark」——
-- 半句英文半句中文。报的人和看的人不是同一种语言，这是跨设备的
-- 东西的常态，所以译这件事只能留到读的那一端做。
--
-- 球馆名照样存原文：它是专有名词，没有译法。
--
-- -------------------------------------------------------------------
-- 为什么必须有 expires_at
--
-- 球局要靠人按「结束」才收摊，而**没人记得按** —— 这不是猜的，
-- src/store/useApp.ts 里专门有一段算「最后一次有动静是什么时候」，
-- 就是为了认出那些打完各回各家、没人收摊的局。
--
-- 没有过期时间的话，一个忘了按结束的人会在好友列表上「正在打球」
-- 好几天。而这种错没人会来报 —— 看的人只会觉得这个功能不准。
--
-- 过期由读策略挡住（expires_at > now()），过期的行留在表里也无害：
-- 一个账号最多一行，下次开局 upsert 就覆盖掉了。
-- ===================================================================

begin;

create table if not exists public.now_playing (
  /*
   * 一人一行。这个 App 本来就规定「一个人同一时间只能在一场里」
   * （见 useApp 的 activeSessionOf），所以 uid 当主键是准确的，
   * 顺带让「开局时报一次」天然变成 upsert。
   */
  uid uuid primary key references auth.users(id) on delete cascade,
  /* 球馆名。直接是要显示的那几个字 */
  venue text not null check (char_length(venue) between 1 and 60),
  /*
   * 赛制的 key（'rotation' / 'king' / …），不是译好的名字 —— 见上面。
   * 可以是空的：老球局没有这个字段。
   * 不写成固定的一张清单，是为了以后加新赛制时旧版本的 App 不会
   * 因为报了个新 key 就被数据库拒掉。认不出来的 key 由读的那一端
   * 原样显示。
   */
  format text check (format is null or char_length(format) <= 24),
  started_at timestamptz not null default now(),
  /* 见上面：没有它，忘了按结束的人会「正在打球」好几天 */
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- 读的时候永远带 expires_at > now()，值一个索引
create index if not exists now_playing_expires on public.now_playing (expires_at);

alter table public.now_playing enable row level security;

/* RLS 和 GRANT 是两道门，都得开 —— 这个仓库栽过好几次 */
grant select, insert, update, delete on public.now_playing to authenticated;

/*
 * 时间由数据库盖，不信客户端传的。
 *
 * started_at 会被拿来显示「打了多久了」，而一个可以自己填的时间戳
 * 意味着那个数随时可以是假的。
 *
 * -------------------------------------------------------------------
 * 这一段有两条是撞出来的，不是想出来的
 *
 * **一、过期时间是「夹住」，不是「拒掉」。**
 * 第一版把上限写成 check (expires_at < started_at + 12 小时)。看着合理，
 * 实际后果是：上一场 10 小时前报的、已经过期，这个人今晚再开局时
 * 新的 expires_at = now()+8h，而 started_at 还是 10 小时前那个 ——
 * 一减，超了 12 小时，**整条 upsert 被拒**。于是他再也报不上去。
 * 打得久的一场（7 小时了还没散）同样会撞上。
 *
 * check 里用不了 now()（必须是 immutable），所以这件事只能在触发器里
 * 做，而且做成夹住：超了就压到上限，不是把人挡在门外。
 *
 * **二、上一场过期了，就重新计时。**
 * 不重置的话「打了多久了」会从上上周那场算起。而且它本来就是新的一场。
 */
create or replace function public.stamp_now_playing() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.started_at := now();
  elsif old.expires_at <= now() then
    /* 上一场早散了，这是新的一场 —— 重新开始计时 */
    new.started_at := now();
  else
    /* 还在打，只是续一次：保留原来的开始时间 */
    new.started_at := old.started_at;
  end if;

  /*
   * 过期时间的上限。夹住而不是拒掉，理由见上面。
   * 防的是哪天客户端那个常量被改成一个荒唐的值，
   * 让一行「正在打球」永远挂在所有好友的列表上。
   */
  new.expires_at := least(new.expires_at, now() + interval '12 hours');
  return new;
end
$fn$;

drop trigger if exists now_playing_stamp on public.now_playing;
create trigger now_playing_stamp
  before insert or update on public.now_playing
  for each row execute function public.stamp_now_playing();

/*
 * 过期时间至少要在开始时间之后。
 *
 * 上限**不在这儿**，在触发器里夹住 —— check 用不了 now()，
 * 而拿 started_at 算上限会把「上一场早就过期了、今晚再开一局」的人
 * 挡在门外。那个坑是本机跑真 Postgres 撞出来的，详见触发器那一段。
 */
alter table public.now_playing drop constraint if exists now_playing_sane_expiry;
alter table public.now_playing
  add constraint now_playing_sane_expiry
  check (expires_at > started_at);

-- ===================================================================
-- 策略
-- ===================================================================

/*
 * 读：好友只看得到还没过期的；**自己那一行永远看得见**。
 *
 * are_friends 已经把拉黑算进去了（见 009）—— 拉黑一个人，
 * 他立刻看不到你在哪打球，不用再去删好友关系。
 *
 * -------------------------------------------------------------------
 * 「自己那一行不受过期限制」不是为了显示，是为了**还删得掉它**
 *
 * 第一版写的是 `expires_at > now() and (uid = auth.uid() or 好友)`，
 * 本机跑真 Postgres 撞出来的后果是：
 *
 *   过期之后，本人**删不掉也覆盖不了**自己那一行 —— 于是他再也
 *   报不了「正在打」。永久坏掉，而且完全静悄悄：没有报错，
 *   好友只是再也看不到他打球。
 *
 * 原因是 UPDATE / DELETE 在找目标行的时候也要过 SELECT 策略这一关。
 * 行对自己都不可见了，自然也就动不了它。
 *
 * 所以把 uid = auth.uid() 提到过期判断**外面**。语义上也正是对的：
 * 自己广播出去的东西，自己什么时候都该看得见、关得掉。
 */
drop policy if exists "只有好友看得到你在哪打球" on public.now_playing;
create policy "只有好友看得到你在哪打球"
  on public.now_playing for select to authenticated
  using (
    uid = auth.uid()
    or (expires_at > now() and public.are_friends(auth.uid(), uid))
  );

/*
 * 写：只能写自己那一行。三条都要判，漏掉 insert 的 with check 的话，
 * 任何人都能替别人报一个「正在打球」。
 */
drop policy if exists "只报自己在哪打球" on public.now_playing;
create policy "只报自己在哪打球"
  on public.now_playing for insert to authenticated
  with check (uid = auth.uid());

drop policy if exists "只改自己那一行状态" on public.now_playing;
create policy "只改自己那一行状态"
  on public.now_playing for update to authenticated
  using (uid = auth.uid())
  with check (uid = auth.uid());

/* 删 = 收工，或者不想让人看见。必须留着这条路 */
drop policy if exists "自己收工" on public.now_playing;
create policy "自己收工"
  on public.now_playing for delete to authenticated
  using (uid = auth.uid());

-- ===================================================================
-- 自检
-- ===================================================================
select 'now_playing 这张表建好了吗' as 项,
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'now_playing'
       ) then '建好了' else '没有 —— 上面那步没成功' end as 值
union all
select 'now_playing 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.now_playing'::regclass
union all
select '过期时间的上限约束',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.now_playing'::regclass
           and conname = 'now_playing_sane_expiry'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '盖时间戳的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.now_playing'::regclass and tgname = 'now_playing_stamp'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '我要的那 4 项权限齐了吗',
       case when (
         select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as need(p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated' and g.table_schema = 'public'
             and g.table_name = 'now_playing' and g.privilege_type = need.p
         )
       ) = 4 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '现在有几个人在打（刚跑完应该是 0）',
       (select count(*)::text from public.now_playing);

notify pgrst, 'reload schema';

commit;
