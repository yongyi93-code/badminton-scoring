-- ===================================================================
-- 好友看到的名字
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- -------------------------------------------------------------------
-- 为什么需要这一列
--
-- 到今天为止，这个 App 里**名字只存在球群里**：它是 records 里那条
-- player 记录上的一个字段，而 records 的读策略是「只读得到自己在的群」。
--
-- 于是出现了一个从「好友可以跨群」那天起就一直在的窟窿：
--
--   你加了一个别的球群的人做好友。好友列表上那一行显示
--   **「不认识的人 · 他不在你的球群里」** —— 你自己点头加的好友，
--   App 却说不出他叫什么。
--
-- 私聊那一屏也一样。这不是小事：一个连名字都显示不出来的好友列表，
-- 等于告诉人「串场这件事我们没想清楚」。
--
-- 解法是给**账号那一层**一个名字。一个人一行，和照片放同一张表 ——
-- 它们是同一件事：「你对外是谁」。
--
-- -------------------------------------------------------------------
-- 它不替代球群里的名字，优先级排在后面
--
-- 显示名字的顺序永远是：
--
--   1. 他在**我这个球群**里那条球员记录上的名字   ← 最可信
--   2. 这里这个 display_name
--   3. 实在没有，才说「不认识的人」
--
-- 第一条排前面是有道理的：同一个群里，大家管他叫什么就是什么 ——
-- 那是记分的人打出来的名字，改了会对不上比赛记录。这一列只在
-- 「我这个群里根本没有这个人」的时候才派上用场。
--
-- -------------------------------------------------------------------
-- 谁看得到
--
-- 一行都不用新写策略：它就在 profiles 上，跟着 022 那条读策略走 ——
-- 自己 / 好友 / 同一个球群的人。陌生人读不到。
--
-- 也就是说全国榜上那个名字和这一列是两回事：那个是公开的、本人
-- 按「上榜」时自己报的；这一列只给好友和同群的人。两者都可以改，
-- 互不影响。
-- ===================================================================

begin;

alter table public.profiles
  add column if not exists display_name text;

/*
 * 24 个字符。中文名两三个字，英文名加姓十来个，24 够用而且够短 ——
 * 好友列表那一行放得下，不会把「私聊」按钮挤出屏幕。
 *
 * 判的是 btrim 之后的长度：不然一串空格能当名字存进去，
 * 界面上是一行空白，看着像坏了。
 */
alter table public.profiles
  drop constraint if exists profiles_display_name_len;
alter table public.profiles
  add constraint profiles_display_name_len
  check (display_name is null or char_length(btrim(display_name)) between 1 and 24);

comment on column public.profiles.display_name is
  '好友和同群的人看到的名字。球群里那条球员记录上的名字优先，这个是兜底 —— 给不在同一个群的好友看';

-- ===================================================================
-- 自检
-- ===================================================================
select 'display_name 这一列加上了吗' as 项,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles'
           and column_name = 'display_name'
       ) then '加上了' else '没有 —— 上面那步没成功' end as 值
union all
select '长度限制在不在（挡住空名字和超长名字）',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.profiles'::regclass
           and conname = 'profiles_display_name_len'
       ) then '在' else '不在' end
union all
select 'profiles 的策略数（还该是 4，这一步不新增策略）', count(*)::text
from pg_policy where polrelid = 'public.profiles'::regclass
union all
select '现在有几个人填了名字（第一次跑是 0，重跑不该把它清掉）',
       (select count(*)::text from public.profiles where display_name is not null);

notify pgrst, 'reload schema';

commit;
