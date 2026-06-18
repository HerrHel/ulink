declare module '../composables/bridge.js' {
  interface ToastAPI {
    toast(msg: string, ok?: boolean): void
    toastWithUndo(msg: string, undoFn: () => void, duration?: number): void
    showConfirm(msg: string, onConfirm: () => void): void
  }
  export const toastAPI: ToastAPI | null
  export function setToastAPI(api: ToastAPI): void
  export let mentionAPI: any
  export function setMentionAPI(api: any): void
  export let ctxMenuAPI: any
  export function setCtxMenuAPI(api: any): void
  export let actionSheetAPI: any
  export function setActionSheetAPI(api: any): void
  export let attrDropdownAPI: any
  export function setAttrDropdownAPI(api: any): void
  export let batchMoveAPI: any
  export function setBatchMoveAPI(api: any): void
  export let mfbAPI: any
  export function setMfbAPI(api: any): void
}
