-- 套餐差异修正：云端历史版本保留期分档 + 撤下未强制执行的存储配额
--
-- 背景（2026-11-21）：
--   1. history.days 免费版与 PRO 同为 90 天，对比表上看不出任何差别。
--      改为 免费 7 天 / PRO 365 天，让历史回溯成为 PRO 的真实差异点。
--      口径：仅指**云端** data_history（cleanup_expired_data 按 plan 清理）；
--      本机 lv_hist:* 按条数保留（设置里 5～30 条），与套餐无关、不受本迁移影响。
--   2. storage.bytes 从未有服务端执行点（图片直传对象存储，无容量统计/拦截），
--      购买页只能标注「展示值」。按 docs/QUOTA_ENFORCEMENT.md 的规则
--      「先有执行点再进 plans.features」，从所有套餐撤下，避免虚假承诺。
--
-- 影响：maintenance 下一次日跑（UTC 03:00）起，免费用户 7 天前的云端历史版本被清理。
--   清理不可逆；PRO 用户历史从 90 天延长到 365 天（已被清理的不会恢复）。
--
-- 幂等：只做 features JSONB 合并（||）与删键（-），重复执行结果不变；不动价格与名称。

UPDATE public.plans
   SET features = (COALESCE(features, '{}'::jsonb) - 'storage.bytes') || jsonb_build_object('history.days', 7)
 WHERE id = 'free';

UPDATE public.plans
   SET features = (COALESCE(features, '{}'::jsonb) - 'storage.bytes') || jsonb_build_object('history.days', 365)
 WHERE id IN ('plus_monthly', 'plus_yearly', 'pro_quarterly');

-- 其余套餐（如测试档）只撤下 storage.bytes，不改历史保留期
UPDATE public.plans
   SET features = COALESCE(features, '{}'::jsonb) - 'storage.bytes'
 WHERE id NOT IN ('free', 'plus_monthly', 'plus_yearly', 'pro_quarterly')
   AND features ? 'storage.bytes';
