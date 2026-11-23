/**
 * 小宫格（图标启动器）渲染开关。
 *
 * 由 CardGrid 提供：仅当主网格处于 mini-grid 布局、且未走虚拟滚动（虚拟模式强制
 * list-view 行堆叠）、未聚焦单组时为 true。BookmarkCard / GroupCard 注入后切换为
 * 「图标 + 名字」的瓦片结构；辅助栏、详情抽屉等在 CardGrid 之外复用卡片的场景
 * 注入不到，保持原卡片样式。
 */
import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'

const TILE_LAYOUT_KEY: InjectionKey<ComputedRef<boolean>> = Symbol('tileLayout')
const FALSE = computed(() => false)

export function provideTileLayout(v: ComputedRef<boolean>): void {
  provide(TILE_LAYOUT_KEY, v)
}

export function useTileLayout(): ComputedRef<boolean> {
  return inject(TILE_LAYOUT_KEY, FALSE)
}

/** 字符串稳定哈希到色相（0-359），用于首字母兜底图标底色 */
export function tileHue(seed: string): number {
  let h = 0
  const s = (seed || '').toLowerCase().replace(/^www\./, '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}
