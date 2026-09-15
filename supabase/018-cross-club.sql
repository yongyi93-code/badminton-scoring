-- ===================================================================
-- 全国榜：一个人在几个球群打，算一个人
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 前置：017-leaderboard.sql 已经跑过。
--
-- -------------------------------------------------------------------
-- 为什么要改
--
-- 017 里 leaderboard 是「一个账号一行」（uid 是主键）。那在只有一个
-- 球群的时候没问题，多一个群就错得很难看：
--
--   我在「我的球群」打了 30 场，报了一次成绩 —— 榜上 MMR 150。
--   周末去「Twin ark」打了 10 场，在那边按了一次「更新我的成绩」——
--   那一次 upsert 直接盖掉了原来那一行，榜上剩 MMR 50。
--
-- 没有报错，没有提示，20 场就这么不见了。手机只装得下当前那个群的
-- 数据（见 src/store/useApp.ts 里 setClubId 那段），所以它报上来的
-- 永远只是「我在这个群的成绩」—— 那本来就不该覆盖别的群那一份。
--
-- 改法：**主键从 uid 变成 (uid, scope)**，一个人一个群一行，
-- 看榜的时候按人合并。
--
-- -------------------------------------------------------------------
-- scope 是什么，为什么不直接存 club_id
--
-- 直接存 club_id 的话，这张「谁都读得到」的表就顺手泄了一件本来
-- 读不到的事：**谁和谁是一个群的**。挑出同一个 club_id 的行，
-- 就是一份带名字的球群花名册 —— 而 records 那张表拦了一整年的
-- 就是这个。
--
-- 所以存的是 sha256('rally-club-scope:' || uid || ':' || club_id)
-- 的前 24 位十六进制。同一个人的两个群，散列不同，分得开；
-- 两个人的同一个群，散列也不同，拼不出花名册。
--
-- 它能被试出来的那一种情况写在这里，不藏着：一个人如果**已经知道
-- 某个球群的 id**（也就是他自己就在那个群里），他可以拿那个 id 和
-- 榜上某个 uid 一起算一次散列，比对上就知道那个人也在这个群。
-- 但那个群的成员他本来就在 App 里看得见 —— 没有新东西。
-- 拼不出来的是「我不认识的那些人，哪几个是一伙的」，
-- 而那才是花名册。
--
-- 数据库不验证 scope 算得对不对，也验不了（它没有 club_id）。
-- 一个人当然可以自己编几个 scope 多报几行 —— 但他本来就能直接把
-- MMR 填成 9999，没有新增的风险面。榜上那个「对手确认过几场」
-- 仍然是唯一一个不容易伪造的数，这一点没变。
--
-- -------------------------------------------------------------------
-- 合并在客户端做，不在数据库里做
--
-- 和 017 一个理由：**MMR 的算法只有一份**（src/lib/avatar.ts）。
-- 这里连合并都只是加法，但加法也是规则 —— 写成一个数据库视图，
-- 就有了第二处会各自演化的实现。
--
-- 合并规则和它不精确的地方，写在 src/lib/leaderboard.ts 的
-- mergePeople 上面。一句话：各群分别算完再相加，和把所有比赛混在
-- 一起重放一遍不完全等价（「输到 0 就不再往下扣」那一条在每个群里
-- 各生效一次），差别只落在净输很多的人身上，而他们本来就在 0 附近。
--
-- -------------------------------------------------------------------
-- 已经在榜上的那几行会被清掉
--
-- 旧行没有 scope —— 它记的是「某一个群的成绩」，但是哪个群，
-- 这张表里没有任何东西说得出来，手机也推不出来。
--
-- 留着它有两种错法：当成独立的一行，那么这个人下次报成绩就变成
-- 两行相加，凭空多一倍；或者下次报成绩时删掉它，那么他要是换了个
-- 群报，旧群那一份就白丢。两种都是悄悄算错，而悄悄算错是这个仓库
-- 最不能忍的一类。
--
-- 所以直接清掉，让人重按一次「上榜」。代价是一次点击，
-- 而且下面的自检会告诉你清掉了几行。
-- ===================================================================

begin;

-- 清了几行，跑完在自检里看得到
/*
 * 先加列，再按「有没有 scope」清 —— 顺序要紧。
 *
 * 反过来写（先无条件 delete 再加列）也能跑，但那样**第二次跑这个文件
 * 会再清一次榜**。这种文件是会被重跑的：跑到一半断了、不确定跑没跑过、
 * 换个项目再来一遍。一个「重跑一次就清空用户数据」的迁移是个陷阱。
 *
 * 加了列之后，旧行的 scope 是空串（default ''），新行不可能是
 * （下面那条 check 堵死了）。所以「scope 为空」= 「017 时代留下的」，
 * 清的就是它们，第二次跑时一行都不匹配。
 */
alter table public.leaderboard
  add column if not exists scope text not null default '';

-- 先丢再建：临时表是跟着连接走的，后台的 SQL Editor 会复用同一个连接，
-- 不丢的话第二次跑看到的是第一次的数字
drop table if exists _cleared_leaderboard;
create temporary table _cleared_leaderboard as
select count(*)::text as n from public.leaderboard where scope = '';

delete from public.leaderboard where scope = '';

/*
 * 主键换成 (uid, scope)。
 *
 * 约束名写死成 leaderboard_pkey 是 Postgres 给主键的默认名，
 * 017 里那一行 `uid uuid primary key` 建出来的就叫这个。
 */
alter table public.leaderboard drop constraint if exists leaderboard_pkey;
alter table public.leaderboard add primary key (uid, scope);

/*
 * scope 不许是空串。
 *
 * 上面加列时给了 default ''，是为了让 add column 在有行的表上也能过；
 * 空串那些行刚刚清掉了，所以这里可以立刻把空串堵死 ——
 * 一行 scope 为空的数据就是一行「不知道属于哪个群」的数据，
 * 正是这次要消灭的东西。
 */
alter table public.leaderboard drop constraint if exists leaderboard_scope_len;
alter table public.leaderboard
  add constraint leaderboard_scope_len
  check (char_length(scope) between 8 and 64);

alter table public.leaderboard alter column scope drop default;

/*
 * 榜要按合并之后的总分排，那件事只能在客户端做（见上面）。
 * 数据库这边还是按行的 mmr 倒序取，取够一批再合并。
 *
 * 几千人之后这个办法会开始漏人（一个人的小行被截断在批次外面），
 * 到那时候该做的是一个服务端视图 —— 现在还早，写在这儿备查。
 */

-- 拿「我自己的那几行」是每次进这一屏都要做的事，值一个索引
create index if not exists leaderboard_uid on public.leaderboard (uid);

-- ===================================================================
-- 策略：一条都没变
--
-- 读还是「登录的人都读得到」，写还是「只能写 uid = auth.uid() 的行」。
-- 主键多了一列不影响这四条 —— 一个人多几行，每一行仍然只有他自己
-- 写得动。这里重新贴一遍是为了让这个文件单独跑也是对的。
-- ===================================================================

drop policy if exists "全国榜谁都看得到" on public.leaderboard;
create policy "全国榜谁都看得到"
  on public.leaderboard for select to authenticated
  using (true);

drop policy if exists "只报自己的成绩" on public.leaderboard;
create policy "只报自己的成绩"
  on public.leaderboard for insert to authenticated
  with check (uid = auth.uid());

drop policy if exists "只改自己那一行" on public.leaderboard;
create policy "只改自己那一行"
  on public.leaderboard for update to authenticated
  using (uid = auth.uid())
  with check (uid = auth.uid());

drop policy if exists "自己下榜" on public.leaderboard;
create policy "自己下榜"
  on public.leaderboard for delete to authenticated
  using (uid = auth.uid());

-- ===================================================================
-- 自检
-- ===================================================================
select 'scope 这一列加上了吗' as 项,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'leaderboard'
           and column_name = 'scope'
       ) then '加上了' else '没有 —— 上面那步没成功' end as 值
union all
select '主键是 (uid, scope) 吗',
       coalesce((
         select string_agg(a.attname, ', ' order by k.ord)
         from pg_constraint c
         cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         where c.conrelid = 'public.leaderboard'::regclass and c.contype = 'p'
       ), '没有主键 —— 上面那步没成功')
union all
select 'scope 不许为空这条约束',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.leaderboard'::regclass
           and conname = 'leaderboard_scope_len'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select 'leaderboard 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.leaderboard'::regclass
union all
select '三个索引齐了吗（mmr / state+mmr / uid）',
       case when (
         select count(*) from pg_indexes
         where schemaname = 'public' and tablename = 'leaderboard'
           and indexname in ('leaderboard_mmr', 'leaderboard_state_mmr', 'leaderboard_uid')
       ) = 3 then '齐了' else '少了' end
union all
select '清掉了几行没有球群的旧数据（这些人要重按一次「上榜」）',
       (select n from _cleared_leaderboard)
union all
-- 第一次跑完这里是 0（旧行刚清掉）。以后重跑这个文件不该再清任何东西，
-- 上一行会是 0，这一行会是榜上真实的行数
select '现在榜上有几行',
       (select count(*)::text from public.leaderboard);

notify pgrst, 'reload schema';

commit;
