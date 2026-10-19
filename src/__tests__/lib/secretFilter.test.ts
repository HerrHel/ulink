import { describe, it, expect } from 'vitest'
import { redactSensitivePatterns } from '../../lib/ai/secretFilter.js'

describe('secretFilter — AI 提示词防敏感凭证泄露脱敏器', () => {
  it('脱敏 PEM / RSA / SSH 私钥块', () => {
    const raw = `
前置说明
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0m4w1234567890abcdef
-----END RSA PRIVATE KEY-----
后续内容
    `
    const out = redactSensitivePatterns(raw)
    expect(out).not.toContain('MIIEowIBAAKCAQEA0m4w1234567890abcdef')
    expect(out).toContain('[REDACTED_PRIVATE_KEY]')
    expect(out).toContain('前置说明')
    expect(out).toContain('后续内容')
  })

  it('脱敏常见大模型与云平台 API Key (sk-...)', () => {
    const raw = '我的 OpenAI key 是 sk-abcdef1234567890abcdef1234567890，请帮我分析。'
    const out = redactSensitivePatterns(raw)
    expect(out).not.toContain('sk-abcdef1234567890abcdef1234567890')
    expect(out).toContain('[REDACTED_API_KEY]')
  })

  it('脱敏 GitHub Personal Access Token (ghp_...)', () => {
    const raw = '部署用的 token: ghp_123456789012345678901234567890123456'
    const out = redactSensitivePatterns(raw)
    expect(out).not.toContain('ghp_123456789012345678901234567890123456')
    expect(out).toContain('[REDACTED_TOKEN]')
  })

  it('脱敏 AWS Key 与 Slack Token', () => {
    const raw = 'AKIAIOSFODNN7EXAMPLE 和 xoxb-123456789012-1234567890123-abcdef123456'
    const out = redactSensitivePatterns(raw)
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(out).not.toContain('xoxb-123456789012-1234567890123-abcdef123456')
    expect(out).toContain('[REDACTED_KEY]')
    expect(out).toContain('[REDACTED_TOKEN]')
  })

  it('脱敏 Bearer 授权头', () => {
    const raw = 'Authorization: Bearer my_secret_token_12345678'
    const out = redactSensitivePatterns(raw)
    expect(out).not.toContain('my_secret_token_12345678')
    expect(out).toContain('Bearer [REDACTED]')
  })

  it('脱敏 URL 中的 HTTP Basic Auth 凭据', () => {
    const raw = 'https://admin:SuperSecretPass123@gitlab.example.com/project'
    const out = redactSensitivePatterns(raw)
    expect(out).not.toContain('SuperSecretPass123')
    expect(out).toContain('https://admin:[REDACTED]@gitlab.example.com/project')
  })

  it('脱敏中英文键值对凭据 (password/密码/密钥/token)', () => {
    const raw = '服务器信息：\npassword: MyStrongPassword!123\n密码：654321\napi_key: secret-val\n口令: token123'
    const out = redactSensitivePatterns(raw)
    expect(out).not.toContain('MyStrongPassword!123')
    expect(out).not.toContain('654321')
    expect(out).not.toContain('secret-val')
    expect(out).not.toContain('token123')
    expect(out).toContain('password: [REDACTED]')
    expect(out).toContain('密码: [REDACTED]')
    expect(out).toContain('api_key: [REDACTED]')
    expect(out).toContain('口令: [REDACTED]')
  })

  it('空文本或普通内容不受影响', () => {
    expect(redactSensitivePatterns('')).toBe('')
    const normal = '这是一篇关于 React 架构演进与现代构建工具的技术笔记。'
    expect(redactSensitivePatterns(normal)).toBe(normal)
  })
})
