-- bookmarks 表缺少 updated_at_num 列（sibling_groups 有，bookmarks 没有）
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS updated_at_num BIGINT DEFAULT 0;
