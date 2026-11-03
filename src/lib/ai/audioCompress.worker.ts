/**
 * audioCompress.worker.ts — 音频编码 Web Worker
 *
 * 负责在独立线程中使用 lamejs 将 16kHz 单声道 PCM 数据编码为 32kbps MP3。
 * 避免在主线程执行密集的 MP3 压缩计算引起 UI 卡顿。
 */
import { Mp3Encoder } from '@breezystack/lamejs'

export interface WorkerCompressRequest {
  id: string
  pcm: Float32Array
  sampleRate?: number
  kbps?: number
}

export interface WorkerCompressResponse {
  id: string
  success: boolean
  buffer?: ArrayBuffer
  error?: string
}

function floatTo16BitPCM(floatSamples: Float32Array): Int16Array {
  const int16 = new Int16Array(floatSamples.length)
  for (let i = 0; i < floatSamples.length; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

export function encodePcmSamples(
  pcm: Float32Array,
  sampleRate = 16000,
  kbps = 32,
): ArrayBuffer {
  const encoder = new Mp3Encoder(1, sampleRate, kbps)
  const samples = floatTo16BitPCM(pcm)
  const chunkSize = 1152
  const mp3Chunks: Uint8Array[] = []

  for (let i = 0; i < samples.length; i += chunkSize) {
    const chunk = samples.subarray(i, i + chunkSize)
    const mp3buf = encoder.encodeBuffer(chunk)
    if (mp3buf && mp3buf.length > 0) {
      mp3Chunks.push(new Uint8Array(mp3buf))
    }
  }

  const end = encoder.flush()
  if (end && end.length > 0) {
    mp3Chunks.push(new Uint8Array(end))
  }

  let totalLength = 0
  for (let i = 0; i < mp3Chunks.length; i++) {
    totalLength += mp3Chunks[i].length
  }

  const merged = new Uint8Array(totalLength)
  let offset = 0
  for (let i = 0; i < mp3Chunks.length; i++) {
    merged.set(mp3Chunks[i], offset)
    offset += mp3Chunks[i].length
  }

  return merged.buffer
}

// 仅在真实 Web Worker 环境绑定 onmessage
if (typeof self !== 'undefined') {
  const workerScope = self as unknown as {
    onmessage: ((e: MessageEvent<WorkerCompressRequest>) => void) | null
    postMessage: (message: unknown, transfer?: Transferable[]) => void
  }

  workerScope.onmessage = (e: MessageEvent<WorkerCompressRequest>) => {
    const { id, pcm, sampleRate = 16000, kbps = 32 } = e.data
    try {
      const buffer = encodePcmSamples(pcm, sampleRate, kbps)
      const res: WorkerCompressResponse = {
        id,
        success: true,
        buffer,
      }
      workerScope.postMessage(res, [buffer])
    } catch (err: unknown) {
      const res: WorkerCompressResponse = {
        id,
        success: false,
        error: (err as Error)?.message || 'MP3 encoding failed',
      }
      workerScope.postMessage(res)
    }
  }
}
