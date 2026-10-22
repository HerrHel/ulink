-- 源文件: supabase/migrations/007_add_link_check_history.sql
-- CloudBase PG 适配: auth.uid() 返回 text；owner 列 UUID→TEXT 且移除 auth.users 外键
-- 死链检测历史表
-- 记录每次检测结果，用于历史对比和趋势分析

CREATE TABLE IF NOT EXISTS link_check_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  bookmark_id TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('alive', 'dead', 'blocked', 'unknown')),
  http_status INTEGER DEFAULT 0,
  response_time INTEGER DEFAULT 0,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  details JSONB DEFAULT '{}'
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_link_check_history_user ON link_check_history(user_id);
CREATE INDEX IF NOT EXISTS idx_link_check_history_bookmark ON link_check_history(bookmark_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_link_check_history_checked_at ON link_check_history(checked_at);

-- RLS策略
ALTER TABLE link_check_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own check history" ON link_check_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own check history" ON link_check_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own check history" ON link_check_history
  FOR DELETE USING (auth.uid() = user_id);

-- 清理旧数据函数（保留最近30天）
CREATE OR REPLACE FUNCTION cleanup_old_check_history()
RETURNS void AS $$
BEGIN
  DELETE FROM link_check_history
  WHERE checked_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
