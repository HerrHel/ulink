// extension/config.js — 扩展运行时配置（与主项目 .env 的 VITE_SUPABASE_* 对齐）
// L2：集中配置，避免 sidepanel 内联硬编码与主项目漂移；anon key 本就公开（RLS 保护），
// 此处仅解决「轮换/多环境」时一处改即可。发布扩展前请与 .env 保持一致。
// 切勿写入 service_role key。
window.LinkVaultExtConfig = {
  SUPABASE_URL: 'https://yqouglfopbmujkqmjgpu.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxb3VnbGZvcGJtdWprcW1qZ3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjI2NjAsImV4cCI6MjA5NTUzODY2MH0.jiS802kT9rZZibDC8N3hB1cyvSxHV5xHs9pNjE7Wmnw',
  /** 主密码会话缓存 TTL（ms）：解密成功后倒计时清 sessionMasterPassword */
  MASTER_PASSWORD_TTL_MS: 60000,
}
