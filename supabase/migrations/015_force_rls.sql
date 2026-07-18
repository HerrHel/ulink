-- 015_force_rls.sql
-- S8：对全部开了 RLS 的表补 FORCE ROW LEVEL SECURITY。
--
-- 背景：001/004/007/011 各迁移只写了 ENABLE ROW LEVEL SECURITY，未跟 FORCE。
--   未 FORCE 时，表所有者（非超级用户）默认不受 RLS；FORCE 让 owner 也走策略。
--   注意（M3 更正）：带 BYPASSRLS 的 service_role **仍**不受 RLS/FORCE 约束——
--   旧稿「FORCE 挡 service_role」是错误假设，见 020 与文末兼容性说明。
--
-- 范围：全部已 ENABLE RLS 的 8 张表
--   含 user_id 私有数据（FORCE 必要性高）：
--     categories / bookmarks / sibling_groups / custom_attributes /
--     user_security / data_history / link_check_history
--   匿名可写无 user_id 绑定：error_logs（FORCE 仍必要，阻断 service_role
--     直读匿名日志做用户指纹追踪）
--
-- ⚠️ 已知既有隐患（不在本迁移范围，仅记录）：
--   007 的 cleanup_old_check_history() 在无 auth context 的纯 SQL 函数里
--   做 DELETE，RLS 下本就可能跑不动（FORCE 不使其更糟，也不改善）。
--   该函数的正确修法是 SECURITY DEFINER + 受信角色，留待后续单独处理。
--
-- ⚠️ 兼容性说明（M3 更正）：
--   FORCE 让表 owner（非超级、无 BYPASSRLS）也走 RLS，**不能**约束带 BYPASSRLS
--   的 service_role。015 初稿「FORCE 可约束 service_role」是错误假设——见 020
--   迁移与 COMMENT。service_role 密钥泄漏时仍可全表读写；防护依赖不打包
--   service_role + Edge 用用户 JWT。自托管可考虑 ALTER ROLE service_role NOBYPASSRLS。
--   本项目 Edge Function check-link 仅读外网 HTTP、写库用调用者 JWT，不受影响。

-- 含用户私有数据的 7 张表
ALTER TABLE categories         FORCE ROW LEVEL SECURITY;
ALTER TABLE bookmarks          FORCE ROW LEVEL SECURITY;
ALTER TABLE sibling_groups     FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_attributes  FORCE ROW LEVEL SECURITY;
ALTER TABLE user_security      FORCE ROW LEVEL SECURITY;
ALTER TABLE data_history       FORCE ROW LEVEL SECURITY;
ALTER TABLE link_check_history FORCE ROW LEVEL SECURITY;

-- 匿名可写日志表
ALTER TABLE error_logs         FORCE ROW LEVEL SECURITY;

SELECT pg_notify('pgrst', 'reload schema');
