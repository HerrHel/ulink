/**
 * attachmentHelper.ts — AI 对话附件（图片、视频、文件）处理与格式化工具
 *
 * 赋予 AI 对话框完整的多模态附件支持：
 * 1. 结构化解析 File 对象为轻量可持久化实体（AttachedMediaFile）
 * 2. 图片自动缩略并转 DataURL 供前端气泡渲染预览
 * 3. 文本/代码/数据文件在端侧快速提取正文内容（截断安全保护）
 * 4. 视频与大文件提取文件名、MIME 类型、格式化尺寸等元数据
 * 5. 将附件结构化内嵌至向 LLM 发送的 Prompt 中
 */

import { t } from '../../i18n/index.js'

export interface AttachedMediaFile {
  id: string
  name: string
  type: 'image' | 'video' | 'audio' | 'file'
  mimeType: string
  size: number
  sizeFormatted: string
  durationSec?: number // 媒体时长（秒）
  dataUrl?: string // 图片压缩缩略图 / 预览 DataURL
  textContent?: string // 文本/代码/数据类文件的提取正文
}

/** 视频直连 MiMo 的单次最长安全秒数（超过容易导致云函数 120s 超时） */
export const MAX_DIRECT_VIDEO_DURATION_SEC = 60

/** 原始 File 只驻留内存，不随会话序列化（避免把二进制写进 localStorage/IDB） */
const rawFileStore = new Map<string, File>()

export function getRawAttachedFile(id: string): File | undefined {
  return rawFileStore.get(id)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * 将 File 对象解析为适合 AI 对话上下文的 AttachedMediaFile 结构
 */
export async function processFileForAi(file: File): Promise<AttachedMediaFile> {
  const id = 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
  rawFileStore.set(id, file)
  if (rawFileStore.size > 40) {
    const first = rawFileStore.keys().next().value
    if (first) rawFileStore.delete(first)
  }
  const size = file.size
  const sizeFormatted = formatFileSize(size)
  const mimeType = file.type || 'application/octet-stream'

  let type: 'image' | 'video' | 'audio' | 'file' = 'file'
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'gif']
  const videoExts = ['mp4', 'mov', 'webm', 'm4v']
  const audioExts = ['mp3', 'm4a', 'wav', 'aac', 'ogg']
  if (mimeType.startsWith('image/') || imageExts.includes(ext)) {
    type = 'image'
  } else if (mimeType.startsWith('video/') || videoExts.includes(ext)) {
    type = 'video'
  } else if (mimeType.startsWith('audio/') || audioExts.includes(ext)) {
    type = 'audio'
  }

  let dataUrl: string | undefined
  let textContent: string | undefined
  let durationSec: number | undefined

  if (type === 'video') {
    try {
      const dur = await readVideoDuration(file)
      if (dur > 0) {
        durationSec = dur
        if (dur > MAX_DIRECT_VIDEO_DURATION_SEC) {
          const rounded = Math.round(dur)
          throw new Error(
            t('ai.videoTooLong', { max: MAX_DIRECT_VIDEO_DURATION_SEC, sec: rounded }) ||
              `视频时长超过 ${MAX_DIRECT_VIDEO_DURATION_SEC} 秒（当前 ${rounded} 秒），为保障响应速度请截短后上传`,
          )
        }
      }
    } catch (err) {
      // 若是超过上限的主动抛错，继续向上抛出阻断上传；其他探测异常则忽略兜底
      if (err instanceof Error && err.message.includes(String(MAX_DIRECT_VIDEO_DURATION_SEC))) {
        throw err
      }
    }
  } else if (type === 'image') {
    // 异步生成缩略图（640px / q0.72，单张约 40~60KB；既有 localStorage 考虑，也受网关入站上限约束）
    try {
      dataUrl = await createImageThumbnail(file)
    } catch {
      // 容错兜底
    }
  } else if (type === 'file') {
    const isText =
      mimeType.startsWith('text/') ||
      /\.(txt|md|markdown|json|js|ts|jsx|tsx|html|css|scss|vue|xml|yaml|yml|csv|log|ini|env|sh|py|sql)$/i.test(file.name)
    if (isText && size < 5 * 1024 * 1024) {
      try {
        const fullText = await readFileAsText(file)
        textContent = fullText.slice(0, 15000)
      } catch {
        // 容错兜底
      }
    }
  }

  return {
    id,
    name: file.name,
    type,
    mimeType,
    size,
    sizeFormatted,
    durationSec,
    dataUrl,
    textContent,
  }
}

/**
 * 探测视频时长（秒）。
 *
 * 坑点处理：
 * 1. URL.revokeObjectURL 必须在所有分支调用，防止 File 对象常驻内存。
 * 2. 部分安卓浏览器 preload=metadata 不触发 loadedmetadata，设置超时兜底返回 0（不阻断上传）。
 * 3. WebM 常见 duration = Infinity（未写头索引），seek 到远端大值迫使其触发 ondurationchange 计算真实时长。
 */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return resolve(0)
    }

    let settled = false
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'

    const done = (d: number) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        try {
          URL.revokeObjectURL(url)
        } catch {
          // 容错释放
        }
        resolve(Number.isFinite(d) && d > 0 ? d : 0)
      }
    }

    // 300ms 超时兜底（交接文档标准：部分安卓浏览器 preload=metadata 不触发事件时不阻断）
    const timer = setTimeout(() => done(0), 300)

    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        done(v.duration)
      } else if (v.duration === Infinity) {
        // WebM 未索引视频，跳到极大值强制触发底层索引计算
        v.currentTime = 1e101
      } else {
        done(0)
      }
    }

    v.ondurationchange = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        done(v.duration)
      }
    }

    v.onerror = () => done(0)
    v.src = url
  })
}
/**
 * 压缩图片生成轻量 DataURL 缩略图。
 *
 * 默认 640px / 0.72：图片以 base64 直接进请求体，而 CloudBase HTTP 访问服务
 * 入站 body 上限约 512KB（2026-11-03 实测 511KB 通过、1023KB 返回 430）。
 * 4 张 640px/q0.72 的 JPEG 约 220KB，base64 后约 300KB，留足余量。
 * 原来 800px/q0.8 时 4 张可达 600KB 以上，会被网关直接拒收。
 */
export function createImageThumbnail(file: File, maxDim = 640, quality = 0.72): Promise<string> {
  return new Promise((resolve) => {
    if (typeof FileReader === 'undefined') {
      return resolve('')
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      if (!src) return resolve('')

      if (typeof Image === 'undefined' || typeof document === 'undefined') {
        return resolve(src.slice(0, 100000))
      }

      const testCanvas = document.createElement('canvas')
      const ctx2d = testCanvas.getContext ? testCanvas.getContext('2d') : null
      if (!ctx2d) {
        return resolve(src.slice(0, 100000))
      }

      let settled = false
      const done = (val: string) => {
        if (!settled) {
          settled = true
          resolve(val)
        }
      }

      const timer = setTimeout(() => done(src.slice(0, 100000)), 500)

      const img = new Image()
      img.onload = () => {
        clearTimeout(timer)
        try {
          let w = img.width
          let h = img.height
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w)
              w = maxDim
            } else {
              w = Math.round((w * maxDim) / h)
              h = maxDim
            }
          }
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h)
            done(canvas.toDataURL('image/jpeg', quality))
          } else {
            done(src.slice(0, 100000))
          }
        } catch {
          done(src.slice(0, 100000))
        }
      }
      img.onerror = () => {
        clearTimeout(timer)
        done(src.slice(0, 100000))
      }
      img.src = src
    }
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') return resolve('')
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string) || '')
    reader.onerror = reject
    reader.readAsText(file)
  })
}

/**
 * 将附件列表转换为 Prompt 结构化上下文
 */
export function formatAttachedFilesForPrompt(files: AttachedMediaFile[], isZh: boolean): string {
  if (!files || files.length === 0) return ''
  const header = isZh ? '【用户上传的附件材料】：' : '[Attached User Files]:'
  const items = files
    .map((f, i) => {
      const typeLabel =
        f.type === 'image'
          ? isZh
            ? '图片'
            : 'Image'
          : f.type === 'video'
          ? isZh
            ? '视频'
            : 'Video'
          : f.type === 'audio'
            ? isZh
              ? '音频'
              : 'Audio'
            : isZh
              ? '文档/文件'
              : 'Document/File'

      let block = `${i + 1}. 【${f.name}】（${typeLabel}，${f.sizeFormatted}）`
      if (f.type === 'image') {
        block += isZh
          ? '\n   图片内容已随本条消息提供（多模态），请直接查看图片内容。'
          : '\n   The image content is attached to this message; inspect it directly.'
      }
      if (f.textContent) {
        block += `\n   文件正文提取内容如下：\n\`\`\`\n${f.textContent}\n\`\`\``
      }
      return block
    })
    .join('\n')
  return `${header}\n${items}`
}
