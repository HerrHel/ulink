-- 软删除支持：给所有表添加 deleted_at 字段
-- 在 Supabase Dashboard → SQL Editor 中执行

ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE sibling_groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE custom_attributes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 通知 PostgREST 刷新 schema
SELECT pg_notify('pgrst', 'reload schema');
