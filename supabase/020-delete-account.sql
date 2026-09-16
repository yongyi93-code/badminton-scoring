-- ===================================================================
-- 删号：把「删账号要连带删什么」交给数据库,别交给某个函数记得
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- -------------------------------------------------------------------
-- 为什么要有这个文件
--
-- 隐私政策里写着可以删号,方式是「写信到那个邮箱」。要把它变成
-- App 里的一个按钮,先得回答一件事:**删掉 auth.users 那一行之后,
-- 到底还剩下什么。**
--
-- 数一遍之后发现，大半已经是对的 —— 下面这些表都写了
-- `references auth.users(id) on delete cascade`,删账号自动跟着没:
--
--   friendships / blocks / messages     （009）
--   reports（他举报的、举报他的）/ feedback（014）/ errors（015）
--   app_admins（016）/ leaderboard（017）
--   各表的 handled_by 是 on delete set null —— 处理记录留着,不署名
--
-- **有三处不是**,这个文件补的就是它们。
--
-- -------------------------------------------------------------------
-- 三处漏网的，两处在这儿补，一处补不了
--
-- **club_members.user_id** 和 **push_subscribers.user_id** 当初建表时
-- 没写外键。后果:人注销了还算球群成员（人数不变）、还会一直往一个
-- 不存在的人推通知。
--
-- 补法是加外键,不是在删号那个函数里多写两句 delete —— 差别在于
-- **谁保证**。写在函数里,从后台手动删一个用户就绕过去了,而那正是
-- 真出事时最可能发生的操作。写成外键,数据库替你记得。
--
-- **第三处补不了：records 里球员的 ownerId。**
-- 它是 JSONB 里的一个字符串,不是外键,数据库不认识它。
-- 而这恰恰是**故意的、也是对的**：比分和球员行不该被 cascade 带走
-- （「比分要留、人要脱钩」）。所以清 ownerId 这一步只能由删号那个
-- Edge Function 做,见 supabase/functions/delete-me/index.ts。
--
-- 代价说清楚:**从后台手动删用户的话,ownerId 不会被清掉。**
-- 它不会让任何东西出错（uuid 不会被重新分配,认不到人就是认不到），
-- 但那是一串指向已删账号的 id,不该留着。下面最后一句自检会数出来。
-- ===================================================================

begin;

-- ===================================================================
-- 一、加外键之前先看有没有孤儿行
--
-- 表里要是有指向不存在用户的行,add constraint 会直接失败,
-- 而失败信息（violates foreign key constraint）不会告诉你是哪几行。
-- 先自己数一遍,数完顺手清掉 —— 那些行本来就是坏的:
-- 一条属于不存在的人的球群成员资格,和一条推不出去的订阅。
-- ===================================================================

delete from public.club_members m
where not exists (select 1 from auth.users u where u.id = m.user_id);

delete from public.push_subscribers s
where s.user_id is null
   or not exists (select 1 from auth.users u where u.id = s.user_id);

-- ===================================================================
-- 二、把外键补上
-- ===================================================================

alter table public.club_members
  drop constraint if exists club_members_user_fk;
alter table public.club_members
  add constraint club_members_user_fk
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.push_subscribers
  drop constraint if exists push_subscribers_user_fk;
alter table public.push_subscribers
  add constraint push_subscribers_user_fk
  foreign key (user_id) references auth.users(id) on delete cascade;

/*
 * push_subscribers.user_id 原来是可空的（002 里是 add column 加上去的）。
 * 现在补上非空 —— 一条不知道属于谁的订阅是推不动也清不掉的僵尸,
 * 上面那句 delete 已经把老的清掉了。
 */
alter table public.push_subscribers
  alter column user_id set not null;

-- ===================================================================
-- 三、给 service_role 补一条 update
--
-- 真机上第一次点注销，函数跑起来了然后炸在：
--
--   permission denied for table records at unlinkPlayers
--
-- 数一遍所有给 service_role 的授权就明白了：001 里只有
-- `grant select on public.records to service_role`。当初开那一行是为了
-- 让推送函数读得到开局的人叫什么 —— 只读就够了，没人想到以后会有
-- 函数要往 records 里写。
--
-- 而 delete-me 要做的恰恰是写：把球员行的 ownerId 改成 null。
--
-- **只补 update，不补 insert / delete。** 这个函数不需要它们，而
-- service_role 是绕过 RLS 的身份 —— 多给一分权限，就多一条以后被
-- 绕开的路。
--
-- （messages 那边不用补：deleteVoiceFiles 只 select 出 audio_path，
-- 而 009 已经给了 service_role 的 select。)
-- ===================================================================

grant update on public.records to service_role;

-- ===================================================================
-- 自检
--
-- 第一段数的是「还有没有指向 auth.users 但不会级联的外键」——
-- 这是这个文件留下的长期检查。以后谁再加一张带 uid 的表又忘了写
-- on delete cascade,这一句就会数出来。
-- ===================================================================
select '指向 auth.users 又不会级联的外键（应该是 0）' as 项,
       (select count(*)::text
        from pg_constraint c
        join pg_class ct on ct.oid = c.conrelid
        where c.contype = 'f'
          and c.confrelid = 'auth.users'::regclass
          and ct.relnamespace = 'public'::regnamespace
          -- a = no action, r = restrict：这两种都不会自动清
          and c.confdeltype in ('a', 'r')) as 值
union all
select 'club_members 的外键补上了吗',
       case when exists (
         select 1 from pg_constraint
         where conname = 'club_members_user_fk'
           and conrelid = 'public.club_members'::regclass
       ) then '补上了' else '没有 —— 上面那步没成功' end
union all
select 'push_subscribers 的外键补上了吗',
       case when exists (
         select 1 from pg_constraint
         where conname = 'push_subscribers_user_fk'
           and conrelid = 'public.push_subscribers'::regclass
       ) then '补上了' else '没有 —— 上面那步没成功' end
union all
/*
 * delete-me 要往 records 里写。缺了这一条，注销会在「剪断球员」
 * 那一步炸，而报错是一句 permission denied —— 和「表不存在」
 * 「RLS 挡住了」长得差不多，很难一眼看出是少了个 grant。
 */
select 'service_role 能 update records 吗（delete-me 要用）',
       case when exists (
         select 1 from information_schema.role_table_grants
         where grantee = 'service_role' and table_schema = 'public'
           and table_name = 'records' and privilege_type = 'UPDATE'
       ) then '能' else '不能 —— 上面那步没成功' end
union all
/*
 * 指向已删账号的 ownerId。
 *
 * 正常情况下这里永远是 0：删号走 Edge Function,它会先清 ownerId
 * 再删账号。不是 0 的话,说明有人是从后台直接删掉的 ——
 * 那不会让任何东西出错,但该清一清。
 */
select '指向已删账号的球员 ownerId（应该是 0）',
       (select count(*)::text
        from public.records r
        where r.kind = 'player'
          and r.deleted = false
          and r.data->>'ownerId' is not null
          and not exists (
            select 1 from auth.users u
            where u.id::text = r.data->>'ownerId'
          ));

notify pgrst, 'reload schema';

commit;
