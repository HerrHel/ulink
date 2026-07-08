-- 013_public_groups_rls_owner_consistency.sql
-- 修复公开分享 RLS 缺「同所有者」一致性导致的跨用户书签泄露：
-- 012_public_groups_rls_softdelete.sql 的匿名 bookmarks SELECT 策略仅校验
-- 「存在某条 is_public 且未删除的组 bookmark_ids 包含该书签 id」，未要求该组与
-- 书签同属一个用户。攻击者可自建一个 is_public 组，把他人书签的 id 塞进
-- bookmark_ids（系统对 id 无归属校验），匿名访客即可经 /s/<gid> 读出他人本应
-- 私有的书签标题/URL。本迁移给 EXISTS 子查询补 sibling_groups.user_id =
-- bookmarks.user_id，确保只有「书签本人公开的组」才能放行该书的匿名读取。

-- bookmarks：匿名可读「未删除 且 被本人未删除公开组引用」的书签
DROP POLICY IF EXISTS "Anyone can view bookmarks in public groups" ON bookmarks;
CREATE POLICY "Anyone can view bookmarks in public groups" ON bookmarks
  FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM sibling_groups
      WHERE sibling_groups.is_public = true
        AND sibling_groups.deleted_at IS NULL
        AND sibling_groups.user_id = bookmarks.user_id   -- 关键：组与书签同所有者，阻断跨用户引用
        AND sibling_groups.bookmark_ids @> to_jsonb(ARRAY[bookmarks.id])
    )
  );

SELECT pg_notify('pgrst', 'reload schema');
