-- 版本历史表
-- 在 Supabase Dashboard → SQL Editor 中执行

CREATE TABLE IF NOT EXISTS data_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('bookmark', 'group')),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_history_user_item ON data_history(user_id, item_id, item_type);
CREATE INDEX IF NOT EXISTS idx_data_history_created ON data_history(user_id, created_at DESC);

ALTER TABLE data_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own history" ON data_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own history" ON data_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own history" ON data_history
  FOR DELETE USING (auth.uid() = user_id);

SELECT pg_notify('pgrst', 'reload schema');
