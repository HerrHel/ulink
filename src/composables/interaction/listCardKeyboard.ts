/**
 * 列表模式（桌面）卡片键盘导航共享逻辑
 *
 * 键位与鼠标分区一致：
 * - Enter → 主操作（打开书签 / 聚焦组）
 * - Space → 打开右侧详情（等同空白单击）
 * - → / ← → 展开 / 收起
 * - ↑ / ↓ / Home / End → 在可见卡片间移动焦点
 */

export type ListCardKeyAction =
  | { type: 'primary' }
  | { type: 'detail' }
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'toggleExpand' }
  | { type: 'none' }

/** 从卡片根节点收集同列表内可聚焦卡片（含虚拟滚动可见项） */
export function listCardsInGrid(from: HTMLElement | null): HTMLElement[] {
  if (!from) return []
  const grid = from.closest('#cardGrid, .card-grid')
  if (!grid) return []
  return Array.from(grid.querySelectorAll<HTMLElement>('.card[role="listitem"]'))
    .filter(el => !el.classList.contains('group-card-focus') && el.offsetParent !== null)
}

export function focusAdjacentListCard(current: HTMLElement | null, delta: number): boolean {
  const cards = listCardsInGrid(current)
  if (!current || !cards.length) return false
  const idx = cards.indexOf(current)
  if (idx < 0) return false
  let next = idx + delta
  if (next < 0) next = 0
  if (next >= cards.length) next = cards.length - 1
  if (next === idx) return false
  const el = cards[next]
  el.focus({ preventScroll: false })
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  return true
}

export function focusEdgeListCard(current: HTMLElement | null, edge: 'start' | 'end'): boolean {
  const cards = listCardsInGrid(current)
  if (!cards.length) return false
  const el = edge === 'start' ? cards[0] : cards[cards.length - 1]
  if (el === current) return false
  el.focus({ preventScroll: false })
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  return true
}

/**
 * 解析列表卡片快捷键。事件已在卡片根上、且非内嵌控件时调用。
 * 返回需执行的动作；调用方负责 preventDefault。
 */
export function resolveListCardKey(
  e: KeyboardEvent,
  opts: { canExpand: boolean; expanded: boolean },
): ListCardKeyAction {
  if (e.ctrlKey || e.metaKey || e.altKey) return { type: 'none' }

  switch (e.key) {
    case 'Enter':
      return { type: 'primary' }
    case ' ':
    case 'Spacebar': // 旧 IE/部分环境
      return { type: 'detail' }
    case 'ArrowRight':
      if (!opts.canExpand) return { type: 'none' }
      return opts.expanded ? { type: 'none' } : { type: 'expand' }
    case 'ArrowLeft':
      if (!opts.canExpand) return { type: 'none' }
      return opts.expanded ? { type: 'collapse' } : { type: 'none' }
    case 'ArrowDown':
    case 'ArrowUp':
    case 'Home':
    case 'End':
      // 导航由调用方处理（需 DOM），此处仅标记由 resolve 外拦截
      return { type: 'none' }
    default:
      return { type: 'none' }
  }
}

/** 是否为内嵌可交互控件（避免抢按钮/输入的按键） */
export function isNestedInteractiveTarget(target: EventTarget | null, cardRoot: HTMLElement | null): boolean {
  const t = target as HTMLElement | null
  if (!t || !cardRoot) return false
  // 焦点在卡片根上时允许处理
  if (t === cardRoot) return false
  return !!t.closest('button, input, a, textarea, select, [contenteditable="true"]')
}

/**
 * 统一处理列表卡片 keydown：导航 + 返回业务动作。
 * 若已处理（含导航），会 preventDefault 并返回动作（导航时为 none）。
 */
export function handleListCardKeydown(
  e: KeyboardEvent,
  cardRoot: HTMLElement | null,
  opts: { canExpand: boolean; expanded: boolean },
): ListCardKeyAction {
  if (isNestedInteractiveTarget(e.target, cardRoot)) return { type: 'none' }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusAdjacentListCard(cardRoot, 1)
    return { type: 'none' }
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusAdjacentListCard(cardRoot, -1)
    return { type: 'none' }
  }
  if (e.key === 'Home') {
    e.preventDefault()
    focusEdgeListCard(cardRoot, 'start')
    return { type: 'none' }
  }
  if (e.key === 'End') {
    e.preventDefault()
    focusEdgeListCard(cardRoot, 'end')
    return { type: 'none' }
  }

  const action = resolveListCardKey(e, opts)
  if (action.type !== 'none') e.preventDefault()
  return action
}
