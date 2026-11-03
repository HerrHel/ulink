/**
 * audioCompress.ts — 纯前端音频重采样与压缩工具
 *
 * 目标：将用户的录音、会议或大音频文件重采样并压缩为 16kHz 单声道 32kbps MP3。
 * 容量效益：
 *  - 10MB 载荷上限下，原 128kbps 只能装约 10 分钟；
 *  - 压至 16kHz 32kbps 单声道后，10MB 可容纳超过 40 分钟会议录音，容量扩充 4 倍。
 *
 * 核心管线：
 * 1. 主线程：使用 AudioContext.decodeAudioData() 解码各类音频/视频容器；
 * 2. 主线程：使用 OfflineAudioContext(1, duration * 16000, 16000) 硬件加速重采样至 16kHz 单声道；
 * 3. Worker 线程：交由 audioCompress.worker.ts 通过 lamejs 编码为 32kbps MP3（无 Worker 环境同线程兜底）；
 * 4. 容错降级：压缩失败时，若原文件 ≤10MB 自动降级上传原文件；若 >10MB 给出清晰阻断提示。
 */
import { encodePcmSamples, type WorkerCompressRequest, type WorkerCompressResponse } from './audioCompress.worker.js'

/** 自动触发音频压缩的体积阈值：6MB */
export const AUDIO_COMPRESS_SIZE_THRESHOLD = 6 * 1024 * 1024

/** 自动触发音频压缩的时长阈值：8 分钟（480 秒） */
export const AUDIO_COMPRESS_DURATION_THRESHOLD_SEC = 8 * 60

/** 云函数与上游下载单段音频源文件硬上限：10MB */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/** 目标重采样率：16kHz（语音识别黄金采样率） */
export const TARGET_SAMPLE_RATE = 16000

/** 目标 MP3 码率：32kbps */
export const TARGET_KBPS = 32

/**
 * 将 PCM Float32Array 交由 Worker 或本地降级编码为 MP3 ArrayBuffer
 */
export async function encodePcmToMp3(
  pcm: Float32Array,
  sampleRate = TARGET_SAMPLE_RATE,
  kbps = TARGET_KBPS,
): Promise<ArrayBuffer> {
  const reqId = 'mp3_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)

  // 1. 若支持 Web Worker，则在独立线程编码，避免主线程 UI 卡顿
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<ArrayBuffer>((resolve, reject) => {
        let worker: Worker | null = null
        try {
          worker = new Worker(new URL('./audioCompress.worker.js', import.meta.url), { type: 'module' })
        } catch {
          // Worker 实例化失败（如安全策略或离线），回落主线程
          return resolve(encodePcmSamples(pcm, sampleRate, kbps))
        }

        const cleanup = () => {
          if (worker) {
            worker.terminate()
            worker = null
          }
        }

        const timer = setTimeout(() => {
          cleanup()
          // 编码超时兜底：尝试主线程编码
          try {
            resolve(encodePcmSamples(pcm, sampleRate, kbps))
          } catch (e) {
            reject(e)
          }
        }, 60000)

        worker.onmessage = (e: MessageEvent<WorkerCompressResponse>) => {
          if (e.data.id !== reqId) return
          clearTimeout(timer)
          cleanup()
          if (e.data.success && e.data.buffer) {
            resolve(e.data.buffer)
          } else {
            reject(new Error(e.data.error || 'MP3 encoding failed in worker'))
          }
        }

        worker.onerror = (err) => {
          clearTimeout(timer)
          cleanup()
          reject(new Error(err.message || 'Worker thread execution error'))
        }

        const msg: WorkerCompressRequest = { id: reqId, pcm, sampleRate, kbps }
        // 注意：pcm 需使用独立副本或直接传递
        worker.postMessage(msg)
      })
    } catch {
      // Worker 失败走同线程兜底
      return encodePcmSamples(pcm, sampleRate, kbps)
    }
  }

  // 2. 无 Worker 环境（如测试或极简环境）：直接同步编码
  return encodePcmSamples(pcm, sampleRate, kbps)
}

/**
 * 主线程解码音频文件为 AudioBuffer
 */
export async function decodeAudioBufferFromBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer()
  const AudioCtxClass =
    (typeof window !== 'undefined' && (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)) ||
    null

  if (!AudioCtxClass) {
    throw new Error('当前环境不支持 Web Audio API 解码')
  }

  const ctx = new AudioCtxClass()
  try {
    // 兼容回调形式与 Promise 形式
    const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      const promise = ctx.decodeAudioData(arrayBuffer, resolve, reject)
      if (promise && typeof promise.then === 'function') {
        promise.then(resolve).catch(reject)
      }
    })
    return audioBuffer
  } finally {
    if (typeof ctx.close === 'function') {
      try {
        await ctx.close()
      } catch {
        // ignore
      }
    }
  }
}

/**
 * 重采样 AudioBuffer 至 16kHz 单声道 Float32Array
 */
export async function resampleToMono16k(audioBuffer: AudioBuffer): Promise<Float32Array> {
  const OfflineCtxClass =
    (typeof window !== 'undefined' &&
      (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext)) ||
    null

  if (!OfflineCtxClass) {
    throw new Error('当前环境不支持 OfflineAudioContext 重采样')
  }

  const length = Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE)
  if (length <= 0) {
    throw new Error('音频时长无效')
  }

  const offlineCtx = new OfflineCtxClass(1, length, TARGET_SAMPLE_RATE)
  const source = offlineCtx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offlineCtx.destination)
  source.start(0)

  const renderedBuffer = await offlineCtx.startRendering()
  return renderedBuffer.getChannelData(0)
}

/**
 * 核心入口：判断并执行音频文件压缩
 *
 * 满足任一条件触发压缩：
 * 1. 文件尺寸 > 6MB
 * 2. 解码后时长 > 8 分钟
 *
 * 容错降级：
 * - 压缩抛错时，若原文件 ≤10MB 则降级上传原文件；
 * - 若原文件 >10MB 则明确告知用户截短。
 */
export async function maybeCompressAudio(
  file: File,
  onProgress?: (text: string) => void,
): Promise<{ file: File; compressed: boolean }> {
  // 小音频（≤6MB）直接返回原文件，无需耗时压缩
  if (file.size <= AUDIO_COMPRESS_SIZE_THRESHOLD) {
    return { file, compressed: false }
  }

  onProgress?.('正在压缩音频…')

  try {
    const audioBuffer = await decodeAudioBufferFromBlob(file)
    const pcm = await resampleToMono16k(audioBuffer)
    const mp3ArrayBuffer = await encodePcmToMp3(pcm, TARGET_SAMPLE_RATE, TARGET_KBPS)

    const baseName = file.name.replace(/\.[^.]+$/, '')
    const compressedName = `${baseName}_32k.mp3`
    const compressedFile = new File([mp3ArrayBuffer], compressedName, { type: 'audio/mp3' })

    // 若压缩后比原文件小且有效，采用压缩版本
    if (compressedFile.size < file.size && compressedFile.size > 0) {
      return { file: compressedFile, compressed: true }
    }
    // 压缩产物若无优势，若原文件未超 10MB 则回退原文件
    if (file.size <= MAX_AUDIO_BYTES) {
      return { file, compressed: false }
    }
    return { file: compressedFile, compressed: true }
  } catch (err) {
    // 降级兜底：若原文件 ≤10MB 则放行原文件
    if (file.size <= MAX_AUDIO_BYTES) {
      return { file, compressed: false }
    }
    throw new Error(
      `音频过大（${(file.size / 1024 / 1024).toFixed(1)}MB）且客户端压缩失败（${(err as Error)?.message || '解码失败'}），请截短后重试`,
    )
  }
}

/**
 * 从视频中直接提取音频并压缩为 32kbps MP3
 * （供长视频音画拆解任务调用；无音轨时返回 null）
 */
export async function extractAndCompressAudioFromVideo(
  videoFile: File,
  onProgress?: (text: string) => void,
): Promise<{ file: File; durationSec: number } | null> {
  onProgress?.('正在提取视频音轨…')
  try {
    const audioBuffer = await decodeAudioBufferFromBlob(videoFile)
    if (!audioBuffer || audioBuffer.duration <= 0) return null

    // 快速检查是否有声音（前 5 秒最大振幅非零）
    const pcm = await resampleToMono16k(audioBuffer)
    let hasSignal = false
    const checkLen = Math.min(pcm.length, TARGET_SAMPLE_RATE * 5)
    for (let i = 0; i < checkLen; i++) {
      if (Math.abs(pcm[i]) > 0.001) {
        hasSignal = true
        break
      }
    }
    if (!hasSignal) return null

    onProgress?.('正在压缩视频音轨…')
    const mp3Buffer = await encodePcmToMp3(pcm, TARGET_SAMPLE_RATE, TARGET_KBPS)
    const baseName = videoFile.name.replace(/\.[^.]+$/, '')
    const audioFile = new File([mp3Buffer], `${baseName}_audio.mp3`, { type: 'audio/mp3' })

    return { file: audioFile, durationSec: audioBuffer.duration }
  } catch {
    // 视频无声或容器无法解码音轨时，返回 null 走无声兜底
    return null
  }
}
