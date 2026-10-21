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

export interface AttachedMediaFile {
  id: string
  name: string
  type: 'image' | 'video' | 'file'
  mimeType: string
  size: number
  sizeFormatted: string
  dataUrl?: string // 图片压缩缩略图 / 预览 DataURL
  textContent?: string // 文本/代码/数据类文件的提取正文
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
  const size = file.size
  const sizeFormatted = formatFileSize(size)
  const mimeType = file.type || 'application/octet-stream'

  let type: 'image' | 'video' | 'file' = 'file'
  if (mimeType.startsWith('image/')) {
    type = 'image'
  } else if (mimeType.startsWith('video/')) {
    type = 'video'
  }

  let dataUrl: string | undefined
  let textContent: string | undefined

  if (type === 'image') {
    // 异步生成缩略图（限制最大边长 800px，压缩为 jpeg，体积通常仅 20~50KB，避免爆 localStorage）
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
    dataUrl,
    textContent,
  }
}

/**
 * 压缩图片生成轻量 DataURL 缩略图
 */
export function createImageThumbnail(file: File, maxDim = 800, quality = 0.8): Promise<string> {
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
          : isZh
          ? '文档/文件'
          : 'Document/File'

      let block = `${i + 1}. 【${f.name}】（${typeLabel}，${f.sizeFormatted}）`
      if (f.textContent) {
        block += `\n   文件正文提取内容如下：\n\`\`\`\n${f.textContent}\n\`\`\``
      }
      return block
    })
    .join('\n')
  return `${header}\n${items}`
}
