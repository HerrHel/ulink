-- 006_enable_realtime.sql
-- 为 LinkVault 的 4 张业务表启用 Supabase Realtime
-- 这使得客户端可以通过 WebSocket 实时接收数据变更

-- 将表添加到 supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE bookmarks;
ALTER PUBLICATION supabase_realtime ADD TABLE sibling_groups;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE custom_attributes;
