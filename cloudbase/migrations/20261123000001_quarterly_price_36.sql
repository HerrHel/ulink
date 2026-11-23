-- 季付调价：¥32 → ¥36（2026-11-23）
--
-- 原因：季付 ¥32 折合 ¥10.7/月，已拿走月付→年付之间大部分折扣（年付 ¥9/月只再省 ¥1.7/月），
-- 导致本可接受年付的用户停在季付。调整后三档梯度为 月付 ¥15 / 季付 ¥36（¥12/月，省 20%）/
-- 年付 ¥108（¥9/月，省 40%）：季付仍是低门槛过渡档，年付每月比季付再省 ¥3（一年省 ¥36）。
--
-- 影响范围：只影响新建订单。已建 pending 订单的金额在 orders.amount_cents 里已锁定，
-- settle_paid_order 按订单金额校验，不受本次调价影响；已开通的权益不变。
-- 前端购买弹窗的价格、划线原价与「立省」都由 plans 推导，自动跟随；落地页 index.html /
-- public/landing.js 的硬编码文案在同一提交中同步。

BEGIN;

UPDATE public.plans
   SET price_cents = 3600,
       updated_at  = now()
 WHERE id = 'pro_quarterly';

COMMIT;
