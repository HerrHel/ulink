/**
 * useImageUpload — 组笔记图片上传编排
 *
 * 选图/拖拽/粘贴 → 前端压缩 → 上传 Storage → 光标处插入 <img>。
 * 依赖登录态（云端上传），未登录时提示。成功静默（图片出现在编辑器即反馈），失败弹 toast。
 */
import { compressImage, computeScale } from '../../lib/imageCompress.js'
import { uploadGroupImage } from '../../lib/imageStorage.js'
import { EditorManager } from '../../lib/editor.js'
import { _getUserId } from './useSyncHistory.js'
import { toast } from '../../lib/toast.js'

const IMAGE_TYPE_RE = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i

/** 图片初始显示尺寸：最长边限制，避免插入后过大（与编辑区 560px 上限一致） */
const INITIAL_MAX_EDGE = 560

/** 是否为可上传的图片文件 */
export function isImageFile(file: File | Blob): boolean {
  return IMAGE_TYPE_RE.test(file.type || '')
}

/** 单张图片：压缩 → 上传 → 插入编辑器光标处（带初始显示尺寸） */
export async function uploadAndInsertImage(gid: string, file: File | Blob): Promise<boolean> {
  const userId = _getUserId()
  if (!userId) {
    toast('上传图片需先登录云端账号', false)
    return false
  }
  if (!EditorManager.get(gid)) return false

  try {
    const { blob, name, width: srcW, height: srcH } = await compressImage(file)
    const url = await uploadGroupImage(userId, gid, blob, name)
    if (!url) {
      toast('图片上传失败，请稍后重试', false)
      return false
    }
    // 有原始尺寸时按最长边 560 计算初始显示尺寸（透传格式如 gif/svg 尺寸未知则不给初始尺寸）
    let w: number | undefined
    let h: number | undefined
    if (srcW > 0 && srcH > 0) {
      const s = computeScale(srcW, srcH, INITIAL_MAX_EDGE)
      w = s.width
      h = s.height
    }
    EditorManager.insertImage(gid, url, '', w, h)
    return true
  } catch (e) {
    console.warn('[image] upload failed:', e instanceof Error ? e.message : e)
    toast('图片上传失败', false)
    return false
  }
}

/** 批量上传（拖拽/粘贴多图），逐张插入；返回成功张数 */
export async function uploadAndInsertImages(gid: string, files: Array<File | Blob>): Promise<number> {
  let ok = 0
  for (const f of files) {
    if (!isImageFile(f)) continue
    if (await uploadAndInsertImage(gid, f)) ok += 1
  }
  if (ok > 1) toast(`已插入 ${ok} 张图片`)
  return ok
}
