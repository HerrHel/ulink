// extension/pwa-open.js 的类型声明。背景 SW 经 ES module import 引入此纯函数，
// .js 在 src/ 外不被 tsc 直接解析，需 .d.ts 供 src/__tests__ named import 取类型。
// 与 src 内 .ts 类型（DecideOpenPwaResult）解耦：此声明独立刻画扩展侧决策契约。

export interface DecideOpenPwaResult {
  shouldOpen: boolean
  reason: string | null
  targetUrl: string | null
}

export function decideOpenPwa(
  url: string | null,
  title: string | null,
  notes: string | null,
  pwaUrl: string,
): DecideOpenPwaResult
