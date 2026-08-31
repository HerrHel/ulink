/**
 * shareShadow.ts — 分享影子数据容器（零依赖模块）
 *
 * 背景：分享页从「独立页面」改为主应用内的只读态后，分享内容必须能被
 * 卡片组件读到，但绝不能成为访问者本地库的一部分。
 *
 * 为什么只维护 Map 而不注入 dataStore 的数组：
 *   dataStore 的 `bookmarks / siblingGroups / categories` 数组是
 *   `filteredBookmarks / filteredGroups / 搜索索引 / 侧栏计数 / 回收站 /
 *   云同步 diff / saveAppData` 的共同数据源。一旦把他人的数据 push 进去，
 *   访问一次分享链接就会：侧栏计数虚高、搜索能搜到别人的书签、
 *   落盘时把他人数据写进自己的 IndexedDB、自动同步时把它推上自己的云空间。
 *
 * 本模块只持有三张影子 Map，由 data.ts 的 `bookmarkMap / groupMap /
 * categoryMap` getter 在分享态下合并进返回值——卡片组件、内联卡片、
 * DetailPanel 能正常只读渲染，而任何「遍历数组」的路径天然看不到影子数据。
 *
 * 独立成文件的原因：data.ts 与 share.ts 都要用它，避免两店互相 import 成环。
 */
import type { Bookmark, Category, SiblingGroup } from '../types.js'

export interface ShadowData {
  bookmarks: Record<string, Bookmark>
  groups: Record<string, SiblingGroup>
  categories: Record<string, Category>
}

function emptyShadow(): ShadowData {
  return { bookmarks: {}, groups: {}, categories: {} }
}

/** 当前影子数据（空对象表示非分享态）。整体替换而非逐项改，保证引用稳定。 */
let _shadow: ShadowData = emptyShadow()

export function shadowData(): ShadowData {
  return _shadow
}

/** 整体设置影子数据（进入分享态时调用一次） */
export function shadowSet(next: ShadowData): void {
  _shadow = next
}

/** 清空影子数据（退出分享态 / fork 前调用） */
export function shadowClear(): void {
  _shadow = emptyShadow()
}

/** 影子数据是否非空（data.ts getter 据此决定要不要新建合并对象） */
export function shadowHasAny(): boolean {
  return (
    Object.keys(_shadow.bookmarks).length > 0 ||
    Object.keys(_shadow.groups).length > 0 ||
    Object.keys(_shadow.categories).length > 0
  )
}
