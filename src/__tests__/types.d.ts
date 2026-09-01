// 桥接：src/ 下的 .ts 文件 import functions/_lib/share-render.js 时，
// TypeScript 找不到对应 .js（functions/ 不在主 tsconfig 项目里）。
// vitest 用 vite-node 转译可直接解析 .ts；此处仅为 IDE/npm run typecheck 静态补齐。
declare module '*functions/_lib/share-render.js' {
  import type { Bookmark, SiblingGroup, Category } from '../../src/types.js'
  export type ShareLocale = 'zh-CN' | 'en-US'
  export function extractAppAssets(indexHtml: string): string
  export function renderSharePage(
    group: SiblingGroup,
    bookmarks: Bookmark[],
    shareUrl: string,
    appOrigin: string,
    locale?: ShareLocale,
    appAssets?: string,
  ): string
  export function renderShareCategoryPage(
    category: Category,
    groups: SiblingGroup[],
    bookmarks: Bookmark[],
    shareId: string,
    shareUrl: string,
    appOrigin: string,
    locale?: ShareLocale,
    layout?: string,
    appAssets?: string,
  ): string
  export function renderNotFoundPage(locale?: ShareLocale): string
}

// 同上：functions/_lib/app-assets.js 的静态补齐（Cloudflare Pages Functions 共享模块）。
declare module '*functions/_lib/app-assets.js' {
  export interface AppAssetsEnv {
    ASSETS?: { fetch: (input: Request | string | URL) => Promise<Response> }
    APP_ORIGIN?: string
  }
  /** 读取主应用 index.html → 提取 SPA 资源标签；全部策略失败返回空串。 */
  export function getAppAssets(env: AppAssetsEnv, requestUrl: string): Promise<string>
}