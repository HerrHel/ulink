-- 011_error_logs.sql
-- 客户端运行时错误日志表
-- 用于捕获 Vue 渲染错误 / unhandled rejection 等
CREATE TABLE IF NOT EXISTS error_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT '',
  stack TEXT DEFAULT '',
  component TEXT DEFAULT '',
  url TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 允许匿名 INSERT（捕获登录前后的错误）
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert error logs" ON error_logs
  FOR INSERT WITH CHECK (true);

-- 仅认证用户可查看自己的错误日志
CREATE POLICY "Users can view own error logs" ON error_logs
  FOR SELECT USING (auth.uid() = user_id);

-- 索引：按时间降序查询
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs(user_id);

SELECT pg_notify('pgrst', 'reload schema');
