/**
 * cloneDeep — 深拷贝纯 JSON 可序列化对象。
 *
 * 仅用于"已通过 Zod schema 校验的纯 JSON 数据"(AppData/Bookmark/SiblingGroup 等),
 * 这些对象不含 Date/CryptoKey/Map 等非 JSON 结构,故 JSON 法是安全且零依赖的。
 *
 * 对含 CryptoKey/Date 等非序列化结构的对象请勿用此函数,改用 structuredClone
 * 或手动拷贝。
 *
 * 优先使用结构化克隆（structuredClone），回退到 JSON 序列化，
 * 避免大量同步队列操作时的序列化开销。
 * 如果 structuredClone 失败（如遇到 reactive proxy），回退到 JSON。
 */
export function cloneDeep<T>(value: T): T {
  // structuredClone 在现代浏览器和 Node.js 17+ 中可用
  // 它比 JSON.parse(JSON.stringify()) 更快且支持更多类型
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // 回退：JSON 序列化（旧版环境兜底，或遇到不可克隆对象如 reactive proxy）
    }
  }
  // 回退：JSON 序列化
  return JSON.parse(JSON.stringify(value))
}
