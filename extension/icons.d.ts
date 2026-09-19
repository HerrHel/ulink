// extension/icons.js 类型声明

export interface ExtensionIcons {
  sun: string
  moon: string
  refresh: string
  folder: string
  tag: string
  star: string
  code: string
  tool: string
  note: string
  edit: string
  trash: string
  link: string
  copy: string
  search: string
  close: string
  lock: string
  password: string
  eye: string
  history: string
  check: string
  zap: string
  bookmark: string
  emptyBookmark: string
  sync: string
}

export function getCategoryIcon(iconKey?: string): string

export const Icons: ExtensionIcons & { getCategoryIcon: typeof getCategoryIcon }

declare global {
  interface Window {
    LinkVaultIcons?: ExtensionIcons & { getCategoryIcon: typeof getCategoryIcon }
  }
}
