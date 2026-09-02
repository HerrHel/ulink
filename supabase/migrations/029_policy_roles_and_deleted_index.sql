-- 029_policy_roles_and_deleted_index.sql
-- 后端审计第三阶段收尾：策略角色显式化 + deleted_at 部分索引。
--
-- 审计时间：2026-09-02（基于远程库 yqouglfopbmujkqmjgpu 实测）
-- 执行：supabase db push --linked
--
-- 两节均可独立回滚（见各节注释）。

-- ═══════════════════════════════════════════════════════════════════
-- 1. P2-11 策略角色 public → authenticated 显式化
-- ═══════════════════════════════════════════════════════════════════
--
-- 问题：001 建策略时未指定角色 → 默认 TO PUBLIC。owner 语义策略
--       （USING/WITH CHECK = auth.uid() = user_id）在 anon 下求值时
--       auth.uid() 为 NULL 恒不匹配，**逻辑安全但语义不清**，且匿名
--       请求也要多一次策略求值。UPDATE 策略（014/028 重建时）已是
--       TO authenticated，SELECT/INSERT/DELETE 仍是 public。
--
-- 实测（pg_policies）：
--   25 条策略 roles='{public}'，表达式全部为 auth.uid() = user_id
--   （SELECT/DELETE 在 USING，INSERT 在 WITH CHECK），无特殊条件。
--   error_logs 的 "Anyone can insert error logs" 是**设计必需**（匿名
--   错误上报），保留 public，不在此列。
--
-- 修复：同策略名 DROP 后重建为 TO authenticated，表达式原样。
--       行为等价（authenticated ⊂ public，认证用户不受影响；anon 本
--       来就匹配不上），语义收敛为「owner 数据仅认证用户可见」。
--       同时为断言加护栏：除 error_logs INSERT 外不得再有 public 角色策略。
--
-- 安全核对（改前确认，执行前请复核）：
--   - 公开读全部走 SECURITY DEFINER RPC（get_public_group / get_public_category），
--     函数以 postgres 执行，不受表策略影响 ✅
--   - 匿名功能仅剩 error_logs 上报与分享页 RPC，无表直读依赖 ✅
--   - Edge Function（share-html/send-feedback/check-link）以 service_role
--     或函数内 role 访问，无影响 ✅
--
-- 回滚：同策略名重建为 TO PUBLIC（表达式相同）。

-- ── bookmarks ──
DROP POLICY IF EXISTS "Users can view own bookmarks" ON bookmarks;
CREATE POLICY "Users can view own bookmarks" ON bookmarks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own bookmarks" ON bookmarks;
CREATE POLICY "Users can insert own bookmarks" ON bookmarks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own bookmarks" ON bookmarks;
CREATE POLICY "Users can delete own bookmarks" ON bookmarks
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── categories ──
DROP POLICY IF EXISTS "Users can view own categories" ON categories;
CREATE POLICY "Users can view own categories" ON categories
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own categories" ON categories;
CREATE POLICY "Users can insert own categories" ON categories
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own categories" ON categories;
CREATE POLICY "Users can delete own categories" ON categories
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── custom_attributes ──
DROP POLICY IF EXISTS "Users can view own custom_attributes" ON custom_attributes;
CREATE POLICY "Users can view own custom_attributes" ON custom_attributes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own custom_attributes" ON custom_attributes;
CREATE POLICY "Users can insert own custom_attributes" ON custom_attributes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own custom_attributes" ON custom_attributes;
CREATE POLICY "Users can delete own custom_attributes" ON custom_attributes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── data_history ──
DROP POLICY IF EXISTS "Users can view own history" ON data_history;
CREATE POLICY "Users can view own history" ON data_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own history" ON data_history;
CREATE POLICY "Users can insert own history" ON data_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own history" ON data_history;
CREATE POLICY "Users can delete own history" ON data_history
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── error_logs（仅 view；insert 是匿名上报，保留 public）──
DROP POLICY IF EXISTS "Users can view own error logs" ON error_logs;
CREATE POLICY "Users can view own error logs" ON error_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ── link_check_history ──
DROP POLICY IF EXISTS "Users can view own check history" ON link_check_history;
CREATE POLICY "Users can view own check history" ON link_check_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own check history" ON link_check_history;
CREATE POLICY "Users can insert own check history" ON link_check_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own check history" ON link_check_history;
CREATE POLICY "Users can delete own check history" ON link_check_history
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── public_category_shares ──
DROP POLICY IF EXISTS "Users can view own category shares" ON public_category_shares;
CREATE POLICY "Users can view own category shares" ON public_category_shares
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own category shares" ON public_category_shares;
CREATE POLICY "Users can insert own category shares" ON public_category_shares
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own category shares" ON public_category_shares;
CREATE POLICY "Users can delete own category shares" ON public_category_shares
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── sibling_groups ──
DROP POLICY IF EXISTS "Users can view own sibling_groups" ON sibling_groups;
CREATE POLICY "Users can view own sibling_groups" ON sibling_groups
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own sibling_groups" ON sibling_groups;
CREATE POLICY "Users can insert own sibling_groups" ON sibling_groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own sibling_groups" ON sibling_groups;
CREATE POLICY "Users can delete own sibling_groups" ON sibling_groups
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── user_security ──
DROP POLICY IF EXISTS "Users can view own security" ON user_security;
CREATE POLICY "Users can view own security" ON user_security
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own security" ON user_security;
CREATE POLICY "Users can insert own security" ON user_security
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own security" ON user_security;
CREATE POLICY "Users can delete own security" ON user_security
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════════
-- 2. P2-12 deleted_at 部分索引（回收站查询）
-- ═══════════════════════════════════════════════════════════════════
--
-- 问题：回收站视图（selectSoftDeleted）按
--       user_id + (deleted_at IS NOT NULL) + updated_at_num 过滤，
--       现有 008 同步索引 (user_id, updated_at_num) 覆盖全量行，
--       对「只查已删行」的回收站查询无法缩小扫描面。
--
-- 修复：每张软删同步表建部分索引
--       (user_id, updated_at_num) WHERE deleted_at IS NOT NULL，
--       只索引已删行（体积≈回收站存量），planner 可精确命中。
--       当前数据量小，收益有限——属低成本「正确性补位」。
--
-- 回滚：DROP INDEX 对应 4 条索引。

CREATE INDEX IF NOT EXISTS idx_bookmarks_deleted
  ON bookmarks (user_id, updated_at_num) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_deleted
  ON categories (user_id, updated_at_num) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_custom_attributes_deleted
  ON custom_attributes (user_id, updated_at_num) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sibling_groups_deleted
  ON sibling_groups (user_id, updated_at_num) WHERE deleted_at IS NOT NULL;


-- 通知 PostgREST 重载 schema
SELECT pg_notify('pgrst', 'reload schema');
