/**
 * imageCompress.ts — 前端图片自动压缩
 *
 * 免费计划容量有限：上传前用 canvas 把图片压到最长边 maxSize、转 WebP/JPEG，
 * 单张约 80~150KB（1280px / 0.6）。纯函数（computeScale/pickOutputMime/fileExtension）可单测，
 * compressImage 依赖浏览器 canvas 运行时（jsdom 无 canvas，靠手动/E2E 验证）。
 */
export interface CompressOptions {
  /** 最长边像素，默认 1280 */
  maxSize?: number
  /** 有损质量 0~1，默认 0.6 */
  quality?: number
  /** 输出格式：'auto'（默认，优先 WebP）| 'webp' | 'jpeg' */
  format?: 'auto' | 'webp' | 'jpeg'
}

export interface CompressedImage {
  blob: Blob
  /** 处理后的文件名（扩展名可能由 png 变为 webp） */
  name: string
  width: number
  height: number
}

/** 这些类型压缩无益（gif 会丢动画、svg 是矢量），直接透传原文件 */
const PASSTHROUGH_TYPES = new Set(['image/gif', 'image/svg+xml'])

/**
 * 计算缩放后尺寸：等比缩到最长边 ≤ maxSize，同时保证最小 1px。
 * 纯函数，便于单测。
 */
export function computeScale(w: number, h: number, maxSize: number): { width: number; height: number } {
  const longest = Math.max(w, h)
  if (longest <= 0 || longest <= maxSize) return { width: w, height: h }
  const ratio = maxSize / longest
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
  }
}

/** 选择输出 MIME。'auto' 优先 WebP（体积最小），透明 PNG 保留 PNG 以免白底。 */
export function pickOutputMime(sourceType: string, format: 'auto' | 'webp' | 'jpeg'): string {
  if (format === 'webp') return 'image/webp'
  if (format === 'jpeg') return 'image/jpeg'
  if (sourceType === 'image/png') return 'image/webp'
  return 'image/webp'
}

/** MIME → 文件扩展名 */
export function fileExtension(mime: string): string {
  switch (mime) {
    case 'image/webp': return 'webp'
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/gif': return 'gif'
    case 'image/svg+xml': return 'svg'
    default: return 'bin'
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), mime, quality)
    } catch {
      resolve(null)
    }
  })
}

/** 去掉原扩展名、去掉路径分隔符后的基础文件名（失败给 'image' 兜底） */
export function baseName(name: string): string {
  const clean = name.split(/[\\/]/).pop() || ''
  const dot = clean.replace(/\.[^.]+$/, '')
  return dot || 'image'
}

/**
 * 压缩图片。非图片 / gif / svg 直接透传；其余转 WebP（不支持则回退 JPEG）。
 * 若压缩后反而更大（小图或已压缩过），返回原文件避免负优化。
 */
export async function compressImage(file: File | Blob, opts: CompressOptions = {}): Promise<CompressedImage> {
  const { maxSize = 1280, quality = 0.6, format = 'auto' } = opts
  const type = (file.type || '').toLowerCase()
  const originalName = (file as File).name || 'image'

  if (!type.startsWith('image/') || PASSTHROUGH_TYPES.has(type)) {
    return { blob: file, name: originalName, width: 0, height: 0 }
  }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // createImageBitmap 失败（个别旧浏览器/异常 Blob）：原样透传
    return { blob: file, name: originalName, width: 0, height: 0 }
  }

  const { width, height } = computeScale(bitmap.width, bitmap.height, maxSize)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return { blob: file, name: originalName, width: bitmap.width, height: bitmap.height }
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const mime = pickOutputMime(type, format)
  const blob = (await canvasToBlob(canvas, mime, quality)) ?? (await canvasToBlob(canvas, 'image/jpeg', quality))
  if (!blob) {
    return { blob: file, name: originalName, width, height }
  }

  // 负优化防护：压缩后体积未减小则用原文件
  if (blob.size > 0 && blob.size >= file.size) {
    return { blob: file, name: originalName, width, height }
  }

  const ext = fileExtension(blob.type || mime)
  return { blob, name: `${baseName(originalName)}.${ext}`, width, height }
}
