-- ===================================================================
-- Story 和动态里放得下一段视频
--
-- 在 Supabase 后台 SQL Editor 里整段贴进去跑一次。可以重复跑。
-- 自检在文件最后，可以另开一个 query 跑（那个编辑器吃不掉太长的一段，
-- 029 那次实测在第 100 行断掉）。
--
-- 这个文件只改一样东西：**moments 桶收什么、收多大**。
-- 没有新表、没有新策略 —— 视频和照片在 posts 上是同一栏（photos），
-- 走的是同一条读写策略、同一个清理函数。
--
-- -------------------------------------------------------------------
-- 为什么视频能塞进 photos 那一栏
--
-- 那一栏存的是**桶里的路径**，从来就不关心路径指的是什么。
-- 024 上那个 guard_post 触发器管的也只有两件事：路径开头必须是作者
-- 自己的 uid、只许一层文件夹 —— 两条对视频一样成立。
--
-- 另起一栏（videos text[]）的话，可见范围、下架、评论、点赞、禁言、
-- 过期清理那六样全要再认一遍新栏位。028 当初决定「Story 不另起一张表」
-- 是同一条理由，这里照抄。
--
-- 客户端靠**扩展名**认出哪个是视频（src/lib/media.ts 里的 isVideo），
-- 所以路径必须带对后缀。那一条钉在 mediaExt 上，有测试。
--
-- -------------------------------------------------------------------
-- 上限从 1 MB 提到 20 MB —— 这一步是有代价的，写清楚
--
-- 桶上的大小限制**只有一个数**，照片和视频共用。提到 20 MB 意味着
-- 数据库这一层不再拦得住「一张 20 MB 的原图」。
--
-- 照片那条路照样安全，但安全的地方换了：客户端压完是 200 KB 左右，
-- 而且 createPost 里那道 POST_MAX_BYTES（900 KB）拦在上传之前。
-- 换句话说，**照片的大小现在只由客户端保证**。
--
-- 这是一笔明码的交易，不是疏忽。改过的客户端能往桶里塞一张 20 MB 的
-- 图 —— 但它本来就能塞一段 20 MB 的视频，桶分不出来。真正挡住滥用的
-- 是别的东西：只能传进自己那个文件夹、只有好友看得到、Story 24 小时
-- 连文件一起删。
--
-- -------------------------------------------------------------------
-- 20 MB 这个数是按流量定的
--
-- 存储不是问题：Story 到点之后连文件一起删（028 + cleanup-stories），
-- 桶不会越积越多。
--
-- 花钱的是**下行**：一段 20 MB 的视频，球群里十个人点开就是 200 MB。
-- 免费版一个月 5 GB，也就是二十几段。要调这个数之前先读这一段，
-- 而且要和 src/lib/media.ts 里那个 VIDEO_MAX_BYTES 一起改 ——
-- 两处不一样的话，表现是「传到一半失败」，而没人查得出为什么。
-- ===================================================================

begin;

update storage.buckets
set
  /*
   * 20 MB。和 src/lib/media.ts 里的 VIDEO_MAX_BYTES 是同一个数，
   * 改一处要改两处。
   */
  file_size_limit = 20 * 1024 * 1024,
  allowed_mime_types = array[
    'image/webp', 'image/jpeg', 'image/png',
    /*
     * quicktime 就是 .mov —— iPhone 录出来的十有八九是它。
     * 漏了这一个等于 iPhone 上整个功能不存在，而错误信息会是
     * 一句没头没脑的 "mime type not supported"。
     */
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
where id = 'moments';

/* 桶还没建过就什么都不用做 —— 那说明 024 没跑过，先去跑那个 */

commit;

-- ===================================================================
-- 自检（另开一个 query 跑）
-- ===================================================================
-- select 'moments 桶在不在' as 项,
--        case when exists (select 1 from storage.buckets where id = 'moments')
--             then '在' else '不在 —— 先去跑 024' end as 值
-- union all
-- select '还是私有的吗（必须是）',
--        coalesce((select case when public then '公开了 —— 不对' else '私有，对' end
--                  from storage.buckets where id = 'moments'), '没这个桶')
-- union all
-- select '最大收多大',
--        coalesce((select (file_size_limit / 1024 / 1024)::text || ' MB'
--                  from storage.buckets where id = 'moments'), '没这个桶')
-- union all
-- select '收得下 mp4 吗',
--        case when 'video/mp4' = any(
--          (select allowed_mime_types from storage.buckets where id = 'moments')
--        ) then '收得下' else '收不下 —— 上面那段没跑成' end
-- union all
-- select '收得下 iPhone 的 .mov 吗',
--        case when 'video/quicktime' = any(
--          (select allowed_mime_types from storage.buckets where id = 'moments')
--        ) then '收得下' else '收不下 —— 上面那段没跑成' end
-- union all
-- select '照片那三种还在吗',
--        case when (select count(*) from unnest(
--          (select allowed_mime_types from storage.buckets where id = 'moments')
--        ) as t(m) where m in ('image/webp', 'image/jpeg', 'image/png')) = 3
--        then '都在' else '少了 —— 不对，照片会发不出去' end;
