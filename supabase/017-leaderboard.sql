-- ===================================================================
-- 全国榜
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- -------------------------------------------------------------------
-- 为什么要新开一张表，而不是把 records 读开
--
-- records 的读策略是 `is_club_member(club_id)` —— 你只读得到自己在的
-- 球群。那一条是这个 App 权限的地基，不能为了一个排行榜掀开：
-- 掀开就等于每个人都能翻所有球群的比赛、球员、球局。
--
-- 所以换个方向：**各自报各自的成绩**。每个人的设备算出自己那个数
-- （本来就在算，「我的」那一页显示的就是它），只把结果推到这张表上。
-- 原始比赛记录一行都不出自己的群。
--
-- 这么做还有一个好处，而且是决定性的：**MMR 的算法只有一份**。
-- 那套规矩（赢 +10 输 −10、爆冷翻倍、大比分加成、重复对手衰减、
-- 时长门槛…）全在 src/lib/avatar.ts 里。要在数据库里重算一遍，
-- 就有了两份会各自演化的实现，而它们迟早对不上 —— 到时候
-- 「我的」那页和全国榜显示两个不同的数，没人说得清哪个对。
--
-- -------------------------------------------------------------------
-- 上不上榜是自己决定的
--
-- 有行 = 在榜上，删掉自己那行 = 下榜。没有第三种状态，也不需要一个
-- 额外的开关字段 —— 那种字段总有一天会和「有没有行」对不上。
--
-- 默认不在榜上。名字挂到一个全国范围的公开榜上，是个该由本人点头的事，
-- 不是装了 App 就默认同意的事。
--
-- -------------------------------------------------------------------
-- 这张表信得过吗：不完全，而且这一点写在明面上
--
-- 数字是各自的设备报上来的，所以理论上谁都能报一个假的 ——
-- 和比分本来就能乱填是同一件事，没有新增风险。
--
-- 但这里多存了一个数：**confirmed**，有多少场是被对手确认过的。
-- 那个数伪造不了多少 —— 它要求对面的人在自己手机上点过头。
-- 榜上并排显示「打了多少场 / 其中多少场对手确认过」，
-- 比一个孤零零的 MMR 诚实得多。
-- ===================================================================

begin;

create table if not exists public.leaderboard (
  -- 一个账号一行。uid 就是主键，所以「报两次」天然变成「改那一行」
  uid uuid primary key references auth.users(id) on delete cascade,
  /*
   * 显示用的名字。取自这个人在自己球群里的球员名 ——
   * 不是邮箱，也不是账号 id：那两样都不该出现在一个公开榜上。
   */
  name text not null check (char_length(name) between 1 and 24),
  mmr integer not null check (mmr >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  /*
   * 其中有多少场被对手确认过（见 src/lib/confirm.ts）。
   * 这是这张表上唯一一个不容易伪造的数，所以它要和 MMR 并排显示。
   */
  confirmed integer not null default 0 check (confirmed >= 0),
  /*
   * 州。从这个人主场球馆的地址上带过来的，可以是空的 ——
   * 球馆没填州的时候就是空，那种情况只上全国榜，不上地区榜。
   *
   * 不做成一张固定的州名表：马来西亚十三州两个联邦直辖区，
   * 拼法和中英混着来，硬卡一张表只会把填不进去的人挡在外面。
   * 归一化交给 App 那边（src/lib/region.ts）。
   */
  state text check (state is null or char_length(state) <= 40),
  updated_at timestamptz not null default now()
);

-- 榜按 MMR 倒着翻，几千行之后没有索引会全表扫
create index if not exists leaderboard_mmr on public.leaderboard (mmr desc);
-- 地区榜：先按州筛，再按 MMR 排
create index if not exists leaderboard_state_mmr on public.leaderboard (state, mmr desc);

alter table public.leaderboard enable row level security;

/*
 * 表级权限。RLS 和 GRANT 是两道门，都得开 —— 这个仓库栽过三次。
 */
grant select, insert, update, delete on public.leaderboard to authenticated;

/*
 * 更新时间由数据库盖，不信客户端传的。
 *
 * 「上次报成绩是什么时候」以后要用来清理僵尸行（一年没动的），
 * 而一个可以自己填的时间戳挡不住任何事。
 *
 * **只盖时间，不碰 uid。** 第一版这里还有一句
 * `new.uid := coalesce(old.uid, auth.uid())`，想的是「防止有人写别人的
 * uid」。那一句是错的，而且错得很难看：INSERT 的时候 old 是空的，
 * 在后台用管理员身份直接插一行时 auth.uid() 也是空 —— 于是它把调用方
 * 明明给了的 uid 覆盖成 NULL，整条插入当场炸在非空约束上。
 *
 * 而且它本来就多余：冒名这件事下面那条 with check (uid = auth.uid())
 * 已经挡死了。本机跑 Postgres 撞出来的，不是想出来的。
 */
create or replace function public.stamp_leaderboard() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists leaderboard_stamp on public.leaderboard;
create trigger leaderboard_stamp
  before insert or update on public.leaderboard
  for each row execute function public.stamp_leaderboard();

-- ===================================================================
-- 策略
-- ===================================================================

/*
 * 读：登录的人都能读全部。这就是这张表存在的意义 ——
 * 它是唯一一处故意跨球群可见的数据，所以上面只放了能公开的东西：
 * 名字、一个分数、场次、州。没有比赛记录，没有球局，没有对手是谁。
 */
drop policy if exists "全国榜谁都看得到" on public.leaderboard;
create policy "全国榜谁都看得到"
  on public.leaderboard for select to authenticated
  using (true);

/*
 * 写：只能写自己那一行。
 *
 * 三条都要判 uid = auth.uid()。漏掉 insert 的 with check 的话，
 * 任何人都能替别人报一个成绩上去 —— 而被冒名的那个人不会收到通知，
 * 也没有第二份可以对。
 */
drop policy if exists "只报自己的成绩" on public.leaderboard;
create policy "只报自己的成绩"
  on public.leaderboard for insert to authenticated
  with check (uid = auth.uid());

drop policy if exists "只改自己那一行" on public.leaderboard;
create policy "只改自己那一行"
  on public.leaderboard for update to authenticated
  using (uid = auth.uid())
  with check (uid = auth.uid());

/*
 * 删：只删得掉自己那一行 —— 这就是「下榜」。
 * 必须留着这条路：上榜是自愿的，下榜也得同样容易。
 */
drop policy if exists "自己下榜" on public.leaderboard;
create policy "自己下榜"
  on public.leaderboard for delete to authenticated
  using (uid = auth.uid());

-- ===================================================================
-- 自检
-- ===================================================================
select '全国榜这张表建好了吗' as 项,
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'leaderboard'
       ) then '建好了' else '没有 —— 上面那步没成功' end as 值
union all
select 'leaderboard 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.leaderboard'::regclass
union all
select '盖时间戳的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.leaderboard'::regclass and tgname = 'leaderboard_stamp'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '两个索引齐了吗',
       case when (
         select count(*) from pg_indexes
         where schemaname = 'public' and tablename = 'leaderboard'
           and indexname in ('leaderboard_mmr', 'leaderboard_state_mmr')
       ) = 2 then '齐了' else '少了' end
union all
select '我要的那 4 项权限齐了吗',
       case when (
         select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as need(p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated' and g.table_schema = 'public'
             and g.table_name = 'leaderboard' and g.privilege_type = need.p
         )
       ) = 4 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '现在榜上有几个人（刚跑完应该是 0）',
       (select count(*)::text from public.leaderboard);

notify pgrst, 'reload schema';

commit;
