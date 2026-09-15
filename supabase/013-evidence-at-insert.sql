-- ===================================================================
-- 证据改成数据库自己拍
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 012 要已经跑过。
--
-- -------------------------------------------------------------------
-- 为什么改
--
-- 012 那一版里，快照是这么发生的：App 插完举报，回头调一次
-- Edge Function，那个函数用服务端身份把对话读出来写回去。
--
-- 上线当天就丢了一条。两条举报差 41 秒：
--
--   07:16:30  拍到 0 条   而那一刻其实有 18 条
--   07:17:11  拍到 18 条
--
-- 第一条撞上了函数冷启动 —— 刚部署完的第一次调用要下载依赖、
-- 起 Deno，客户端那一下没等到就放弃了。而放弃之后没有任何东西
-- 会重来：那 18 句话的快照永远没了。
--
-- 这不是「偶尔失败一次」的量级的问题。证据是这个功能的全部意义，
-- 而且它有时效 —— 消息随后被删掉就再也补不回来（009 里那条
-- 「只能撤回自己发的」正是这么用的）。一个有时会丢证据的举报，
-- 和没有举报的差别没有看上去那么大。
--
-- 所以把它挪到一条不会掉链子的路上：举报插进来的那一刻，
-- 数据库自己把对话拍下来。不走网络、不需要任何函数活着、
-- 和举报本身是同一个事务 —— 举报成功了，证据就一定在。
--
-- Edge Function 那边只剩通知这一件事（它那段快照代码留着当兜底，
-- 因为下面那个触发器只对「跑过这段 SQL 之后」的举报生效）。
--
-- -------------------------------------------------------------------
-- 为什么是 AFTER INSERT，不是 BEFORE
--
-- 012 的插入策略里有一句 `evidence is null` —— 那是挡「举报的人
-- 自己编证据」的。而 Postgres 检查 RLS 的 with check 是在 BEFORE
-- 触发器跑完之后：BEFORE 里把 evidence 填上，那一行就再也过不了
-- 自己那条策略，谁都举报不了。
--
-- AFTER 里补一条 update 就没这个问题，而 012 那个 keep_report_facts
-- 触发器写的是 coalesce(old.evidence, new.evidence) —— 空的时候
-- 填得进去，填过就冻住，正好是这里要的。
-- ===================================================================

begin;

-- ===================================================================
-- 一、把一对人的近况拍成一张 jsonb
-- ===================================================================

/*
 * 这个函数读得到任意两个人的私聊内容。
 *
 * 所以下面紧跟着一句 revoke —— Postgres 新建函数默认是
 * 「谁都能执行」，不收回的话，任何一个登录用户都可以直接调它，
 * 传两个 uid 进去，把别人的对话原样读出来。那等于私聊没有了。
 *
 * 收回之后只剩两个地方用得到它：下面那个 security definer 的
 * 触发器，和这段 SQL 最后那次补档（那时是以 postgres 的身份在跑）。
 */
create or replace function public.report_evidence(a uuid, b uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'taken_at', to_jsonb(now()),
    -- 拉的时候倒着取最近 30 条，存的时候要顺着，不然读起来是倒放的
    'messages', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', t.id,
                 'sender', t.sender,
                 'body', t.body,
                 'kind', coalesce(t.kind, 'text'),
                 'audio_path', t.audio_path,
                 'duration_ms', t.duration_ms,
                 'created_at', t.created_at
               )
               order by t.created_at
             )
      from (
        select m.id, m.sender, m.body, m.kind, m.audio_path, m.duration_ms, m.created_at
        from public.messages m
        where (m.sender = a and m.recipient = b)
           or (m.sender = b and m.recipient = a)
        order by m.created_at desc
        limit 30
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.report_evidence(uuid, uuid) from public;
revoke all on function public.report_evidence(uuid, uuid) from anon, authenticated;

-- ===================================================================
-- 二、举报一落库就拍
-- ===================================================================

create or replace function public.snapshot_on_report() returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.reports
     set evidence = public.report_evidence(new.reporter, new.reported)
   where id = new.id and evidence is null;
  return null;
end
$fn$;

drop trigger if exists reports_snapshot on public.reports;
create trigger reports_snapshot
  after insert on public.reports
  for each row execute function public.snapshot_on_report();

-- ===================================================================
-- 三、把之前丢掉的补回来
--
-- 只补 evidence 还空着的那些。消息还在的就补得回来，
-- 已经被删掉的补不回来 —— 那正是当初丢掉快照的代价。
-- ===================================================================
update public.reports r
   set evidence = public.report_evidence(r.reporter, r.reported)
 where r.evidence is null;

-- ===================================================================
-- 四、自检
-- ===================================================================
select '拍快照的触发器装上了吗' as 项,
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.reports'::regclass and tgname = 'reports_snapshot'
       ) then '装上了' else '没有 —— 上面那步没成功' end as 值
union all
select '普通用户调不调得动 report_evidence（该调不动）',
       case when has_function_privilege('authenticated', 'public.report_evidence(uuid,uuid)', 'execute')
            then '调得动 —— 危险，上面那句 revoke 没生效'
            else '调不动，对' end
union all
select '还有几条举报是没证据的',
       (select count(*)::text from public.reports where evidence is null)
       || ' 条（消息已经被删掉的补不回来，其余应该是 0）'
union all
select '一共几条举报 / 其中拍到了对话的',
       (select count(*)::text from public.reports) || ' / ' ||
       (select count(*)::text from public.reports
        where jsonb_array_length(coalesce(evidence->'messages', '[]'::jsonb)) > 0);

notify pgrst, 'reload schema';

commit;
