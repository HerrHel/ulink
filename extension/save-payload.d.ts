// extension/save-payload.js 的类型声明，供 src/__tests__ named import 取类型。

export interface BuildBookmarkPayloadParams {
  url: string
  title?: string
  categoryId?: string
  parentId?: string | null
  notes?: string
  favIconUrl?: string
  userId?: string
  existingBookmarks?: Array<{ order?: number }>
  id?: string
}

export interface BookmarkPayloadRow {
  id: string
  user_id: string
  title: string
  url: string
  username: string
  password: string
  notes: string
  icon: string
  category_id: string
  parent_id: string | null

  order: number
  use_count: number
  attributes: Record<string, unknown>
  created_at_num: number
  updated_at_num: number
  pinned_at: null
  deleted_at: null
}

export function isSafeHttpUrl(url: string | null | undefined): boolean
export function extractHostname(url: string | null | undefined): string
export function normalizeUrlForMatch(url: string | null | undefined): string
export function newBookmarkId(uniqHint?: number | string): string
export function nextBookmarkOrder(existingBookmarks?: Array<{ order?: number }>): number
export function buildBookmarkPayload(params: BuildBookmarkPayloadParams): BookmarkPayloadRow

declare global {
  interface Window {
    LinkVaultSavePayload?: {
      isSafeHttpUrl: typeof isSafeHttpUrl
      extractHostname: typeof extractHostname
      normalizeUrlForMatch: typeof normalizeUrlForMatch
      newBookmarkId: typeof newBookmarkId
      nextBookmarkOrder: typeof nextBookmarkOrder
      buildBookmarkPayload: typeof buildBookmarkPayload
    }
  }
}
