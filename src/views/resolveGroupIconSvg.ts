/**
 * 分享组图标白名单解析（D2-006 / M5 安全护栏）。
 *
 * 跨用户公开分享组（fetchPublicGroup 远端 RLS 数据）的 group.icon 不可信——
 * 可能是追踪像素 URL、任意字符串、或原型链危险键（如 'constructor'/'__proto__'）。
 * ShareView.vue 用 `v-html="groupIconSvg"` 把返回值直接注入 DOM，本函数是这条
 * 注入路径的唯一白名单防线：仅当 icon 是 icons.ts 已知自有键时才返对应静态 SVG，
 * 任意未知字符串（含原型链属性）一律返空串——绝不把任意串当作 SVG 键回落到 I.star，
 * 否则分享页会渲染跨用户注入内容（追踪像素 / 意外对象字符串化）。
 *
 * 抽到独立纯模块（同 buildShareEntries.ts 口径）仅为可直接单测护栏，逻辑逐字保留
 * 原内联 computed 的白名单判定，零行为变化。
 */
export function resolveGroupIconSvg(
  icon: string | undefined,
  knownIcons: Record<string, string>,
): string {
  // 空/未定义图标不渲染
  if (!icon) return ''
  // 仅匹配已知自有键；未知字符串 / 原型链属性（toString / constructor / __proto__ 等）
  // 不命中 hasOwnProperty，一律返空——不当作 SVG 键回落 star
  return Object.prototype.hasOwnProperty.call(knownIcons, icon)
    ? knownIcons[icon]
    : ''
}
