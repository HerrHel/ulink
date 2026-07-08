-- 012_public_groups_rls_softdelete.sql
-- 修复公开分享 RLS 的软删除漏洞：
-- 010_public_groups_rls.sql 的两条匿名 SELECT 策略仅判断 is_public = true，
-- 未过滤 deleted_at。若组被软删除（deleted_at IS NOT NULL）而 is_public 残留为 true，
-- 匿名用户（含未来 SSR 端）仍能读出本应已删除的组及其书签，存在被搜索引擎
-- 索引到过期内容的隐患。本迁移给两条策略补充 deleted_at IS NULL 约束。

-- sibling_groups：匿名可读「未删除 且 公开」的组
DROP POLICY IF EXISTS "Anyone can view public groups" ON sibling_groups;
CREATE POLICY "Anyone can view public groups" ON sibling_groups
  FOR SELECT USING (is_public = true AND deleted_at IS NULL);

-- bookmarks：匿名可读「被未删除公开组引用」的书签
-- 关联判断里同步加 sibling_groups.deleted_at IS NULL，
-- 避免组被软删除后其书签仍经该组放行；书签自身的 deleted_at 同样过滤。
DROP POLICY IF EXISTS "Anyone can view bookmarks in public groups" ON bookmarks;
CREATE POLICY "Anyone can view bookmarks in public groups" ON bookmarks
  FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM sibling_groups
      WHERE sibling_groups.is_public = true
        AND sibling_groups.deleted_at IS NULL
        AND sibling_groups.bookmark_ids @> to_jsonb(ARRAY[bookmarks.id])
    )
  );

SELECT pg_notify('pgrst', 'reload schema');
