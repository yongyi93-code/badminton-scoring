-- ===================================================================
-- 朋友圈（第一版：只有好友看得到）
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 009（好友）和 022（名片）要已经跑过。
--
-- -------------------------------------------------------------------
-- 这一版故意没有「公开」那一档
--
-- 定下来的产品是「默认好友可见，单条可以选公开」（docs/社交化.md）。
-- 公开那一档**这一版不做**，而且连那个字段都不加。
--
-- 理由不是做不动，是顺序：一条设成公开的动态，陌生人看得到，
-- 那正是应用商店审核要看的场景 —— 而「举报之后管理员能做什么」
-- 现在的答案还是「只能点一下已处理」。先有公开内容、后有管理手段，
-- 中间那段时间是没人管的。
--
-- **那为什么连字段都不加**：一个没有任何东西在用的 visibility 字段，
-- 配一条「公开的谁都读得到」的分支策略，等于为一个还不存在的功能
-- 提前放开权限 —— 这个仓库在 022 的注释里刚写过这句话。
-- 等封号做完，加一列、改一条策略，在本机跑真 Postgres 撞过再上线。
--
-- -------------------------------------------------------------------
-- 动态不能改，只能删了重发
--
-- 和语音消息同一条规矩（010）：发出去的东西没有「改一改」这回事。
-- 所以这张表**没有 update 策略**。
--
-- 这不是偷懒。留着 update 的话，一个人可以在别人点过赞、评论过之后
-- 把内容换掉 —— 而点赞还挂在那儿。那是一种很难解释的错。
--
-- -------------------------------------------------------------------
-- 照片放私有桶，和语音一样，不和头像一样
--
-- 头像那个桶是公开的，理由写在 022 里：公开的动态上要显示作者的脸，
-- 陌生人得看得见。
--
-- 朋友圈的照片不是那回事 —— 它更接近私信：只给好友看。所以照 010 的
-- 办法，桶设成私有，每次用的时候签一个临时链接出来。地址会过期，
-- 泄漏一次不等于永久公开。
--
-- 代价是刷一屏要签一批链接（一次请求签一批，不是一张一次）。
-- 为一张脸的 40 像素圆圈付这个代价不值，为别人的生活照值。
-- ===================================================================

begin;

-- ===================================================================
-- 一、动态
-- ===================================================================

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references auth.users(id) on delete cascade,
  /* 正文。可以没有 —— 只发照片是常见的 */
  body text,
  /*
   * 桶里的路径，比如 {'a1b2…/9f3c….webp'}。存路径不存完整地址：
   * 私有桶的地址本来就是临时签出来的，存下来第二天就打不开了。
   */
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);

/*
 * 一条动态至少要有点什么。
 *
 * 不判的话可以插进一条既没字也没图的 —— 界面上是一个空白卡片，
 * 点不动也删不掉（人根本看不见它在哪），而谁都不知道它是怎么来的。
 * messages 那边（010）踩过同一个坑。
 *
 * array_length 对空数组返回的是 NULL 不是 0，所以要 coalesce ——
 * 这一条不套的话，空数组会让整个 check 变成 NULL，而 NULL 在
 * check 里算**通过**。
 */
alter table public.posts drop constraint if exists posts_shape;
alter table public.posts add constraint posts_shape check (
  (body is not null and char_length(btrim(body)) between 1 and 1000)
  or coalesce(array_length(photos, 1), 0) >= 1
);

/* 九张。再多一屏也看不完，而每一张都是钱 */
alter table public.posts drop constraint if exists posts_photo_count;
alter table public.posts add constraint posts_photo_count
  check (coalesce(array_length(photos, 1), 0) <= 9);

alter table public.posts enable row level security;

/* RLS 和 GRANT 是两道门，都得开 —— 这个仓库栽过好几次 */
grant select, insert, delete on public.posts to authenticated;

/*
 * 照片路径必须是**自己文件夹里的**。
 *
 * 不守的话有个绕法：我发一条动态，photos 里写上别人文件夹里的路径。
 * 桶的读策略是按路径第一段认人的，于是我的好友会拿到一个他本来
 * 没资格看的文件的签名链接 —— 用我的动态当跳板。
 *
 * check 里写不了 unnest（子查询不让用），所以只能是触发器。
 * created_at 也在这儿钉死：不然可以伪造一条「三年前发的」插到别人
 * 时间线的中间去。
 */
create or replace function public.guard_post() returns trigger
language plpgsql as $fn$
declare p text;
begin
  new.created_at := now();
  foreach p in array coalesce(new.photos, '{}') loop
    if p !~ ('^' || new.author::text || '/') then
      raise exception '照片路径不属于作者本人: %', p;
    end if;
    /* 只许一层文件夹：a/b.webp 行，a/b/c.webp 不行 */
    if array_length(string_to_array(p, '/'), 1) <> 2 then
      raise exception '照片路径层数不对: %', p;
    end if;
  end loop;
  return new;
end
$fn$;

drop trigger if exists posts_guard on public.posts;
create trigger posts_guard
  before insert on public.posts
  for each row execute function public.guard_post();

/*
 * 读：自己的，和好友的。
 *
 * are_friends 已经把拉黑算进去了（009）—— 拉黑一个人，他立刻看不到
 * 你的动态，你也看不到他的。
 */
drop policy if exists "自己和好友的动态" on public.posts;
create policy "自己和好友的动态"
  on public.posts for select to authenticated
  using (author = auth.uid() or public.are_friends(auth.uid(), author));

drop policy if exists "只能以自己的身份发" on public.posts;
create policy "只能以自己的身份发"
  on public.posts for insert to authenticated
  with check (author = auth.uid());

drop policy if exists "只能删自己发的" on public.posts;
create policy "只能删自己发的"
  on public.posts for delete to authenticated
  using (author = auth.uid());

/*
 * 故意不给 update：发出去的东西只能删了重发（理由见文件开头）。
 *
 * 管理员下架某一条也**还没有**。那件事和封号是一套的，等那一轮 ——
 * 现在整个 App 里没有任何公开内容，能看到一条动态的人都是作者
 * 自己点头加的好友。
 */

/* 刷的是「最近的」，所以时间要能倒着走。作者那个是看某个人主页用的 */
create index if not exists posts_time on public.posts (created_at desc);
create index if not exists posts_author_time on public.posts (author, created_at desc);

-- ===================================================================
-- 二、点赞
-- ===================================================================

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  uid uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, uid)
);

alter table public.post_likes enable row level security;
grant select, insert, delete on public.post_likes to authenticated;

/*
 * 「看得到那条动态，就看得到它的赞」。
 *
 * 这一条靠的是 **RLS 会套进策略里的子查询**：下面这个 exists 去查
 * posts 的时候，posts 自己那条读策略照样生效，所以查不到的动态
 * 在这里就是不存在。不用把「自己或好友」那句话再抄一遍 ——
 * 抄一遍就有了两份，而它们迟早会不一样。
 *
 * （posts 的策略里没有反过来引用 post_likes，所以不会绕成死循环。）
 */
drop policy if exists "看得到那条动态就看得到赞" on public.post_likes;
create policy "看得到那条动态就看得到赞"
  on public.post_likes for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

/* 点赞：只能以自己的身份，而且只能点自己看得到的那条 */
drop policy if exists "只能自己点赞" on public.post_likes;
create policy "只能自己点赞"
  on public.post_likes for insert to authenticated
  with check (
    uid = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id)
  );

drop policy if exists "只能收回自己的赞" on public.post_likes;
create policy "只能收回自己的赞"
  on public.post_likes for delete to authenticated
  using (uid = auth.uid());

-- ===================================================================
-- 三、照片桶
--
-- private：桶里的东西没有公开地址，要一条一条签出临时链接来。
-- 和 voice 一样，不和 avatars 一样 —— 理由见文件开头。
-- ===================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'moments', 'moments', false,
  /*
   * 1 MB。客户端压完（长边 1080、webp）通常 100–250 KB，
   * 留这么多是给压缩退回 jpeg 的那条路。
   *
   * 卡在数据库这层，不是只在界面上卡：界面那道拦得住手滑，
   * 拦不住改过的客户端。
   */
  1024 * 1024,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * 谁看得到：自己传的，和好友传的。
 *
 * 路径是 <uid>/<随机>.webp，所以 foldername[1] 就是作者。
 * 和 posts 的读策略是同一个口径（are_friends）—— 两处不一样的话，
 * 会出现「动态看得到，图是裂的」或者反过来「图签得出来，动态读不到」。
 */
drop policy if exists "自己和好友的动态照片" on storage.objects;
create policy "自己和好友的动态照片"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'moments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.are_friends(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists "只能传进自己那个动态文件夹" on storage.objects;
create policy "只能传进自己那个动态文件夹"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'moments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  );

/* 删掉一条动态时要把图一起删掉，不然桶里越积越多 */
drop policy if exists "只能删自己那个动态文件夹里的" on storage.objects;
create policy "只能删自己那个动态文件夹里的"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'moments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/* 同样不给 update：覆盖同一个路径等于把别人看过的图换掉，而地址没变 */

-- ===================================================================
-- 自检
-- ===================================================================
select 'posts 这张表建好了吗' as 项,
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'posts'
       ) then '建好了' else '没有 —— 上面那步没成功' end as 值
union all
select 'posts 的策略数（应该是 3：读 / 发 / 删，没有改）', count(*)::text
from pg_policy where polrelid = 'public.posts'::regclass
union all
select 'posts 上有 update 策略吗（必须没有）',
       case when exists (
         select 1 from pg_policy
         where polrelid = 'public.posts'::regclass and polcmd = 'w'
       ) then '有 —— 不对，动态不该能改' else '没有，对' end
union all
select '「至少要有点什么」那条约束在不在',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.posts'::regclass and conname = 'posts_shape'
       ) then '在' else '不在' end
union all
select '照片路径那个触发器在不在（挡住拿别人的图当跳板）',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.posts'::regclass and tgname = 'posts_guard'
       ) then '在' else '不在' end
union all
select 'post_likes 的策略数（应该是 3）', count(*)::text
from pg_policy where polrelid = 'public.post_likes'::regclass
union all
select 'moments 桶建好了吗（而且必须是私有的）',
       coalesce((
         select case when public then '建了，但是公开的 —— 不对' else '私有，对' end
         from storage.buckets where id = 'moments'
       ), '没建成')
union all
select 'moments 桶卡了大小和格式吗',
       case when (select file_size_limit from storage.buckets where id = 'moments') is not null
             and (select allowed_mime_types from storage.buckets where id = 'moments') is not null
            then '卡了' else '没卡' end
union all
select 'moments 桶上的策略数（应该是 3：看 / 传 / 删）',
       (select count(*)::text from pg_policy
        where polrelid = 'storage.objects'::regclass
          and polname in ('自己和好友的动态照片', '只能传进自己那个动态文件夹',
                          '只能删自己那个动态文件夹里的'))
union all
select 'posts 上我要的那 3 项权限齐了吗',
       case when (
         select count(*) from (values ('SELECT'), ('INSERT'), ('DELETE')) as need(p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated' and g.table_schema = 'public'
             and g.table_name = 'posts' and g.privilege_type = need.p
         )
       ) = 3 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '现在有几条动态（第一次跑是 0）',
       (select count(*)::text from public.posts);

notify pgrst, 'reload schema';

commit;
