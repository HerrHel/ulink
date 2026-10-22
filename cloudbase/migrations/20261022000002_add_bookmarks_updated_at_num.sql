-- 源文件: supabase/migrations/002_add_bookmarks_updated_at_num.sql
-- CloudBase PG 适配: auth.uid() 返回 text；owner 列 UUID→TEXT 且移除 auth.users 外键
-- bookmarks 表缺少 updated_at_num 列（sibling_groups 有，bookmarks 没有）
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS updated_at_num BIGINT DEFAULT 0;
