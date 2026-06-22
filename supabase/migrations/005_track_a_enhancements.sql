-- Track A 增强迁移
-- 1. categories / custom_attributes 新增 updated_at_num 列（A2: _merge updatedAt 修复）
-- 2. sibling_groups 新增 is_public 列 + 公开读取 RLS 策略（A4: 公开分享链接）
-- 在 Supabase Dashboard → SQL Editor 中执行

-- ═══════════════════════════════════════════
-- A2: categories / custom_attributes 时间戳
-- ═══════════════════════════════════════════

ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at_num BIGINT DEFAULT 0;
ALTER TABLE custom_attributes ADD COLUMN IF NOT EXISTS updated_at_num BIGINT DEFAULT 0;

-- 回填已有数据：将 0 设为当前时间戳
UPDATE categories SET updated_at_num = EXTRACT(EPOCH FROM NOW()) * 1000 WHERE updated_at_num IS NULL OR updated_at_num = 0;
UPDATE custom_attributes SET updated_at_num = EXTRACT(EPOCH FROM NOW()) * 1000 WHERE updated_at_num IS NULL OR updated_at_num = 0;

-- ═══════════════════════════════════════════
-- A4: 公开分享链接
-- ═══════════════════════════════════════════

-- sibling_groups 新增 is_public 字段
ALTER TABLE sibling_groups ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_sibling_groups_public ON sibling_groups(id) WHERE is_public = TRUE;

-- 公开组允许匿名 SELECT
CREATE POLICY "Public groups are readable by anyone"
  ON sibling_groups FOR SELECT
  USING (is_public = TRUE);

-- 公开组关联的书签允许匿名 SELECT（通过 bookmark_ids JSONB 数组关联）
CREATE POLICY "Bookmarks in public groups are readable by anyone"
  ON bookmarks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sibling_groups
      WHERE sibling_groups.is_public = TRUE
        AND sibling_groups.bookmark_ids ? bookmarks.id
    )
  );

SELECT pg_notify('pgrst', 'reload schema');
