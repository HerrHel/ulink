/**
 * audioCompress.test.ts — 音频客户端重采样与压缩单测
 */
import { describe, expect, it, vi } from 'vitest'
import {
  maybeCompressAudio,
  encodePcmToMp3,
  AUDIO_COMPRESS_SIZE_THRESHOLD,
  MAX_AUDIO_BYTES,
  TARGET_SAMPLE_RATE,
} from '../../lib/ai/audioCompress.js'
import { encodePcmSamples } from '../../lib/ai/audioCompress.worker.js'

describe('音频客户端压缩模块 (audioCompress.ts)', () => {
  it('小音频（≤6MB）直接放行不触发压缩', async () => {
    const file = new File(['small-audio-data'], 'test.mp3', { type: 'audio/mpeg' })
    Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 }) // 2MB

    const onProgress = vi.fn()
    const res = await maybeCompressAudio(file, onProgress)

    expect(res.compressed).toBe(false)
    expect(res.file).toBe(file)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('PCM 样本能够被 lamejs 编码为合法的 MP3 ArrayBuffer', async () => {
    // 构造 1 秒 16kHz 正弦波样本
    const samples = new Float32Array(TARGET_SAMPLE_RATE)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((i / TARGET_SAMPLE_RATE) * 440 * 2 * Math.PI) * 0.5
    }

    const mp3BufferSync = encodePcmSamples(samples, TARGET_SAMPLE_RATE, 32)
    expect(mp3BufferSync.byteLength).toBeGreaterThan(0)

    // encodePcmToMp3（在无 Worker 或降级环境下）
    const mp3BufferAsync = await encodePcmToMp3(samples, TARGET_SAMPLE_RATE, 32)
    expect(mp3BufferAsync.byteLength).toBeGreaterThan(0)
  })

  it('大音频（>6MB）在环境无解码器导致异常时，若原文件 ≤10MB 自动降级上传原文件', async () => {
    // 在 Node/Vitest 环境下未挂载真实 Web Audio，decodeAudioBufferFromBlob 会抛错
    const bigFile = new File(['dummy-content'], 'meeting-recording.mp3', { type: 'audio/mpeg' })
    Object.defineProperty(bigFile, 'size', { value: 8 * 1024 * 1024 }) // 8MB，大于 6MB 但小于 10MB

    const onProgress = vi.fn()
    const res = await maybeCompressAudio(bigFile, onProgress)

    expect(onProgress).toHaveBeenCalledWith('正在压缩音频…')
    // 降级原文件放行
    expect(res.compressed).toBe(false)
    expect(res.file).toBe(bigFile)
  })

  it('超大音频（>10MB）若客户端压缩失败，应阻断并抛出友好错误提示', async () => {
    const hugeFile = new File(['huge-content'], 'huge-recording.mp3', { type: 'audio/mpeg' })
    Object.defineProperty(hugeFile, 'size', { value: 25 * 1024 * 1024 }) // 25MB

    const onProgress = vi.fn()
    await expect(maybeCompressAudio(hugeFile, onProgress)).rejects.toThrow(/音频过大/)
  })

  it('常量阈值配置合理性校验', () => {
    expect(AUDIO_COMPRESS_SIZE_THRESHOLD).toBe(6 * 1024 * 1024)
    expect(MAX_AUDIO_BYTES).toBe(10 * 1024 * 1024)
    expect(TARGET_SAMPLE_RATE).toBe(16000)
  })
})
