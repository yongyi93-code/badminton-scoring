-- ===================================================================
-- 举报
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 009 和 010 要已经跑过。
--
-- 跑完还有一步：把自己设成管理员，不然举报没人看得到。
-- 那一句在文件最后，是注释掉的，照着做。
--
-- -------------------------------------------------------------------
-- 举报和拉黑不是一件事
--
-- 拉黑是「我不想再看到这个人」——一个人自己的事，立刻生效，
-- 不需要任何人同意。009 里已经有了。
--
-- 举报是「这件事该有人管一管」——它要送到别人手上，要留证据，
-- 要有结论。两件事的对象、时效、能看到的人全不一样，
-- 所以是另一张表，不是 blocks 上多一栏。
--
-- 界面上两件事摆在一起（举报的时候顺手拉黑），那是界面的事。
--
-- -------------------------------------------------------------------
-- 证据必须由服务端拍快照，这一条是整段 SQL 里最要紧的
--
-- 两个方向都会出事，缺一不可：
--
--   1. 不拍快照 → 证据会没
--      009 里有一条策略叫「只能撤回自己发的」：发消息的人删得掉
--      自己说过的话。骂完一句删掉，举报点开是一段空白对话 ——
--      而这恰恰是会骂人的人最可能做的事。
--
--   2. 让客户端拍 → 证据会假
--      客户端递上来的任何东西都可以是编的。「他说了这句话」这种
--      指控要是能由指控的人自己填，那这张表记的就不是证据，
--      是作文。
--
-- 所以：插举报的时候 evidence 必须是空的（插入策略里管着），
-- 之后由 Edge Function 用服务端身份回数据库把那段对话读出来填进去
-- （下面那个触发器只让它填一次，填过就冻住）。
--
-- -------------------------------------------------------------------
-- 管理员这张表，App 里没有任何一条路写得到
--
-- 只有 select，而且只查得到自己那一行。加管理员要到后台跑 SQL。
--
-- 这是故意做得不方便的：管理员看得到别人的私聊内容（证据里就是），
-- 那么「怎么变成管理员」这条路上任何一个洞，都等于所有人的私聊
-- 有一个洞。一条 insert 策略写松了就是这种洞，而这张表一年也加
-- 不了两次人 —— 拿方便换这个，换得不值。
-- ===================================================================

begin;

-- ===================================================================
-- 一、两张表
-- ===================================================================

/*
 * 谁是管理员。
 *
 * note 是给人看的（「我自己」「阿明，帮忙管周三那场」），不是给
 * 程序看的 —— 半年后翻这张表，光一列 uuid 认不出是谁。
 */
create table if not exists public.app_admins (
  uid uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  -- 谁举报的。默认值由数据库填，客户端伪造不了
  reporter uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reported uuid not null references auth.users(id) on delete cascade,
  /*
   * 理由是一份定死的清单，不是自由文本。
   *
   * 清单能统计（「这个人被三个人以骚扰举报过」），自由文本不能；
   * 而且照着选比对着空白框打字容易得多 —— 一个正在被骚扰的人
   * 不该还要先组织语言。想多说的写在 note 里。
   */
  reason text not null check (
    reason in ('harassment', 'abuse', 'spam', 'fake', 'cheating', 'other')
  ),
  note text check (note is null or char_length(note) <= 1000),
  /*
   * 举报的那一刻，他们之间最近那段对话长什么样。
   * 只有服务端填得进去，而且只填得了一次 —— 见文件开头和下面的触发器。
   */
  evidence jsonb,
  status text not null default 'open' check (status in ('open', 'handled', 'dismissed')),
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reports_no_self check (reporter <> reported)
);

/*
 * 同一个人对同一个人，同时只能有一条没处理完的举报。
 *
 * 这是防刷：没有这个索引，谁都能对着一个人连点五十下，
 * 把管理员那一屏淹掉 —— 而淹掉之后，真的那一条也就看不见了。
 *
 * 用 partial unique index 而不是「24 小时内一次」那种时间窗，
 * 是因为它答的问题更准：处理完之前，重复的那一条不增加任何信息；
 * 处理完之后，这个人又犯了，那本来就该是一条新的举报。
 */
create unique index if not exists reports_one_open
  on public.reports (reporter, reported) where status = 'open';

-- 管理员那一屏按时间顺着翻没处理的；部分索引，不用全表扫
create index if not exists reports_open_time
  on public.reports (created_at) where status = 'open';

-- 「这个人被举报过几次」要查得快，不然以后没法按人汇总
create index if not exists reports_reported
  on public.reports (reported, created_at desc);

alter table public.app_admins enable row level security;
alter table public.reports enable row level security;

/*
 * 表级权限。RLS 和 GRANT 是两道门，都得开。
 *
 * 这一段栽过两次（009 里那两段注释就是两次的记录），所以这次
 * 写在策略前面，并且一样按「策略里有的才发」来发：
 *
 *   app_admins  App 只需要问「我是不是管理员」→ 只发 select
 *   reports     举报、撤回、管理员改状态 → select/insert/update/delete
 *
 * service_role 要单独发一次 —— 它绕得过 RLS，绕不过 GRANT，
 * 这两件事是分开的。它要读举报、要把证据写回去（update），
 * 还要读 app_admins 才知道该推给谁。
 */
grant select on public.app_admins to authenticated;
grant select, insert, update, delete on public.reports to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.app_admins to service_role;
    grant select, update on public.reports to service_role;
  end if;
end $$;

-- ===================================================================
-- 二、一个函数
-- ===================================================================

/*
 * 「这个人是不是管理员」。
 *
 * 必须 security definer：下面那条读策略只让人看到自己那一行，
 * 而举报表的读策略要判的是「当前这个人在不在名单里」——
 * 普通身份查不到别人那一行，这个判断在策略里就永远是假。
 *
 * 只吐一个真假，问不出名单里都有谁。
 */
create or replace function public.is_admin(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where uid = u);
$$;

grant execute on function public.is_admin(uuid) to authenticated;

-- ===================================================================
-- 三、一个触发器
--
-- 和 009 里那两个是同一类东西：守「旧值不许被改掉」，
-- 而 with check 看不见旧值，这种事只有触发器做得到。
-- ===================================================================

/*
 * 举报的内容不许改，状态可以改。
 *
 * 管理员对这一行有 update 权限（他要标「处理完了」），而 with check
 * 拦不住他顺手把 reason 从「骚扰」改成「广告」、或者把 reported
 * 换成另一个人。被改的人不会知道，也没有第二份可以对。
 *
 * evidence 是唯一一个「空的时候可以填、填过就冻住」的：
 * 它由服务端在举报落库之后补上（见文件开头）。coalesce 正好
 * 表达这件事 —— 第一次填得进去，之后每一次都被按回原值。
 */
create or replace function public.keep_report_facts() returns trigger
language plpgsql as $fn$
begin
  new.reporter   := old.reporter;
  new.reported   := old.reported;
  new.reason     := old.reason;
  new.note       := old.note;
  new.created_at := old.created_at;
  new.evidence   := coalesce(old.evidence, new.evidence);
  -- 状态一变，就记下是谁、什么时候下的结论。不靠客户端自觉传
  if new.status is distinct from old.status then
    new.handled_by := case when new.status = 'open' then null else auth.uid() end;
    new.handled_at := case when new.status = 'open' then null else now() end;
  else
    new.handled_by := old.handled_by;
    new.handled_at := old.handled_at;
  end if;
  return new;
end
$fn$;

drop trigger if exists reports_keep_facts on public.reports;
create trigger reports_keep_facts
  before update on public.reports
  for each row execute function public.keep_report_facts();

-- ===================================================================
-- 四、策略
-- ===================================================================

-- ---------- app_admins ----------

/*
 * 只看得到自己那一行 —— 也就是只答得出「我是不是」，
 * 答不出「都有谁是」。
 *
 * 后半句是故意的：管理员名单公开的话，想骚扰的人就知道该绕开谁、
 * 该针对谁。而 App 需要的只有前半句：决定那个入口显不显示。
 */
drop policy if exists "只知道自己是不是管理员" on public.app_admins;
create policy "只知道自己是不是管理员"
  on public.app_admins for select to authenticated
  using (uid = auth.uid());

-- 没有 insert / update / delete 策略，也没发这三样权限。
-- 加管理员只有一条路：到后台跑 SQL（见文件最后）。

-- ---------- reports ----------

-- 读：自己举报的，加上管理员看全部
drop policy if exists "自己的举报和管理员看得到" on public.reports;
create policy "自己的举报和管理员看得到"
  on public.reports for select to authenticated
  using (reporter = auth.uid() or public.is_admin(auth.uid()));

/*
 * 举报：以自己的身份，开着的状态，证据栏必须空着。
 *
 * 三件事都要判：
 *   reporter = auth.uid()  不能替别人举报
 *   status = 'open'        不能插一条「已处理」进去把自己洗白
 *   evidence is null       证据不能由举报的人自己写（文件开头那段）
 *   handled_* is null      同上，结论不能自带
 *
 * 这里故意不查拉黑：被一个人拉黑之后更应该举报得了他，
 * 而不是更不能。挡住的话，先拉黑再骚扰就成了一条免疫路线。
 */
drop policy if exists "只能以自己的身份举报" on public.reports;
create policy "只能以自己的身份举报"
  on public.reports for insert to authenticated
  with check (
    reporter = auth.uid()
    and status = 'open'
    and evidence is null
    and handled_by is null
    and handled_at is null
  );

/*
 * 改状态：只有管理员。
 *
 * 举报的人自己改不了 —— 他要是能把自己那条标成「已处理」，
 * 那条唯一索引就形同虚设，连点五十下又回来了。
 * 他想收回的话走下面那条 delete。
 */
drop policy if exists "只有管理员能下结论" on public.reports;
create policy "只有管理员能下结论"
  on public.reports for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

/*
 * 撤回：只能撤自己的，而且只在还没人处理之前。
 *
 * 举报完了后悔是很正常的事（吵完架第二天和好了），所以留一条路。
 * 但处理过的撤不掉：那时候它已经不只是「我的一条投诉」，
 * 而是一件发生过、有人看过、有结论的事。
 */
drop policy if exists "没处理之前可以撤回自己的举报" on public.reports;
create policy "没处理之前可以撤回自己的举报"
  on public.reports for delete to authenticated
  using (reporter = auth.uid() and status = 'open');

-- ---------- 被举报的那段录音 ----------

/*
 * 管理员听得到被举报的那两个人之间的语音。
 *
 * 不给的话，「他发语音骂我」这类举报根本没法处理 —— 证据快照里
 * 那一条只是「[语音] 0:12」，点开是一个签不出链接的气泡。
 *
 * 范围卡在两件事上，两件都必须成立：
 *   1. 当事人只能是这条举报的那一对（路径头两段就是收发双方，
 *      见 010：路径的形状就是权限）
 *   2. 只在举报还开着的时候。结了案，这扇门自己关上 ——
 *      管理员的权限是跟着「有一件待办」走的，不是永久的
 *
 * 也就是说这不是「管理员能听所有人的语音」。那种权限我不会加：
 * 它一旦存在，就只能靠人自觉不用。
 */
drop policy if exists "管理员听得到被举报的录音" on storage.objects;
create policy "管理员听得到被举报的录音"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice'
    and array_length(storage.foldername(name), 1) = 2
    and public.is_admin(auth.uid())
    and exists (
      select 1 from public.reports r
      where r.status = 'open'
        and (
          (r.reporter::text = (storage.foldername(name))[1]
             and r.reported::text = (storage.foldername(name))[2])
          or
          (r.reported::text = (storage.foldername(name))[1]
             and r.reporter::text = (storage.foldername(name))[2])
        )
    )
  );

-- ===================================================================
-- 五、自检
-- ===================================================================
select '两张表都建好了吗' as 项,
       count(*)::text || ' / 2' as 值
from information_schema.tables
where table_schema = 'public' and table_name in ('app_admins', 'reports')
union all
select 'reports 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.reports'::regclass
union all
select 'app_admins 的策略数（应该是 1，只有读）', count(*)::text
from pg_policy where polrelid = 'public.app_admins'::regclass
union all
select '守住「举报内容不许改」的触发器',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.reports'::regclass and tgname = 'reports_keep_facts'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select '「同一对人只能有一条没处理的」这个索引',
       case when exists (
         select 1 from pg_indexes
         where schemaname = 'public' and indexname = 'reports_one_open'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
/*
 * 和 009 里一样：问的是「我要的那几项在不在」，不是「总共有几项」。
 * Supabase 自己在 public schema 上有一套默认权限，数总数只会
 * 白吓人一跳。
 */
select '我要的那 5 项权限齐了吗',
       case when (
         select count(*) from (values
           ('reports', 'SELECT'), ('reports', 'INSERT'),
           ('reports', 'UPDATE'), ('reports', 'DELETE'),
           ('app_admins', 'SELECT')
         ) as need(t, p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated'
             and g.table_schema = 'public'
             and g.table_name = need.t
             and g.privilege_type = need.p
         )
       ) = 5 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '推送函数读得写得了 reports 吗',
       case when (
         select count(*) from information_schema.role_table_grants
         where grantee = 'service_role' and table_schema = 'public'
           and table_name = 'reports'
           and privilege_type in ('SELECT', 'UPDATE')
       ) >= 2 then '可以' else '不行 —— 证据存不进去、也推不出提醒' end
union all
select '管理员听得到被举报录音的那条策略',
       case when exists (
         select 1 from pg_policy
         where polrelid = 'storage.objects'::regclass
           and polname = '管理员听得到被举报的录音'
       ) then '有' else '没有 —— 语音举报会没法处理' end
union all
-- 这一条不是检查，是提醒：一个管理员都没有的话，举报没人看得到
select '现在有几个管理员',
       case when (select count(*) from public.app_admins) = 0
            then '一个都没有 —— 照下面那句 SQL 把自己加进去'
            else (select count(*)::text from public.app_admins) end;

notify pgrst, 'reload schema';

commit;

-- ===================================================================
-- 六、最后一步：把自己设成管理员
--
-- 上面那段跑完之后，单独跑下面这一句（去掉注释）。
-- 把邮箱换成你自己登录 RALLY 用的那个。
--
-- 不这么做的话，举报会老老实实地存进数据库，但一个人都看不到 ——
-- 一个没人看的举报按钮比没有更糟：它让人以为说出去了。
--
--   insert into public.app_admins (uid, note)
--   select id, '我自己' from auth.users where email = '你的邮箱@example.com'
--   on conflict (uid) do nothing;
--
-- 跑完确认一下，应该看到一行：
--
--   select a.uid, a.note, u.email
--   from public.app_admins a join auth.users u on u.id = a.uid;
-- ===================================================================
