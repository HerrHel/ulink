-- 源文件: supabase/migrations/008_add_sync_indexes.sql
-- CloudBase PG 适配: auth.uid() 返回 text；owner 列 UUID→TEXT 且移除 auth.users 外键
-- 同步查询复合索引
-- _pullChanges 使用 gt('updated_at_num', since) 过滤，复合索引避免全表扫描
CREATE INDEX IF NOT EXISTS idx_bookmarks_sync ON bookmarks(user_id, updated_at_num);
CREATE INDEX IF NOT EXISTS idx_sibling_groups_sync ON sibling_groups(user_id, updated_at_num);
CREATE INDEX IF NOT EXISTS idx_categories_sync ON categories(user_id, updated_at_num);
CREATE INDEX IF NOT EXISTS idx_custom_attributes_sync ON custom_attributes(user_id, updated_at_num);

-- 替换单列索引（单列索引被复合索引的前缀覆盖）
DROP INDEX IF EXISTS idx_bookmarks_user;
DROP INDEX IF EXISTS idx_sibling_groups_user;
DROP INDEX IF EXISTS idx_categories_user;
DROP INDEX IF EXISTS idx_custom_attributes_user;

SELECT pg_notify('pgrst', 'reload schema');
