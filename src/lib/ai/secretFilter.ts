/**
 * secretFilter.ts — AI 提示词与上下文防敏感数据泄露过滤脱敏器
 *
 * 职责：
 * 在用户书签数据（标题、网址、附注 notes、标签）组装进大模型提示词之前，
 * 自动识别并脱敏高危机密信息（如私钥、API Key、Bearer Token、带密码的 URL、密码键值对等），
 * 防范机密凭证被发送至第三方大模型或存储于大模型供应商服务器（对齐 OWASP LLM02 敏感信息泄露防范）。
 */

/** 1. PEM / RSA / SSH 私钥块 */
const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g

/** 2. 常见 AI/云服务 API Key 格式 */
// OpenAI / DeepSeek / Mistral / Anthropic / 等: sk-...
const SK_KEY_RE = /\b(sk-[a-zA-Z0-9_-]{20,})\b/g
// GitHub Personal Access Token: ghp_..., gho_..., etc.
const GH_TOKEN_RE = /\b(gh[pousr]_[a-zA-Z0-9]{36,})\b/g
// AWS Access Key ID: AKIA...
const AWS_KEY_RE = /\b(AKIA[0-9A-Z]{16})\b/g
// Slack Tokens: xoxb-..., xoxp-..., etc.
const SLACK_TOKEN_RE = /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/g
// JWT (三段 base64 且以 eyJ 开头)
const JWT_TOKEN_RE = /\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g

/** 3. Bearer 授权头形式 */
const BEARER_RE = /\b(Bearer\s+)[a-zA-Z0-9_\-.~+/=]{16,}\b/gi

/** 4. URL 中的 HTTP Basic Auth 凭证 (http://user:password@...) */
const URL_BASIC_AUTH_RE = /(https?:\/\/[^:@\s]+):([^:@\s]+)@/g

/** 5. 键值对型凭证 (如 "password: 123456", "token=abcdef", "密码：xxxx", "api_key: xxx") */
const KV_SECRET_RE = /(?:(^|[\s,;；，\n(（])(password|passwd|pwd|secret|api_?key|auth_?token|access_?token|client_?secret|密码|口令|密钥)\s*[:：=]\s*)([^\s,;；，\n)）]+)/gi

/**
 * 对任意文本执行敏感凭证模式脱敏过滤。
 * 纯函数无副作用，命中模式即替换为 [REDACTED]，保留上下文语义结构。
 */
export function redactSensitivePatterns(text: string): string {
  if (!text) return ''

  let out = text
    .replace(PEM_PRIVATE_KEY_RE, '[REDACTED_PRIVATE_KEY]')
    .replace(URL_BASIC_AUTH_RE, '$1:[REDACTED]@')
    .replace(BEARER_RE, '$1[REDACTED]')
    .replace(SK_KEY_RE, '[REDACTED_API_KEY]')
    .replace(GH_TOKEN_RE, '[REDACTED_TOKEN]')
    .replace(AWS_KEY_RE, '[REDACTED_KEY]')
    .replace(SLACK_TOKEN_RE, '[REDACTED_TOKEN]')
    .replace(JWT_TOKEN_RE, '[REDACTED_JWT]')
    .replace(KV_SECRET_RE, (_match, prefix, key) => `${prefix}${key}: [REDACTED]`)

  return out
}
