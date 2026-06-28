/**
 * bridge.ts — 模块级服务注册表
 *
 * 正在逐步移除，替代方案：Pinia Store。
 * 已移除：toastAPI → useToastStore
 * 待移除：ctxMenuAPI, actionSheetAPI, attrDropdownAPI, batchMoveAPI, mfbAPI, mentionAPI
 */

export interface ContextMenuAPI {
  show(e: MouseEvent, type: string, id: string): void
  hide(): void
}

export interface ActionSheetAPI {
  show(items: Array<{ label: string; action: () => void; danger?: boolean }>): void
  showCategoryPicker(bmId: string): void
  showGroupCategoryPicker(gid: string): void
}

export interface AttrDropdownAPI {
  toggle(): void
  close(): void
}

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

// --- Context Menu ---
export let ctxMenuAPI: ContextMenuAPI | null = null
export function setCtxMenuAPI(api: ContextMenuAPI | null) { ctxMenuAPI = api }

// --- Action Sheet ---
export let actionSheetAPI: ActionSheetAPI | null = null
export function setActionSheetAPI(api: ActionSheetAPI | null) { actionSheetAPI = api }

// --- Attr Dropdown ---
export let attrDropdownAPI: AttrDropdownAPI | null = null
export function setAttrDropdownAPI(api: AttrDropdownAPI | null) { attrDropdownAPI = api }

// --- Batch Move Popover ---
export let batchMoveAPI: BatchMoveAPI | null = null
export function setBatchMoveAPI(api: BatchMoveAPI | null) { batchMoveAPI = api }

// --- Mobile Format Bar ---
export let mfbAPI: MfbAPI | null = null
export function setMfbAPI(api: MfbAPI | null) { mfbAPI = api }
