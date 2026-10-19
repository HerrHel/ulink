import { describe, it, expect } from 'vitest'
import {
  isPrivateHost,
  isPrivateUrl,
  sanitizeUrlForExternalService,
} from '../../lib/ai/urlGuard.js'

describe('urlGuard — AI 外部抓取与网络请求安全防线', () => {
  it('识别字面私有与环回主机名', () => {
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('127.0.0.1')).toBe(true)
    expect(isPrivateHost('0.0.0.0')).toBe(true)
    expect(isPrivateHost('::1')).toBe(true)
    expect(isPrivateHost('[::1]')).toBe(true)
    expect(isPrivateHost('metadata.google.internal')).toBe(true)
    expect(isPrivateHost('router.local')).toBe(true)
    expect(isPrivateHost('nas.internal')).toBe(true)
    expect(isPrivateHost('device.lan')).toBe(true)
  })

  it('识别各类私有与保留 IPv4 地址', () => {
    expect(isPrivateHost('10.0.0.1')).toBe(true)
    expect(isPrivateHost('10.254.254.254')).toBe(true)
    expect(isPrivateHost('172.16.0.1')).toBe(true)
    expect(isPrivateHost('172.31.255.255')).toBe(true)
    expect(isPrivateHost('192.168.1.1')).toBe(true)
    expect(isPrivateHost('169.254.169.254')).toBe(true) // link-local
    expect(isPrivateHost('127.0.1.1')).toBe(true)
  })

  it('放行正常公网主机名', () => {
    expect(isPrivateHost('github.com')).toBe(false)
    expect(isPrivateHost('ulink.ren')).toBe(false)
    expect(isPrivateHost('8.8.8.8')).toBe(false)
    expect(isPrivateHost('1.1.1.1')).toBe(false)
  })

  it('isPrivateUrl 能够精准判断完整 URL 的安全性', () => {
    expect(isPrivateUrl('http://192.168.1.1/admin')).toBe(true)
    expect(isPrivateUrl('http://localhost:3000')).toBe(true)
    expect(isPrivateUrl('https://127.0.0.1:8080/api')).toBe(true)
    expect(isPrivateUrl('javascript:alert(1)')).toBe(true) // 非 http/https 视为私有/不安全
    expect(isPrivateUrl('ftp://example.com')).toBe(true)
    expect(isPrivateUrl('https://github.com/explore')).toBe(false)
    expect(isPrivateUrl('https://v0.dev')).toBe(false)
  })

  it('sanitizeUrlForExternalService 清洗 HTTP Basic Auth 和敏感 Query 参数', () => {
    const raw = 'https://user:password123@example.com/api?token=secret_token&key=abc&view=list&sort=asc#heading'
    const cleaned = sanitizeUrlForExternalService(raw)
    expect(cleaned).not.toContain('password123')
    expect(cleaned).not.toContain('secret_token')
    expect(cleaned).not.toContain('key=abc')
    expect(cleaned).toContain('view=list')
    expect(cleaned).toContain('sort=asc')
    expect(cleaned).toContain('#heading')
  })
})
