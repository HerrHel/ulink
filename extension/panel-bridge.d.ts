// extension/panel-bridge.js 的类型声明

export interface PanelTabPayload {
  url: string
  title: string
  description: string
  selection: string
  icon: string
}

export type AppMessage =
  | { type: 'ready' }
  | { type: 'matched'; url: string; saved: boolean }

export const APP_ORIGIN: string
export const MSG_NS: string
export const MSG_VERSION: number

export function resolveAppOrigin(search: string | null | undefined): string
export function appPanelUrl(origin: string): string
export function buildTabPayload(
  tab: { url?: string; title?: string; favIconUrl?: string } | null | undefined,
  meta?: {
    title?: string
    description?: string
    selection?: string
    icon?: string
    videoTime?: string
    currentSubtitle?: string
  } | null,
): PanelTabPayload | null
export function toAppMessage(type: string, extra?: Record<string, unknown>): Record<string, unknown>
export function parseAppMessage(origin: string, data: unknown, appOrigin: string): AppMessage | null
export function sameUrl(a: string, b: string): boolean
