-- 死链「自动全量检测」加单次规模上限
--
-- 成本模型：自动检测每检查 1 个书签 = 1 次服务端外呼（check-link 云函数），
-- 成本与**书签数成正比**。资源点 = 0.11108 点/GBs（1GBs = 1GB 内存 × 1 秒），
-- 单个外呼约 2 秒 / 256MB → 约 0.057 点/次。
--
-- 尾部风险：一位拥有 10,000 个书签的用户，一次自动扫描 = 10,000 次外呼 ≈ 570 点，
-- 折合每周约 2,400 点/月 —— 仅此一人就可能吃掉个人版套餐（40,000 点）的 6%。
-- 若这样的用户有 20 位，套餐直接击穿。
--
-- 处理：加单次扫描规模上限（linkcheck.auto.max），超出部分本次不检查并如实告知。
--   plus 档：500（覆盖绝大多数用户的全部书签；超出时 UI 明示"仅检查前 500 个"）
-- 手动检查不受此限（用户主动触发、有界），只有无人值守的自动扫描需要封顶。

BEGIN;

UPDATE public.plans
   SET features = features || jsonb_build_object('linkcheck.auto.max', 500),
       updated_at = now()
 WHERE id IN ('plus_monthly', 'plus_yearly');

-- 免费档不含自动检测，也不给上限
UPDATE public.plans
   SET features = features - 'linkcheck.auto' - 'linkcheck.auto.max',
       updated_at = now()
 WHERE id = 'free';

COMMIT;
