-- ===================================================================
-- 通知跟着收的人的语言走
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 002-push.sql 要已经跑过。
--
-- -------------------------------------------------------------------
-- 为什么语言这一栏要挂在订阅上，而不是挂在人身上
--
-- 「我用中文还是英文」这件事本来就存在浏览器的 localStorage 里，
-- 也就是说它是**这台设备**的偏好，不是这个人的属性：同一个人
-- 手机上看中文、iPad 上看英文，完全说得通。
--
-- 而推送恰好也是发给设备的 —— push_subscribers 一行就是一台设备。
-- 两件事的粒度天生一样，挂在这里不用多一层对照。
--
-- 挂在球员身上的话反而要回答「他两台设备语言不一样时算谁的」，
-- 而那个问题没有正确答案。
--
-- -------------------------------------------------------------------
-- 空着是什么意思
--
-- 老的订阅行这一栏是空的。空 = 不知道，那就退回中文 —— 这个球群
-- 现在绝大多数人用中文，而且下一次他点开语言开关就会被补上。
-- 不去猜、也不去回填：猜错了是给人推一条他读不懂的通知。
-- ===================================================================

begin;

alter table public.push_subscribers
  add column if not exists lang text check (lang in ('zh', 'en'));

-- ------------------------------------------------------------------
-- 自检
-- ------------------------------------------------------------------
select '订阅表上有 lang 这一列了吗' as 项,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'push_subscribers'
           and column_name = 'lang'
       ) then '有' else '没有 —— 上面那步没成功' end as 值
union all
select '现在各语言各有几台设备（空的是还没报过语言的老订阅）',
       coalesce(string_agg(t.k || '=' || t.n, ' · ' order by t.k), '一台都没有')
from (
  select coalesce(lang, '(空)') as k, count(*)::text as n
  from public.push_subscribers group by 1
) t;

notify pgrst, 'reload schema';

commit;
