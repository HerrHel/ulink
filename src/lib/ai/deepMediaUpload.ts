/**
 * deepMediaUpload.ts — 用户主动上传媒体（音频/视频/图片）到 CloudBase 私有存储，
 * 再交给 extract-video 的 deep_upload 通道做 ASR/OCR。
 *
 * 与平台解析的区别：不抓取任何第三方页面、不使用代理、不需要浏览器扩展；
 * 文件由用户主动选择，服务端处理完即删除（对象生命周期由调用方/worker 清理）。
 */
import { getCbStorage, isCloudBaseBackend, isCloudBaseConfigured } from '../cloudbase.js'

export type DeepUploadKind = 'audio' | 'video' | 'image'

export const DEEP_MEDIA_BUCKET = 'deep-media'
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface DeepUploadFile {
  kind: DeepUploadKind
  url: string
  title: string
  /** CloudBase 对象路径，处理完用于删除 */
  path: string
}

export function formatUploadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function detectUploadKind(file: File): DeepUploadKind | null {
  const mime = (file.type || '').toLowerCase()
  if (AUDIO_MIME.has(mime) || mime.startsWith('audio/')) return 'audio'
  if (VIDEO_MIME.has(mime) || mime.startsWith('video/')) return 'video'
  if (IMAGE_MIME.has(mime) || mime.startsWith('image/')) return 'image'
  return null
}

export function validateUploadFile(file: File): DeepUploadKind {
  const kind = detectUploadKind(file)
  if (!kind) throw new Error('仅支持音频（mp3/m4a/wav/aac）、视频（mp4/mov/webm）或图片（jpg/png/webp）')
  const limit = kind === 'audio' ? MAX_AUDIO_BYTES : kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (file.size > limit) {
    throw new Error(
      kind === 'audio' ? '音频不能超过 50MB' : kind === 'video' ? '视频不能超过 200MB' : '图片不能超过 10MB',
    )
  }
  if (file.size <= 0) throw new Error('文件为空')
  return kind
}

function safeName(name: string): string {
  return String(name || 'media')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 80)
}

/**
 * 上传用户文件到 deep-media bucket，返回公开 URL。
 * 调用方必须先登录；userId 用于 RLS 路径隔离（{userId}/deep/...）。
 */
export async function uploadDeepMediaFile(file: File, userId: string): Promise<DeepUploadFile> {
  if (!userId) throw new Error('请先登录后再上传')
  if (!isCloudBaseBackend() || !isCloudBaseConfigured) throw new Error('上传存储未配置')
  const kind = validateUploadFile(file)
  const st = getCbStorage(DEEP_MEDIA_BUCKET) as
    | { upload?: (path: string, body: File, opts?: Record<string, unknown>) => Promise<{ error?: unknown }>; getPublicUrl?: (path: string) => unknown }
    | null
  if (!st || typeof st.upload !== 'function') throw new Error('上传存储不可用')
  const path = `${userId}/deep/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(file.name)}`
  const { error } = await st.upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw new Error((error as Error)?.message || '上传失败')
  const pub: any = await Promise.resolve(st.getPublicUrl?.(path))
  const url = pub?.data?.publicUrl || pub?.data?.publicURL || ''
  if (!url) throw new Error('获取文件地址失败')
  return { kind, url, title: file.name, path }
}

/** 处理结束/失败后删除临时媒体对象（尽力而为，不阻塞结果展示） */
export async function deleteDeepMediaFile(path: string): Promise<void> {
  if (!path) return
  try {
    const st = getCbStorage(DEEP_MEDIA_BUCKET) as { remove?: (paths: string[]) => Promise<{ error?: unknown }> } | null
    if (st && typeof st.remove === 'function') await st.remove([path])
  } catch (_) {
    // 删除失败留给 bucket 生命周期兜底，不打扰用户
  }
}
