// 桥接：src/ 下的 .ts 文件 import functions/_lib/share-render.js 时，
// TypeScript 找不到对应 .js（functions/ 不在主 tsconfig 项目里）。
// vitest 用 vite-node 转译可直接解析 .ts；此处仅为 IDE/npm run typecheck 静态补齐。
declare module '*functions/_lib/share-render.js' {
  import type { Bookmark, SiblingGroup, Category } from '../../src/types.js'
  export type ShareLocale = 'zh-CN' | 'en-US'
  export function renderSharePage(
    group: SiblingGroup,
    bookmarks: Bookmark[],
    shareUrl: string,
    appOrigin: string,
    locale?: ShareLocale,
  ): string
  export function renderShareCategoryPage(
    category: Category,
    groups: SiblingGroup[],
    bookmarks: Bookmark[],
    shareId: string,
    shareUrl: string,
    appOrigin: string,
    locale?: ShareLocale,
  ): string
  export function renderNotFoundPage(locale?: ShareLocale): string
}