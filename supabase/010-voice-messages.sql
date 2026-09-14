-- ===================================================================
-- 语音消息
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 跑之前 009 要已经跑过。
--
-- -------------------------------------------------------------------
-- 两件事
--
--   1. messages 多认一种形状：一条消息要么是一段文字，要么是一段录音
--   2. 录音本身放 Storage 的 voice 桶里，桶是私有的，另一套规则
--
-- 录音为什么不塞进表里：一段 60 秒的 opus 大概 60–100KB，几百条
-- 之后这张表每次查询都在搬运几十兆音频，而界面上真正要播的
-- 一次只有一条。放 Storage，表里只留一个路径。
--
-- -------------------------------------------------------------------
-- 路径就是权限
--
-- 文件路径定成  <发的人 uid>/<收的人 uid>/<随机名>.<后缀>
--
-- 这不是为了好看，是为了让「谁能听」这件事不用再查一次表：
-- 路径的前两段就是这段录音属于哪两个人，Storage 的策略直接读它。
-- 存一个「这段录音属于哪条消息」的对照表也能做到，但那就多了一份
-- 要和文件本身保持一致的东西 —— 而它们迟早会不一致。
-- ===================================================================

begin;

-- ===================================================================
-- 一、messages 多认一种形状
-- ===================================================================

alter table public.messages
  add column if not exists kind text not null default 'text',
  add column if not exists audio_path text,
  add column if not exists duration_ms integer;

/*
 * 原来 body 是 not null 且必须 1–2000 字 —— 那是「消息只能是文字」
 * 时代的规矩。语音那条没有文字，所以两条都得放开，再换成一条
 * 按类型分别要求的。
 *
 * 换而不是删：不要求的后果是可以插进一条什么都没有的消息，
 * 界面上是一个点不动也读不了的空气泡，而谁都不知道它是怎么来的。
 */
alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_shape;

alter table public.messages add constraint messages_shape check (
  (kind = 'text'  and body is not null and char_length(body) between 1 and 2000
                  and audio_path is null)
  or
  (kind = 'voice' and audio_path is not null
                  and duration_ms is not null and duration_ms between 500 and 120000)
);

/*
 * 那个「说过的话不许改」的触发器也要跟着管新的这三栏。
 *
 * 不管的话有个绕法：收信的人本来就有 update 权限（他要标记已读），
 * 于是他可以把 audio_path 指到另一段录音上 —— 对方说过的话被换成
 * 了别的，而两边看到的还是同一份。和改 body 是同一个洞，
 * 只是换了一栏。
 */
create or replace function public.keep_message_body() returns trigger
language plpgsql as $fn$
begin
  new.sender := old.sender;
  new.recipient := old.recipient;
  new.body := old.body;
  new.created_at := old.created_at;
  new.kind := old.kind;
  new.audio_path := old.audio_path;
  new.duration_ms := old.duration_ms;
  return new;
end
$fn$;

-- ===================================================================
-- 二、放录音的那个桶
--
-- public = false：桶里的东西没有公开地址，要一条一条签出临时链接。
-- 设成公开的话，路径再怎么设计都没用 —— 地址泄漏一次就人人可听，
-- 而私信的意思就是「只有你们俩」。
-- ===================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice', 'voice', false,
  -- 2MB。60 秒的 opus 大概 100KB，留这么多是给 iOS 那边的 mp4
  2 * 1024 * 1024,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * 谁能听：路径前两段里有我，就是我这段对话里的东西。
 *
 * storage.foldername('a/b/c.webm') 给的是 {a,b} —— 文件名不算。
 * 所以 [1] 是发的人，[2] 是收的人。
 */
drop policy if exists "只有收发双方听得到" on storage.objects;
create policy "只有收发双方听得到"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[2] = auth.uid()::text
    )
  );

/*
 * 谁能传：只能以自己的身份传，而且只能传进「和某个好友」那条路径。
 *
 * 后半句用的是和私信同一个 are_friends —— 两处口径必须一样，
 * 否则会出现「录音传上去了，那条消息却插不进来」：文件成了孤儿，
 * 占着空间，谁也听不到，谁也不知道它在。
 */
drop policy if exists "只能传进自己和好友那条路径" on storage.objects;
create policy "只能传进自己和好友那条路径"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 2
    and public.are_friends(auth.uid(), ((storage.foldername(name))[2])::uuid)
  );

-- 撤回自己发的那条语音时要把文件也删掉，所以发的人能删
drop policy if exists "只能删自己传的录音" on storage.objects;
create policy "只能删自己传的录音"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/*
 * 故意不给 update。
 *
 * 传上去的录音没有「改一改」这回事 —— 要换就是撤回重发，那走的是
 * 删 + 传两步。留着 update 只是多一条以后可能被绕开的路：
 * 覆盖同一个路径，等于把对方已经听过的那句话换掉。
 */

-- ===================================================================
-- 三、自检
-- ===================================================================
select 'messages 认得语音这种形状了吗' as 项,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'messages'
           and column_name in ('kind', 'audio_path', 'duration_ms')
         having count(*) = 3
       ) then '认得' else '没有 —— 上面那步没成功' end as 值
union all
select '那条「文字还是语音」的约束',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.messages'::regclass and conname = 'messages_shape'
       ) then '有' else '没有 —— 上面那步没成功' end
union all
select 'voice 桶建好了吗（而且是私有的）',
       coalesce((
         select case when public then '建了，但是公开的 —— 不对' else '私有，对' end
         from storage.buckets where id = 'voice'
       ), '没建成')
union all
select 'voice 桶的策略数（应该是 3）',
       count(*)::text
from pg_policy
where polrelid = 'storage.objects'::regclass
  and polname in ('只有收发双方听得到', '只能传进自己和好友那条路径', '只能删自己传的录音');

notify pgrst, 'reload schema';

commit;
