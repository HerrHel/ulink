import { reactive, nextTick, watch } from 'vue';
import { useDataStore } from '../../stores/data.js';
import { useUIStore } from '../../stores/ui.js';
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js';
import { gid, displayText } from '../../utils.js';
import { isThreePartCipher } from '../../crypto.js';
import { useE2EStore } from '../../stores/e2e.js';
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js';
import { t } from '../../i18n/index.js';
import { EditorManager } from '../../lib/editor.js';
import { pushNavState } from '../interaction/useKeyboardOps.js';
import { previewIconUrl, clearIcon } from '../ui/useIconPreview.js';
import { inlineCardHTML, groupRefCardHTML } from '../useInlineCard.js';
import { CAT_ALL, CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../../config/constants.js';
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
  /** A2-003：内含书签草稿；取消时用 _orig* 回滚 */
  bookmarkIds: string[]
  _origBookmarkIds: string[]
  _origNotes: string
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
  bookmarkIds: [],
  _origBookmarkIds: [],
  _origNotes: '',
})

export function saveGroupBody(gid: string) {
  const ds = useDataStore();
  const sg = ds.groupMap[gid];
  if (!sg) return;
  if (sg.notes && isThreePartCipher(sg.notes)) return;
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
        // A5-005：与 GroupEditor.syncToStore 一致，过滤软删/不存在的 id
        const bm = bmid ? ds.bookmarkMap[bmid] : null;
        if (bm && !bm.deletedAt && !seen[bmid]) { seen[bmid] = true; ids.push(bmid); }
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
      if (bmid && bmid.indexOf('ref:') !== 0 && !seen2[bmid]) {
        const bm = ds.bookmarkMap[bmid];
        if (bm && !bm.deletedAt) { seen2[bmid] = true; ids2.push(bmid); }
      }
    });
    ds.updateGroup(gid, { bookmarkIds: ids2 });
  }
  saveAppData();
}

export function createGroup(catId?: string): string {
  const ds = useDataStore();
  const ui = useUIStore();
  // 旧实现为把新组插到「最前」，对所有现存顶层书签 + 组遍历 update*({order: order+1})：
  //   ① 每个被遍历项的 updatedAt 被刷成 Date.now() —— 按 updatedAt 排序时新建一个组会抹平
  //      全库的时间次序，用户失去「哪个先建」的辨识；
  //   ② 每个被遍历项 _markDirty + _trackChange(order) —— 一次新建组触发整库全量同步推送；
  //   ③ _saveLocalHistory 对每个 id 入队一条历史快照。
  // 改用「现存最大 order + 1」新组单独占用一个唯一 order 位，仅新增一条 dirty，
  // 默认 desc 排序下新组 order 最大即排最前——与原「插到最前」行为一致，但零次生副作用。
  const maxBmOrder = ds.bookmarks.reduce((m, b) => b.parentId ? m : (b.order > m ? b.order : m), -1)
  const maxGrpOrder = ds.siblingGroups.reduce((m, g) => (g.order > m ? g.order : m), -1)
  const g: SiblingGroup = {
    id: 'sg_' + gid(),
    name: '',
    categoryId: catId || (ui.curCat === CAT_ALL ? CAT_UNCATEGORIZED : ui.curCat),
    icon: '', order: Math.max(maxBmOrder, maxGrpOrder) + 1, isExpanded: false,
    attributes: { [ATTR_IS_GROUP]: true },
    bookmarkIds: [], notes: '',
    updatedAt: Date.now(), useCount: 0
  };
  // 新建后直接进入该笔记编辑（createNoteAndFocus），画面本身即反馈，不再弹「已创建」提示
  ds.addGroup(g); saveAppData();
  return g.id;
}

/** 空笔记：无标题（或默认「未命名」）、正文无文字/图片/媒体/书签卡片、无成员书签、无图标 */
export function isEmptyNote(sg: SiblingGroup): boolean {
  const name = (sg.name || '').trim();
  if (name && name !== t('common.unnamed') && name !== '未命名' && name !== 'Untitled') return false;
  if ((sg.bookmarkIds || []).length || (sg.icon || '').trim()) return false;
  const notes = sg.notes || '';
  if (/<(img|video|audio|iframe)\b|data-bm-id/i.test(notes)) return false;
  return notes.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim() === '';
}

/**
 * 刚新建的笔记一旦被离开（focusedGroupId 不再是它，任何途径：返回、点侧栏、浏览器后退、AI 跳转…），
 * 若仍为空则直接彻底删除（不进回收站、不弹提示，与备忘录一致）。只盯 createNoteAndFocus 新建的这一张，
 * 已有笔记哪怕是空的也不碰。
 *
 * flush:'sync'：在 focusedGroupId 被赋值的同一刻判定，此时标题输入框与编辑器仍在 DOM 中——
 * 有的离开途径不会先触发标题 blur / saveGroupBody，故以界面上的实时内容兜底，绝不误删已写了东西的笔记。
 */
function _watchFreshNote(gid: string) {
  const ui = useUIStore();
  const stop = watch(() => ui.focusedGroupId, (cur) => {
    if (cur === gid) return;
    stop();
    const ds = useDataStore();
    const sg = ds.groupMap[gid];
    if (!sg || sg.deletedAt) return;
    saveGroupBody(gid);
    const liveTitle = (document.querySelector<HTMLElement>('.focus-title-input')?.textContent || '').trim();
    const titled = !!liveTitle && liveTitle !== t('common.unnamed') && liveTitle !== '未命名' && liveTitle !== 'Untitled';
    // 标题已输入但还没 blur 落库（如光标在标题里直接后退）：顺手存下，免得留下笔记却丢了标题
    if (titled && liveTitle !== (sg.name || '').trim()) ds.updateGroup(gid, { name: liveTitle });
    if (titled || !isEmptyNote(ds.groupMap[gid])) return;
    ds.permanentDeleteGroup(gid);
    saveAppData();
  }, { flush: 'sync' });
}

/**
 * 新建一张空笔记并直接进入专注编辑，光标落在标题上（起完名接着写正文）。
 * 新建弹窗的「新建笔记」与命令面板共用此入口，保证两处行为一致。
 */
export function createNoteAndFocus(catId?: string): string {
  const ui = useUIStore();
  if (ui.activeView !== 'bookmarks') {
    ui.switchToBookmarksView(catId);
  }
  const id = createGroup(catId);
  toggleGroupFocus(id);
  _watchFreshNote(id);
  void nextTick(() => {
    const el = document.querySelector<HTMLElement>('.focus-title-input');
    if (el) {
      el.focus();
    } else {
      setTimeout(() => {
        document.querySelector<HTMLElement>('.focus-title-input')?.focus();
      }, 50);
    }
  });
  return id;
}

export async function deleteGroup(dGid: string, skipConfirm?: boolean) {
  const ds = useDataStore();
  const ui = useUIStore();
  const sg = ds.groupMap[dGid];
  if (!sg) return;
  const doDelete = () => {
    if (geForm.id === dGid || ui.editingGeId === dGid) {
      closeGroupEdit({ discard: true });
    }
    ds.deleteGroup(dGid);
    saveAppData();
    if (ui.focusedGroupId === dGid) ui.focusedGroupId = null;
    toastWithUndo(t('msg.groupDeleted'), function () {
      ds.restoreGroup(dGid);
      debouncedSaveAppData(); toast(t('msg.groupRestored'));
    });
  };
  if (skipConfirm) doDelete();
  else if (await showConfirm(t('msg.confirmDeleteGroup', { name: sg.name || t('common.unnamed') }))) doDelete();
}

/** Directly add bookmark to group (for programmatic use, not popover) */
export function addToGroupDirect(bmId: string, tGid: string) {
  const ds = useDataStore();
  const sg = ds.groupMap[tGid];
  if (!sg) return;
  if (sg.bookmarkIds.indexOf(bmId) !== -1) { toast(t('msg.bookmarkAlreadyInGroup'), false); return; }
  const bm = ds.bookmarkMap[bmId];
  if (!bm) return;
  ds.updateGroup(tGid, { bookmarkIds: [...sg.bookmarkIds, bmId] });
  const ed = EditorManager.get(tGid);
  if (ed) ed.chain().insertContent(inlineCardHTML(bm)).run();
  saveGroupBody(tGid); saveAppData();
  toast(t('msg.addedToGroup'));
}

export function removeBmFromGroup(bmId: string, tGid: string) {
  const ds = useDataStore();
  const sg = ds.groupMap[tGid];
  if (!sg) return;
  const idx = sg.bookmarkIds.indexOf(bmId);
  if (idx < 0) return;
  const bm = ds.bookmarkMap[bmId];
  // DATA-9：删除前快照完整 bookmarkIds；updateGroup 不可变替换后闭包 sg 仍是旧引用（仍含 bmId），
  // undo 再 splice 会双 id。恢复时直接写回快照即可。
  const idsBefore = sg.bookmarkIds.slice();
  const newIds = idsBefore.filter((_, i) => i !== idx);
  ds.updateGroup(tGid, { bookmarkIds: newIds });
  const ed = EditorManager.get(tGid);
  if (ed) EditorManager.deleteNode(tGid, 'data-bm-id', bmId);
  saveGroupBody(tGid); saveAppData();
  toastWithUndo(t('msg.removedFromGroup'), function () {
    ds.updateGroup(tGid, { bookmarkIds: idsBefore.slice() });
    const currentEd = EditorManager.get(tGid);
    // 编辑器内若已无该卡片再插入，避免重复 inlineCard
    if (currentEd && bm) {
      let hasCard = false
      currentEd.state.doc.descendants(node => {
        if (node.type.name === 'inlineCard' && node.attrs['data-bm-id'] === bmId) hasCard = true
      })
      if (!hasCard) currentEd.chain().insertContent(inlineCardHTML(bm)).run()
    }
    saveGroupBody(tGid); debouncedSaveAppData(); toast(t('deadlinks.restored'));
  });
}

export function addGroupRefToGroup(refGid: string, targetGid: string, clientX?: number, clientY?: number) {
  if (refGid === targetGid) return;
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
    // R-RESURRECT：聚焦只做内存计数，不写历史/不标脏/不刷 updatedAt，
    // 避免离线墓碑被本地存活快照复活（updateGroup 会触发这三件事）。
    if (sg) { ds.bumpGroupUseCount(tGid); }
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
  // L8：与 openBmModal 对齐，记录打开前焦点，Esc/关闭可恢复
  ui.lastFocusedEl = document.activeElement as HTMLElement;
  ui.editingGeId = eGid;
  geForm.id = eGid;
  geForm.name = displayText(sg.name) || '';
  geForm.catId = sg.categoryId || '';
  geForm.icon = sg.icon || '';
  geForm.attrs = sg.attributes ? { ...sg.attributes } : {};
  geForm.iconPreviewVisible = !!sg.icon;
  geForm.iconPreviewUrl = sg.icon || '';
  geForm.clearIconVisible = !!sg.icon;
  // A2-003：书签列表进草稿；notes 快照供取消时回滚 deleteNode 副作用
  geForm.bookmarkIds = [...(sg.bookmarkIds || [])];
  geForm._origBookmarkIds = [...(sg.bookmarkIds || [])];
  geForm._origNotes = sg.notes || '';
  pushNavState();
  ui.modals.groupEdit = true;
}

/** 取消组编辑：回滚草稿期对 bookmarkIds / notes 的副作用后关闭 */
export function closeGroupEdit(opts?: { discard?: boolean }) {
  const ui = useUIStore();
  const discard = opts?.discard !== false;
  const gId = geForm.id;
  if (discard && gId) {
    const ds = useDataStore();
    const sg = ds.groupMap[gId];
    if (sg) {
      const notesChanged = (sg.notes || '') !== (geForm._origNotes || '');
      const idsChanged =
        (sg.bookmarkIds || []).length !== geForm._origBookmarkIds.length ||
        (sg.bookmarkIds || []).some((id, i) => id !== geForm._origBookmarkIds[i]);
      // deleteNode 可能已经 via onUpdate 写脏 notes；取消时还原打开快照
      if (notesChanged || idsChanged) {
        ds.updateGroup(gId, {
          bookmarkIds: [...geForm._origBookmarkIds],
          notes: geForm._origNotes,
        });
        EditorManager.silentSetContent(gId, geForm._origNotes);
        saveAppData();
      } else if (geForm.bookmarkIds.length !== geForm._origBookmarkIds.length) {
        // 仅草稿列表变了、store 未写：还原编辑器节点即可
        EditorManager.silentSetContent(gId, geForm._origNotes);
      }
    }
  }
  ui.modals.groupEdit = false;
  ui.editingGeId = null;
  geForm.id = '';
  geForm.bookmarkIds = [];
  geForm._origBookmarkIds = [];
  geForm._origNotes = '';
  // L8：Esc 路径也走 closeGroupEdit，在此统一恢复焦点
  if (ui.lastFocusedEl) {
    try { ui.lastFocusedEl.focus() } catch { /* 元素可能已卸载 */ }
    ui.lastFocusedEl = null
  }
}

export function saveGroupEdit() {
  const ds = useDataStore();
  const gId = geForm.id;
  if (!gId) return;
  const sg = ds.groupMap[gId];
  if (!sg) return;

  const e2eStore = useE2EStore();
  if (e2eStore.isE2EEnabled && !e2eStore.isUnlocked) {
    if ([sg.name, sg.notes].some(f => typeof f === 'string' && f && isThreePartCipher(f))) {
      toast(t('modal.childBm.encryptedBlocked'), false);
      return;
    }
  }

  // 保存前把草稿 bookmarkIds 固化；notes 以编辑器当前 HTML 为准（移除书签已反映在 DOM）
  const editorHTML = EditorManager.getContentHTML(gId);
  ds.updateGroup(gId, {
    name: geForm.name.trim() || t('common.unnamed'),
    categoryId: (geForm.catId && (!ds.categoryMap || (ds.categoryMap[geForm.catId] && !ds.categoryMap[geForm.catId].deletedAt))) ? geForm.catId : CAT_UNCATEGORIZED,
    icon: geForm.icon.trim(),
    attributes: { ...geForm.attrs, [ATTR_IS_GROUP]: true },
    bookmarkIds: [...geForm.bookmarkIds],
    ...(editorHTML !== null ? { notes: editorHTML } : {}),
    updatedAt: Date.now()
  });
  // 已保存：关闭时不再 discard 回滚
  geForm._origBookmarkIds = [...geForm.bookmarkIds];
  geForm._origNotes = editorHTML !== null ? editorHTML : (sg.notes || '');
  saveAppData();
  closeGroupEdit({ discard: false }); toast(t('msg.groupUpdated'));
}

export function previewGeIconUrl() { previewIconUrl(geForm); }

export function clearGeIcon() { clearIcon(geForm); }

export function closeAddBmPopover() {
  const ui = useUIStore();
  ui.overlays.addPopover = false;
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
  saveAppData()
  return true
}
