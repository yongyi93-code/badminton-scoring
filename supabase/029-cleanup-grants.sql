-- ===================================================================
-- 补 028 漏掉的一句：service_role 在 posts 上没有 SELECT
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 028 要已经跑过。
--
-- 那个编辑器**吃不掉太长的一段**（实测这个文件整段贴进去在第 100 行
-- 断掉，报 syntax error at end of input）。真正非做不可的只有下面
-- 「一、」那两句，九行；自检可以另开一个 query 单独跑。
--
-- -------------------------------------------------------------------
-- 线上撞出来的（2026-09-21）
--
-- 一条 Story 过了 24 小时还挂在圈圈里，点开一片黑。查下来是两件事
-- 叠在一起，前一半已经在客户端修了（过期的不再显示），这里是后一半：
-- **行根本没被删掉**。
--
--   select count(*) from public.posts
--   where expires_at is not null and expires_at <= now();   → 2
--
-- 而照片已经没了 —— 也就是说 cleanup-stories 每小时都跑到了「删照片」
-- 那一步，然后死在「删行」上，返回 500，没人看日志。
--
-- -------------------------------------------------------------------
-- 为什么是 SELECT，不是 RLS
--
-- 028 里我只写了 `grant delete on public.posts to service_role`。
-- 而函数发出去的是**带 where 的 delete**（`.in('id', ids)`），
-- Postgres 里带 where 的 DELETE 要读那些列 —— 于是要 SELECT 权限。
--
-- 本机跑真 Postgres 撞过，两句的差别就是这么直白：
--
--   delete from posts where expires_at <= now();  → permission denied
--   delete from posts;                            → DELETE 2
--
-- 线上那张权限表也对得上：DELETE, REFERENCES, TRIGGER, TRUNCATE ——
-- 没有 SELECT。
--
-- 顺带排掉了另外两个看着更像的嫌疑：
--   · service_role 有 bypassrls（「能」），所以不是 RLS 挡的
--   · posts 不是 force RLS
--
-- -------------------------------------------------------------------
-- 为什么当时没发现
--
-- 因为 028 里那个自检没有查这件事，而函数里的探针**证明不了它能删**：
-- 探针问的是「读得到 expired_stories 吗」，而那是个普通视图 ——
-- 视图跟着**建它的人**的权限走，所以它照样读得到。
-- 本机验过：读得到 2 条、删掉 0 条，两件事完全不相干。
--
-- 所以这个文件的自检直接问 Postgres「service_role 到底有没有这个权限」
-- （has_table_privilege），不绕任何弯子。
-- ===================================================================

-- ===================================================================
-- 一、非做不可的就这两句
-- ===================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice '这个库里没有 service_role，跳过授权';
    return;
  end if;

  /*
   * 只补 SELECT。
   *
   * 不写 `grant all` —— service_role 在 posts 上不该有 INSERT 和
   * UPDATE：发动态是本人的事（024 的策略），而 posts 故意不给 update
   * （发出去的东西只能删了重发）。给多了的话，哪天某个函数写错一行，
   * 没有任何一道门拦得住它替别人发一条。
   */
  grant select on public.posts to service_role;
end $$;

-- ===================================================================
-- 顺手把那几条孤儿收掉
--
-- 它们的照片已经被删掉了（上面那次失败正好卡在文件之后、行之前），
-- 所以这些行现在指向一堆不存在的文件 —— 留着只会让管理员那边
-- 一直看到一条点开全黑的 Story。
--
-- **只删照片确实都不在了的那些**。还有文件在桶里的，交给
-- cleanup-stories 按它的顺序走（先文件后行）—— 在这儿直接删行的话，
-- 那些文件就永远变成没人知道的孤儿了，而那是 028 开头就点名要避免的。
-- ===================================================================

delete from public.posts p
where p.expires_at is not null
  and p.expires_at <= now()
  and not exists (
    select 1
    from unnest(coalesce(p.photos, '{}')) as t(path)
    join storage.objects o on o.bucket_id = 'moments' and o.name = t.path
  );

commit;

-- ===================================================================
-- 自检
-- ===================================================================
select 'service_role 读得到 posts 吗（这就是那个 bug）' as 项,
       case when has_table_privilege('service_role', 'public.posts', 'SELECT')
            then '读得到' else '读不到 —— 上面那步没成功' end as 值
union all
select 'service_role 删得了 posts 吗',
       case when has_table_privilege('service_role', 'public.posts', 'DELETE')
            then '删得了' else '删不了 —— 028 没跑过？' end
union all
select 'service_role 在 posts 上还是没有 INSERT / UPDATE 吧（该没有）',
       case when has_table_privilege('service_role', 'public.posts', 'INSERT')
                 or has_table_privilege('service_role', 'public.posts', 'UPDATE')
            then '有了 —— 不对，给多了' else '没有' end
union all
/*
 * 别的函数用到的表一起查一遍。
 *
 * 这个 bug 的形状是「少了一句 grant，而所有人都以为 service_role
 * 什么都能干」—— 那就不该只查撞出来的这一张表。
 */
select '这些表里 service_role 读不到的：' ||
       coalesce(nullif(string_agg(t, ', ' order by t), ''), '（没有，都读得到）'),
       ''
from (
  select t from unnest(array[
    'app_admins', 'feedback', 'friendships', 'messages',
    'posts', 'push_subscribers', 'records', 'reports'
  ]) as t
  where to_regclass('public.' || t) is not null
    and not has_table_privilege('service_role', 'public.' || t, 'SELECT')
) s
union all
select '过期还没清掉的还剩几条',
       (select count(*)::text from public.posts
        where expires_at is not null and expires_at <= now());
