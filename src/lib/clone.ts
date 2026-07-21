/**
 * cloneDeep — 深拷贝纯 JSON 可序列化对象。
 *
 * 仅用于"已通过 Zod schema 校验的纯 JSON 数据"(AppData/Bookmark/SiblingGroup 等),
 * 这些对象不含 Date/CryptoKey/Map 等非 JSON 结构,故 JSON 法是安全且零依赖的。
 *
 * 对含 CryptoKey/Date 等非序列化结构的对象请勿用此函数,改用 structuredClone
 * 或手动拷贝。
 */
export function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
