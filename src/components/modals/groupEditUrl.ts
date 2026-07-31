import { favicon, domain } from '../../utils.js'

// 编辑组模态框"内含书签"行项目两个用户可见 URL 文本/img-src 承载：
//   - faviconUrl(bm.url) → <img :src>：无自定义图标时的 favicon 图标 URL（第三方服务）
//   - domainName(bm.url) → <span>{{ }}：每行书签右侧展示的域名文本
// 从 GroupEditModal.vue 抽出为独立纯模块以便直接测试（与 extractHostname.ts /
// searchSuggestRender.ts / typeLabel.ts 同口径）。
//
// 关键护栏点（why 除薄包装外值得抽离）：两函数对入参加 `|| ''` 空安全防护——
// bm.url 经 Bookmark bookmarkMap 查表而来，理论上应恒为 string，但旧数据/导入/远端同步
// 残缺项理论上可能使其为 undefined/null。`|| ''` 把其归一成空串再交 utils/favicon/domain
// 处理，保证 favicon('') 返 ''（不产非法 img src）、domain('') 走 `new URL('')` catch 返 ''
// （不展示 'undefined' 文本）。若未来有人为"精简"内联掉 `|| ''` 直接调 favicon(bm.url)，
// favicon(undefined) 会经 domain(undefined) → `new URL(undefined)` 抛错被 catch 返 undefined
// → `dm ? '' : ''` 仍返 ''（favicon 兜底稳），但 domainName(undefined) 经 domain(undefined) catch
// 返 undefined 直接进 `<span>{{ undefined }}` 显示空、`<img :src="undefined">`——用户可见退化。
// 抽离 + 护栏把"调用点空安全防护不被误删"直锁为可回归断言。
export function faviconUrl(url: string): string {
  return favicon(url || '')
}

export function domainName(url: string): string {
  return domain(url || '')
}
