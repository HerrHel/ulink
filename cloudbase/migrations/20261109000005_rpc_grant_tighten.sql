-- 2026-11-09：按 uid 的 RPC 权限收口（根治 anon 越权读订单/额度）
--
-- 背景：20261028000010 的注释判断「云函数 rdb 走 tcbopenapi → 身份是 anon/authenticated，
-- 只 GRANT service_role 会 42501」。生产 ACL 已证伪该判断：
--   · resolve_entitlement / reserve_quota / settle_quota 只有 service_role 有权，
--   · 而 extract-video / mimo-chat 在线上正常调用它们（额度检查与两段式计费都在跑）。
-- 因此云函数身份是 service_role（node-sdk init），给公网角色开 EXECUTE 纯属多余暴露。
--
-- 收口对象（调用方全部是云函数，前端不直接调）：
--   get_payment_order             ← pay/index.js（查订单 + 支付二维码，越权最敏感）
--   consume_daily_feature_quota   ← check-link / mimo-chat
--   ai_quota_check                ← 全仓已无调用方（mimo-chat 改用 reserve_quota）
-- 公开读（get_public_group / get_public_category）与前端自用（upsert_public_category_share）
-- 保持不动。

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_payment_order(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_daily_feature_quota(text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_quota_check(text) FROM anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
