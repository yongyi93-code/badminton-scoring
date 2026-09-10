-- ===================================================================
-- 哪个球群才是「真的那个」
--
-- 只读。不改任何东西，随便跑几遍都行。
--
-- ------------------------------------------------------------------
-- 为什么要跑这一句
--
-- App 里配了一个默认球群的邀请码（VITE_DEFAULT_CLUB_CODE）。
-- 从现在这版起，所有人打开 App 都会被拨到那个群里 —— 不管他手上
-- 原来还有几个别的群。这是「所有人自动进同一个群」应有的样子，
-- 也是「我开了局，别人首页看不到」那个毛病的解法。
--
-- 但它有个前提：那个邀请码指的，得是装着你们全部战绩的那个群。
-- 指错了的话，所有人会被一起拨到一个空群里，界面上看起来就像
-- 数据全没了（其实一行都没少，只是不在当前这个群里）。
--
-- 所以上线前跑一下这一句，对着结果看一眼：
-- 「行数」最多的那个群，它的邀请码是不是 .env 里配的那一个。
-- 是就没事。不是就别合，把邀请码换成对的那个再说。
-- ===================================================================

select
  c.data ->> 'name'                      as 群名,
  c.data ->> 'code'                      as 邀请码,
  c.id                                   as 群_id,
  count(r.id) filter (where r.deleted = false)                          as 活着的行,
  count(r.id) filter (where r.deleted = false and r.kind = 'player')    as 球员,
  count(r.id) filter (where r.deleted = false and r.kind = 'session')   as 球局,
  count(r.id) filter (where r.deleted = false and r.kind = 'match')     as 比赛,
  (select count(*) from public.club_members m where m.club_id = c.id)   as 成员,
  max(r.updated_at)                      as 最后一次有人动它
from public.records c
left join public.records r on r.club_id = c.id
where c.kind = 'club'
  and c.deleted = false
group by c.id, c.data
order by 活着的行 desc;
