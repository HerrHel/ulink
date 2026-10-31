import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// 云函数目录是独立部署单元（CommonJS），这里用 createRequire 直接加载真源，避免 Vite 对 CJS 的转换差异。
const require = createRequire(import.meta.url)
const routing = require('../../../cloudbase/functions/extract-video/routing.js') as {
  isMeaningfulText: (t: unknown) => boolean
  isDeadPageText: (...t: unknown[]) => boolean
  shouldUseWorker: (u: URL | null, hosts: string[]) => boolean
  normalizeWorkerSource: (s: unknown) => string
  pickFallbackReason: (s: Record<string, unknown>) => string
  isValidJobId: (id: unknown) => boolean
}

const HOSTS = ['bilibili.com', 'b23.tv', 'youtube.com', 'youtu.be', 'douyin.com', 'xiaohongshu.com', 'x.com']

describe('extract-video 路由纯函数', () => {
  describe('isMeaningfulText（空壳标题判定，正语义）', () => {
    it('空/极短/平台通用 slogan 均判为无意义', () => {
      expect(routing.isMeaningfulText('')).toBe(false)
      expect(routing.isMeaningfulText('  ')).toBe(false)
      expect(routing.isMeaningfulText('抖音')).toBe(false)
      expect(routing.isMeaningfulText('记录美好生活')).toBe(false)
      expect(routing.isMeaningfulText('在抖音记录美好生活')).toBe(false)
      expect(routing.isMeaningfulText('小红书-你的生活指南')).toBe(false)
      expect(routing.isMeaningfulText('Make Your Day')).toBe(false)
    })

    it('正常标题/简介判为有内容', () => {
      expect(routing.isMeaningfulText('【官方 MV】Never Gonna Give You Up')).toBe(true)
      expect(routing.isMeaningfulText('这个视频介绍了三个效率工具')).toBe(true)
    })
  })

  describe('isDeadPageText（错误页/已删除页）', () => {
    it('命中常见中文/英文错误页特征', () => {
      expect(routing.isDeadPageText('抱歉，视频不见了')).toBe(true)
      expect(routing.isDeadPageText('页面不存在')).toBe(true)
      expect(routing.isDeadPageText('404 Not Found')).toBe(true)
      expect(routing.isDeadPageText('This video has been removed')).toBe(true)
      expect(routing.isDeadPageText('访问异常，请稍后再试')).toBe(true)
    })

    it('正常内容与空输入不误判', () => {
      expect(routing.isDeadPageText('这是一段正常简介')).toBe(false)
      expect(routing.isDeadPageText('')).toBe(false)
      expect(routing.isDeadPageText(null, undefined)).toBe(false)
    })
  })

  describe('shouldUseWorker（平台域名匹配）', () => {
    it('主域与子域命中', () => {
      expect(routing.shouldUseWorker(new URL('https://www.douyin.com/video/1'), HOSTS)).toBe(true)
      expect(routing.shouldUseWorker(new URL('https://m.bilibili.com/video/BV1'), HOSTS)).toBe(true)
      expect(routing.shouldUseWorker(new URL('https://youtu.be/abc'), HOSTS)).toBe(true)
      expect(routing.shouldUseWorker(new URL('https://x.com/a/status/1'), HOSTS)).toBe(true)
    })

    it('非视频站、伪装后缀、空配置都不命中', () => {
      expect(routing.shouldUseWorker(new URL('https://example.com/a'), HOSTS)).toBe(false)
      expect(routing.shouldUseWorker(new URL('https://evilbilibili.com/a'), HOSTS)).toBe(false)
      expect(routing.shouldUseWorker(new URL('https://www.bilibili.com.evil.com/a'), HOSTS)).toBe(false)
      expect(routing.shouldUseWorker(new URL('https://www.douyin.com/video/1'), [])).toBe(false)
      expect(routing.shouldUseWorker(null, HOSTS)).toBe(false)
    })
  })

  describe('normalizeWorkerSource（extractor 名归一）', () => {
    it.each([
      ['BiliBili', 'bilibili'],
      ['bilibili', 'bilibili'],
      ['Youtube', 'youtube'],
      ['youtube:tab', 'youtube'],
      ['Douyin', 'douyin'],
      ['TikTok', 'tiktok'],
      ['xiaohongshu', 'xiaohongshu'],
      ['RedNote', 'xiaohongshu'],
      ['Twitter', 'x'],
      ['x', 'x'],
      ['vimeo', 'generic'],
      ['', 'generic'],
    ])('%s → %s', (input, expected) => {
      expect(routing.normalizeWorkerSource(input)).toBe(expected)
    })
  })

  describe('pickFallbackReason（降级原因枚举）', () => {
    it('worker 被跳过优先于超时/适配器空', () => {
      expect(routing.pickFallbackReason({ workerSkipped: 'no_proxy', workerTimedOut: true })).toBe('worker_no_proxy')
      expect(routing.pickFallbackReason({ workerSkipped: 'unavailable', adapterAttempted: true })).toBe(
        'worker_unavailable',
      )
    })

    it('超时与适配器空分别标注', () => {
      expect(routing.pickFallbackReason({ workerTimedOut: true, adapterAttempted: true })).toBe('timeout')
      expect(routing.pickFallbackReason({ adapterAttempted: true })).toBe('adapter_empty')
      expect(routing.pickFallbackReason({})).toBe('worker_unavailable')
    })
  })

  describe('isValidJobId（深度任务 id 校验）', () => {
    it('合法 id', () => {
      expect(routing.isValidJobId('9f2c8e1a4b7d6c5e')).toBe(true)
      expect(routing.isValidJobId('9f2c8e1a-4b7d-6c5e-8a1b-2c3d4e5f6071')).toBe(true)
      expect(routing.isValidJobId('job_ABC-123')).toBe(true)
    })

    it('非法 id（注入面/长度越界）', () => {
      expect(routing.isValidJobId('')).toBe(false)
      expect(routing.isValidJobId('short')).toBe(false)
      expect(routing.isValidJobId('../../etc/passwd')).toBe(false)
      expect(routing.isValidJobId('a'.repeat(65))).toBe(false)
      expect(routing.isValidJobId('abc def ghi')).toBe(false)
      expect(routing.isValidJobId(null)).toBe(false)
      expect(routing.isValidJobId(12345678)).toBe(false)
    })
  })
})
