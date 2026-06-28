import { reactive } from 'vue';
import { useDataStore } from '../../stores/data.js';
import { useUIStore } from '../../stores/ui.js';
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js';
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
  const ds = useDataStore();
  const sg = ds.groupMap[gid];
  if (!sg) return;
  const editorHTML = EditorManager.getContentHTML(gid);
  if (editorHTML !== null) {
    ds.updateGroup(gid, { notes: editorHTML })
  }
}

export function syncGroupBookmarks(gid: string) {
  const ds = useDataStore();
  const sg = ds.groupMap[gid];
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
    ds.updateGroup(gid, { bookmarkIds: ids });
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
    ds.updateGroup(gid, { bookmarkIds: ids2 });
  }
  saveAppData();
}

export function createGroup(catId?: string): string {
  const ds = useDataStore();
  const ui = useUIStore();
  ds.siblingGroups.forEach(function (g) { ds.updateGroup(g.id, { order: (g.order || 0) + 1 }); });
  ds.bookmarks.filter(function (b) { return !b.parentId; }).forEach(function (b) { ds.updateBookmark(b.id, { order: (b.order || 0) + 1 }); });
  const g: SiblingGroup = {
    id: 'sg_' + gid(),
    name: '',
    categoryId: catId || (ui.curCat === 'all' ? 'uncategorized' : ui.curCat),
    icon: '', order: 0, isExpanded: false,
    attributes: { 'is-group': true },
    bookmarkIds: [], notes: '',
    updatedAt: Date.now(), useCount: 0
  };
  ds.addGroup(g); saveAppData(); toast('组已创建');
  return g.id;
}

export async function deleteGroup(dGid: string, skipConfirm?: boolean) {
  const ds = useDataStore();
  const ui = useUIStore();
  const sg = ds.groupMap[dGid];
  if (!sg) return;
  const doDelete = () => {
    ds.deleteGroup(dGid);
    saveAppData();
    if (ui.focusedGroupId === dGid) ui.focusedGroupId = null;
    toastWithUndo('已删除组', function () {
      ds.restoreGroup(dGid);
      debouncedSaveAppData(); toast('组已恢复');
    });
  };
  if (skipConfirm) doDelete();
  else if (await showConfirm('确认删除组「' + (sg.name || '未命名') + '」？')) doDelete();
}

/** Directly add bookmark to group (for programmatic use, not popover) */
export function addToGroupDirect(bmId: string, tGid: string) {
  const ds = useDataStore();
  const sg = ds.groupMap[tGid];
  if (!sg) return;
  if (sg.bookmarkIds.indexOf(bmId) !== -1) { toast('书签已在组内', false); return; }
  const bm = ds.bookmarkMap[bmId];
  if (!bm) return;
  ds.updateGroup(tGid, { bookmarkIds: [...sg.bookmarkIds, bmId] });
  const ed = EditorManager.get(tGid);
  if (ed) ed.chain().insertContent(inlineCardHTML(bm)).run();
  saveGroupBody(tGid); saveAppData();
  toast('已添加到组');
}

export function removeBmFromGroup(bmId: string, tGid: string) {
  const ds = useDataStore();
  const sg = ds.groupMap[tGid];
  if (!sg) return;
  const idx = sg.bookmarkIds.indexOf(bmId);
  if (idx < 0) return;
  const bm = ds.bookmarkMap[bmId];
  const newIds = sg.bookmarkIds.filter((_, i) => i !== idx);
  ds.updateGroup(tGid, { bookmarkIds: newIds });
  const ed = EditorManager.get(tGid);
  if (ed) EditorManager.deleteNode(tGid, 'data-bm-id', bmId);
  saveGroupBody(tGid); saveAppData();
  toastWithUndo('已从组移除', function () {
    const restored = [...sg.bookmarkIds];
    restored.splice(idx, 0, bmId);
    ds.updateGroup(tGid, { bookmarkIds: restored });
    const currentEd = EditorManager.get(tGid);
    if (currentEd && bm) currentEd.chain().insertContent(inlineCardHTML(bm)).run();
    saveGroupBody(tGid); debouncedSaveAppData(); toast('已恢复');
  });
}

export function addGroupRefToGroup(refGid: string, targetGid: string, clientX?: number, clientY?: number) {
  const ds = useDataStore();
  const src = ds.groupMap[refGid];
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
    const sg = ds.groupMap[targetGid];
    if (!sg) return;
    const refHtml = groupRefCardHTML(src);
    ds.updateGroup(targetGid, { notes: (sg.notes || '') + refHtml });
  }
  saveAppData();
}

export function removeGroupRef(targetGid: string, refGid: string) {
  const ed = EditorManager.get(targetGid);
  if (ed) EditorManager.deleteNode(targetGid, 'data-ref-gid', refGid);
  saveGroupBody(targetGid); saveAppData();
}

export function searchInFocusedGroup() {
  const ds = useDataStore();
  const ui = useUIStore();
  const q = (ui.searchQuery || '').trim().toLowerCase();
  const body = document.getElementById('sgBody_' + ui.focusedGroupId);
  if (!body) return;
  body.querySelectorAll('.group-inline-card').forEach(c => {
    const bmId = c.getAttribute('data-bm-id');
    if (!q) { (c as HTMLElement).style.display = ''; return; }
    if (bmId && bmId.startsWith('ref:')) {
      const rg = ds.groupMap[bmId.slice(4)];
      (c as HTMLElement).style.display = (rg && (rg.name || '').toLowerCase().indexOf(q) !== -1) ? '' : 'none';
    } else if (bmId) {
      const bm = ds.bookmarkMap[bmId];
      (c as HTMLElement).style.display = (bm && (bm.title.toLowerCase().indexOf(q) !== -1 || bm.url.toLowerCase().indexOf(q) !== -1)) ? '' : 'none';
    }
  });
}

export function toggleGroupFocus(tGid: string) {
  const ds = useDataStore();
  const ui = useUIStore();
  const prev = ui.focusedGroupId;
  if (prev) { saveGroupBody(prev); saveAppData(); }
  const entering = (ui.focusedGroupId !== tGid);
  ui.focusedGroupId = entering ? tGid : null;
  if (entering) {
    const sg = ds.groupMap[tGid];
    if (sg) { ds.updateGroup(tGid, { useCount: (sg.useCount || 0) + 1 }); }
    pushNavState();
    ui._prevLayoutMode = ui.layoutMode;
  } else {
    if (ui._prevLayoutMode) {
      ui.layoutMode = ui._prevLayoutMode;
      ui._prevLayoutMode = null;
    }
  }
  if (prev !== ui.focusedGroupId) { ui.searchQuery = ''; }
}

export function exitGroupFocus() {
  const ui = useUIStore();
  if (ui.focusedGroupId) { saveGroupBody(ui.focusedGroupId); saveAppData(); }
  ui.searchQuery = '';
  ui.focusedGroupId = null;
  if (ui._prevLayoutMode) {
    ui.layoutMode = ui._prevLayoutMode;
    ui._prevLayoutMode = null;
  }
}

export function editGroup(eGid: string) {
  const ds = useDataStore();
  const ui = useUIStore();
  const sg = ds.groupMap[eGid];
  if (!sg) return;
  ui.editingGeId = eGid;
  geForm.id = eGid;
  geForm.name = sg.name || '';
  geForm.catId = sg.categoryId || '';
  geForm.icon = sg.icon || '';
  geForm.attrs = sg.attributes ? { ...sg.attributes } : {};
  geForm.iconPreviewVisible = !!sg.icon;
  geForm.iconPreviewUrl = sg.icon || '';
  geForm.clearIconVisible = !!sg.icon;
  pushNavState();
  ui.groupEditOpen = true;
}

export function closeGroupEdit() {
  const ui = useUIStore();
  ui.groupEditOpen = false;
  ui.editingGeId = null;
}

export function saveGroupEdit() {
  const ds = useDataStore();
  const gId = geForm.id;
  if (!gId) return;
  const sg = ds.groupMap[gId];
  if (!sg) return;
  ds.updateGroup(gId, {
    name: geForm.name.trim() || '未命名',
    categoryId: geForm.catId,
    icon: geForm.icon.trim(),
    attributes: { ...geForm.attrs, 'is-group': true },
    updatedAt: Date.now()
  });
  saveAppData();
  closeGroupEdit(); toast('组已更新');
}

export function previewGeIconUrl() { previewIconUrl(geForm); }

export function clearGeIcon() { clearIcon(geForm); }

export function closeAddBmPopover() {
  const ui = useUIStore();
  ui.addBmPopoverOpen = false;
  ui.addToGid = null;
}

export function removeFromSrcGroup(srcGid: string, bmId: string): boolean {
  if (!srcGid || !bmId) return false
  const ds = useDataStore()
  const sg = ds.groupMap[srcGid]
  if (!sg) return false
  const isRef = bmId.startsWith('ref:')
  const lookupId = isRef ? bmId.slice(4) : bmId
  if (!isRef) {
    const idx = sg.bookmarkIds.indexOf(bmId)
    if (idx < 0) return false
    ds.updateGroup(srcGid, { bookmarkIds: sg.bookmarkIds.filter((_, i) => i !== idx) })
  }
  const ed = EditorManager.get(srcGid)
  if (ed) EditorManager.deleteNode(srcGid, isRef ? 'data-ref-gid' : 'data-bm-id', lookupId)
  saveGroupBody(srcGid)
  return true
}
