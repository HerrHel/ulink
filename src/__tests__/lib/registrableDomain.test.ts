/**
 * registrableDomain — 根域名（eTLD+1）计算
 * 验收点：普通后缀取后两段；多段国别后缀多取一段；共享托管后缀下每个子域自成一站；
 * IP / 单段主机名 / 主机名本身是后缀时返回空串（调用方据此放弃跨子域归拢）。
 */
import { describe, it, expect } from 'vitest'
import { registrableDomain } from '../../lib/registrableDomain.js'

describe('registrableDomain', () => {
  it('普通后缀：取后两段', () => {
    expect(registrableDomain('deepseek.com')).toBe('deepseek.com')
    expect(registrableDomain('chat.deepseek.com')).toBe('deepseek.com')
    expect(registrableDomain('a.b.platform.deepseek.com')).toBe('deepseek.com')
    expect(registrableDomain('www.bilibili.com')).toBe('bilibili.com')
  })

  it('大小写、首尾空白与末尾的点不影响结果', () => {
    expect(registrableDomain('  Chat.DeepSeek.COM. ')).toBe('deepseek.com')
  })

  it('多段国别后缀：多取一段', () => {
    expect(registrableDomain('www.sina.com.cn')).toBe('sina.com.cn')
    expect(registrableDomain('news.sina.com.cn')).toBe('sina.com.cn')
    expect(registrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk')
    expect(registrableDomain('shop.example.com.au')).toBe('example.com.au')
  })

  it('共享托管后缀：每个用户子域自成一站', () => {
    expect(registrableDomain('alice.github.io')).toBe('alice.github.io')
    expect(registrableDomain('bob.github.io')).toBe('bob.github.io')
    expect(registrableDomain('docs.alice.github.io')).toBe('alice.github.io')
    expect(registrableDomain('my-app.vercel.app')).toBe('my-app.vercel.app')
    expect(registrableDomain('bucket.s3.amazonaws.com')).toBe('bucket.s3.amazonaws.com')
  })

  it('主机名本身就是后缀时没有根域名', () => {
    expect(registrableDomain('github.io')).toBe('')
    expect(registrableDomain('com.cn')).toBe('')
    expect(registrableDomain('co.uk')).toBe('')
  })

  it('IP、单段主机名、空值没有根域名', () => {
    expect(registrableDomain('192.168.1.1')).toBe('')
    expect(registrableDomain('[::1]')).toBe('')
    expect(registrableDomain('localhost')).toBe('')
    expect(registrableDomain('')).toBe('')
    expect(registrableDomain(null)).toBe('')
    expect(registrableDomain('a..com')).toBe('')
  })
})
