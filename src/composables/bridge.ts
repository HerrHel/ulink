/**
 * bridge.ts — 模块级服务注册表
 *
 * 正在逐步移除，替代方案：Pinia Store。
 * 已移除：toastAPI, ctxMenuAPI, actionSheetAPI, attrDropdownAPI
 * 待移除：batchMoveAPI, mfbAPI, mentionAPI
 */

export interface BatchMoveAPI {
  show(): void
  hide(): void
}

export interface MentionAPI {
  hide(): void
  init(): void
  destroy(): void
}

export interface MfbAPI {
  show(): void
  hide(): void
}

// --- Mention ---
export let mentionAPI: MentionAPI | null = null
export function setMentionAPI(api: MentionAPI | null) { mentionAPI = api }

// --- Batch Move Popover ---
export let batchMoveAPI: BatchMoveAPI | null = null
export function setBatchMoveAPI(api: BatchMoveAPI | null) { batchMoveAPI = api }

// --- Mobile Format Bar ---
export let mfbAPI: MfbAPI | null = null
export function setMfbAPI(api: MfbAPI | null) { mfbAPI = api }
