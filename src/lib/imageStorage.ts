/**
 * imageStorage.ts — 组笔记图片存储封装（Supabase Storage / CloudBase pgstore 双后端）
 *
 * public bucket `group-images`，路径 `{userId}/{groupId}/{filename}`。
 * notes 里只存 public URL，不塞 base64；本模块提供上传/删除/路径提取/按组清理。
 * 所有操作前先判登录态，未登录（或后端未配置）静默跳过，不抛错。
 *
 * 双后端要点（2026-10-22 迁移）：
 * - CloudBase js-sdk 的 storage 刻意做成 Supabase 同形（upload(path, body, opts) →
 *   {data,error}、remove(paths)、list(prefix, opts)），故只换入口（storageFrom）。
 * - ⚠️ getPublicUrl 在 CloudBase 侧是 **async**（Supabase 侧同步）→ 统一 async 化。
 * - 公开 URL 形态两侧路径同构（`/object/public/group-images/<path>`，仅域名不同）
 *   → PUBLIC_PATH_RE 通用；白名单改为双前缀（存量笔记里的旧 Supabase URL 继续可读）。
 */
import { supabase, isSupabaseConfigured } from './supabase.js'
import { getCbStorage, getCbAuth, isCloudBaseBackend, isCloudBaseConfigured } from './cloudbase.js'

export const GROUP_IMAGES_BUCKET = 'group-images'

/** 本 bucket 的 public URL 前缀（双后端；未配置侧为空） */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || ''
export const GROUP_IMAGES_PUBLIC_PREFIX = SUPABASE_URL + '/storage/v1/object/public/group-images/'
/** CloudBase pgstore 公开前缀（实测形态；前端运行时按 envId 组装） */
export const CB_GROUP_IMAGES_PUBLIC_PREFIX = (() => {
  const envId = (import.meta.env.VITE_CLOUDBASE_ENV_ID as string | undefined) || ''
  return envId ? `https://${envId}.api.tcloudbasegateway.com/v1/storages/object/public/group-images/` : ''
})()

/** 双前缀白名单：存量笔记里的旧 Supabase URL 与新 CloudBase URL 均放行 */
export function isGroupImageUrl(src: string): boolean {
  return !!src && (src.startsWith(GROUP_IMAGES_PUBLIC_PREFIX) || (!!CB_GROUP_IMAGES_PUBLIC_PREFIX && src.startsWith(CB_GROUP_IMAGES_PUBLIC_PREFIX)))
}

/** 匹配 public URL 中 bucket 后的对象路径（两侧路径同构：/object/public/group-images/<path>） */
const PUBLIC_PATH_RE = /\/object\/public\/group-images\/([^"'\s>]+)/g

export function groupImagePath(userId: string, groupId: string, filename: string): string {
  return `${userId}/${groupId}/${filename}`
}

function storageFrom(): any | null {
  if (isCloudBaseBackend()) return isCloudBaseConfigured ? getCbStorage(GROUP_IMAGES_BUCKET) : null
  return isSupabaseConfigured ? supabase.storage.from(GROUP_IMAGES_BUCKET) : null
}

/** 由对象路径生成 public URL（仅在上传成功、有真实句柄时调用）；两侧统一 async */
export async function publicImageUrl(path: string): Promise<string> {
  const st = storageFrom()
  if (!st) return ''
  const res: any = await Promise.resolve(st.getPublicUrl(path))
  return res?.data?.publicUrl || ''
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
  const st = storageFrom()
  if (!st) return null
  const path = groupImagePath(userId, groupId, filename)
  const { error } = await st.upload(path, blob, {
    contentType: blob.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) {
    console.warn('[image] upload failed:', (error as Error).message)
    return null
  }
  return (await publicImageUrl(path)) || null
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
  const st = storageFrom()
  if (!st) return
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return
  const { error } = await st.remove(unique)
  if (error) console.warn('[image] delete failed:', (error as Error).message)
}

/** 删除某个组目录下的全部对象（按前缀 list + remove） */
export async function deleteGroupImagePrefix(userId: string, groupId: string): Promise<void> {
  const st = storageFrom()
  if (!st) return
  const prefix = `${userId}/${groupId}/`
  const res: any = await st.list(prefix, { limit: 200 }).catch(() => null)
  if (!res || res.error) return
  // Supabase 返回 {data: FileObject[]}；CloudBase neo 面可能包一层 items——两种形状都认
  const entries: Array<{ name: string }> = Array.isArray(res.data) ? res.data : (res.data?.items || res.items || [])
  const paths = entries.map((f: { name: string }) => prefix + f.name)
  await deleteImagePaths(paths)
}

/** 当前登录用户 id；未登录返回 null */
async function getUserId(): Promise<string | null> {
  const st = storageFrom()
  if (!st) return null
  try {
    if (isCloudBaseBackend()) {
      const auth = getCbAuth() as { getSession?: () => Promise<{ data?: { session?: { user?: { id?: string } } } }> } | null
      const res = await auth?.getSession?.()
      return res?.data?.session?.user?.id ?? null
    }
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
