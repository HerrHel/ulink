/**
 * deepMediaUpload.test.ts — 上传媒体校验纯函数（不上传网络）
 */
import { describe, expect, it } from 'vitest'
import {
  detectUploadKind,
  formatUploadSize,
  validateUploadFile,
  MAX_IMAGE_BYTES,
} from '../../lib/ai/deepMediaUpload.js'
import { detectMediaIntent } from '../../lib/ai/unifiedMedia.js'

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('deepMediaUpload 纯函数', () => {
  it('识别音频/视频/图片类型', () => {
    expect(detectUploadKind(makeFile('a.mp3', 'audio/mpeg', 10))).toBe('audio')
    expect(detectUploadKind(makeFile('a.mp4', 'video/mp4', 10))).toBe('video')
    expect(detectUploadKind(makeFile('a.jpg', 'image/jpeg', 10))).toBe('image')
    expect(detectUploadKind(makeFile('a.pdf', 'application/pdf', 10))).toBe(null)
  })

  it('大小超限抛错', () => {
    expect(() => validateUploadFile(makeFile('big.png', 'image/png', MAX_IMAGE_BYTES + 1))).toThrow()
    expect(validateUploadFile(makeFile('ok.png', 'image/png', 1024))).toBe('image')
  })

  it('格式化文件大小', () => {
    expect(formatUploadSize(512)).toBe('512 B')
    expect(formatUploadSize(2048)).toBe('2.0 KB')
    expect(formatUploadSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('按用户问题区分「看图」与「转写/OCR」', () => {
    expect(detectMediaIntent('这张图里有什么？')).toEqual({ wantsTranscript: false, wantsOcr: false })
    expect(detectMediaIntent('截图里有哪些网址')).toEqual({ wantsTranscript: false, wantsOcr: true })
    expect(detectMediaIntent('把这段录音转写一下')).toEqual({ wantsTranscript: true, wantsOcr: false })
    expect(detectMediaIntent('总结这个视频并提取画面网址')).toEqual({ wantsTranscript: true, wantsOcr: true })
  })
})
