-- 修复 user_security 的越权写入：登录用户可自行修改 banned_until 解除封禁
--
-- 问题：authenticated 对 public.user_security 拥有全列 UPDATE 权限，
-- 且 RLS 策略为「只能改自己的行」。表结构为
--   user_id, master_canary, updated_at, banned_until
-- 因此任何登录用户都能执行
--   UPDATE user_security SET banned_until = NULL WHERE user_id = auth.uid()
-- 从而绕过 fn_assert_not_banned 的封禁校验。
--
-- 修法：把 UPDATE 收紧到列级——只允许前端真正需要的两列
-- （master_canary 用于 E2E 主密码校验串的多端同步、updated_at 由前端带入）。
-- banned_until 从此只能由 SECURITY DEFINER 函数或 service_role 修改。
--
-- 保留 INSERT：前端 useE2E/useVault 走 upsert，首次需要插入行。
-- 即使用户在 INSERT 时自带 banned_until，也只是给自己写一个值，
-- 不构成越权；冲突时的 UPDATE 路径会被列权限拦住。

REVOKE UPDATE ON public.user_security FROM authenticated;
GRANT UPDATE (master_canary, updated_at) ON public.user_security TO authenticated;

-- 同步收回 anon 的一切写权限（匿名用户不应有）
REVOKE INSERT, UPDATE, DELETE ON public.user_security FROM anon;

-- orders / entitlements：RLS 已只放行 SELECT（无 INSERT/UPDATE 策略），
-- 写操作会被 RLS 拒绝。这里再把冗余的表级写权限收回，
-- 落实最小权限（评估时「表级 GRANT 全开、只靠 RLS 兜底」是常见扣分点）。
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.entitlements FROM authenticated;
REVOKE ALL ON public.orders FROM anon;
REVOKE ALL ON public.entitlements FROM anon;
