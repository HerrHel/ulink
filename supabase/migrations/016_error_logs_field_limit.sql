-- 016_error_logs_field_limit.sql
-- S10：error_logs 防滥用——字段裁剪防御层。
--
-- 背景：error_logs 表 RLS 允许匿名 INSERT（WITH CHECK (true)），虽然前端
-- errorReporter.ts 已在发送前截断字段（message 1000 / stack 5000 / component 200），
-- 但攻击者可直接调 REST API 绕过客户端，写入任意长文本浪费存储或注入投毒日志。
--
-- 本迁移在 DB 层加 CHECK 约束作为纵深防御，即使有人绕过前端直调 API，
-- 超长字段也会被 PG 拒绝。

ALTER TABLE error_logs
  ADD CONSTRAINT ck_error_logs_message_length CHECK (length(message) <= 1000);

ALTER TABLE error_logs
  ADD CONSTRAINT ck_error_logs_stack_length CHECK (length(stack) <= 5000);

ALTER TABLE error_logs
  ADD CONSTRAINT ck_error_logs_component_length CHECK (length(component) <= 200);

ALTER TABLE error_logs
  ADD CONSTRAINT ck_error_logs_url_length CHECK (length(url) <= 2048);

ALTER TABLE error_logs
  ADD CONSTRAINT ck_error_logs_ua_length CHECK (length(user_agent) <= 1024);

-- 注：IP 维度的写入速率限制单靠 DB 无法实现（PG RLS 无从获取客户端 IP）。
-- 真速率限制需将错误上报路由到 Edge Function，由函数侧做计数+限流，
-- 或替换匿名 INSERT 为「前端调 Edge Function→函数侧鉴权+限流→写入」。
-- 列为 follow-up，不在本迁移范围内。

SELECT pg_notify('pgrst', 'reload schema');
