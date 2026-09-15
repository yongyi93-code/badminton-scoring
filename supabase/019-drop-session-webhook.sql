-- ===================================================================
-- 删掉开局那个数据库 Webhook 触发器
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
--
-- **这个文件已经在生产上跑过了（2026-09-16）。** 留着是因为它记着
-- 一件否则没人知道的事：那个触发器存在过、为什么删、以及它当初
-- 是怎么被建出来的（后台点出来的，仓库里一个字都没有）。
--
-- -------------------------------------------------------------------
-- 它是怎么被发现的
--
-- 做备份恢复演练（docs/备份与恢复.md）的时候，pg_restore 在新项目里
-- 建不出这个触发器，于是把它的完整定义打进了日志：
--
--   CREATE TRIGGER "notify-on-new-session" AFTER INSERT ON public.records
--     FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
--       'https://<ref>.supabase.co/functions/v1/notify-session',
--       'POST',
--       '{"Content-type":"application/json","Authorization":"Bearer <令牌>"}',
--       '{}', '5000');
--
-- 那个 Bearer 解开是 {"iss":"supabase","role":"service_role"}。
--
-- -------------------------------------------------------------------
-- 三个问题，一起删掉
--
-- **一、它把 service_role 令牌写死在自己的定义里。**
-- service_role 绕过所有 RLS。而触发器定义是数据库的一部分，所以
-- **每一份 pg_dump 出来的备份文件里都带着这把万能钥匙** —— 谁拿到
-- 备份，就等于拿到整个数据库，包括所有人的私聊。备份文件本来的密级
-- 是「有私聊」，因为它变成了「有主钥匙」。
--
-- **二、它是多余的。** 开局的人自己的手机已经调过那个函数了，见
-- src/lib/push.ts 的 notifyNewSession()。那段代码的注释里还写着当初
-- 为什么改成手机自己调（「Webhook 从来没有人去后台建过…症状就是
-- 开局了谁也没收到通知」）—— 后来 Webhook 又被建了出来，于是两条路
-- 同时开着，同一次开局很可能推了两遍。
--
-- **三、它没有条件。** AFTER INSERT ON records，不分 kind ——
-- 每插一条记录（每场比赛、每个球员、每个头像）都往外发一次 HTTP，
-- 一晚上几百次，函数那边第一件事就是 `if (row.kind !== 'session') return`
-- 把它丢掉。
--
-- 删掉之后实测：开局照样收得到推送（手机那条路在干活）。
--
-- -------------------------------------------------------------------
-- 以后要是真的需要数据库 Webhook
--
-- **别再往触发器里写 service_role。** 那个 Edge Function 查数据库用的是
-- 平台自动注入的钥匙（见 supabase/functions/notify-session/index.ts 的
-- candidateKeys()），请求里带的 Bearer 只是用来过「你是谁」那道门 ——
-- publishable key 就够了，而它本来就是公开的，写进触发器不算泄露。
-- ===================================================================

begin;

drop trigger if exists "notify-on-new-session" on public.records;

-- ===================================================================
-- 自检：还有没有别的触发器把密钥写死在定义里
--
-- 这一句比「删掉了没有」更要紧 —— 它是这件事留下的长期检查。
-- 哪天又有人在后台点出一个 Webhook，这一句就会数出来。
-- 输出里不含密钥本身，只有个数。
-- ===================================================================
select 'notify-on-new-session 还在吗' as 项,
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.records'::regclass
           and tgname = 'notify-on-new-session'
       ) then '还在 —— 上面那步没成功' else '删掉了' end as 值
union all
select 'public 里还有几个触发器把密钥写死在定义里（应该是 0）',
       (select count(*)::text from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal
          and c.relnamespace = 'public'::regnamespace
          and pg_get_triggerdef(t.oid) like '%Bearer %');

commit;
