-- 030_error_logs_funnel.sql
-- error_logs 写入收口（P1-4 方案 B 的 DB 侧）：匿名直插策略撤除 + ip_hash 限流载体。
--
-- 审计时间：2026-09-02（docs/BACKEND_AUDIT.md P1-4）
-- 执行：supabase db push --linked
--
-- 背景：error_logs 的匿名 INSERT 策略（019 定形：user_id IS NULL OR = auth.uid()）
--       让任何人可绕过客户端节流无限 POST /rest/v1/error_logs。028 用全局熔断
--       （1min/200）止损；本迁移是根治的 DB 半场——配合 Edge Function
--       report-error 形成唯一写入通道：
--         - 匿名直插表策略 DROP（PostgREST 直写通道关闭）
--         - error_logs 增 ip_hash 列 + 索引（函数侧按 IP 计数限流的载体）
--       report-error 函数：按 IP 1min/30 条（DB 计数，跨实例一致）+ 028 全局
--       熔断兜底（BEFORE INSERT 触发器对 service_role 同样生效）。

-- ═══════════════════════════════════════════════════════════════════
-- 1. 撤除匿名直插策略（error_logs 唯一写入口改为 report-error 函数）
-- ═══════════════════════════════════════════════════════════════════
--
-- 影响面评估：
--   - 前端 src/lib/errorReporter.ts 原直插 error_logs → 同步改为调 report-error
--     函数（本迁移配套的代码改动，commit 同批提交）
--   - 匿名 SELECT 策略已不存在（028 前只有 view own = authenticated）；
--     "Users can view own error logs"（authenticated）保留：函数落库时携带
--     有效 JWT 解析出的 user_id，用户仍可在后台看自己的错误。
--   - RLS 熔断触发器 trg_error_logs_throttle（028）保留：service_role 写入
--     同样计数，全局最终兜底不撤。
--
-- 回滚：CREATE POLICY "Anyone can insert error logs" ON error_logs
--       FOR INSERT TO public WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "Anyone can insert error logs" ON error_logs;

COMMENT ON TABLE error_logs IS
  'P1-4（030）：匿名直插已撤，唯一写入通道 = Edge Function report-error'
  '（按 IP 1min/30 计数限流 + 028 全局 1min/200 熔断兜底）。';

-- ═══════════════════════════════════════════════════════════════════
-- 2. error_logs 增 ip_hash 列 + 时间索引（report-error 限流计数载体）
-- ═══════════════════════════════════════════════════════════════════
--
-- 设计：ip_hash = sha256Hex(ip | IP_HASH_SALT)（盐在函数环境变量，防彩虹表）。
-- 只存哈希不存明文 IP（隐私）；count(gte created_at) 用部分索引加速，
-- 窗口查询只扫近 1 分钟的行。
--
-- 回滚：DROP INDEX / DROP COLUMN 对应两条语句。

ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS ip_hash text;

CREATE INDEX IF NOT EXISTS idx_error_logs_ip_time
  ON error_logs (ip_hash, created_at DESC);

COMMENT ON COLUMN error_logs.ip_hash IS
  '上报来源 IP 的 SHA-256 哈希（盐在 report-error 函数），用于按 IP 限流计数，不存明文。';


-- 通知 PostgREST 重载 schema
SELECT pg_notify('pgrst', 'reload schema');
