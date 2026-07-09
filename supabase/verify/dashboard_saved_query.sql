-- LinkVault RLS 回归自检（唯一需在 Supabase Dashboard SQL Editor 保存的查询）
-- 用法：打开 → Run → 两个结果块分别核验。
-- 对应仓库：supabase/verify/rls_check.sql

-- ▪️ 块 1/2：策略表达式（S2 同所有者一致性 + S3 UPDATE WITH CHECK）
SELECT c.relname                                       AS "表",
       p.polname                                       AS "策略",
       pg_get_expr(p.polqual, p.polrelid)              AS "USING 条件",
       pg_get_expr(p.polwithcheck, p.polrelid)         AS "WITH CHECK"
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE p.polname = 'Anyone can view bookmarks in public groups'
   OR p.polname LIKE 'Users can update own %'
ORDER BY c.relname, p.polname;
-- ✅ 预期：6 行。
--    "Anyone can view..." 的 USING 须含 sibling_groups.user_id = bookmarks.user_id
--    "Users can update own..." 的 WITH CHECK 须为 (auth.uid() = user_id)（不能是 NULL）

-- ▪️ 块 2/2：FORCE RLS 状态（S8 全 8 表）
SELECT c.relname              AS "表",
       c.relrowsecurity       AS "RLS 已启用",
       c.relforcerowsecurity  AS "RLS 已 FORCE"
FROM pg_class c
WHERE c.relname IN (
  'categories', 'bookmarks', 'sibling_groups', 'custom_attributes',
  'user_security', 'data_history', 'link_check_history', 'error_logs'
)
ORDER BY c.relname;
-- ✅ 预期：8 行，两列全为 true。
