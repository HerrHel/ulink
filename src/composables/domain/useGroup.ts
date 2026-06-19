import { reactive } from 'vue';
import { useAppStore } from '../../stores/app.js';
import { gid } from '../../utils.js';
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js';
import { EditorManager } from '../../lib/editor.js';
import { pushNavState } from '../interaction/useKeyboardOps.js';
import { previewIconUrl, clearIcon } from '../ui/useIconPreview.js';
import { inlineCardHTML, groupRefCardHTML } from '../useInlineCard.js';
import type { SiblingGroup } from '../../types.js';

interface GeFormState {
  id: string
  name: string
  catId: string
  icon: string
  attrs: Record<string, boolean>
  iconPreviewVisible: boolean
  iconPreviewUrl: string
  clearIconVisible: boolean
}

/**
 * Reactive form state for GroupEditModal.
 * Replaces all DOM getElementById/readElementById operations in group editing.
 */
export const geForm = reactive<GeFormState>({
  id: '',
  name: '',
  catId: '',
  icon: '',
  attrs: {},
  iconPreviewVisible: false,
  iconPreviewUrl: '',
  clearIconVisible: false,
})

export function saveGroupBody(gid: string) {
  const store = useAppStore();
  const sg = store.groupMap[gid];
  if (!sg) return;
  const editorHTML = EditorManager.getContentHTML(gid);
  if (editorHTML !== null) sg.notes = editorHTML;
  sg.updatedAt = Date.now();
}

export function syncGroupBookmarks(gid: string) {
  const store = useAppStore();
  const sg = store.groupMap[gid];
  if (!sg) return;
  const ed = EditorManager.get(gid);
  if (ed) {
    const ids: string[] = [];
    const seen: Record<string, boolean> = {};
    ed.state.doc.descendants(function (node) {
      if (node.type.name === 'inlineCard') {
        const bmid = node.attrs['data-bm-id'];
        if (bmid && !seen[bmid]) { seen[bmid] = true; ids.push(bmid); }
      }
    });
    sg.bookmarkIds = ids;
  } else {
    const el = document.getElementById('sgBody_' + gid);
    if (!el) return;
    const cards = el.querySelectorAll('.group-inline-card[data-bm-id]');
    const ids2: string[] = [];
    const seen2: Record<string, boolean> = {};
    cards.forEach(function (c) {
      const bmid = c.getAttribute('data-bm-id');
      if (bmid && bmid.indexOf('ref:') !== 0 && !seen2[bmid]) { seen2[bmid] = true; ids2.push(bmid); }
    });
    sg.bookmarkIds = ids2;
  }
  sg.updatedAt = Date.now();
  store.save();
}

export function createGroup(catId?: string): string {
  const store = useAppStore();
  store.siblingGroups.forEach(function (g) { g.order = (g.order || 0) + 1; });
  store.bookmarks.filter(function (b) { return !b.parentId; }).forEach(function (b) { b.order = (b.order || 0) + 1; });
  const g: SiblingGroup = {
    id: 'sg_' + gid(),
    name: '',
    categoryId: catId || (store.curCat === 'all' ? 'uncategorized' : store.curCat),
    icon: '', order: 0, isExpanded: false,
    attributes: { 'is-group': true },
    bookmarkIds: [], notes: '',
    updatedAt: Date.now(), useCount: 0
  };
  store.addGroup(g); store.save(); toast('组已创建');
  return g.id;
}

export function deleteGroup(dGid: string, skipConfirm?: boolean) {
  const store = useAppStore();
  const sg = store.groupMap[dGid];
  if (!sg) return;
  const doDelete = () => {
    const snapshot = JSON.parse(JSON.stringify(sg));
    store.deleteGroup(dGid);
    store.save();
    if (store.focusedGroupId === dGid) store.focusedGroupId = null;
    toastWithUndo('已删除组', function () {
      store.siblingGroups.push(snapshot);
      store.siblingGroups.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      store.debouncedSave(); toast('组已恢复');
    });
  };
  if (skipConfirm) doDelete();
  else showConfirm('确认删除组「' + (sg.name || '未命名') + '」？', doDelete);
}

/** Directly add bookmark to group (for programmatic use, not popover) */
export function addToGroupDirect(bmId: string, tGid: string) {
  const store = useAppStore();
  const sg = store.groupMap[tGid];
  if (!sg) return;
  if (sg.bookmarkIds.indexOf(bmId) !== -1) { toast('书签已在组内', false); return; }
  const bm = store.bookmarkMap[bmId];
  if (!bm) return;
  sg.bookmarkIds.push(bmId);
  const ed = EditorManager.get(tGid);
  if (ed) ed.chain().insertContent(inlineCardHTML(bm)).run();
  saveGroupBody(tGid); store.save();
  toast('已添加到组');
}

export function removeBmFromGroup(bmId: string, tGid: string) {
  const store = useAppStore();
  const sg = store.groupMap[tGid];
  if (!sg) return;
  const idx = sg.bookmarkIds.indexOf(bmId);
  if (idx < 0) return;
  const bm = store.bookmarkMap[bmId];
  sg.bookmarkIds.splice(idx, 1);
  const ed = EditorManager.get(tGid);
  if (ed) EditorManager.deleteNode(tGid, 'data-bm-id', bmId);
  saveGroupBody(tGid); store.save();
  toastWithUndo('已从组移除', function () {
    sg.bookmarkIds.splice(idx, 0, bmId);
    if (ed && bm) ed.chain().insertContent(inlineCardHTML(bm)).run();
    saveGroupBody(tGid); store.debouncedSave(); toast('已恢复');
  });
}

export function addGroupRefToGroup(refGid: string, targetGid: string, clientX?: number, clientY?: number) {
  const store = useAppStore();
  const src = store.groupMap[refGid];
  if (!src) return;
  const ed = EditorManager.get(targetGid);
  if (ed) {
    const html = groupRefCardHTML(src);
    if (clientX !== undefined && clientY !== undefined) {
      EditorManager.insertAtCoords(targetGid, html, clientX, clientY);
    } else {
      ed.chain().insertContent(html).run();
    }
    saveGroupBody(targetGid);
  } else {
    const sg = store.groupMap[targetGid];
    if (!sg) return;
    const refHtml = groupRefCardHTML(src);
    sg.notes = (sg.notes || '') + refHtml;
    sg.updatedAt = Date.now();
  }
  store.save();
}

export function removeGroupRef(targetGid: string, refGid: string) {
  const store = useAppStore();
  const ed = EditorManager.get(targetGid);
  if (ed) EditorManager.deleteNode(targetGid, 'data-ref-gid', refGid);
  saveGroupBody(targetGid); store.save();
}

export function searchInFocusedGroup() {
  const store = useAppStore();
  const q = (store.searchQuery || '').trim().toLowerCase();
  const body = document.getElementById('sgBody_' + store.focusedGroupId);
  if (!body) return;
  body.querySelectorAll('.group-inline-card').forEach(c => {
    const bmId = c.getAttribute('data-bm-id');
    if (!q) { (c as HTMLElement).style.display = ''; return; }
    if (bmId && bmId.startsWith('ref:')) {
      const rg = store.groupMap[bmId.slice(4)];
      (c as HTMLElement).style.display = (rg && (rg.name || '').toLowerCase().indexOf(q) !== -1) ? '' : 'none';
    } else if (bmId) {
      const bm = store.bookmarkMap[bmId];
      (c as HTMLElement).style.display = (bm && (bm.title.toLowerCase().indexOf(q) !== -1 || bm.url.toLowerCase().indexOf(q) !== -1)) ? '' : 'none';
    }
  });
}

export function toggleGroupFocus(tGid: string) {
  const store = useAppStore();
  const prev = store.focusedGroupId;
  if (prev) { saveGroupBody(prev); store.save(); }
  const entering = (store.focusedGroupId !== tGid);
  store.focusedGroupId = entering ? tGid : null;
  if (entering) {
    const sg = store.groupMap[tGid];
    if (sg) { sg.useCount = (sg.useCount || 0) + 1; sg.updatedAt = Date.now(); }
    pushNavState();
    // 保存当前布局模式，退出时恢复
    store._prevLayoutMode = store.layoutMode;
  } else {
    // 退出聚焦：恢复之前的布局模式
    if (store._prevLayoutMode) {
      store.layoutMode = store._prevLayoutMode;
      store._prevLayoutMode = null;
    }
  }
  if (prev !== store.focusedGroupId) { store.searchQuery = ''; }
}

export function exitGroupFocus() {
  const store = useAppStore();
  if (store.focusedGroupId) { saveGroupBody(store.focusedGroupId); store.save(); }
  store.searchQuery = '';
  store.focusedGroupId = null;
  // 恢复之前的布局模式
  if (store._prevLayoutMode) {
    store.layoutMode = store._prevLayoutMode;
    store._prevLayoutMode = null;
  }
}

export function editGroup(eGid: string) {
  const store = useAppStore();
  const sg = store.groupMap[eGid];
  if (!sg) return;
  store.editingGeId = eGid;
  geForm.id = eGid;
  geForm.name = sg.name || '';
  geForm.catId = sg.categoryId || '';
  geForm.icon = sg.icon || '';
  geForm.attrs = sg.attributes ? { ...sg.attributes } : {};
  geForm.iconPreviewVisible = !!sg.icon;
  geForm.iconPreviewUrl = sg.icon || '';
  geForm.clearIconVisible = !!sg.icon;
  pushNavState();
  store.groupEditOpen = true;
}

export function closeGroupEdit() {
  const store = useAppStore();
  store.groupEditOpen = false;
  store.editingGeId = null;
}

export function saveGroupEdit() {
  const store = useAppStore();
  const gId = geForm.id;
  if (!gId) return;
  const sg = store.groupMap[gId];
  if (!sg) return;
  store.updateGroup(gId, {
    name: geForm.name.trim() || '未命名',
    categoryId: geForm.catId,
    icon: geForm.icon.trim(),
    attributes: { ...geForm.attrs },
    updatedAt: Date.now()
  });
  store.save();
  closeGroupEdit(); toast('组已更新');
}

export function previewGeIconUrl() { previewIconUrl(geForm); }

export function clearGeIcon() { clearIcon(geForm); }

export function closeAddBmPopover() {
  const store = useAppStore();
  store.addBmPopoverOpen = false;
  store.addToGid = null;
}

export function removeFromSrcGroup(srcGid: string, bmId: string): boolean {
  if (!srcGid || !bmId) return false
  const store = useAppStore()
  const sg = store.groupMap[srcGid]
  if (!sg) return false
  const isRef = bmId.startsWith('ref:')
  const lookupId = isRef ? bmId.slice(4) : bmId
  // 组引用卡片不在 bookmarkIds 中，只从编辑器内容中移除
  if (!isRef) {
    const idx = sg.bookmarkIds.indexOf(bmId)
    if (idx < 0) return false
    sg.bookmarkIds.splice(idx, 1)
  }
  const ed = EditorManager.get(srcGid)
  if (ed) EditorManager.deleteNode(srcGid, isRef ? 'data-ref-gid' : 'data-bm-id', lookupId)
  saveGroupBody(srcGid)
  return true
}
