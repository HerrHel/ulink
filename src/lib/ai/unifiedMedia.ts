/**
 * unifiedMedia.ts — 统一媒体附件处理
 *
 * 用户从聊天输入框上传图片/视频/音频，入口只有一个；是否走多模态直读还是深度解析，
 * 由「用户的问题 + 文件类型」决定：
 *  - 图片 + 问“图里有什么/描述” → 压缩缩略图直接作为多模态消息发给模型；
 *  - 图片 + 问“网址/文字/OCR/识别” → 上传原图做 OCR（文字/网址更准），同时保留缩略图给模型；
 *  - 音频 → 上传后 ASR 转写，把转写文本注入对话；
 *  - 视频 → 上传后 ASR（默认）+ 用户要求画面网址时做 OCR。
 *
 * 处理失败会写入明确的错误段落，不伪造结果；临时对象处理完即删除。
 */
import type { AttachedMediaFile } from './attachmentHelper.js'
import { getRawAttachedFile } from './attachmentHelper.js'
import { deleteDeepMediaFile, uploadDeepMediaFile } from './deepMediaUpload.js'
import { pollDeepVideo, submitDeepUpload, type DeepVideoResult } from './deepVideoExtract.js'

export interface MediaIntent {
  wantsTranscript: boolean
  wantsOcr: boolean
}

export interface UnifiedMediaResult {
  /** 直接发给模型的多模态图片（data URL） */
  images: string[]
  /** 注入 prompt 的解析文本（转写/OCR 结果/错误说明） */
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

function resultText(result: DeepVideoResult | undefined): string {
  if (!result) return ''
  const lines: string[] = []
  if (result.title) lines.push(`媒体：${result.title}`)
  const transcript = (result.transcript?.text || '').trim()
  if (transcript) lines.push(`口播转写（可能有个别错字）：\n${transcript.slice(0, 12000)}`)
  const urls = Array.isArray(result.on_screen_urls) ? result.on_screen_urls : []
  if (urls.length > 0) {
    lines.push(`画面/图片中识别到的网址：\n${urls.slice(0, 30).map((u) => `- ${u.url}`).join('\n')}`)
  }
  if (result.degraded) lines.push('（本次结果有降级：可能缺少时间轴或部分媒体未处理）')
  return lines.join('\n\n')
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
  if (mediaFiles.length === 0) return { images: [], extraPrompt: '' }
  const intent = detectMediaIntent(userText)
  const images = mediaFiles
    .filter((f) => f.type === 'image' && typeof f.dataUrl === 'string' && f.dataUrl)
    .map((f) => f.dataUrl as string)
    .slice(0, 4)
  const sections: string[] = []

  for (const file of mediaFiles) {
    if (file.type === 'image' && !intent.wantsOcr) continue
    if (file.type !== 'image' && !intent.wantsTranscript && !intent.wantsOcr) {
      // 音视频至少做口播转写，否则模型只能看到文件名
      intent.wantsTranscript = true
    }
    opts.onProgress?.(file.name)
    let objectPath = ''
    try {
      if (!userId) throw new Error('需要登录后才能解析媒体文件')
      const rawFile = getRawAttachedFile(file.id)
      if (!rawFile) throw new Error('原始文件不可用，请重新上传')
      const uploaded = await uploadDeepMediaFile(rawFile, userId)
      objectPath = uploaded.path
      const includeOcr = file.type === 'image' ? true : intent.wantsOcr
      const includeTranscript = file.type === 'audio' ? true : intent.wantsTranscript
      const job = await submitDeepUpload(
        { kind: uploaded.kind, url: uploaded.url, title: uploaded.title },
        { signal: opts.signal, include: { transcript: includeTranscript, ocr: includeOcr } },
      )
      const final = await pollDeepVideo(job.job_id, {
        signal: opts.signal,
        onProgress: (stage, progress) => {
          opts.onProgress?.(`${file.name} ${Math.round(progress * 100)}%${stage ? ` · ${stage}` : ''}`)
        },
      })
      if (final.status === 'failed') {
        const err = final.error
        throw new Error(`${err?.code || 'failed'}${err?.message ? `：${err.message}` : ''}`)
      }
      const text = resultText(final.result)
      if (text) sections.push(`【${file.name}】\n${text}`)
    } catch (e) {
      sections.push(`【${file.name}】媒体解析失败：${(e as Error)?.message || '未知错误'}`)
    } finally {
      if (objectPath) await deleteDeepMediaFile(objectPath)
    }
  }

  return {
    images,
    extraPrompt: sections.length > 0 ? `【用户上传的媒体解析结果】\n${sections.join('\n\n')}` : '',
  }
}
