/**
 * bridge.ts — 模块级服务注册表
 *
 * 为什么用模块级单例而非 provide/inject？
 * ─────────────────────────────────────────
 * 本项目中多个 API 引用来自 composable 模块级代码（非 Vue 组件 setup 上下文），
 * 例如 toast.js、useUndo.js、useKeyboardOps.js 等。provide/inject 仅在组件 setup 中可用，
 * 无法满足这些模块的调用需求。因此模块级单例是当前架构下的正确选择。
 *
 * 注册方（Vue 组件 onMounted）：  ToastContainer、ContextMenu、ActionSheet、...
 * 消费方（composable / 组件）：   toast.js、useUndo.js、App.vue、...
 */

export interface ToastAPI {
  toast(msg: string, ok?: boolean): void
  toastWithUndo(msg: string, undoFn: () => void, duration?: number): void
  showConfirm(msg: string, onConfirm: () => void): void
}

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

// --- Toast / Confirm ---
export let toastAPI: ToastAPI | null = null
export function setToastAPI(api: ToastAPI | null) { toastAPI = api }

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
