-- 026_feedback_messages.sql
-- 网页反馈表单落库：用户可在应用内「反馈 / 建议」弹窗直接提交内容，
-- 由 Edge Function `send-feedback` 写入本表并转发到企业邮箱 support@ulink.ren。
--
-- 背景：原先反馈入口只展示邮箱地址 + `mailto:`，依赖访客本机装有邮件客户端，
-- 桌面端大量用户点击后毫无反应。改为表单提交后体验可控，且邮件投递失败时
-- 本表仍留有完整记录，不至于丢反馈。
--
-- 设计：
-- 1) 表只存放反馈内容与投递状态。不授予 anon / authenticated 任何策略（RLS 开启且
--    无 policy），唯一写入路径是 Edge Function 用自动注入的 SUPABASE_SERVICE_ROLE_KEY
--    （bypassRLS）写入——公网无法直接读写，避免被当留言板刷。
-- 2) ip_hash 用于限流：同一 IP 一小时内的提交次数上限由 Edge Function 统计。
--    存哈希不存明文 IP，兼顾限流与隐私（哈希加盐，salt 来自函数环境变量）。
-- 3) mail_sent / mail_error 记录投递结果：SMTP 未配置或发信失败时仍保留反馈内容，
--    事后可补发或直接在 Dashboard 查看。
--
-- 执行：supabase db push --linked

CREATE TABLE IF NOT EXISTS feedback_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message TEXT NOT NULL,
  contact TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  locale TEXT,
  app_version TEXT,
  mail_sent BOOLEAN NOT NULL DEFAULT FALSE,
  mail_error TEXT
);

-- 限流查询形态：WHERE ip_hash = ? AND created_at >= ? → 复合索引
CREATE INDEX IF NOT EXISTS idx_feedback_messages_ip_time
  ON feedback_messages (ip_hash, created_at DESC);

ALTER TABLE feedback_messages ENABLE ROW LEVEL SECURITY;

-- 有意不建任何 policy：RLS 开启 + 无策略 = 除 service_role（bypassRLS）外全部拒绝。
-- 读取请在 Dashboard / SQL Editor 用 service_role 或 postgres 角色执行。
