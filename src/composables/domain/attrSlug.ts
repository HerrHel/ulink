// 属性 id 规范化（slug）纯函数：把属性 name 规范化成稳定的 attribute id。
// 为 AttributeModal.onAddAttr（UI 层加属性入口）与 useAttrFilter.addAttrQuick（domain 层加属性入口）
// 共用的同一规则——两处必须共认同一 slug 链，否则跨路径 dedup 失效（同名属性 id 分叉致
// attributeMap 跨路径找不到/重复冲突）。抽离到独立纯模块统一真相源，逐字搬自两处原内联实现零行为变化。
// 注意：返回空串时调用方各自接 `|| gid()` 兜底（gid 是 nanoid 非确定，不在此纯函数内）。
export function attrSlug(name: string): string {
  return name.replace(/[\s]+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
}
