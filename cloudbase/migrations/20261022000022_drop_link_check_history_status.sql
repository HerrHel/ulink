-- 源文件: supabase/migrations/022_drop_link_check_history_status.sql
-- CloudBase PG 适配: auth.uid() 返回 text；owner 列 UUID→TEXT 且移除 auth.users 外键
-- 022_drop_link_check_history_status.sql
-- 废弃 link_check_history.status：决策与契约统一为 fetch_outcome(+http_status)。
-- Edge 不再写 status；客户端从不读该列。旧行归档一并丢弃（无读路径）。
-- 顺序：先 DROP CONSTRAINT，再 DROP COLUMN。

ALTER TABLE link_check_history
  DROP CONSTRAINT IF EXISTS link_check_history_status_check;

ALTER TABLE link_check_history
  DROP COLUMN IF EXISTS status;
