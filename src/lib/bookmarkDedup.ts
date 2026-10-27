import type { Bookmark } from '../types.js'

/**
 * bookmarkDedup.ts — 书签 URL 去重与父子层级关系判定纯函数（从 composables/domain/useBookmark.ts 抽取）
 *
 * 包含：
 * 1. URL 后缀变体 / 完全重复判定
 * 2. 智能识别最匹配的父级书签（子网站 / 子页面识别）
 *
 * 无副作用、无 store / Vue 依赖，便于单测直测。
 */

/**
 * 从现有书签列表中智能检测最匹配的父级书签（子网站 / 子页面识别）
 *
 * 识别规则：
 * 1. 只有顶层书签（!b.parentId）且未软删除（!b.deletedAt）可作为父级候选
 * 2. 排除指定 ID（如当前编辑书签自身，避免自挂为父）
 * 3. 优先级 1（同主机名子路径）：如现有 https://github.com，新输入 https://github.com/vuejs/core；若有多个子路径，最长匹配前缀优先
 * 4. 优先级 2（子域名归属）：如现有 https://docker.com，新输入 https://docs.docker.com 或 https://hub.docker.com
 *
 * @param newUrlInput 用户输入的新书签 URL
 * @param bookmarks 现有全量书签列表
 * @param excludeId 排除的书签 ID
 */
export function findBestParentBookmark(
  newUrlInput: string,
  bookmarks: Bookmark[],
  excludeId?: string
): Bookmark | null {
  if (!newUrlInput || newUrlInput.trim().length < 4) return null
  let newUrl: URL
  try {
    const raw = newUrlInput.trim()
    newUrl = new URL(raw.startsWith('http') ? raw : 'https://' + raw)
  } catch {
    return null
  }

  const newHost = newUrl.hostname.toLowerCase()
  const newPath = newUrl.pathname.replace(/\/+$/, '')
  const newFull = newUrl.href

  // 顶层、未删除且非自身候选
  const candidates = bookmarks.filter(b => !b.parentId && !b.deletedAt && b.id !== excludeId)

  let bestParent: Bookmark | null = null
  let bestScore = 0

  for (const b of candidates) {
    if (!b.url) continue
    let existUrl: URL
    try {
      const raw = b.url.trim()
      existUrl = new URL(raw.startsWith('http') ? raw : 'https://' + raw)
    } catch {
      continue
    }

    const existHost = existUrl.hostname.toLowerCase()
    const existPath = existUrl.pathname.replace(/\/+$/, '')

    // 完全重复跳过（非父子关系）
    if (existUrl.href === newFull || (existHost === newHost && existPath === newPath && !newUrl.search && !newUrl.hash)) {
      continue
    }

    let score = 0

    // 1. 同主机名下的子路径关系（最强关系）
    if (existHost === newHost) {
      if (!existPath || existPath === '') {
        if (newPath && newPath !== '') {
          score = 100
        }
      } else if (newPath.startsWith(existPath)) {
        const nextChar = newPath.slice(existPath.length).charAt(0)
        if (nextChar === '' || nextChar === '/') {
          score = 150 + existPath.length
        }
      }
    }

    // 2. 子域名与主站/根域名关系（例如 docs.docker.com -> docker.com）
    if (score === 0) {
      const cleanExistHost = existHost.replace(/^www\./, '')
      const cleanNewHost = newHost.replace(/^www\./, '')

      if (cleanNewHost !== cleanExistHost && cleanNewHost.endsWith('.' + cleanExistHost)) {
        if (!existPath || existPath === '') {
          score = 80
        }
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestParent = b
    }
  }

  return bestParent
}

/**
 * 检测两个URL是否是后缀变体关系
 * 例如：
 * - https://example.com 和 https://example.com/page
 * - https://example.com/ 和 https://example.com/page
 * 返回true表示newUrl是existingUrl的后缀变体
 */
export function isUrlSuffixVariant(existingUrl: string, newUrl: string): boolean {
  try {
    const existing = new URL(existingUrl)
    const newUrlObj = new URL(newUrl)

    // 域名必须相同
    if (existing.hostname !== newUrlObj.hostname) return false

    // 协议必须相同
    if (existing.protocol !== newUrlObj.protocol) return false

    // 获取路径（去除开头的斜杠）
    const existingPath = existing.pathname.replace(/^\//, '')
    const newPath = newUrlObj.pathname.replace(/^\//, '')

    // 如果existingPath为空或根路径，则newPath是它的后缀
    if (!existingPath || existingPath === '/') return true

    // newPath必须以existingPath开头（作为前缀）
    if (newPath.startsWith(existingPath)) {
      // 确保existingPath后面是斜杠或者是字符串结尾
      const rest = newPath.slice(existingPath.length)
      return rest === '' || rest.startsWith('/')
    }

    return false
  } catch {
    // URL解析失败，认为不是后缀变体
    return false
  }
}

/**
 * 检测是否有完全重复的URL
 * 返回true表示存在完全重复
 */
export function isExactDuplicate(existingUrl: string, newUrl: string): boolean {
  try {
    const existing = new URL(existingUrl)
    const newUrlObj = new URL(newUrl)

    // 完整比较：协议、主机名、路径、查询参数、哈希
    return existing.href === newUrlObj.href
  } catch {
    return false
  }
}
