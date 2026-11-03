/**
 * videoDecompose.test.ts — 视频智能音画拆解单测
 */
import { describe, expect, it, vi } from 'vitest'
import {
  formatTimestamp,
  calculateFrameQuality,
  MAX_VIDEO_FRAMES,
  MIN_ADAPTIVE_FRAMES,
  extractKeyframesFromVideo,
  decomposeVideoForAi,
} from '../../lib/ai/videoDecompose.js'
import * as audioModule from '../../lib/ai/audioCompress.js'
import * as uploadModule from '../../lib/ai/deepMediaUpload.js'

describe('视频音画拆解模块 (videoDecompose.ts)', () => {
  it('formatTimestamp 正确格式化秒数为 [mm:ss]', () => {
    expect(formatTimestamp(0)).toBe('[00:00]')
    expect(formatTimestamp(5)).toBe('[00:05]')
    expect(formatTimestamp(65)).toBe('[01:05]')
    expect(formatTimestamp(725)).toBe('[12:05]')
    expect(formatTimestamp(3600)).toBe('[60:00]')
  })

  it('calculateFrameQuality 能够识别黑屏与有效画面', () => {
    // 构造纯黑屏模拟 ImageData
    const blackData = new Uint8ClampedArray(160 * 90 * 4)
    // 纯黑：r=0, g=0, b=0, a=255
    for (let i = 0; i < blackData.length; i += 4) {
      blackData[i + 3] = 255
    }

    const mockCtx = {
      getImageData: vi.fn(() => ({ data: blackData })),
    } as unknown as CanvasRenderingContext2D

    const blackScore = calculateFrameQuality(mockCtx, 160, 90)
    expect(blackScore).toBe(0)

    // 构造高对比度内容模拟 ImageData (一半亮一半暗)
    const richData = new Uint8ClampedArray(160 * 90 * 4)
    for (let i = 0; i < richData.length; i += 4) {
      const isTop = i < richData.length / 2
      const val = isTop ? 220 : 40
      richData[i] = val
      richData[i + 1] = val
      richData[i + 2] = val
      richData[i + 3] = 255
    }

    const mockRichCtx = {
      getImageData: vi.fn(() => ({ data: richData })),
    } as unknown as CanvasRenderingContext2D

    const richScore = calculateFrameQuality(mockRichCtx, 160, 90)
    expect(richScore).toBeGreaterThan(50)
  })

  it('MAX_VIDEO_FRAMES 常量配置为 16', () => {
    expect(MAX_VIDEO_FRAMES).toBe(16)
  })

  it('时间预算自适应帧数底线配置为 8 帧', () => {
    expect(MIN_ADAPTIVE_FRAMES).toBe(8)
  })

  it('在非 DOM 环境下 extractKeyframesFromVideo 安全返回空数组', async () => {
    const file = new File(['mock-video'], 'demo.mp4', { type: 'video/mp4' })
    const origDoc = globalThis.document
    // @ts-expect-error test non-DOM
    delete globalThis.document

    try {
      const frames = await extractKeyframesFromVideo(file, 60)
      expect(frames).toEqual([])
    } finally {
      globalThis.document = origDoc
    }
  })

  it('decomposeVideoForAi 完整链路组装音轨与时序索引', async () => {
    const mockFile = new File(['mock-video-data'], 'presentation.mp4', { type: 'video/mp4' })
    const mockAudioFile = new File(['mock-mp3'], 'presentation_audio.mp3', { type: 'audio/mp3' })

    vi.spyOn(audioModule, 'extractAndCompressAudioFromVideo').mockResolvedValue({
      file: mockAudioFile,
      durationSec: 120,
    })

    vi.spyOn(uploadModule, 'uploadDeepMediaFile').mockImplementation(async (file) => ({
      url: `https://mock.tcloudbasegateway.com/deep-media/${file.name}`,
      path: `deep-media/${file.name}`,
      kind: 'video',
      title: file.name,
    }))

    const onProgress = vi.fn()
    const result = await decomposeVideoForAi(mockFile, 120, 'test_user_123', onProgress)

    expect(result.hasAudio).toBe(true)
    expect(result.audioUrl).toContain('presentation_audio.mp3')
    expect(result.timeIndexPrompt).toContain('【视频核心语音】')
    expect(onProgress).toHaveBeenCalled()
  })
})
