-- ===================================================================
-- 把现有数据归到一个球群里
--
-- 只跑一次，跑之前先跑 003。可以重复跑（不会重复建群）。
--
-- ------------------------------------------------------------------
-- 这一步在做什么
--
-- 003 给 records 加了 club_id，但老数据那一列还是空的。空的行在
-- 005 收紧策略之后谁都读不到 —— 等于你现有的战绩全部消失。
--
-- 所以顺序是死的：003 建结构 → 004 归群 → 005 收紧。
-- 中间跳过 004 直接跑 005，你会失去所有历史数据。
--
-- ------------------------------------------------------------------
-- 谁会成为这个群的成员
--
-- 从 player 记录里的 ownerId 收集 —— 那是每个认领过角色的人的
-- 登录账号 id。没认领过的（代建的访客）本来就没有账号，不用管。
-- ===================================================================

-- ------------------------------------------------------------------
-- 整段包在事务里：中途出错就全部回滚，不留半迁移的状态。
-- 也顺带让底下那张自检表在失败时不打印 —— 否则脚本报了错，
-- 汇总表照样输出，看着像成功了。
-- ------------------------------------------------------------------
begin;

do $$
declare
  v_club_id  text;
  v_code     text;
  -- ↓↓↓ 改成你想要的群名字 ↓↓↓
  --
  -- 注意这里是普通的 SQL 字符串，不是 psql 的 \set 变量。
  -- 踩过两次：一是 \set 在美元引号块里不做替换；二是 Supabase 的
  -- SQL Editor 根本不认 \set 这类 psql 命令。两边都以语法错误收场。
  -- （连带一提：块里的注释也不能出现美元引号，那会提前把块封掉。）
  v_name     text := '我的球群';
  v_members  int;
  v_rows     int;
begin
  -- ----------------------------------------------------------------
  -- 1. 已经有群了就用那个，别建第二个
  --
  -- 这段要能重复跑：迁移这种东西，人总会因为不确定有没有跑成功而
  -- 再跑一遍。第二遍不该产生第二个群。
  -- ----------------------------------------------------------------
  select id into v_club_id
  from public.records
  where kind = 'club' and deleted = false
  order by (data->>'createdAt')::bigint
  limit 1;

  if v_club_id is null then
    v_club_id := 'club_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    -- 邀请码去掉了容易看错的字符：0/O、1/I/L。
    -- 这串是要人念给球友听、或者手打进去的，不是给机器读的。
    v_code := upper(substr(translate(
      md5(random()::text || clock_timestamp()::text),
      '01lo', 'wxyz'), 1, 6));

    insert into public.records (kind, id, data, club_id, deleted)
    values ('club', v_club_id,
      jsonb_build_object(
        'id', v_club_id,
        'name', v_name,
        'code', v_code,
        'createdAt', (extract(epoch from now()) * 1000)::bigint
      ),
      v_club_id, false);

    raise notice '建了球群「%」，id=%，邀请码=%', v_name, v_club_id, v_code;
  else
    select data->>'code' into v_code
    from public.records where kind = 'club' and id = v_club_id;
    raise notice '已经有球群了，id=%，邀请码=% —— 沿用它', v_club_id, v_code;
  end if;

  -- ----------------------------------------------------------------
  -- 2. 把认领过角色的人都拉进来当成员
  --
  -- 直接插 club_members，不走 RLS（这段是在后台以超级用户身份跑的）。
  -- on conflict 跳过：重复跑不会报错。
  -- ----------------------------------------------------------------
  insert into public.club_members (club_id, user_id)
  select distinct v_club_id, (r.data->>'ownerId')::uuid
  from public.records r
  where r.kind = 'player'
    and r.deleted = false
    and r.data->>'ownerId' is not null
    and r.data->>'ownerId' <> ''
  on conflict (club_id, user_id) do nothing;

  get diagnostics v_members = row_count;
  raise notice '加了 % 个成员', v_members;

  -- ----------------------------------------------------------------
  -- 3. 所有还没归群的行，全部归到这个群
  --
  -- 包括软删除的行：它们也要能被这个群的人读到，否则删除同步不出去，
  -- 别人手机上那条会一直躺着。
  -- ----------------------------------------------------------------
  update public.records
  set club_id = v_club_id
  where club_id is null;

  get diagnostics v_rows = row_count;
  raise notice '归了 % 行数据', v_rows;
end $$;

-- ------------------------------------------------------------------
-- 自检：跑完看这三个数
--   club_id 还是空的行数   应该是 0
--   成员数                 应该等于你们注册过的人数
--   每个群各有多少行
-- ------------------------------------------------------------------
select 'club_id 还空着的行' as 项, count(*)::text as 值
from public.records where club_id is null
union all
select '成员数', count(*)::text from public.club_members
union all
select '球群「' || (data->>'name') || '」邀请码', data->>'code'
from public.records where kind = 'club' and deleted = false
union all
select '  ' || kind || ' 行数', count(*)::text
from public.records where deleted = false group by kind;

commit;
