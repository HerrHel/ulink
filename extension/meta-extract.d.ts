// extension/meta-extract.js 的类型声明

export interface PageMetadata {
  title: string
  description: string
  keywords: string
  selection: string
  icon: string
}

export function extractPageMetadataFromDoc(
  doc: Document | null,
  win?: Window | null,
): PageMetadata

export function extractPageMetadataInTab(): PageMetadata

export function matchCategoryByKeywords(
  meta: Partial<PageMetadata> | null,
  categories: Array<{ id: string; name: string }>,
): string | null
