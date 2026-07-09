-- rls_check.sql — 线上 RLS 回归自检（只读）
--
-- 用途：核验安全修复 S2 / S3 在生产数据库上的实际 RLS 策略形态。
--       迁移文件记录「策略应该长什么样」，本查询给出「线上现在长什么样」——
--       二者不符即为回归（被后续迁移误删/误改，或迁移从未被执行）。
--
-- 对应迁移：
--   S2 ← supabase/migrations/013_public_groups_rls_owner_consistency.sql
--        公开组匿名 SELECT 策略补 sibling_groups.user_id = bookmarks.user_id（同所有者一致性），
--        阻断「攻击者用公开组引用他人书签 id → 匿名访客读出他人私有书签」的跨用户泄露。
--   S3 ← supabase/migrations/014_update_with_check.sql
--        5 张表（bookmarks / sibling_groups / categories / custom_attributes / user_security）
--        的 FOR UPDATE 策略补 WITH CHECK (auth.uid() = user_id)，
--        阻断「UPDATE ... SET user_id=<他人>」越权转让数据归属的提权。
--   S8 ← supabase/migrations/015_force_rls.sql
--        全部 8 张已 ENABLE RLS 的表补 FORCE ROW LEVEL SECURITY，
--        让表所有者 / service_role 也受策略约束，把 S2/S3 防护升级为
--        「拦截一切直连角色」（防 service_role 密钥泄露后全表读写）。
--
-- 执行方式：Supabase Dashboard → SQL Editor → New query → 粘贴本文件全部内容 → Run。
--           本查询只含 SELECT，不写库，可安全在任意环境（prod / staging）运行。
--
-- 预期结果（S2+S3 全部生效时，前一个查询块）：
--   共 6 行。
--   - "Anyone can view bookmarks in public groups"（1 行，bookmarks 表）
--       using_clause 须含字符串：(sibling_groups.user_id = bookmarks.user_id)
--       with_check_clause 为 NULL（SELECT 策略本就无 WITH CHECK）。
--   - "Users can update own ..."（5 行：categories / bookmarks / sibling_groups /
--       custom_attributes / user_security）
--       with_check_clause 须等于：(auth.uid() = user_id)
--       with_check_clause 不得为 NULL（缺失 = S3 未生效）。
--
-- 预期结果（S8 全部生效时，后一个查询块）：
--   共 8 行，每行 relrowsecurity=true 且 relrowforcerls=true。
--
-- 异常判读：
--   - 某表行缺失          → 对应策略被删，重跑 013/014 迁移。
--   - using_clause 不含 user_id 比较 → S2 回退，重跑 013。
--   - with_check_clause 为 NULL → S3 回退，重跑 014。
--   - 列名报错 column p.polqual does not exist → 你的 PG < 17，列名是 qual/with_check，
--     把 p.polqual 改为 p.qual、p.polwithcheck 改为 p.with_check 即可。
--
-- 注：PostgreSQL 17+ 将 pg_policy 的 qual/with_check 列改名为 polqual/polwithcheck，
--     下方用新列名。若 environment 为旧版见上「异常判读」改回旧列名。

-- ────── S2 / S3 自检：策略表达式 ──────
SELECT c.relname                                       AS table_name,
       p.polname                                       AS policy_name,
       pg_get_expr(p.polqual, p.polrelid)              AS using_clause,
       pg_get_expr(p.polwithcheck, p.polrelid)         AS with_check_clause
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE p.polname = 'Anyone can view bookmarks in public groups'
   OR p.polname LIKE 'Users can update own %'
ORDER BY c.relname, p.polname;

-- ────── S8 自检：RLS 启用 + FORCE 状态 ──────
-- relrowsecurity = RLS 已 ENABLE；relforcerowsecurity = RLS 已 FORCE。
-- 注：PG 列名在 PG17 实测为 relrowsecurity / relforcerowsecurity（不是
--      relrowforcerls 或 relforcerls）。S8 生效：全部 8 行的两个布尔列均为 true。
SELECT c.relname            AS table_name,
       c.relrowsecurity     AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
WHERE c.relname IN (
  'categories', 'bookmarks', 'sibling_groups', 'custom_attributes',
  'user_security', 'data_history', 'link_check_history', 'error_logs'
)
ORDER BY c.relname;
