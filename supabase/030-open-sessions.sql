-- ===================================================================
-- 公开球局：全 App 看得到的那一张列表
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- 那个编辑器吃不掉太长的一段（029 那次实测在第 100 行断掉），
-- 所以自检单独放在文件最后，可以另开一个 query 跑。
--
-- -------------------------------------------------------------------
-- 为什么又是一张新表，而不是把 records 读开
--
-- `records` 的读策略是 `is_club_member(club_id)` —— 你只读得到自己
-- 在的球群。那是这个 App 权限的地基：掀开它，所有人都能翻所有球群的
-- 比赛、球员、球局、聊天。
--
-- 全国榜（017）当初站在一模一样的岔路口，走的是另一条：**另开一张
-- 自愿的公开表，只放能公开的那几样**。这里照抄，连「有行 = 公开，
-- 删行 = 收回」这条也照抄 —— 不设 is_public 之类的开关字段，
-- 那种字段总有一天会和「有没有行」对不上。
--
-- 所以这张表上只有：球馆、州、日期时间、几片场、几个人、上限、
-- 谁开的、球群邀请码。**比分、球员名单、聊天一行都不出群。**
--
-- -------------------------------------------------------------------
-- 老的球局一条都不会被公开
--
-- 这张表是新的，谁也没给它写过行，而且这一版的代码只发布「还活着
-- 而且还新鲜」的局（src/lib/openBoard.ts 里的 shouldPublish：
-- 进行中 + 没勾私人 + 12 小时内有动静）。
--
-- 那一条同时挡住了升级时最容易出的事：本机那些还标着 active、其实
-- 早就打完没人按「结束」的老局，不会因为这次升级被摊到全网。
--
-- 没有回填，也不该有。
--
-- -------------------------------------------------------------------
-- 邀请码为什么在这张表上
--
-- 数据是按球群隔离的，所以看到一场局却没有码的人只能干看着。
-- 把码放在这一行上，「我要来」才点得动。
--
-- 这意味着：**公开一场局 = 把这个球群的门牌号给了看得到它的人。**
-- 这一点必须在界面上说清楚，而不是只写在这儿。勾「私人局」就不发布，
-- 码也就不出去。
-- ===================================================================

begin;

create table if not exists public.open_sessions (
  /* 球局 id。一场局在这张表上最多一行 */
  session_id text primary key,

  /*
   * 谁发布的。写策略认这一栏 —— 只有开局的那台手机维护这一行。
   * 别人的手机连写都写不进来，所以不会出现两台手机互相覆盖。
   */
  host_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,

  /* 球群邀请码。想加入的人靠它进来（理由见文件开头） */
  club_code text check (club_code is null or char_length(club_code) <= 24),

  venue text not null check (char_length(venue) <= 200),

  /*
   * 州。从球馆那串地址里认出来的（src/lib/region.ts），可以是空的。
   * 认不出来就是空 —— **不猜**：猜错了把一场局放进隔壁州的列表里，
   * 比不放更糟。空的只出现在「全部」里，不出现在任何一个州的筛选下。
   */
  state text check (state is null or char_length(state) <= 40),

  /* yyyy-mm-dd。存成 text 和 records 里那一栏一个口径，不做时区转换 */
  date text not null check (char_length(date) = 10),
  /* "HH:mm"，可以没有（早期的球局没有这一栏） */
  time text check (time is null or char_length(time) = 5),

  courts integer not null default 1 check (courts between 1 and 20),
  joined integer not null default 0 check (joined >= 0),
  max_players integer check (max_players is null or max_players between 1 and 200),

  /* 开局的人叫什么。列表上总要看得出是谁开的 */
  host_name text check (host_name is null or char_length(host_name) <= 40),

  updated_at timestamptz not null default now()
);

/* 列表按日期翻，几千行之后没有索引会全表扫 */
create index if not exists open_sessions_date on public.open_sessions (date, time);
/* 「只看雪兰莪」：先按州筛再按日期排 */
create index if not exists open_sessions_state_date on public.open_sessions (state, date);

alter table public.open_sessions enable row level security;

/* RLS 和 GRANT 是两道门，都得开 —— 这个仓库栽过四次（最近一次是 029） */
grant select, insert, update, delete on public.open_sessions to authenticated;

/*
 * 更新时间由数据库盖，不信客户端传的。
 *
 * 以后要靠它清理僵尸行（发布了却再没人动过的），而一个可以自己填的
 * 时间戳挡不住任何事。
 *
 * **只盖时间，不碰 host_uid** —— 017 那次在这儿栽过：多写一句
 * `new.host_uid := coalesce(old.host_uid, auth.uid())` 想防冒名，
 * 结果 INSERT 时 old 是空的、后台用管理员身份插入时 auth.uid() 也是空，
 * 于是它把调用方明明给了的值覆盖成 NULL，整条插入炸在非空约束上。
 * 而且本来就多余：冒名由下面那条 with check 挡死。
 */
create or replace function public.stamp_open_session() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists open_sessions_stamp on public.open_sessions;
create trigger open_sessions_stamp
  before insert or update on public.open_sessions
  for each row execute function public.stamp_open_session();

-- ===================================================================
-- 策略
-- ===================================================================

/*
 * 读：登录的人都读得到全部。这就是这张表存在的意义 ——
 * 它和全国榜一样，是故意跨球群可见的那一小块，所以上面只放了
 * 能公开的东西。
 *
 * 只给 authenticated，不给 anon：没登录的人看到一场局也加不进来，
 * 而把所有球馆和时间对整个互联网敞开没有任何好处。
 */
drop policy if exists "公开球局谁都看得到" on public.open_sessions;
create policy "公开球局谁都看得到"
  on public.open_sessions for select to authenticated
  using (true);

/*
 * 写：只能写自己那一行。
 *
 * 这一条同时办了三件事：不能替别人发布、不能改别人发布的那一行、
 * 不能把别人的局从列表上撤掉。
 */
drop policy if exists "只发布自己开的局" on public.open_sessions;
create policy "只发布自己开的局"
  on public.open_sessions for insert to authenticated
  with check (host_uid = auth.uid());

drop policy if exists "只改自己发布的" on public.open_sessions;
create policy "只改自己发布的"
  on public.open_sessions for update to authenticated
  using (host_uid = auth.uid())
  with check (host_uid = auth.uid());

/*
 * 删 = 从公开列表上收回来。
 *
 * 管理员也删得掉：这张表是全 App 可见的，万一有人把不该公开的东西
 * 写进球馆名里，得有人能立刻摘掉它 —— 和动态下架（025）同一条道理。
 */
drop policy if exists "自己收回，或者管理员摘掉" on public.open_sessions;
create policy "自己收回，或者管理员摘掉"
  on public.open_sessions for delete to authenticated
  using (host_uid = auth.uid() or public.is_admin(auth.uid()));

commit;
