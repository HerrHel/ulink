-- 深度解析日配额：plans.features 补 video.deep.daily（free 0 / PRO 各档 2）
--
-- 背景（见 docs/VIDEO_DEEP_EXTRACT.md §5）：
--   深度解析 = 下载音频跑 ASR + 抽帧 OCR，是分钟级、百 MB 级任务，单位成本与同步解析
--   （只抓简介/字幕，约 1~2 秒外呼）不在一个量级，因此必须独立计数：
--   video.extract.daily（轻量，free 1 / PRO 10，见迁移 20261025000006/20261025000002）
--   video.deep.daily（深度，free 0 / PRO 2）。
--   分开计数是为了「2 次/日 的深度解析」不会把「10 次/日 的轻量解析」额度吃光，反之亦然。
--
-- 语义（与云函数 extract-video 的既有口径一致）：
--   features 键不存在或 ≤ 0 = 该能力不开放；深度解析必须登录（匿名一律 401 login_required）。
--   云函数缺省回落（EXTRACT_VIDEO_DEEP_DAILY，默认 2）只在 features **没有**该键时生效：
--   登录且 video.extract.daily >= 10 视为 PRO 档 → 2，否则 0。本迁移写入显式值后即不再走回落。
--
-- 幂等：只做 features JSONB 合并（||），重复执行结果不变；不新增/删除其它字段、不动价格与名称。
-- 说明：新增付费档（如 pro_*）时需把 id 补进下面第二条 UPDATE 的 IN 列表，否则该档没有深度额度。

BEGIN;

-- free：显式 0（不能白嫖深度解析；同时兜住未来误改）
UPDATE public.plans
   SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('video.deep.daily', 0),
       updated_at = now()
 WHERE id = 'free';

-- PRO 各档（当前为 plus_monthly / plus_yearly / pro_quarterly）：2 次/日
UPDATE public.plans
   SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('video.deep.daily', 2),
       updated_at = now()
 WHERE id IN ('plus_monthly', 'plus_yearly', 'pro_quarterly');

COMMIT;
