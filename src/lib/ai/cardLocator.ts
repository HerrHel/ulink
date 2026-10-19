/**
 * cardLocator.ts — 卡片与笔记跨分类双向高亮定位引擎
 *
 * 职责：
 * 1. 在主卡片网格中准确定位目标卡片/笔记（自动切换分类、解除组聚焦、移动端自动收起侧边栏等）；
 * 2. 触发平滑滚动（scrollIntoView），使目标卡片居中呈现在视野中央；
 * 3. 施加精准的呼吸微光高亮脉冲（.card-locate-pulse），建立视觉动线；
 * 4. 适配虚拟滚动与 DOM 异步挂载。
 */

import { nextTick } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { CAT_ALL } from '../../config/constants.js'

export interface LocateCardOptions {
  id: string
  type?: 'bookmark' | 'group'
  categoryId?: string
  smooth?: boolean
  collapseDetailOnMobile?: boolean
  pulseDurationMs?: number
}

export interface LocateCardResult {
  success: boolean
  targetId: string
  targetType: 'bookmark' | 'group'
  reason?: 'not_found' | 'deleted' | 'dom_missing'
  el?: HTMLElement
}

/**
 * 在主工作区网格中定位并高亮指定书签或笔记
 */
export async function locateAndHighlightCard(
  options: LocateCardOptions
): Promise<LocateCardResult> {
  const rawId = options.id.replace(/^group:/, '')
  let targetType: 'bookmark' | 'group' =
    options.type || (options.id.startsWith('group:') ? 'group' : 'bookmark')

  const ui = useUIStore()
  const ds = useDataStore()

  // 1. 查找实体并确定归属分类与存活状态
  let targetCatId = options.categoryId
  if (targetType === 'group' || (!options.type && ds.groupMap[rawId])) {
    targetType = 'group'
    const grp = ds.groupMap[rawId] || ds.siblingGroups.find((g) => g.id === rawId)
    if (!grp) {
      return { success: false, targetId: rawId, targetType, reason: 'not_found' }
    }
    if (grp.deletedAt) {
      return { success: false, targetId: rawId, targetType, reason: 'deleted' }
    }
    targetCatId = grp.categoryId
  } else {
    targetType = 'bookmark'
    const bm = ds.bookmarkMap[rawId] || ds.bookmarks.find((b) => b.id === rawId)
    if (!bm) {
      return { success: false, targetId: rawId, targetType, reason: 'not_found' }
    }
    if (bm.deletedAt) {
      return { success: false, targetId: rawId, targetType, reason: 'deleted' }
    }
    targetCatId = bm.categoryId
  }

  // 2. 状态对齐：若不在「全部分类」且目标不在当前分类，自动切分类
  if (targetCatId && ui.curCat !== CAT_ALL && ui.curCat !== targetCatId) {
    ui.curCat = targetCatId
  }

  // 3. 组聚焦状态对齐：若当前处于其他组聚焦态，解除聚焦以暴露全局网格
  if (ui.focusedGroupId) {
    if (targetType === 'group' && ui.focusedGroupId !== rawId) {
      ui.focusedGroupId = null
    } else if (targetType === 'bookmark') {
      const curGroup = ds.groupMap[ui.focusedGroupId]
      const isInCurGroup = curGroup?.bookmarkIds?.includes(rawId)
      if (!isInCurGroup) {
        ui.focusedGroupId = null
      }
    }
  }

  // 4. 移动端视野腾出：收起 AI / 详情抽屉
  if (options.collapseDetailOnMobile !== false && ui.isMobile) {
    ui.panels.detail = false
  }

  // 5. 等待 Vue 响应式 DOM 更新
  await nextTick()

  // 6. DOM 查询与定位（支持重试一次以兼容虚拟滚动或过渡）
  const queryDom = (): HTMLElement | null => {
    if (typeof document === 'undefined') return null
    if (targetType === 'group') {
      return (
        document.querySelector<HTMLElement>(
          `#cardGrid .group-card[data-group-id="${rawId}"], .card[data-group-id="${rawId}"], [data-group-id="${rawId}"]`
        ) || null
      )
    }
    return (
      document.querySelector<HTMLElement>(
        `#cardGrid .card[data-id="${rawId}"]:not(.group-card), .card[data-id="${rawId}"], [data-id="${rawId}"]`
      ) || null
    )
  }

  let el = queryDom()

  // 若首查未命中，给微任务延时再查一次（如分类切换过渡）
  if (!el && typeof window !== 'undefined') {
    await new Promise((resolve) => setTimeout(resolve, 80))
    el = queryDom()
  }

  // 若书签位于某个未展开/聚焦的笔记组内，尝试聚焦该笔记组
  if (!el && targetType === 'bookmark') {
    const parentGroup = ds.siblingGroups.find(
      (g) => !g.deletedAt && g.bookmarkIds?.includes(rawId)
    )
    if (parentGroup && ui.focusedGroupId !== parentGroup.id) {
      ui.focusedGroupId = parentGroup.id
      await nextTick()
      if (typeof window !== 'undefined') {
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      el = queryDom()
    }
  }

  if (!el) {
    return { success: false, targetId: rawId, targetType, reason: 'dom_missing' }
  }

  // 7. 视野平滑滚动居中
  try {
    el.scrollIntoView({
      behavior: options.smooth !== false ? 'smooth' : 'auto',
      block: 'center',
      inline: 'nearest',
    })
  } catch {
    // 兼容老旧浏览器不支持 scrollIntoView options
    el.scrollIntoView()
  }

  // 8. 触发呼吸微光高亮脉冲动画
  el.classList.remove('card-locate-pulse')
  // 强制回流以重置 CSS animation
  void el.offsetWidth
  el.classList.add('card-locate-pulse')

  // 若元素支持聚焦，聚焦以辅助读屏器与键盘无障碍
  if (typeof el.focus === 'function') {
    try {
      el.focus({ preventScroll: true })
    } catch {
      // 忽略部分元素不支持 preventScroll
    }
  }

  const duration = options.pulseDurationMs ?? 2000
  setTimeout(() => {
    el?.classList.remove('card-locate-pulse')
  }, duration)

  return { success: true, targetId: rawId, targetType, el }
}
