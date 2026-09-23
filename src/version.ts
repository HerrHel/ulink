/**
 * 构建时注入的版本信息。
 *
 * 由 vite.config.ts 的 define 注入：
 * - __APP_VERSION__ — package.json 的 version 字段（手动 bump）
 * - __BUILD_TIME__  — 构建时刻 ISO 串。每次部署必变，是确认「线上是否为最新构建」
 *   的最可靠信号（PWA/SW 缓存下客户端可能仍持旧构建，设置面板据此对比）。
 *
 * tsc 对 declare const 视为模块内声明（无运行时产物），运行时标识符由 vite define
 * 替换为字面量；vitest 复用 vite.config 的 define，测试环境同样可用。
 */
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.0'
export const BUILD_TIME: string = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '2026-09-23T00:00:00.000Z'
