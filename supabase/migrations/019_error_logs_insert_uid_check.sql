-- 019_error_logs_insert_uid_check.sql
-- H7：error_logs INSERT 策略禁止伪造他人 user_id。
--
-- 旧策略 WITH CHECK (true) 允许任意认证用户在 INSERT 时把 user_id 设为他人
-- auth.users UUID，受害者打开错误日志面板会看到投毒内容。
-- 改为：user_id 必须为 NULL（匿名上报）或等于 auth.uid()（本人）。
--
-- 注：匿名无限频写入（存储 DoS）仍需 Edge Function 限流才能根治，
-- 本迁移只堵「伪造他人 user_id」；字段长度限制见 016。

DROP POLICY IF EXISTS "Anyone can insert error logs" ON error_logs;

CREATE POLICY "Anyone can insert error logs" ON error_logs
  FOR INSERT WITH CHECK (user_id IS NULL OR user_id = auth.uid());

SELECT pg_notify('pgrst', 'reload schema');
