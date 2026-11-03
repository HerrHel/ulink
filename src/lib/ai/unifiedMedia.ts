/**
 * unifiedMedia.ts — 统一媒体附件处理
 *
 * 用户从聊天输入框上传图片/视频/音频，入口只有一个；是否走多模态直读还是深度解析，
 * 由「用户的问题 + 文件类型」决定：
 *  - 图片 + 问“图里有什么/描述” → 压缩缩略图直接作为多模态消息发给模型；
 *  - 图片 + 问“网址/文字/OCR/识别” → 直接作为多模态图片给模型（v2.6-flash 视觉已足够）；
 *  - 视频 → 上传取公开 URL，作为 `video_url` 多模态块直传（实测 10 秒视频约 600 video tokens）；
 *  - 音频 → 转 base64 作为 `input_audio` 块直传（MiMo 要求 data 字段，不支持远程 URL）。
 *
 * 2026-11-03 重构：不再经 video-worker 容器做「下载→ASR/OCR」。原因：
 *   1) MiMo-V2.6-Flash 原生支持 video/audio 输入，抽帧逐帧调视觉是低效路径；
 *   2) 在线视频下载（yt-dlp）有版权风险（《著作权法》53 条(六)）且容器按运行时长计费。
 * 现在只处理**用户自己上传的文件**，不涉及第三方内容获取。
 *
 * 处理失败会写入明确的错误段落，不伪造结果；上传的临时对象处理完即删除。
 */
import type { AttachedMediaFile } from './attachmentHelper.js'
import { getRawAttachedFile, MAX_DIRECT_VIDEO_DURATION_SEC } from './attachmentHelper.js'
import { uploadDeepMediaFile } from './deepMediaUpload.js'
import { maybeCompressAudio } from './audioCompress.js'
import { decomposeVideoForAi } from './videoDecompose.js'

export interface MediaIntent {
  wantsTranscript: boolean
  wantsOcr: boolean
}

/** 发往 MiMo 的多模态内容块（与 OpenAI content parts 同构） */
export type MiMoMediaPart =
  | { type: 'video_url'; video_url: { url: string } }
  /** 音频只传存储 URL：base64 由云函数物化（入站请求体上限约 512KB，传不得） */
  | { type: 'input_audio'; input_audio: { url: string; format: string } }

export interface UnifiedMediaResult {
  /** 直接发给模型的多模态图片（data URL） */
  images: string[]
  /** 直接发给模型的音视频多模态块 */
  mediaParts: MiMoMediaPart[]
  /** 注入 prompt 的解析文本（失败说明等） */
  extraPrompt: string
}

/** 轻量意图识别：只有明确要转写/OCR 才做耗时的深度处理 */
export function detectMediaIntent(text: string): MediaIntent {
  const raw = String(text || '')
  const wantsTranscript =
    /转写|字幕|口播|说了什么|讲了什么|讲了啥|总结|摘要|内容|录音|语音|音频内容|语音内容|transcript|subtitle|speech|summar/i.test(
      raw,
    )
  const wantsOcr =
    /网址|链接|url|ocr|画面|屏幕|文字|识别.*(文字|网址|链接)|提取.*(网址|链接|文字)|写了什么|字/i.test(raw)
  return { wantsTranscript, wantsOcr }
}

/**
 * 处理聊天附件中的媒体文件：
 * - 图片始终返回缩略图；只有用户要 OCR 时才上传原图做 OCR；
 * - 音频/视频必须登录后上传并解析，返回文本注入 prompt；
 * - 失败以 `【文件名：错误】` 写入 extraPrompt，模型会如实告知用户。
 */
export async function prepareUnifiedMedia(
  files: AttachedMediaFile[],
  userText: string,
  userId: string,
  opts: {
    signal?: AbortSignal
    onProgress?: (text: string) => void
  } = {},
): Promise<UnifiedMediaResult> {
  const mediaFiles = (files || []).filter((f) => f.type === 'image' || f.type === 'video' || f.type === 'audio')
  if (mediaFiles.length === 0) return { images: [], mediaParts: [], extraPrompt: '' }

  // 图片：缩略图走 data URL 直传（v2.6-flash 视觉足够，不再单独跑 OCR 服务）
  const images = mediaFiles
    .filter((f) => f.type === 'image' && typeof f.dataUrl === 'string' && f.dataUrl)
    .map((f) => f.dataUrl as string)
    .slice(0, 4)

  const mediaParts: MiMoMediaPart[] = []
  const errors: string[] = []
  let videoUsed = false

  for (const file of mediaFiles) {
    if (file.type === 'image') continue // 已在 images 中处理
    try {
      if (!userId) throw new Error('需要登录后才能发送媒体文件')

      if (file.type === 'video') {
        if (videoUsed) throw new Error('一次对话只能发送一个视频')
        if (!VIDEO_ACCEPTED.test(file.mimeType || file.name || '')) {
          throw new Error('视频格式不支持，请使用 mp4 / mov / webm')
        }
        const rawFile = getRawAttachedFile(file.id)
        if (!rawFile) throw new Error('原始文件不可用，请重新上传')

        const duration = file.durationSec || 0
        // 短视频（≤30s）：直接走原生 video_url 直传（全画质全声效，模型几秒完成）
        if (duration > 0 && duration <= MAX_DIRECT_VIDEO_DURATION_SEC) {
          opts.onProgress?.(`${file.name} 上传中`)
          const uploaded = await uploadDeepMediaFile(rawFile, userId)
          mediaParts.push({ type: 'video_url', video_url: { url: uploaded.url } })
          videoUsed = true
          opts.onProgress?.(`${file.name} 已就绪`)
          continue
        }

        // 中长视频（>30s 或未探明时长的视频）：自动启动端侧智能「音画拆解」
        opts.onProgress?.(`正在对 ${file.name} 执行端侧音画拆解与抽帧…`)
        const decomposed = await decomposeVideoForAi(rawFile, duration, userId, opts.onProgress)

        // 注入提取到的核心压缩音轨（16kHz 32kbps MP3）
        if (decomposed.audioUrl) {
          mediaParts.push({
            type: 'input_audio',
            input_audio: { url: decomposed.audioUrl, format: 'mp3' },
          })
        }

        // 注入提取到的带时间戳时序关键帧（远程 URL，单张仅约 26 tokens）
        if (decomposed.frames && decomposed.frames.length > 0) {
          for (const frame of decomposed.frames) {
            if (frame.url) {
              images.push(frame.url)
            }
          }
        }

        if (decomposed.timeIndexPrompt) {
          errors.push(decomposed.timeIndexPrompt)
        }

        videoUsed = true
        opts.onProgress?.(`${file.name} 音画拆解完成`)
        continue
      }

      // 音频：只传存储 URL，base64 由云函数物化。
      //
      // 为什么不能前端传 base64（2026-11-03 实测）：
      //   CloudBase HTTP 访问服务入站 body 上限约 512KB（511KB 通过、1023KB 返回 430），
      //   而 base64 有 4/3 膨胀系数——1MB 原文件就必然被网关拒收。
      //   MiMo 的 input_audio 又只认 base64（远程 URL 报「`data` is not set」），
      //   所以只能由服务端下载后转码，请求体始终只有几十字节。
      const rawFile = getRawAttachedFile(file.id)
      if (!rawFile) throw new Error('原始文件不可用，请重新上传')

      // 若满足大文件/长音频条件，由客户端先行重采样为 16kHz 32kbps MP3（扩充 4 倍容量）
      const prepared = await maybeCompressAudio(rawFile, opts.onProgress)
      const targetFile = prepared.file

      if (targetFile.size > MAX_AUDIO_BYTES) {
        throw new Error(
          `音频过大（上限 ${MAX_AUDIO_BYTES / 1024 / 1024}MB，约 ${MAX_AUDIO_BYTES / 1024 / 1024} 分钟 mp3），请截短后重试`,
        )
      }
      opts.onProgress?.(`${targetFile.name} 上传中`)
      // 对象不删除：云函数在后续请求中会来拉取，交给 maintenance 按保留期清理
      const uploaded = await uploadDeepMediaFile(targetFile, userId)
      mediaParts.push({
        type: 'input_audio',
        input_audio: { url: uploaded.url, format: audioFormatOf(targetFile) },
      })
    } catch (e) {
      errors.push(`【${file.name}】媒体处理失败：${(e as Error)?.message || '未知错误'}`)
    }
  }

  return {
    images,
    mediaParts,
    extraPrompt: errors.length > 0 ? `【用户上传的媒体处理说明】\n${errors.join('\n')}` : '',
  }
}

/** 允许的视频容器（与 deepMediaUpload 的白名单一致） */
const VIDEO_ACCEPTED = /mp4|quicktime|webm|video\//i

/**
 * 单段音频源文件上限 10MB。
 *
 * 依据（均为实测，不是估算）：
 *   · MiMo 侧能处理 8.53MB mp3（11.9M 字符 base64，44 秒出结果）
 *   · 云函数侧下载上限 10MB（MIMO_CHAT_MAX_AUDIO_BYTES），base64 后在 128MB 内存内
 *   · 128kbps mp3 约 1MB/分钟，故 ≈10 分钟；纯语音用 32kbps 可达 40 分钟
 *
 * 超过则请用户截短——不做服务端切片（切片需要 ffmpeg 容器，成本与收益不划算）。
 */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/** MiMo input_audio.format 取值（实测支持 mp3/wav） */
function audioFormatOf(file: File): string {
  const mime = (file.type || '').toLowerCase()
  if (mime.includes('wav') || /\.wav$/i.test(file.name)) return 'wav'
  if (mime.includes('aac') || /\.aac$/i.test(file.name)) return 'aac'
  if (mime.includes('mp4') || mime.includes('m4a') || /\.(m4a|mp4)$/i.test(file.name)) return 'm4a'
  return 'mp3'
}
