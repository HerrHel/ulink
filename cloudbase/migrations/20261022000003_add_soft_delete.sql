-- 源文件: supabase/migrations/003_add_soft_delete.sql
-- CloudBase PG 适配: auth.uid() 返回 text；owner 列 UUID→TEXT 且移除 auth.users 外键
-- 软删除支持：给所有表添加 deleted_at 字段
-- 在 Supabase Dashboard → SQL Editor 中执行

ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE sibling_groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE custom_attributes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 通知 PostgREST 刷新 schema
SELECT pg_notify('pgrst', 'reload schema');
