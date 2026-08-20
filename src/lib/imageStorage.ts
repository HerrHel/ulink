/**
 * imageStorage.ts — Supabase Storage 图片封装
 *
 * public bucket `group-images`，路径 `{userId}/{groupId}/{filename}`。
 * notes 里只存 public URL，不塞 base64；本模块提供上传/删除/路径提取/按组清理。
 * 所有操作前先判登录态，未登录（或未配置 Supabase）静默跳过，不抛错。
 */
import { supabase, isSupabaseConfigured } from './supabase.js'

export const GROUP_IMAGES_BUCKET = 'group-images'

/** 本 bucket 的 public URL 前缀（未配置 Supabase 时为空字符串） */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || ''
export const GROUP_IMAGES_PUBLIC_PREFIX = SUPABASE_URL + '/storage/v1/object/public/group-images/'

/** 匹配 public URL 中 bucket 后的对象路径（含中文/空格，取到引号/空白/闭合标签前） */
const PUBLIC_PATH_RE = /\/object\/public\/group-images\/([^"'\s>]+)/g

export function groupImagePath(userId: string, groupId: string, filename: string): string {
  return `${userId}/${groupId}/${filename}`
}

/** 由对象路径生成 public URL（仅在上传成功、有真实 client 时调用） */
export function publicImageUrl(path: string): string {
  return supabase.storage.from(GROUP_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
}

function genName(ext: string): string {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${rnd}.${ext}`
}

/** 上传图片对象，返回 public URL；失败返回 null */
export async function uploadGroupImage(
  userId: string,
  groupId: string,
  blob: Blob,
  filename: string,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  const path = groupImagePath(userId, groupId, filename)
  const { error } = await supabase.storage
    .from(GROUP_IMAGES_BUCKET)
    .upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false })
  if (error) {
    console.warn('[image] upload failed:', error.message)
    return null
  }
  return publicImageUrl(path)
}

/** 从 notes HTML 提取本 bucket 内的对象路径（用于删除清理） */
export function extractGroupImagePaths(notesHtml: string): string[] {
  if (!notesHtml) return []
  const out: string[] = []
  const re = new RegExp(PUBLIC_PATH_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(notesHtml)) !== null) {
    try { out.push(decodeURIComponent(m[1])) } catch { out.push(m[1]) }
  }
  return out
}

/** 删除一批对象（去重 + 过滤空） */
export async function deleteImagePaths(paths: string[]): Promise<void> {
  if (!isSupabaseConfigured) return
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return
  const { error } = await supabase.storage.from(GROUP_IMAGES_BUCKET).remove(unique)
  if (error) console.warn('[image] delete failed:', error.message)
}

/** 删除某个组目录下的全部对象（按前缀 list + remove） */
export async function deleteGroupImagePrefix(userId: string, groupId: string): Promise<void> {
  if (!isSupabaseConfigured) return
  const prefix = `${userId}/${groupId}/`
  const { data, error } = await supabase.storage.from(GROUP_IMAGES_BUCKET).list(prefix, { limit: 200 })
  if (error || !data) return
  const paths = data.map((f: { name: string }) => prefix + f.name)
  await deleteImagePaths(paths)
}

/** 当前登录用户 id；未登录返回 null */
async function getUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
}

/**
 * 组彻底删除时的云端图片清理（fire-and-forget）：
 * ① 按 notes 里引用到的对象路径删除（精确）② 再按 userId/groupId 前缀清空兜底。
 */
export async function cleanupGroupImagesOnDelete(groupId: string, notesHtml: string): Promise<void> {
  const userId = await getUserId()
  if (!userId) return
  await deleteImagePaths(extractGroupImagePaths(notesHtml))
  await deleteGroupImagePrefix(userId, groupId)
}

/** 生成新文件名（由压缩后的扩展名决定） */
export function newImageName(ext: string): string {
  return genName(ext)
}
