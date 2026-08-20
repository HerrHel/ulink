/**
 * useListNav — 列表键盘跨屏导航注入契约
 *
 * 背景：listCardKeyboard 原基于 DOM 可见卡片导航（listCardsInGrid 收集 #cardGrid 下
 * offsetParent 非空的 .card），虚拟滚动只渲染可见片段 → 键盘 ↑↓ 无法跨屏移动焦点。
 * 方案：CardGrid 通过 provide 暴露数据索引级导航（combinedList + useVirtualScroll.scrollToIndex），
 * 卡片组件在键盘处理时优先使用；非虚拟列表（全量 DOM）行为不变。
 */
import { provide, inject, ref, type InjectionKey, type Ref } from 'vue'

export interface ListNavTarget {
  type: 'bm' | 'group'
  id: string
}

export interface ListNav {
  /** 从 from 项向 delta 方向移动焦点（-1/1），返回是否已处理（越界/未找到返回 false） */
  navigate(from: ListNavTarget, delta: number): boolean
  /** 跳到列表首/尾 */
  navigateEdge(from: ListNavTarget, edge: 'start' | 'end'): boolean
}

export const LIST_NAV_KEY: InjectionKey<Ref<ListNav | null>> = Symbol('list-nav')

export function provideListNav(nav: Ref<ListNav | null>) {
  provide(LIST_NAV_KEY, nav)
}

export function useListNav(): Ref<ListNav | null> {
  return inject(LIST_NAV_KEY, ref(null))
}
