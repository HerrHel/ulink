import { describe, it, expect } from 'vitest'
import {
  formatFileSize,
  processFileForAi,
  formatAttachedFilesForPrompt,
  type AttachedMediaFile,
} from '../../lib/ai/attachmentHelper.js'

describe('AI 对话多模态附件处理 (attachmentHelper.ts)', () => {
  describe('1. 格式化文件尺寸 formatFileSize', () => {
    it('正确格式化 B / KB / MB', () => {
      expect(formatFileSize(500)).toBe('500 B')
      expect(formatFileSize(2048)).toBe('2.0 KB')
      expect(formatFileSize(1024 * 1024 * 3.5)).toBe('3.5 MB')
    })
  })

  describe('2. 解析文件 processFileForAi', () => {
    it('文本文件能够提取正文内容并识别为 file 类型', async () => {
      const mockFile = new File(['Hello ULink AI Assistant!'], 'notes.txt', { type: 'text/plain' })
      const res = await processFileForAi(mockFile)

      expect(res.name).toBe('notes.txt')
      expect(res.type).toBe('file')
      expect(res.mimeType).toBe('text/plain')
      expect(res.textContent).toBe('Hello ULink AI Assistant!')
      expect(res.size).toBe(mockFile.size)
    })

    it('JSON 文件能够提取结构化数据内容', async () => {
      const jsonContent = JSON.stringify({ app: 'ulink', version: '2.0' }, null, 2)
      const mockFile = new File([jsonContent], 'config.json', { type: 'application/json' })
      const res = await processFileForAi(mockFile)

      expect(res.name).toBe('config.json')
      expect(res.type).toBe('file')
      expect(res.textContent).toContain('ulink')
    })

    it('视频文件能正确识别为 video 类型并记录元数据', async () => {
      const mockFile = new File(['video-bytes'], 'presentation.mp4', { type: 'video/mp4' })
      const res = await processFileForAi(mockFile)

      expect(res.name).toBe('presentation.mp4')
      expect(res.type).toBe('video')
      expect(res.mimeType).toBe('video/mp4')
    })

    it('图片文件能正确识别为 image 类型', async () => {
      const mockFile = new File(['image-bytes'], 'screenshot.png', { type: 'image/png' })
      const res = await processFileForAi(mockFile)

      expect(res.name).toBe('screenshot.png')
      expect(res.type).toBe('image')
      expect(res.mimeType).toBe('image/png')
    })
  })

  describe('3. 组装 Prompt 结构化格式 formatAttachedFilesForPrompt', () => {
    it('空列表返回空串', () => {
      expect(formatAttachedFilesForPrompt([], true)).toBe('')
    })

    it('中文环境下输出清晰的编号、类型与文件正文内容块', () => {
      const files: AttachedMediaFile[] = [
        {
          id: 'f1',
          name: '架构图.png',
          type: 'image',
          mimeType: 'image/png',
          size: 1024 * 50,
          sizeFormatted: '50.0 KB',
        },
        {
          id: 'f2',
          name: '需求草稿.md',
          type: 'file',
          mimeType: 'text/markdown',
          size: 200,
          sizeFormatted: '200 B',
          textContent: '# 核心需求\n1. 支持拖拽粘贴图片\n2. 纯端侧快速解析',
        },
        {
          id: 'f3',
          name: '演示录屏.mp4',
          type: 'video',
          mimeType: 'video/mp4',
          size: 1024 * 1024 * 12,
          sizeFormatted: '12.0 MB',
        },
      ]

      const promptZh = formatAttachedFilesForPrompt(files, true)
      expect(promptZh).toContain('【用户上传的附件材料】：')
      expect(promptZh).toContain('1. 【架构图.png】（图片，50.0 KB）')
      expect(promptZh).toContain('2. 【需求草稿.md】（文档/文件，200 B）')
      expect(promptZh).toContain('文件正文提取内容如下：')
      expect(promptZh).toContain('# 核心需求')
      expect(promptZh).toContain('3. 【演示录屏.mp4】（视频，12.0 MB）')
    })

    it('英文环境下输出对应英文标签与提示', () => {
      const files: AttachedMediaFile[] = [
        {
          id: 'f1',
          name: 'diagram.png',
          type: 'image',
          mimeType: 'image/png',
          size: 1024,
          sizeFormatted: '1.0 KB',
        },
      ]

      const promptEn = formatAttachedFilesForPrompt(files, false)
      expect(promptEn).toContain('[Attached User Files]:')
      expect(promptEn).toContain('1. 【diagram.png】（Image，1.0 KB）')
    })
  })
})
