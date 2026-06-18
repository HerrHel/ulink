/**
 * useDragDrop — 拖放交互
 * 管理卡片拖拽排序、拖入组、拖到详情面板等交互。
 * 从 drag.js 完整迁入。
 */
import { onMounted, onUnmounted } from 'vue'
import { PAYLOAD_KEY, DRAG_SRC_DETAIL, CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { swapOrder } from '../../utils.js'
import { toast } from '../../lib/toast.js'
import { saveGroupBody, syncGroupBookmarks, addToGroupDirect, addGroupRefToGroup, removeFromSrcGroup } from '../domain/useGroup.js'
import { inlineCardHTML, groupRefCardHTML } from '../useInlineCard.js'
import { openDetail } from '../ui/useUI.js'
import { useAppStore } from '../../stores/app.js'
import { EditorManager } from '../../lib/editor.js'

// ── 拖拽辅助 ──
function setDragImage(e) { const img = new Image(); img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; e.dataTransfer.setDragImage(img, 0, 0); }
function dragPayload(e) { try { return JSON.parse(e.dataTransfer.getData(PAYLOAD_KEY)); } catch (_) { return null; } }

// ── DOM 元素交换 ──
function swapCardsDOM(a, b) {
  const elA = typeof a === 'string' ? document.querySelector(a) : a
  const elB = typeof b === 'string' ? document.querySelector(b) : b
  if (!elA || !elB || elA === elB) return
  const parent = elA.parentNode
  const nextA = elA.nextSibling, nextB = elB.nextSibling
  if (nextA === elB) { parent.insertBefore(elB, elA) }
  else if (nextB === elA) { parent.insertBefore(elA, elB) }
  else { parent.insertBefore(elA, nextB); parent.insertBefore(elB, nextA) }
}

// Module-level drag state (not reactive, not in LV — transient drag operation state)
let _dragOverEl = null
let _catDragId = null
let _detailDragIdx = null
let _currentDragPayload = null

// 拖拽插入光标指示器
let _dragCursor = null
let _lastInsertPos = null // { gid, pos } — dragover 时缓存的插入位置
function _getDragCursor() {
  if (!_dragCursor) {
    _dragCursor = document.createElement('div')
    _dragCursor.className = 'drag-cursor'
    document.body.appendChild(_dragCursor)
  }
  return _dragCursor
}
function _showDragCursor(x, y) {
  const c = _getDragCursor()
  c.style.left = x + 'px'
  c.style.top = y + 'px'
  c.classList.add('visible')
}
function _hideDragCursor() {
  if (_dragCursor) { _dragCursor.remove(); _dragCursor = null; }
}
function _updateDragCursorForGroupBody(body, clientX, clientY) {
  const gid = body.dataset.gid
  if (!gid) { _hideDragCursor(); _lastInsertPos = null; return }
  const ed = EditorManager.get(gid)
  if (!ed) { _hideDragCursor(); _lastInsertPos = null; return }
  try {
    const coords = ed.view.posAtCoords({ left: clientX, top: clientY })
    if (coords) {
      const $pos = ed.state.doc.resolve(coords.pos)
      let insertPos = coords.pos
      if ($pos.depth > 0 && $pos.parentOffset === $pos.parent.content.size) {
        insertPos = Math.max(insertPos - 1, $pos.before(1))
      }
      _lastInsertPos = { gid, pos: insertPos }
      const cursorCoords = ed.view.coordsAtPos(insertPos)
      if (cursorCoords) {
        _showDragCursor(cursorCoords.left, (cursorCoords.top + cursorCoords.bottom) / 2 - 10)
        return
      }
    }
  } catch (_) { /* posAtCoords 失败时清除插入位置 */ }
  _lastInsertPos = null
  _hideDragCursor()
}

// Helpers: O(1) lookup via store getter
function _findBm(id) { return useAppStore().bookmarkMap[id] }
function _findGroup(id) { return useAppStore().groupMap[id] }

function _onDragStart(e) {
  const store = useAppStore()
  if (store.batchMode) { e.preventDefault(); return; }
  _currentDragPayload = null;
  const bmCard = e.target.closest('.card[data-id]:not(.group-card)');
  if (bmCard) {
    let id = bmCard.dataset.id;
    let gc = bmCard.closest('.group-card');
    let srcGid = gc ? gc.dataset.groupId : null;
    _currentDragPayload = { type: 'bm', id: id, srcGid: srcGid };
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify(_currentDragPayload));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    bmCard.classList.add('dragging');
    return;
  }
  const inlineCard = e.target.closest('.group-inline-card[data-bm-id]');
  if (inlineCard) {
    const id = inlineCard.getAttribute('data-bm-id');
    const gc = inlineCard.closest('.group-card');
    let srcGid = gc ? gc.dataset.groupId : null;
    _currentDragPayload = { type: 'bm', id: id, srcGid: srcGid };
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify(_currentDragPayload));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    inlineCard.classList.add('dragging');
    return;
  }
  const gCard = e.target.closest('.group-card[data-group-id]');
  if (gCard) {
    const gid = gCard.dataset.groupId;
    const parentGc = gCard.parentElement ? gCard.parentElement.closest('.group-card') : null;
    const srcGid = parentGc ? parentGc.dataset.groupId : null;
    _currentDragPayload = { type: 'group', id: 'group:' + gid, srcGid: srcGid };
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify(_currentDragPayload));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    gCard.classList.add('dragging');
    return;
  }
  const dCard = e.target.closest('.detail-card[data-didx]');
  if (dCard) {
    _detailDragIdx = parseInt(dCard.dataset.didx);
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'detail', id: dCard.dataset.bmId, srcGid: DRAG_SRC_DETAIL }));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    dCard.classList.add('dragging');
    return;
  }
  const rItem = e.target.closest('.rail-item[draggable="true"]');
  if (rItem) {
    _catDragId = rItem.dataset.catId;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'cat', id: _catDragId }));
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
}

function _onDragEnd() { clearDragState(); }

function _onDragOver(e) {
  const target = e.target.closest('.card, .group-body, .group-card-head, .detail-card, .rail-item, #detailPanel, #cardGrid');
  if (target && target.classList.contains('group-card') && _currentDragPayload && _currentDragPayload.type === 'bm' && _currentDragPayload.srcGid === target.dataset.groupId) {
    e.preventDefault();
    const gBody = target.querySelector('.group-body');
    if (gBody) _updateDragCursorForGroupBody(gBody, e.clientX, e.clientY);
    else _hideDragCursor();
    return;
  }
  if (target !== _dragOverEl) {
    if (_dragOverEl) _dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over');
    _dragOverEl = target;
    if (target) {
      e.preventDefault();
      const cls = target.classList.contains('detail-card') ? 'detail-drag-over' : target.classList.contains('rail-item') ? 'rail-drag-over' : 'drag-over';
      target.classList.add(cls);
    }
  } else if (target) {
    e.preventDefault();
  }
  const gBody = target && target.classList.contains('group-body') ? target : (target && target.closest('.group-body'))
  if (gBody) {
    _updateDragCursorForGroupBody(gBody, e.clientX, e.clientY)
  } else {
    _hideDragCursor()
  }
}

function _onDrop(e) {
  if (_dragOverEl) { _dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over'); _dragOverEl = null; }
  _hideDragCursor();
  const p = dragPayload(e);
  if (!p) return;

  const gBody = e.target.closest('.group-body');
  if (gBody) { handleBodyDrop(e, gBody, p); return; }
  const gHead = e.target.closest('.group-card-head');
  if (gHead) { handleGroupHeadDrop(e, gHead, p); return; }
  const bmCard = e.target.closest('.card:not(.group-card)');
  if (bmCard) { handleBmCardDrop(e, bmCard, p); return; }
  const gCard = e.target.closest('.group-card');
  if (gCard) { handleGroupCardDrop(e, gCard, p); return; }
  const dCard = e.target.closest('.detail-card');
  if (dCard) { handleDetailCardDrop(e, dCard, p); return; }
  if (e.target.closest('#detailPanel')) { handleDetailPanelDrop(e, p); return; }
  if (e.target.closest('#cardGrid')) { handleGridDrop(e, p); return; }
  const rItem = e.target.closest('.rail-item');
  if (rItem) {
    if (p.type === 'bm') {
      handleBmToCatDrop(e, rItem, p);
    } else if (p.type === 'cat') {
      handleRailDrop(e, rItem);
    }
    return;
  }
}

function clearDragState() {
  document.querySelectorAll('.dragging').forEach(function (el) { el.classList.remove('dragging'); });
  if (_dragOverEl) { _dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over'); _dragOverEl = null; }
  _catDragId = null; _detailDragIdx = null; _currentDragPayload = null; _lastInsertPos = null;
  _hideDragCursor();
}

function handleBodyDrop(e, body, p) {
  e.preventDefault(); e.stopPropagation();
  body.classList.remove('drag-over');
  if (!p) return;
  const gid = body.dataset.gid;
  const store = useAppStore();

  if (p.type === 'group') {
    let refGid = p.id.slice(6);
    addGroupRefToGroup(refGid, gid, e.clientX, e.clientY);
    return;
  }
  if (p.type !== 'bm') return;

  const isRef = p.id && p.id.startsWith('ref:');

  if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL && p.srcGid !== gid) {
    removeFromSrcGroup(p.srcGid, p.id);
  }
  if (p.srcGid === DRAG_SRC_DETAIL) {
    const idx = store.detailCards.indexOf(p.id);
    if (idx >= 0) store.detailCards.splice(idx, 1);
  }

  if (p.srcGid === gid) {
    reorderInlineCard(gid, p.id, e.clientX, e.clientY);
    syncGroupBookmarks(gid);
  } else {
    if (isRef) {
      const src = _findGroup(p.id.slice(4))
      if (!src) return;
      EditorManager.insertAtCoords(gid, groupRefCardHTML(src), e.clientX, e.clientY);
      saveGroupBody(gid);
      store.save();
      toast('已移动组引用');
    } else {
      const sg = _findGroup(gid)
      const b = _findBm(p.id)
      if (!sg || !b) return;
      EditorManager.insertAtCoords(gid, inlineCardHTML(b), e.clientX, e.clientY);
      if (sg.bookmarkIds.indexOf(p.id) === -1) sg.bookmarkIds.push(p.id);
      saveGroupBody(gid);
      store.save();
      toast('已加入组');
    }
  }
}

function handleGroupHeadDrop(e, head, p) {
  e.preventDefault(); e.stopPropagation();
  head.classList.remove('drag-over');
  const gid = head.closest('.group-card').dataset.groupId;
  if (!gid) return;
  const store = useAppStore();
  if (p.type === 'group') {
    const srcGid = p.id.slice(6);
    if (srcGid === gid) return;
    const a = _findGroup(srcGid)
    const b = _findGroup(gid)
    if (a && b) { swapOrder(a, b); store.debouncedSave(); swapCardsDOM('.group-card[data-group-id="' + a.id + '"]', '.group-card[data-group-id="' + b.id + '"]'); }
  } else if (p.type === 'bm') {
    const bm = _findBm(p.id)
    const sg = _findGroup(gid)
    if (!bm || !sg) return;
    let dirty = false;
    if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL) { removeFromSrcGroup(p.srcGid, p.id); dirty = true; }
    if (p.srcGid === DRAG_SRC_DETAIL) { const di = store.detailCards.indexOf(p.id); if (di >= 0) store.detailCards.splice(di, 1); dirty = true; }
    swapOrder(bm, sg);
    store.debouncedSave();
    if (!dirty) { swapCardsDOM('.card[data-id="' + bm.id + '"]:not(.group-card)', '.group-card[data-group-id="' + sg.id + '"]'); }
  }
}

function handleBmCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('drag-over');
  const tid = card.dataset.id;
  if (p.id === tid) return;
  const store = useAppStore();

  if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL) {
    const onGroup = e.target.closest('.group-card');
    if (!onGroup || onGroup.dataset.groupId !== p.srcGid) {
      removeFromSrcGroup(p.srcGid, p.id);
      store.debouncedSave();
      toast('已移出组');
    }
  }

  if (p.type === 'group') {
    const sg = _findGroup(p.id.slice(6))
    const bm = _findBm(tid)
    if (sg && bm && !bm.parentId) { swapOrder(sg, bm); store.debouncedSave(); swapCardsDOM('.group-card[data-group-id="' + sg.id + '"]', '.card[data-id="' + bm.id + '"]:not(.group-card)'); }
    return;
  }

  const a = _findBm(p.id)
  const b = _findBm(tid)
  if (a && b) {
    if (a.parentId === b.parentId) { swapOrder(a, b); store.debouncedSave(); swapCardsDOM('.card[data-id="' + a.id + '"]:not(.group-card)', '.card[data-id="' + b.id + '"]:not(.group-card)'); }
    else toast('只能在同级书签间拖拽排序', false);
  }
}

function handleGroupCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('drag-over');
  const gid = card.dataset.groupId;
  if (!gid) return;
  const store = useAppStore();

  if (p.type === 'group') {
    const srcGid = p.id.slice(6);
    if (srcGid === gid) return;
    addGroupRefToGroup(srcGid, gid, e.clientX, e.clientY);
    return;
  }

  if (p.type === 'bm') {
    const isRef = p.id && p.id.startsWith('ref:');
    if (isRef) {
      const refGid = p.id.slice(4);
      if (refGid !== gid) {
        // 从源组移除（与书签拖拽行为一致：移动而非复制）
        if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL) removeFromSrcGroup(p.srcGid, p.id);
        addGroupRefToGroup(refGid, gid, e.clientX, e.clientY);
      }
      return;
    }
    if (p.srcGid === gid) return;
    if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL && p.srcGid !== gid) {
      removeFromSrcGroup(p.srcGid, p.id);
    }
    if (p.srcGid === DRAG_SRC_DETAIL) {
      const di = store.detailCards.indexOf(p.id);
      if (di >= 0) store.detailCards.splice(di, 1);
    }
    addToGroupDirect(p.id, gid);
    return;
  }
}

function handleDetailCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('detail-drag-over');
  if (p.type !== 'detail') return;
  const store = useAppStore();
  const toIdx = parseInt(card.dataset.didx);
  if (_detailDragIdx == null || _detailDragIdx === toIdx) return;
  const tmp = store.detailCards[_detailDragIdx];
  store.detailCards[_detailDragIdx] = store.detailCards[toIdx];
  store.detailCards[toIdx] = tmp;
}

function handleDetailPanelDrop(e, p) {
  e.preventDefault();
  if (p.srcGid === DRAG_SRC_DETAIL) return;
  const store = useAppStore();
  if (p.type === 'group') {
    if (store.detailCards.indexOf(p.id) === -1) store.detailCards.push(p.id);
    store.detailOpen = true;
  } else {
    if (p.srcGid) { removeFromSrcGroup(p.srcGid, p.id); store.debouncedSave(); }
    openDetail(p.id);
  }
}

function handleGridDrop(e, p) {
  e.preventDefault();
  if (!p || p.type === 'group') return;
  const store = useAppStore();
  if (p.srcGid === DRAG_SRC_DETAIL) {
    const di = store.detailCards.indexOf(p.id);
    if (di >= 0) store.detailCards.splice(di, 1);
  } else if (p.srcGid && removeFromSrcGroup(p.srcGid, p.id)) {
    store.debouncedSave(); toast('已移出组');
  }
}

function handleRailDrop(e, item) {
  e.preventDefault();
  item.classList.remove('rail-drag-over');
  if (!_catDragId) return;
  const store = useAppStore();
  const targetId = item.dataset.catId;
  if (!targetId || _catDragId === targetId || targetId === CAT_ALL || targetId === CAT_UNCATEGORIZED) return;
  const srcIdx = store.categories.findIndex(function (c) { return c.id === _catDragId; });
  const tgtIdx = store.categories.findIndex(function (c) { return c.id === targetId; });
  if (srcIdx < 0 || tgtIdx < 0) return;
  const src = store.categories.splice(srcIdx, 1)[0];
  store.categories.splice(tgtIdx, 0, src);
  store.debouncedSave();
}

function handleBmToCatDrop(e, item, p) {
  e.preventDefault();
  item.classList.remove('rail-drag-over');
  const targetCatId = item.dataset.catId;
  if (!targetCatId || targetCatId === CAT_ALL) return;
  const store = useAppStore();
  const bm = _findBm(p.id);
  if (!bm) return;
  const newCatId = targetCatId === CAT_UNCATEGORIZED ? CAT_UNCATEGORIZED : targetCatId;
  if (bm.categoryId === newCatId) return;
  bm.categoryId = newCatId;
  store.debouncedSave();
  toast('已移动到分类: ' + (store.categories.find(c => c.id === newCatId)?.name || newCatId));
}

function reorderInlineCard(gid, bmId, clientX, clientY) {
  const store = useAppStore();
  const ed = EditorManager.get(gid);
  if (!ed) return;
  const isRef = bmId && bmId.startsWith('ref:')
  const refGid = isRef ? bmId.slice(4) : null
  let nodePos = null;
  ed.state.doc.descendants(function (node, pos) {
    if (!node.attrs) return
    if (isRef && node.attrs['data-ref-gid'] === refGid) { nodePos = pos; return false; }
    if (!isRef && node.attrs['data-bm-id'] === bmId) { nodePos = pos; return false; }
  });
  if (nodePos === null) return;
  const node = ed.state.doc.nodeAt(nodePos);
  if (!node) return;
  const data = isRef ? _findGroup(refGid) : _findBm(bmId)
  if (!data) return;
  const html = isRef ? groupRefCardHTML(data) : inlineCardHTML(data);
  const $nodePos = ed.state.doc.resolve(nodePos);
  const paragraphPos = $nodePos.before(1);
  const cachedPos = (_lastInsertPos && _lastInsertPos.gid === gid) ? _lastInsertPos.pos : null;
  ed.chain().deleteRange({ from: nodePos, to: nodePos + node.nodeSize }).run();
  const paragraph = ed.state.doc.nodeAt(paragraphPos);
  if (paragraph && paragraph.type.name === 'paragraph' && paragraph.content.size === 0 && ed.state.doc.content.childCount > 1) {
    ed.chain().deleteRange({ from: paragraphPos, to: paragraphPos + 1 }).run();
  }
  if (cachedPos !== null) {
    let adjustedPos = cachedPos;
    if (cachedPos > nodePos) adjustedPos -= node.nodeSize;
    adjustedPos = Math.min(adjustedPos, ed.state.doc.content.size - 1);
    ed.chain().insertContentAt(Math.max(adjustedPos, 0), html).run();
  } else {
    EditorManager.insertAtCoords(gid, html, clientX, clientY);
  }
  saveGroupBody(gid);
  store.save();
}

export function useDragDrop() {
  onMounted(() => {
    document.addEventListener('dragstart', _onDragStart)
    document.addEventListener('dragend', _onDragEnd)
    document.addEventListener('dragover', _onDragOver)
    document.addEventListener('drop', _onDrop)
  })

  onUnmounted(() => {
    document.removeEventListener('dragstart', _onDragStart)
    document.removeEventListener('dragend', _onDragEnd)
    document.removeEventListener('dragover', _onDragOver)
    document.removeEventListener('drop', _onDrop)
  })
}
