-- 020_rls_service_role_and_cleanup_rpc.sql
-- M3 / M4 修复：澄清 FORCE RLS 边界 + 收紧 cleanup RPC 可调用面。
--
-- ── M3 ──
-- 015 注释曾写「FORCE 可约束 service_role」。事实：PostgreSQL 中带 BYPASSRLS
-- 属性的角色（Supabase 的 service_role 默认如此）不受 RLS/FORCE 约束；
-- FORCE 仅让「表 owner 且无 BYPASSRLS」也走策略。
--
-- 托管 Supabase 上通常不能/不宜 ALTER ROLE service_role NOBYPASSRLS（平台角色，
-- 且 Dashboard/部分运营操作依赖它）。本迁移：
--   1) 以 COMMENT 纠正 015 的错误假设，避免后续误信 FORCE 已挡 service_role；
--   2) 在自托管且确认无依赖时，可选执行：ALTER ROLE service_role NOBYPASSRLS;
-- 当前项目 Edge Function check-link 用调用者 JWT 写 link_check_history，不依赖
-- service_role 绕过 RLS。客户端永不打包 service_role key。
--
-- ── M4 ──
-- cleanup_old_check_history() 创建时未 REVOKE EXECUTE FROM PUBLIC，PostgREST
-- 会把函数暴露为 /rest/v1/rpc/cleanup_old_check_history。任意 anon/authenticated
-- 可触发全表 DELETE 计划扫描（即使 RLS 限制实际删除行，扫描开销仍可被滥用）。
-- 收紧为仅 service_role（及超级用户）可执行；并改为 SECURITY DEFINER 以便
-- 运维/cron 在受信上下文下真正清理跨用户旧行。

-- M4：重建函数为 SECURITY DEFINER + 收紧 EXECUTE
CREATE OR REPLACE FUNCTION cleanup_old_check_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM link_check_history
  WHERE checked_at < NOW() - INTERVAL '30 days';
END;
$$;

REVOKE ALL ON FUNCTION cleanup_old_check_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_old_check_history() FROM anon;
REVOKE ALL ON FUNCTION cleanup_old_check_history() FROM authenticated;
-- 仅 service_role 可调（Dashboard SQL / 服务端 cron）；普通用户 RPC 403
GRANT EXECUTE ON FUNCTION cleanup_old_check_history() TO service_role;

COMMENT ON FUNCTION cleanup_old_check_history() IS
  '保留 30 天内 link_check_history。SECURITY DEFINER；EXECUTE 仅 service_role（M4）。';

-- M3：在关键业务表上留下正确语义的 COMMENT，纠正 015 错误假设
COMMENT ON TABLE bookmarks IS
  'FORCE RLS 已开。注意：带 BYPASSRLS 的 service_role 仍不受 RLS 约束（M3）；'
  '防护依赖：不在前端暴露 service_role key + Edge 用用户 JWT。';

SELECT pg_notify('pgrst', 'reload schema');
