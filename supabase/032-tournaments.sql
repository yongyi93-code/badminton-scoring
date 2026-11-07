-- ===================================================================
-- 淘汰赛表上云：开比赛的人说了算
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 自检在文件最后，可以另开一个 query 跑。
--
-- -------------------------------------------------------------------
-- 谁能干什么
--
--   看      登录的人都看得到（和公开球局、全国榜同一档）。
--           比赛本来就是要贴出来给大家看的。
--   填比分  开比赛的人（host_uid），加上他点名的记分员（editors）。
--   其余    改名单、改对阵、加减记分员、改名、删掉 —— 只有开比赛的人。
--
-- 记分员只能动 matches 那一栏，由下面的触发器挡：RLS 只管得了
-- 「能不能改这一行」，管不了「能改这一行的哪几栏」。
--
-- -------------------------------------------------------------------
-- 两个人同时填分
--
-- 赛表整张存在一个 jsonb 里（matches），因为「填一场 → 后面几轮跟着
-- 重算」那套逻辑在客户端（src/lib/bracket.ts），不想在 SQL 里再写一遍。
--
-- 代价是两台手机同时各填一场，后写的会把先写的整张盖掉。所以加了
-- version：每次写都带上「我是基于第几版改的」，数据库每写一次 +1。
-- 版本对不上就写不进去，客户端拉最新那版、把自己那一笔重新算一遍
-- 再写（src/lib/tournamentSync.ts）。
-- ===================================================================

begin;

create table if not exists public.tournaments (
  /* 客户端生成的 id —— 离线建的比赛上线后原样推上来，赛表里的链接不变 */
  id text primary key check (char_length(id) <= 64),

  host_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
  /* 记分员。只有 host 改得动这一栏 */
  editors uuid[] not null default '{}',

  name text not null check (char_length(name) <= 120),
  date text not null check (char_length(date) = 10),
  doubles boolean not null default true,
  mode text not null check (mode in ('random', 'seeded', 'manual')),
  size integer not null check (size between 2 and 256),
  /* 参赛者：[{id, names[], seed?}] */
  entrants jsonb not null default '[]',
  /* 整张赛表：[{round, index, a, b, scoreA?, scoreB?, winner?}] */
  matches jsonb not null default '[]',

  /* 开比赛的人叫什么。列表上要看得出是谁办的 */
  host_name text check (host_name is null or char_length(host_name) <= 40),

  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tournaments_updated on public.tournaments (updated_at desc);

alter table public.tournaments enable row level security;

/* RLS 和 GRANT 是两道门，都得开 —— 这个仓库栽过好几次 */
grant select, insert, update, delete on public.tournaments to authenticated;

/*
 * 每次写：盖时间、版本 +1，并且挡住记分员越权。
 *
 * auth.uid() 是空的（后台管理员直接改）就不挡 —— 017 那次栽过：
 * 触发器里拿 auth.uid() 当真，后台一改就炸。
 */
create or replace function public.guard_tournament() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.created_at := old.created_at;
    if auth.uid() is not null and auth.uid() <> old.host_uid then
      if new.host_uid is distinct from old.host_uid
         or new.editors is distinct from old.editors
         or new.name is distinct from old.name
         or new.date is distinct from old.date
         or new.doubles is distinct from old.doubles
         or new.mode is distinct from old.mode
         or new.size is distinct from old.size
         or new.entrants is distinct from old.entrants
         or new.host_name is distinct from old.host_name then
        raise exception 'only the host can change this tournament (scorers can only enter scores)'
          using errcode = '42501';
      end if;
    end if;
  else
    new.version := 0;
  end if;
  return new;
end
$fn$;

drop trigger if exists tournaments_guard on public.tournaments;
create trigger tournaments_guard
  before insert or update on public.tournaments
  for each row execute function public.guard_tournament();

-- ===================================================================
-- 策略
-- ===================================================================

drop policy if exists "比赛登录就看得到" on public.tournaments;
create policy "比赛登录就看得到"
  on public.tournaments for select to authenticated
  using (true);

drop policy if exists "只能以自己的名义开比赛" on public.tournaments;
create policy "只能以自己的名义开比赛"
  on public.tournaments for insert to authenticated
  with check (host_uid = auth.uid());

/*
 * 开比赛的人和记分员能改。哪几栏能改由上面的触发器挡。
 * with check 里再认一次 host，挡住「把比赛转给别人」。
 */
drop policy if exists "开比赛的人和记分员能改" on public.tournaments;
create policy "开比赛的人和记分员能改"
  on public.tournaments for update to authenticated
  using (host_uid = auth.uid() or auth.uid() = any (editors))
  with check (host_uid = auth.uid() or auth.uid() = any (editors));

drop policy if exists "只有开比赛的人能删" on public.tournaments;
create policy "只有开比赛的人能删"
  on public.tournaments for delete to authenticated
  using (host_uid = auth.uid());

commit;

-- 实时推送：一台手机填了分，别的手机不用刷新
do $$
begin
  alter publication supabase_realtime add table public.tournaments;
exception
  when duplicate_object then null;
end;
$$;

-- ===================================================================
-- 自检（可以单独跑）：应该看到 4 条策略、1 个触发器
-- ===================================================================
-- select policyname, cmd from pg_policies where tablename = 'tournaments';
-- select tgname from pg_trigger where tgrelid = 'public.tournaments'::regclass and not tgisinternal;
