-- ===================================================================
-- 照片头像
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- -------------------------------------------------------------------
-- 两张脸，分工不同
--
-- 这个 App 从此有两张脸，各自回答一个问题（决定见 docs/社交化.md）：
--
--   照片（这个文件管的）   名字旁边那个小圆      「你是谁」
--   换装角色（早就有了）   点进个人主页才看到    「你有多强」
--
-- 所以这里存的只有照片。角色那一套一个字都不动 —— src/assets 那 2 MB
-- 素材、商店、金币，展示面全部保住。
--
-- -------------------------------------------------------------------
-- 桶是公开读的，这是想清楚之后选的，不是图省事
--
-- 朋友圈的单条动态可以设成公开（那是产品决定），而公开的动态上要
-- 显示作者的头像 —— 一个还没加好友的陌生人得看得见那张脸。
--
-- 私有桶要签名 URL，而签名会过期：好友列表里几十个小圆，每次进这一屏
-- 都要重签一遍，图会闪、会重下。为一个 40 像素的圆圈付这个代价不值。
--
-- **代价写在明面上**：公开桶意味着那个地址谁拿到都打得开，而且永久
-- 有效。所以：
--
--   · 文件名是随机的（uuid），**不是 uid** —— 不然拿全国榜上公开的
--     uid 就能把所有人的照片挨个翻出来
--   · 路径的第一段是 uid，那是给写入策略用的（只能往自己那个文件夹里传）
--   · 换一张照片会写一个新的随机文件名，旧的由客户端删掉
--
-- -------------------------------------------------------------------
-- 「谁看得到别人的照片路径」故意收得比桶紧
--
-- 桶是公开的，但**要先知道路径才打得开**。路径存在下面这张 profiles 表
-- 里，而它的读策略是「自己 / 好友 / 同一个球群的人」。
--
-- 也就是说：一个刚注册、什么都没加的陌生人，拿不到任何人的路径。
-- 等以后真做了公开的朋友圈，再把作者的路径**冗余进那条动态里** ——
-- 而不是现在就把这张表对所有人打开。
--
-- 为一个还不存在的功能提前放开权限，是这类事情最常见的出错方式。
-- ===================================================================

begin;

-- ===================================================================
-- 一、桶
-- ===================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true,
  /*
   * 512 KB。客户端压完通常 60–150 KB（长边 512、webp）——
   * 留这么多是给压缩失败时那条退路（有些浏览器不支持 webp，退回 jpeg）。
   *
   * 卡在数据库这层，不是只在界面上卡：界面那道拦得住手滑，
   * 拦不住改过的客户端。
   */
  512 * 1024,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * 写：只能往自己那个文件夹里传。
 *
 * 路径长这样：<uid>/<随机>.webp
 * storage.foldername('abc/xyz.webp') 给的是 {abc} —— 文件名不算。
 * 所以 [1] 就是那个人的 uid。
 */
drop policy if exists "只能传进自己那个头像文件夹" on storage.objects;
create policy "只能传进自己那个头像文件夹"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  );

/* 换照片时要把旧的那张删掉，不然桶里越积越多，而且全是人脸 */
drop policy if exists "只能删自己那个头像文件夹里的" on storage.objects;
create policy "只能删自己那个头像文件夹里的"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/*
 * 故意不给 update。
 *
 * 和语音那边同一条理由（010）：换照片就是「传一张新的 + 删旧的」，
 * 留着 update 只是多一条以后可能被绕开的路 —— 覆盖同一个路径，
 * 等于把别人已经看过的那张脸换掉，而路径没变，缓存也不会更新。
 */

-- ===================================================================
-- 二、谁的照片在哪
-- ===================================================================

create table if not exists public.profiles (
  uid uuid primary key references auth.users(id) on delete cascade,
  /*
   * 桶里的路径，比如 'a1b2…/9f3c….webp'。空 = 没设过照片。
   * 存路径不存完整 URL：换域名、换项目的时候 URL 会变，路径不会。
   */
  photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

/* RLS 和 GRANT 是两道门，都得开 —— 这个仓库栽过好几次 */
grant select, insert, update, delete on public.profiles to authenticated;

create or replace function public.stamp_profile() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists profiles_stamp on public.profiles;
create trigger profiles_stamp
  before insert or update on public.profiles
  for each row execute function public.stamp_profile();

/*
 * 「我们俩在同一个球群里吗」。
 *
 * 必须 security definer：它要读**别人**的成员资格，而 club_members
 * 自己的策略只让你读自己那几行。不加的话这个函数永远返回 false，
 * 而且不报错 —— 同群的人互相看不到头像，没人查得出为什么。
 *
 * 和 is_club_member（005）不一样：那个只问「我在不在某个群」，
 * 只读自己的行，所以它不需要 definer。
 */
create or replace function public.shares_club(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_members x
    join public.club_members y on y.club_id = x.club_id
    where x.user_id = a and y.user_id = b
  );
$$;

grant execute on function public.shares_club(uuid, uuid) to authenticated;

-- ===================================================================
-- 策略
-- ===================================================================

/*
 * 读：自己、好友、同一个球群的人。
 *
 * 为什么不是「登录的人都能读」：见文件开头。一个刚注册、什么都没加的
 * 陌生人不该能把所有人的脸翻一遍。
 *
 * are_friends 已经把拉黑算进去了（009）—— 拉黑一个人，他立刻看不到
 * 你的照片。
 */
drop policy if exists "自己好友和同群的人看得到照片" on public.profiles;
create policy "自己好友和同群的人看得到照片"
  on public.profiles for select to authenticated
  using (
    uid = auth.uid()
    or public.are_friends(auth.uid(), uid)
    or public.shares_club(auth.uid(), uid)
  );

/* 写：只能写自己那一行。三条都要判 */
drop policy if exists "只设自己的照片" on public.profiles;
create policy "只设自己的照片"
  on public.profiles for insert to authenticated
  with check (uid = auth.uid());

drop policy if exists "只改自己的照片" on public.profiles;
create policy "只改自己的照片"
  on public.profiles for update to authenticated
  using (uid = auth.uid())
  with check (uid = auth.uid());

drop policy if exists "自己撤掉照片" on public.profiles;
create policy "自己撤掉照片"
  on public.profiles for delete to authenticated
  using (uid = auth.uid());

-- ===================================================================
-- 自检
-- ===================================================================
select 'avatars 这个桶建好了吗' as 项,
       case when exists (select 1 from storage.buckets where id = 'avatars')
            then '建好了' else '没有 —— 上面那步没成功' end as 值
union all
select '桶是公开读的吗（朋友圈公开动态要用）',
       case when (select public from storage.buckets where id = 'avatars')
            then '是' else '不是 —— 陌生人看不到公开动态上的头像' end
union all
select '桶卡了大小和格式吗',
       case when (select file_size_limit from storage.buckets where id = 'avatars') is not null
             and (select allowed_mime_types from storage.buckets where id = 'avatars') is not null
            then '卡了' else '没卡 —— 谁都能传一个 10MB 的文件上来' end
union all
select 'profiles 这张表建好了吗',
       case when exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'profiles'
       ) then '建好了' else '没有' end
union all
select 'profiles 的策略数（应该是 4）', count(*)::text
from pg_policy where polrelid = 'public.profiles'::regclass
union all
select 'shares_club 是 security definer 吗（不是的话同群互相看不到）',
       case when (select prosecdef from pg_proc where proname = 'shares_club')
            then '是' else '不是 —— 会静悄悄地永远返回 false' end
union all
select 'avatars 桶上的写入策略数（应该是 2：传 + 删）',
       (select count(*)::text from pg_policy
        where polrelid = 'storage.objects'::regclass
          and polname like '%头像%')
union all
select '我要的那 4 项权限齐了吗',
       case when (
         select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as need(p)
         where exists (
           select 1 from information_schema.role_table_grants g
           where g.grantee = 'authenticated' and g.table_schema = 'public'
             and g.table_name = 'profiles' and g.privilege_type = need.p
         )
       ) = 4 then '齐了' else '少了 —— 上面那段 grant 没跑成' end
union all
select '现在有几个人设了照片（刚跑完应该是 0）',
       (select count(*)::text from public.profiles where photo_path is not null);

notify pgrst, 'reload schema';

commit;
