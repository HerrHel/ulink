/**
 * dragHint — 拖拽落点语义文案（纯函数，可单测）
 *
 * 从 useDragDrop 抽出：只读 payload + target 类名/属性，不触 DOM 写。
 */

export interface DragHintPayload {
  type: 'bm' | 'group' | 'detail' | 'cat'
  id: string
  srcGid?: string | null
}

/** 根据当前悬停目标与拖拽载荷返回中文提示；无意义落点返回空串 */
export function getDragHintText(
  target: Element,
  payload: DragHintPayload | null,
): string {
  if (!payload) return ''
  if (target.classList.contains('group-body')) {
    if (payload.type === 'detail') return ''
    const gid = (target as HTMLElement).dataset.gid
    if (payload.type === 'group' && payload.id.slice(6) === gid) return ''
    return payload.type === 'group' ? '嵌入为笔记引用' : '嵌入为内联卡片'
  }
  if (target.classList.contains('group-card-head')) {
    if (payload.type === 'detail') return ''
    return payload.type === 'group' ? '交换笔记位置' : '将书签排序到此笔记'
  }
  if (target.classList.contains('detail-card-wrap')) return '移到此位置'
  if (target.closest('#edgeStagingSidebar, .edge-staging-drop-zone, #stagingDock')) {
    if (payload.srcGid === '__detail__' || payload.type === 'detail') return ''
    return '加入暂存'
  }
  if (target.closest('#detailPanel, #btnToggleDetail')) {
    if (payload.type === 'group') return '由 AI 读取笔记'
    if (payload.type === 'bm') return '由 AI 读取书签'
    return '由 AI 读取此卡片'
  }
  if (target.classList.contains('rail-item')) return '移动到分类'
  if (target.classList.contains('group-card')) {
    if (payload.type === 'detail') return ''
    const gid = (target as HTMLElement).dataset.groupId
    if (payload.type === 'group' && payload.id.slice(6) === gid) return ''
    if (payload.type === 'bm') return '移动书签到笔记'
    if (payload.type === 'group') return '嵌入为笔记引用'
    return ''
  }
  if (target.classList.contains('card') && !target.classList.contains('group-card')) {
    return (payload.srcGid && payload.srcGid !== '__detail__') ? '移出笔记' : '交换排序'
  }
  if (payload.srcGid === '__detail__' && target.closest('#cardGrid, #panelContent, .panel-main-inner, .panel-main')) return '移出暂存'
  if (payload.type === 'detail' && target.closest('#cardGrid, #panelContent, .panel-main-inner, .panel-main')) return '移出暂存'
  // 拖到空白区域：仅当源卡片在组内时提示移出笔记
  if (payload.srcGid && payload.srcGid !== '__detail__' && target.closest('#cardGrid')) return '移出笔记'
  return ''
}
