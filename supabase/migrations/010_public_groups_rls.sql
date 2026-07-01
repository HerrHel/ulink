-- 010_public_groups_rls.sql
-- 为公开分享功能添加 RLS 匿名读策略
-- 允许未认证用户 SELECT is_public = true 的组及其书签

-- sibling_groups：允许匿名用户读取公开组
CREATE POLICY "Anyone can view public groups" ON sibling_groups
  FOR SELECT USING (is_public = true);

-- bookmarks：允许匿名用户读取被公开组引用的书签
-- 通过 sibling_groups.bookmark_ids JSONB 数组判断关联性
CREATE POLICY "Anyone can view bookmarks in public groups" ON bookmarks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sibling_groups
      WHERE sibling_groups.is_public = true
        AND sibling_groups.bookmark_ids @> to_jsonb(ARRAY[bookmarks.id])
    )
  );

SELECT pg_notify('pgrst', 'reload schema');
