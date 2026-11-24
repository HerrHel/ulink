-- PRO 月度 AI token 额度：20 万 → 300 万（2026-11-24）
--
-- 问题：PRO 同时有 ai.requests.daily=100 与 ai.tokens.monthly=200000 两道上限。mimo-chat 按
-- 「输入全文（含书签上下文 / 偏好 / 个性化摘要 / 历史消息）+ 输出 UTF-8 字节」÷2 折算 token，
-- 一次正常对话就要几千 token，20 万只够每月几十到一百来次——「每日 100 次」根本碰不到，
-- 最愿意付费的重度用户月中就被卡住。
--
-- 调整：每日 100 次是对用户展示的主限制；月度 token 改为防滥用兜底 300 万（约 1000 次对话）。
-- 成本（docs/PRICING.md，MiMo-V2.6-Flash 输入 ¥1 / 输出 ¥2 每百万 token，按 80/20 估算）：
-- 用满 300 万 ≈ ¥3.6/月，低于年付折合收入 ¥9/月；正常用户远用不满。
--
-- 只改三个付费档；免费档无 ai.tokens.monthly（AI 为终身试用 ai.trial.total，不走 token 预扣）。
-- 前端购买弹窗「每月 N 万…额度」由该键推导，自动跟随；落地页硬编码文案在同一提交同步。

BEGIN;

UPDATE public.plans
   SET features   = jsonb_set(features, '{ai.tokens.monthly}', '3000000'::jsonb, true),
       updated_at = now()
 WHERE id IN ('plus_monthly', 'pro_quarterly', 'plus_yearly');

COMMIT;
