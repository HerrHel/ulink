-- 2026-11-10：收回两份被公网角色执行的高危 RPC（安全评估收口）
--
-- 1) redeem_code(p_code, p_uid)
--    设计上只允许 service_role（20261025000004 已 REVOKE），但线上 ACL 仍残留
--    anon / authenticated。后果：匿名用户可绕过 redeem 云函数的登录校验与
--    10 次/10 分钟核销限流，直接调用 RPC 核销兑换码，并把权益发给任意 uid。
--
-- 2) consume_rate_limit(p_key, p_limit, p_window_secs)
--    调用方全部是云函数（node-sdk → service_role），前端不直接调用。
--    授予 authenticated 后，登录用户可构造任意限流键并自定上限，例如：
--      · feature:<指标>:<他人 uid>:<日期>  → 提前耗尽他人的每日额度
--      · share-pass-gid:<gid>              → 锁死某个公开分享的密码入口（10 分钟/次）
--    属于跨用户配额/可用性 DoS，必须收回。
--
-- 3) user_security：authenticated 仍保留 DELETE 策略「Users can delete own security」。
--    登录用户删除自己的 user_security 行后，fn_assert_not_banned 读不到记录，
--    封禁即被绕过（20261110000001 只修了 UPDATE 列权限，未堵 DELETE）。
--    前端对 user_security 只有 select / upsert，删除策略无用且危险，一并移除。
--
-- 幂等：REVOKE/GRANT 可重复执行；DROP POLICY IF EXISTS 可重复执行。

BEGIN;

REVOKE EXECUTE ON FUNCTION public.redeem_code(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_code(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO service_role;

DROP POLICY IF EXISTS "Users can delete own security" ON public.user_security;
REVOKE DELETE ON public.user_security FROM authenticated;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
