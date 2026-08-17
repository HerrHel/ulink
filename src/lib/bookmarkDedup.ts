/**
 * bookmarkDedup.ts — 书签 URL 去重纯函数（从 composables/domain/useBookmark.ts 抽取）
 *
 * 仅含 URL 后缀变体 / 完全重复判定，无副作用、无 store / Vue 依赖，
 * 便于单测直测与 useBookmark.ts 瘦身（TECH_DEBT A 类：去重/规范化抽纯函数）。
 */

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
