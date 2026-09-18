-- ===================================================================
-- 朋友圈：单条可以选公开
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 024（朋友圈）和 025（封号）要已经跑过。
--
-- -------------------------------------------------------------------
-- 这是 024 故意留着不做的那一半
--
-- 024 里写着：「公开那一档这一版不做，而且连那个字段都不加 —— 理由不是
-- 做不动，是顺序：一条公开的动态陌生人看得到，而那正是应用商店审核要看
-- 的场景，而举报之后管理员能做什么，答案还是『只能点一下已处理』。」
--
-- 025 把那件事补上了（禁言、封号、下架、申诉），所以这一档现在可以开。
--
-- -------------------------------------------------------------------
-- 公开只改「谁看得到」，不改「在哪看得到」
--
-- 主时间线还是只有好友的 —— 和微信一样。公开的意思是：
-- **一个还没加你好友的人，点进你的个人主页，看得到这一条**。
--
-- 不做成一个所有人的广场，因为那是另一个产品：广场要排序、要推荐、
-- 要防刷、要一整套内容治理，而这个 App 是一个球群的记分板。
--
-- （时间线那一屏靠客户端按作者收窄，不靠策略 —— 策略管的是
-- 「读不读得到」，不是「这一屏想显示谁」。两件事混在一起的话，
-- 以后想加一个「公开」栏目就得先改策略。）
--
-- -------------------------------------------------------------------
-- 三件跟着公开一起变的事，少一件都是坏的
--
-- **一、照片。** 动态照片在私有桶里，桶的读策略是按路径第一段认好友的。
-- 陌生人读得到那条动态却签不出图 —— 一屏裂图。所以桶上多一条：
-- 「这个文件被某条公开动态引用着」也放行。
--
-- 不把公开的图挪去公开桶：那要在「设成公开」的那一下搬文件，
-- 中间失败就是一条图裂的动态，而且路径变了缓存也全作废。
--
-- **二、作者是谁。** profiles 的读策略是「自己 / 好友 / 同群」，
-- 所以陌生人读得到动态，却读不到作者的名字和脸 —— 一条没有作者的
-- 动态。所以多一条：**发过公开动态的人，名片对登录用户可见**。
--
-- 这一条是有代价的，写在明面上：**把一条动态设成公开，等于同时把
-- 自己的名字和头像对所有登录用户公开**。界面上必须说这句话。
-- 反过来做（把作者的名字照片冗余进那条动态里）会存两份，
-- 而两份迟早对不上 —— 改了名字，旧动态上还是旧名字。
--
-- **三、拉黑照样管用。** are_friends 里本来就含拉黑，但公开那一支
-- 绕过了它，所以要单独再判一次。不判的话，拉黑一个人之后他照样
-- 看得到你所有公开的动态 —— 而拉黑的人多半正是最会去翻的那个。
--
-- -------------------------------------------------------------------
-- 发出去之后改不了，公开这一栏也一样
--
-- 024 定的规矩：动态只能删了重发。visibility 一样冻在触发器里。
--
-- 「那能不能让作者把公开收回成好友可见？」——收窄是安全的，但那会
-- 给人一种「发错了还能补救」的错觉，而公开的那几分钟里内容可能
-- 已经被截图了。说「发出去就是发出去了」更诚实，也和这个 App 里
-- 别的地方一致。
-- ===================================================================

begin;

alter table public.posts
  add column if not exists visibility text not null default 'friends';

alter table public.posts drop constraint if exists posts_visibility;
alter table public.posts add constraint posts_visibility
  check (visibility in ('friends', 'public'));

/*
 * 桶那条策略和 profiles 那条策略都要按「这条动态是不是公开的」去查，
 * 而那是按 photos 这个数组、按 author 查的。没有索引的话，每刷一屏
 * 都是全表扫。
 */
create index if not exists posts_public
  on public.posts (author) where visibility = 'public' and hidden_at is null;
create index if not exists posts_photos on public.posts using gin (photos);

-- ===================================================================
-- 一、谁看得到这条动态
-- ===================================================================

/*
 * 在 025 那版上多一支「或者它是公开的」。
 *
 * 拉黑要单独再判一次：are_friends 里含拉黑，但公开这一支绕过了它。
 * 不判的话，拉黑一个人之后他照样翻得到你所有公开的动态。
 */
drop policy if exists "自己和好友的动态" on public.posts;
create policy "自己和好友的动态"
  on public.posts for select to authenticated
  using (
    author = auth.uid()
    or public.is_admin(auth.uid())
    or (
      hidden_at is null
      and not public.is_blocked_between(auth.uid(), author)
      and (visibility = 'public' or public.are_friends(auth.uid(), author))
    )
  );

/*
 * 发的时候只能是这两种之一，而且**不能冒充**。
 * 024 那条 insert 策略照抄，只是这里要把 visibility 也钉一下 ——
 * check 约束已经管了取值，这里不用重复。
 */

/* 公开这一栏也冻住：发出去之后改不了，理由见文件开头 */
create or replace function public.keep_post_facts() returns trigger
language plpgsql as $fn$
begin
  new.author     := old.author;
  new.body       := old.body;
  new.photos     := old.photos;
  new.created_at := old.created_at;
  new.visibility := old.visibility;
  if (new.hidden_at is null) is distinct from (old.hidden_at is null) then
    new.hidden_at := case when new.hidden_at is null then null else now() end;
    new.hidden_by := case when new.hidden_at is null then null else auth.uid() end;
  else
    new.hidden_at := old.hidden_at;
    new.hidden_by := old.hidden_by;
  end if;
  return new;
end
$fn$;

-- ===================================================================
-- 二、公开动态上的照片
--
-- 桶还是私有的，链接还是签出来的、会过期的 —— 变的只是
-- 「谁签得出来」多了一种人。
-- ===================================================================

drop policy if exists "自己和好友的动态照片" on storage.objects;
create policy "自己和好友的动态照片"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'moments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.are_friends(auth.uid(), ((storage.foldername(name))[1])::uuid)
      /*
       * 或者：这个文件正被某一条**公开而且没被下架**的动态引用着。
       *
       * 下架那一条一起判，不然管理员下架之后图还签得出来 ——
       * 而下架的意思就是「别人不该再看到它」。
       *
       * 拉黑也一起判：口径要和 posts 那条策略一模一样，
       * 否则会出现「动态看不到、图还看得到」这种更难查的状态。
       */
      or exists (
        select 1 from public.posts p
        where p.visibility = 'public'
          and p.hidden_at is null
          and not public.is_blocked_between(auth.uid(), p.author)
          and storage.objects.name = any (p.photos)
      )
    )
  );

-- ===================================================================
-- 三、公开动态的作者是谁
--
-- 代价写在明面上：设成公开 = 把自己的名字和头像对所有登录用户公开。
-- 界面上那一句必须说这件事。
-- ===================================================================

drop policy if exists "自己好友和同群的人看得到照片" on public.profiles;
create policy "自己好友和同群的人看得到照片"
  on public.profiles for select to authenticated
  using (
    uid = auth.uid()
    or public.are_friends(auth.uid(), uid)
    or public.shares_club(auth.uid(), uid)
    or (
      not public.is_blocked_between(auth.uid(), uid)
      and exists (
        select 1 from public.posts p
        where p.author = public.profiles.uid
          and p.visibility = 'public'
          and p.hidden_at is null
      )
    )
  );

-- ===================================================================
-- 自检
-- ===================================================================
select 'posts 上多了 visibility 这一栏吗' as 项,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'posts'
           and column_name = 'visibility'
       ) then '多了' else '没有 —— 上面那步没成功' end as 值
union all
select '取值只能是那两种吗',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.posts'::regclass and conname = 'posts_visibility'
       ) then '是' else '不是' end
union all
select '老的动态默认是「只有好友」吗（必须是 —— 不能悄悄把旧内容公开）',
       coalesce((
         select case when count(*) = 0 then '是' else '不是 —— 有 ' || count(*) || ' 条被改成公开了' end
         from public.posts where visibility <> 'friends'
       ), '是')
union all
select '「动态不能改」那个触发器还在吗（现在也冻 visibility）',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.posts'::regclass and tgname = 'posts_keep_facts'
       ) then '在' else '不在' end
union all
select 'posts 的策略数（还该是 4：读 / 发 / 删 / 下架）', count(*)::text
from pg_policy where polrelid = 'public.posts'::regclass
union all
select 'moments 桶上的读策略认得公开动态了吗',
       case when exists (
         select 1 from pg_policy
         where polrelid = 'storage.objects'::regclass
           and polname = '自己和好友的动态照片'
           and pg_get_expr(polqual, polrelid) like '%visibility%'
       ) then '认得' else '不认得 —— 陌生人会看到一屏裂图' end
union all
select 'profiles 的读策略认得公开动态的作者了吗',
       case when exists (
         select 1 from pg_policy
         where polrelid = 'public.profiles'::regclass
           and pg_get_expr(polqual, polrelid) like '%visibility%'
       ) then '认得' else '不认得 —— 公开的动态上没有作者名字' end
union all
select '两条新策略都判了拉黑吗（公开那一支绕过了 are_friends）',
       case when (
         select count(*) from pg_policy
         where polrelid in ('public.posts'::regclass, 'public.profiles'::regclass,
                            'storage.objects'::regclass)
           and pg_get_expr(polqual, polrelid) like '%visibility%'
           and pg_get_expr(polqual, polrelid) like '%is_blocked_between%'
       ) = 3 then '判了' else '少了 —— 拉黑的人还翻得到你公开的动态' end
union all
select '现在有几条公开的动态（第一次跑是 0）',
       (select count(*)::text from public.posts where visibility = 'public');

notify pgrst, 'reload schema';

commit;
