-- 015_force_rls.sql
-- S8：对全部开了 RLS 的表补 FORCE ROW LEVEL SECURITY。
--
-- 背景：001/004/007/011 各迁移只写了 ENABLE ROW LEVEL SECURITY，未跟 FORCE。
--   PostgreSQL RLS 中，表所有者（role postgres）与具有 BYPASSRLS 的角色
--   （含 service_role）默认不受 RLS 约束。RLS 未 FORCE 时，这些角色若被
--   误用（前端误打包 service_role 密钥、日志误打印、Edge Function 越权调用）
--   可绕过 S2/S3 刚补好的策略全表读写——S2/S3 只挡 authenticated/anon。
--   设 FORCE 让所有角色（含所有者、service_role）都受策略约束，把 S2/S3
--   的防护从「拦截普通用户」升级为「拦截一切直连角色」。
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
-- ⚠️ 兼容性说明：
--   FORCE 不影响 Edge Function 用 service_role 做服务端鉴权后的写入，
--   但要求那些函数自行以 RPC/SECURITY DEFINER 方式承载需 bypass 的运营
--   操作（如旧数据清理），而非依赖 service_role 的 BYPASSRLS 隐式放行。
--   本项目 Edge Function check-link 仅读外网 HTTP、不触库，不受影响。

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
