/* ================================================================
   LV — LinkVault Single Global Namespace
   唯一全局命名空间，所有模块挂载于此

   LV.Data    — 数据层：加载、保存、导入导出
   LV.Utils   — 工具函数：ID 生成、URL 处理、剪贴板等
   LV.Render  — 渲染模块：卡片、侧栏、详情面板
   LV.UI      — 界面交互：模态框、书签操作、分类管理
   LV.Drag    — 拖拽模块：卡片拖放、排序
   LV.Mention — @提及模块：组内书签/组引用
   LV.Group   — 组管理：内容编辑、书签增删
   LV.Undo    — 撤销/重做模块
   LV.Keyboard— 键盘快捷键与导航历史
   ================================================================ */

'use strict';

/* ==================== CONSTANTS ==================== */
const STORAGE_KEY = 'linkvault_v2';
const CAT_ALL = 'all';
const CAT_UNCATEGORIZED = 'uncategorized';
const ATTR_IS_GROUP = 'is-group';
const MAX_SUGGESTIONS = 8;
const TOAST_FADE_MS = 2200;
const TOAST_REMOVE_MS = 2600;
const PAYLOAD_KEY = 'application/x-linkvault';
const DRAG_SRC_DETAIL = '__detail__';
const MAX_UNDO = 20;
const UNDO_WINDOW = 500;
const MAX_UNDO_BYTES = 512 * 1024; // 512KB total undo memory cap

const DEFAULTS = {
  categories: [
    { id: 'all', name: '全部', icon: 'grid', color: '#122E8A' },
    { id: 'uncategorized', name: '未分类', icon: 'bookmark', color: '#6E6860' },
    { id: 'email', name: '邮箱', icon: 'mail', color: '#e11d48' },
    { id: 'tools', name: '工具', icon: 'tool', color: '#d97706' },
    { id: 'ai', name: 'AI', icon: 'ai-icon', color: '#8b5cf6' },
    { id: 'social', name: '社交', icon: 'social-icon', color: '#1d9bf0' },
    { id: 'game', name: '游戏平台', icon: 'game-icon', color: '#16a34a' }
  ],
  bookmarks: [
    { id: 'b1', title: 'GitHub', url: 'https://github.com', username: '', password: '', notes: '代码托管平台', icon: '', categoryId: 'tools', parentId: null, order: 0, useCount: 15, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 86400000 },
    { id: 'b2', title: 'QQ邮箱', url: 'https://mail.qq.com', username: '@qq.com', password: 'MTIz', notes: '', icon: '', categoryId: 'email', parentId: null, order: 1, useCount: 8, attributes: { 'requires-login': true, 'china-available': true }, isExpanded: false, createdAt: Date.now() - 172800000 },
    { id: 'b3', title: 'DeepSeek', url: 'https://www.deepseek.com/', username: '', password: '', notes: 'API key:', icon: '', categoryId: 'ai', parentId: null, order: 2, useCount: 5, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 40000000 },
    { id: 'sb1', title: '开始对话', url: 'https://chat.deepseek.com/', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 0, useCount: 3, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 30000000 },
    { id: 'sb2', title: 'API开发平台', url: 'https://platform.deepseek.com/usage', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 1, useCount: 2, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 20000000 },
    { id: 'b4', title: 'Twitter/X', url: 'https://x.com', username: '', password: '', notes: '社交媒体', icon: '', categoryId: 'social', parentId: null, order: 3, useCount: 4, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 345600000 },
    { id: 'b5', title: 'Steam', url: 'https://store.steampowered.com', username: '', password: '', notes: '游戏平台', icon: '', categoryId: 'game', parentId: null, order: 4, useCount: 0, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 100000 }
  ],
  customAttributes: [
    { id: 'requires-login', name: '需要登录', type: 'boolean' },
    { id: 'china-available', name: '国内可用', type: 'boolean' },
    { id: 'ai', name: 'Ai', type: 'boolean' },
    { id: 'is-group', name: '组', type: 'boolean' }
  ],
  siblingGroups: [
    {
      id: 'sg_welcome', name: '欢迎使用', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: { 'is-group': true },
      bookmarkIds: ['b1', 'b2', 'b3'],
      notes: '拖拽书签到此处、或输入 @ 来整理收藏：<br>'
        + '<span class="group-inline-card" contenteditable="false" data-bm-id="b1" draggable="true"><img src="https://api.xinac.net/icon/?url=github.com" alt=""><span class="gic-name">GitHub</span><span class="gic-domain">github.com</span><span class="gic-btn">详情</span><span class="gic-remove" title="移除">&times;</span></span> '
        + '<span class="group-inline-card" contenteditable="false" data-bm-id="b2" draggable="true"><img src="https://api.xinac.net/icon/?url=mail.qq.com" alt=""><span class="gic-name">QQ邮箱</span><span class="gic-domain">mail.qq.com</span><span class="gic-btn">详情</span><span class="gic-remove" title="移除">&times;</span></span> '
        + '<span class="group-inline-card" contenteditable="false" data-bm-id="b3" draggable="true"><img src="https://api.xinac.net/icon/?url=www.deepseek.com" alt=""><span class="gic-name">DeepSeek</span><span class="gic-domain">deepseek.com</span><span class="gic-btn">详情</span><span class="gic-remove" title="移除">&times;</span></span>'
    }
  ]
};


// ==================== Data Module 数据模块 ====================
//#region Data Module 数据模块
/* ==================== DATA LAYER ==================== */

function load() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (r) {
      const d = JSON.parse(r);
      const cats = d.categories || DEFAULTS.categories;
      DEFAULTS.categories.forEach(dc => { if (!cats.find(c => c.id === dc.id)) cats.push(dc); });
      const attrs = d.customAttributes || [];
      const seen = {};
      const deduped = [];
      attrs.forEach(a => {
        if (seen[a.name]) {
          const keep = seen[a.name];
          (d.bookmarks || []).forEach(b => { if (b.attributes && b.attributes[a.id]) { b.attributes[keep.id] = b.attributes[a.id]; delete b.attributes[a.id]; } });
        } else { seen[a.name] = a; deduped.push(a); }
      });
      d.customAttributes = deduped;
      (d.bookmarks || []).forEach(b => { if (b.categoryId === CAT_ALL) b.categoryId = CAT_UNCATEGORIZED; });
      (d.siblingGroups || []).forEach(g => {
        if (g.categoryId === CAT_ALL) g.categoryId = CAT_UNCATEGORIZED;
        if (!g.attributes) g.attributes = { [ATTR_IS_GROUP]: true };
      });
      // Reverse-migrate text-format notes → HTML inline cards
      (d.siblingGroups || []).forEach(g => {
        if (g.notes && !/<[a-z][\s\S]*>/i.test(g.notes)) {
          const text = g.notes;
          const ids = [];
          const re = /\[([^\]]+)\]\(([a-zA-Z0-9]+)\)/g;
          let m;
          while ((m = re.exec(text)) !== null) {
            const bm = (d.bookmarks || []).find(function (x) { return x.id === m[2]; });
            if (bm && ids.indexOf(m[2]) < 0) ids.push(m[2]);
          }
          let html = '';
          let lastIdx = 0;
          const re2 = /\[([^\]]+)\]\(([a-zA-Z0-9]+)\)|@(\S+)/g;
          while ((m = re2.exec(text)) !== null) {
            html += esc(text.slice(lastIdx, m.index));
            if (m[1] !== undefined) {
              const bm2 = (d.bookmarks || []).find(function (x) { return x.id === m[2]; });
              if (bm2) html += inlineCardHTML(bm2);
              else html += esc(m[0]);
            } else if (m[3] !== undefined) {
              const sg2 = (d.siblingGroups || []).find(function (x) { return x.name === m[3]; });
              if (sg2 && sg2.id !== g.id) html += groupRefCardHTML(sg2);
              else html += esc(m[0]);
            }
            lastIdx = re2.lastIndex;
          }
          html += esc(text.slice(lastIdx));
          html = html.replace(/\n/g, '<br>');
          g.notes = html;
          g._migrated = true;
          ids.forEach(function (id) { if (g.bookmarkIds.indexOf(id) < 0) g.bookmarkIds.push(id); });
        }
      });
      // 迁移：将 localStorage 展开状态一次性写入数据模型，之后由模型驱动渲染
      try {
        const _es = JSON.parse(localStorage.getItem('lv_expandStates') || '{}');
        (d.bookmarks || []).forEach(function (b) { if (_es[b.id]) b.isExpanded = true; });
        (d.siblingGroups || []).forEach(function (g) { if (_es[g.id]) g.isExpanded = true; });
        localStorage.removeItem('lv_expandStates');
      } catch (_) {}
      const needsPersist = attrs.length !== deduped.length;
      (d.siblingGroups || []).forEach(function (g) { if (g._migrated) needsPersist = true; });
      const result = { categories: cats, bookmarks: d.bookmarks || [], customAttributes: deduped, siblingGroups: d.siblingGroups || [] };
      if (needsPersist) try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch (e) { }
      return result;
    }
  } catch (e) { }
  return JSON.parse(JSON.stringify(DEFAULTS));
}

let A = load();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(A)); }
  catch (e) { toast('存储空间不足，请清理部分数据', false); }
  cleanStaleUndoStacks();
}

const debouncedSave = debounce(function () { save(); }, 300);

function getStorageInfo() {
  try {
    const d = localStorage.getItem(STORAGE_KEY);
    if (!d) return { size: 0, percent: 0, label: '0 KB' };
    const bytes = new Blob([d]).size;
    const sizeKB = bytes / 1024;
    const percent = Math.min(100, Math.round(bytes / 5242880 * 100));
    return {
      size: sizeKB,
      percent: percent,
      label: sizeKB < 1024 ? sizeKB.toFixed(1) + ' KB' : (sizeKB / 1024).toFixed(1) + ' MB'
    };
  } catch (e) { return { size: 0, percent: 0, label: '0 KB' }; }
}

function exportData() {
  try {
    const blob = new Blob([JSON.stringify(A, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'linkvault-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); URL.revokeObjectURL(a.href);
    toast('数据已导出');
  } catch (e) { toast('导出失败', false); }
}

function validateImportData(data) {
  if (!Array.isArray(data.categories) || !Array.isArray(data.bookmarks) ||
      !Array.isArray(data.customAttributes) || !Array.isArray(data.siblingGroups)) return '数据结构错误：缺少必需的数组字段';
  for (let i = 0; i < data.categories.length; i++) {
    const c = data.categories[i];
    if (!c.id || !c.name) return '分类 #' + i + ' 缺少 id 或 name';
  }
  for (let i = 0; i < data.bookmarks.length; i++) {
    const b = data.bookmarks[i];
    if (!b.id || !b.title || !b.url) return '书签 #' + i + ' 缺少 id、title 或 url';
  }
  for (let i = 0; i < data.customAttributes.length; i++) {
    const a = data.customAttributes[i];
    if (!a.id || !a.name) return '属性 #' + i + ' 缺少 id 或 name';
  }
  for (let i = 0; i < data.siblingGroups.length; i++) {
    const g = data.siblingGroups[i];
    if (!g.id || !g.name) return '组 #' + i + ' 缺少 id 或 name';
    if (g.bookmarkIds && !Array.isArray(g.bookmarkIds)) return '组 #' + i + ' 的 bookmarkIds 不是数组';
  }
  return null;
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = JSON.parse(reader.result);
      const err = validateImportData(data);
      if (err) { toast(err, false); return; }
      try { localStorage.setItem(STORAGE_KEY + '_backup', JSON.stringify(A)); } catch (e) { }
      A.categories = data.categories;
      A.bookmarks = data.bookmarks;
      A.customAttributes = data.customAttributes;
      A.siblingGroups = data.siblingGroups;
      save(); LV.curCat = CAT_ALL; LV.focusedGroupId = null;
      LV.activeAttrs = []; LV.excludedAttrs = [];
      LV.detailCards = []; renderAll();
      toast('数据已导入 (' + A.bookmarks.length + ' 个书签)');
    } catch (e) { toast('导入失败：' + e.message, false); }
  };
  reader.readAsText(file);
}

function triggerImport() { document.getElementById('importFile').click(); }

function resetData() {
  showConfirm('确认清除所有数据？这将恢复为默认状态，且不可撤销。', function () {
    localStorage.removeItem(STORAGE_KEY);
    A = JSON.parse(JSON.stringify(DEFAULTS));
    LV.curCat = CAT_ALL; LV.focusedGroupId = null;
    LV.activeAttrs = []; LV.excludedAttrs = [];
    LV.detailCards = [];
    Object.keys(LV.undoStacks).forEach(function (k) { delete LV.undoStacks[k]; });
    _totalUndoBytes = 0; _undoBytesDirty = false;
    save(); renderAll();
    toast('数据已重置为默认');
  });
}


//#endregion Data Module 数据模块

// ==================== Utils Module 工具模块 ====================
//#region Utils Module 工具模块
/* ==================== UTILITY FUNCTIONS ==================== */

function gid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function favicon(url) { try { return 'https://api.xinac.net/icon/?url=' + new URL(url).hostname; } catch (e) { return ''; } }
function domain(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } }
function safeAtob(s) { try { return atob(s); } catch (e) { return s; } }

function fixUrl(u) {
  u = u.trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return 'https://' + u;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function sanitizeHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  (function walk(node) {
    if (node.nodeType === 1) {
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED' || tag === 'BASE' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') { node.remove(); return; }
      for (let i = node.attributes.length - 1; i >= 0; i--) {
        const a = node.attributes[i];
        const an = a.name.toLowerCase();
        // Strip ALL on* event handlers (onerror, onclick, onload, etc.)
        if (an.indexOf('on') === 0) {
          node.removeAttribute(a.name);
        } else {
          // Neutralise javascript:/vbscript:/data: URIs in URL-bearing attributes
          var av = a.value.replace(/[\s\x00-\x1f]+/g, '').toLowerCase();
          if ((an === 'href' || an === 'src' || an === 'action' || an === 'formaction' || an === 'xlink:href' || an === 'poster') && /^(javascript|vbscript|data\s*:)/i.test(av)) {
            node.removeAttribute(a.name);
          }
        }
      }
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) walk(node.childNodes[i]);
  })(div);
  return div.innerHTML;
}

function debounce(fn, ms) {
  let t;
  return function () { const args = arguments, ctx = this; clearTimeout(t); t = setTimeout(function () { fn.apply(ctx, args); }, ms); };
}

function swapOrder(a, b) {
  if (a.order === b.order) b.order++;
  const t = a.order; a.order = b.order; b.order = t;
}

function copyToClipboard(text, label) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(function () {});
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  }
  toast((label || '') + ' 已复制');
}

function setDragImage(e) {
  const img = new Image();
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  e.dataTransfer.setDragImage(img, 0, 0);
}

function dragPayload(e) {
  try { return JSON.parse(e.dataTransfer.getData(PAYLOAD_KEY)); } catch (_) { return null; }
}


//#endregion Utils Module 工具模块

// ==================== Icons 图标常量 ====================
/* ==================== ICONS ==================== */
const I = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>',
  click: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.70711 13.2929C10.0976 13.6834 10.0976 14.3166 9.70711 14.7071C9.31658 15.0976 8.68342 15.0976 8.29289 14.7071L3.29289 9.70711C2.90237 9.31658 2.90237 8.68342 3.29289 8.29289L8.29289 3.29289C8.68342 2.90237 9.31658 2.90237 9.70711 3.29289C10.0976 3.68342 10.0976 4.31658 9.70711 4.70711L6.41421 8H16C17.3261 8 18.5979 8.52678 19.5355 9.46447C20.4732 10.4021 21 11.6739 21 13V20C21 20.5523 20.5523 21 20 21C19.4477 21 19 20.5523 19 20V13C19 12.2044 18.6839 11.4413 18.1213 10.8787C17.5587 10.3161 16.7957 10 16 10H6.41421L9.70711 13.2929Z" fill="currentColor"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.2929 13.2929C13.9024 13.6834 13.9024 14.3166 14.2929 14.7071C14.6834 15.0976 15.3166 15.0976 15.7071 14.7071L20.7071 9.70711C21.0976 9.31658 21.0976 8.68342 20.7071 8.29289L15.7071 3.29289C15.3166 2.90237 14.6834 2.90237 14.2929 3.29289C13.9024 3.68342 13.9024 4.31658 14.2929 4.70711L17.5858 8H8C6.67392 8 5.40215 8.52678 4.46447 9.46447C3.52678 10.4021 3 11.6739 3 13V20C3 20.5523 3.44771 21 4 21C4.55229 21 5 20.5523 5 20V13C5 12.2044 5.31607 11.4413 5.87868 10.8787C6.44129 10.3161 7.20435 10 8 10H17.5858L14.2929 13.2929Z" fill="currentColor"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.6602 10.44L20.6802 14.62C19.8402 18.23 18.1802 19.69 15.0602 19.39C14.5602 19.35 14.0202 19.26 13.4402 19.12L11.7602 18.72C7.59018 17.73 6.30018 15.67 7.28018 11.49L8.26018 7.30001C8.46018 6.45001 8.70018 5.71001 9.00018 5.10001C10.1702 2.68001 12.1602 2.03001 15.5002 2.82001L17.1702 3.21001C21.3602 4.19001 22.6402 6.26001 21.6602 10.44Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path opacity="0.4" d="M15.0603 19.3901C14.4403 19.8101 13.6603 20.1601 12.7103 20.4701L11.1303 20.9901C7.16034 22.2701 5.07034 21.2001 3.78034 17.2301L2.50034 13.2801C1.22034 9.3101 2.28034 7.2101 6.25034 5.9301L7.83034 5.4101C8.24034 5.2801 8.63034 5.1701 9.00034 5.1001C8.70034 5.7101 8.46034 6.4501 8.26034 7.3001L7.28034 11.4901C6.30034 15.6701 7.59034 17.7301 11.7603 18.7201L13.4403 19.1201C14.0203 19.2601 14.5603 19.3501 15.0603 19.3901Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 6L21 6.00078M8 12L21 12.0008M8 18L21 18.0007M3 6.5H4V5.5H3V6.5ZM3 12.5H4V11.5H3V12.5ZM3 18.5H4V17.5H3V18.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  listCheck: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2.25 6C2.25 5.58579 2.58579 5.25 3 5.25H20C20.4142 5.25 20.75 5.58579 20.75 6C20.75 6.41421 20.4142 6.75 20 6.75H3C2.58579 6.75 2.25 6.41421 2.25 6ZM20.4613 10.4086C20.7879 10.6634 20.8461 11.1347 20.5914 11.4613L16.6914 16.4613C16.5522 16.6397 16.3399 16.7458 16.1136 16.7499C15.8873 16.754 15.6713 16.6557 15.5257 16.4824L13.4257 13.9824C13.1593 13.6652 13.2004 13.1921 13.5176 12.9257C13.8348 12.6593 14.3079 12.7004 14.5743 13.0176L16.0784 14.8082L19.4086 10.5387C19.6634 10.2121 20.1347 10.1539 20.4613 10.4086ZM2.25 11C2.25 10.5858 2.58579 10.25 3 10.25H10C10.4142 10.25 10.75 10.5858 10.75 11C10.75 11.4142 10.4142 11.75 10 11.75H3C2.58579 11.75 2.25 11.4142 2.25 11ZM2.25 16C2.25 15.5858 2.58579 15.25 3 15.25H10C10.4142 15.25 10.75 15.5858 10.75 16C10.75 16.4142 10.4142 16.75 10 16.75H3C2.58579 16.75 2.25 16.4142 2.25 16Z" fill="currentColor"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="3" rx="1.5" fill="currentColor"/><rect x="3" y="10.5" width="18" height="3" rx="1.5" fill="currentColor"/><rect x="3" y="17" width="18" height="3" rx="1.5" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  'ai-icon': '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3"><circle cx="34.52" cy="11.43" r="5.82"/><circle cx="53.63" cy="31.6" r="5.82"/><circle cx="34.52" cy="50.57" r="5.82"/><circle cx="15.16" cy="42.03" r="5.82"/><circle cx="15.16" cy="19.27" r="5.82"/><circle cx="34.51" cy="29.27" r="4.7"/><line x1="20.17" y1="16.3" x2="28.9" y2="12.93"/><line x1="38.6" y1="15.59" x2="49.48" y2="27.52"/><line x1="50.07" y1="36.2" x2="38.67" y2="46.49"/><line x1="18.36" y1="24.13" x2="30.91" y2="46.01"/><line x1="20.31" y1="44.74" x2="28.7" y2="48.63"/><line x1="17.34" y1="36.63" x2="31.37" y2="16.32"/><line x1="20.52" y1="21.55" x2="30.34" y2="27.1"/><line x1="39.22" y1="29.8" x2="47.81" y2="30.45"/><line x1="34.51" y1="33.98" x2="34.52" y2="44.74"/></svg>',
  'social-icon': '<svg viewBox="0 0 400 400" fill="currentColor"><g transform="translate(0,-652.36216)"><path d="m 55.925394,652.36218 c -30.393352,0 -55.29942992,24.90804 -55.29942994,55.30138 2e-8,30.39336 24.90607794,55.29943 55.29942994,55.29943 5.173306,0 10.181454,-0.73848 14.941042,-2.08588 l 13.444984,22.57367 c -29.876428,22.0478 -49.30739,57.48755 -49.30739,97.35113 0,66.64002 54.290612,120.93059 120.93065,120.93059 34.5698,0 65.811,-14.61461 87.87871,-37.97949 l 20.46044,15.44103 c -1.93494,5.6137 -3.00189,11.62111 -3.00189,17.86675 0,30.39331 24.90608,55.30131 55.29943,55.30131 30.39336,0 55.30139,-24.908 55.30139,-55.30131 0,-30.39336 -24.90803,-55.29943 -55.30139,-55.29943 -15.15619,0 -28.94669,6.19466 -38.96584,16.17344 l -18.57767,-14.02115 c 11.30496,-18.38831 17.8355,-40.00592 17.8355,-63.11174 0,-19.44442 -4.62952,-37.8337 -12.83171,-54.13344 l 45.97152,-33.68277 c 9.41166,7.40845 21.24826,11.85518 34.07144,11.85518 30.39336,0 55.29943,-24.90609 55.29943,-55.29943 0,-30.39336 -24.90607,-55.30139 -55.29943,-55.30139 -30.39336,0 -55.30139,24.90803 -55.30138,55.30139 0,8.57289 1.9821,16.7081 5.50963,23.97207 l -43.76065,32.06172 c -22.18189,-27.82655 -56.34936,-45.70397 -94.58753,-45.70397 -17.8512,0 -34.81398,3.89923 -50.08667,10.8845 l -13.081719,-21.9643 c 11.307989,-10.14693 18.458539,-24.84746 18.458539,-41.12791 0,-30.39334 -24.906082,-55.30138 -55.299436,-55.30138 z m 0,24.99939 c 16.88268,0 30.300042,13.41932 30.300042,30.30199 0,16.88268 -13.417362,30.30004 -30.300042,30.30004 -16.882678,0 -30.300041,-13.41736 -30.300041,-30.30004 0,-16.88267 13.417363,-30.30199 30.300041,-30.30199 z m 288.149216,41.87788 c 16.88268,0 30.30004,13.41932 30.30004,30.302 0,16.88267 -13.41736,30.30004 -30.30004,30.30004 -16.88268,0 -30.30199,-13.41737 -30.30199,-30.30004 0,-16.88268 13.41931,-30.302 30.30199,-30.302 z m -188.13993,65.63121 c 53.12935,0 95.92929,42.8019 95.92929,95.93125 0,53.12935 -42.79994,95.93126 -95.92929,95.93126 -53.12936,0 -95.93126,-42.80191 -95.93126,-95.93126 0,-53.12935 42.8019,-95.93125 95.93126,-95.93125 z m -0.83006,25.24744 c -25.44286,-0.3999 -45.66106,29.20262 -35.43859,52.66472 2.89454,7.52249 8.26285,14.01893 14.95081,18.48588 -23.02566,10.11073 -36.703153,35.46616 -36.337011,60.07275 -0.05902,4.80544 -0.511373,9.75352 4.099511,9.6111 34.32375,-0.69828 76.17032,0.1505 110.49731,-0.0762 4.49067,-27.31468 -9.21096,-58.03472 -35.11048,-69.52369 18.1538,-12.01297 23.32449,-40.37216 8.3455,-56.90876 -7.48953,-9.09402 -19.19064,-14.64784 -31.00705,-14.32582 z m 0.65428,23.65371 c 0.53101,-0.007 1.06852,0.0172 1.60933,0.0742 13.02643,0.59668 19.17674,20.56949 7.50177,27.56768 -9.21009,6.54539 -24.95129,-0.23815 -23.88027,-12.38055 0.11879,-8.0054 6.80405,-15.15142 14.76917,-15.26135 z m 1.00388,66.78743 c 14.92636,0.23653 27.49301,12.78709 31.24923,26.5306 -21.27876,-0.0222 -42.55775,0.0588 -63.83633,-0.0605 3.92221,-13.76741 16.13183,-26.32073 31.13596,-26.45443 0.48619,-0.0184 0.96965,-0.0233 1.45114,-0.0156 z m 159.80859,66.20151 c 16.88268,0 30.302,13.41736 30.302,30.30004 0,16.88271 -13.41932,30.30201 -30.302,30.30201 -16.88268,0 -30.30004,-13.4193 -30.30004,-30.30201 0,-16.88268 13.41736,-30.30004 30.30004,-30.30004 z"/></g></svg>',
  'game-icon': '<svg viewBox="0 0 512 512" fill="currentColor"><path d="M510.002,309.835l-0.068-0.326l-0.076-0.334l-26.508-112.721l-0.106-0.417l-0.106-0.418c-16.668-62.217-73.294-105.666-137.712-105.666H166.579c-64.418,0-121.045,43.449-137.712,105.666l-0.114,0.418l-0.099,0.417L2.147,309.174l-0.076,0.326l-0.068,0.326c-9.749,46.43,16.926,92.496,62.036,107.168l1.586,0.509c9.24,3.012,18.89,4.544,28.624,4.544c32.668,0,63.128-17.404,79.758-45.489l22.556-33.343l0.561-0.835l0.509-0.872c0.796-1.388,2.276-2.253,3.861-2.253h109.02c1.586,0,3.066,0.865,3.862,2.253l0.508,0.872l0.562,0.835l22.555,33.343c16.63,28.085,47.09,45.489,79.766,45.489c9.734,0,19.384-1.532,28.67-4.56l1.533-0.493C493.07,402.331,519.737,356.257,510.002,309.835z M439.318,390.397l-1.54,0.501c-6.608,2.154-13.353,3.186-20.014,3.186c-22.646,0-44.283-11.949-56.088-32.433l-23.064-34.101c-5.788-10.053-16.508-16.258-28.101-16.258h-109.02c-11.592,0-22.312,6.206-28.101,16.258l-23.063,34.101c-11.804,20.484-33.434,32.433-56.081,32.433c-6.661,0-13.405-1.032-20.013-3.186l-1.548-0.501c-31.431-10.219-50.102-42.485-43.311-74.819l26.508-112.722c13.42-50.102,58.826-84.94,110.696-84.94h178.847c51.869,0,97.276,34.838,110.696,84.94l26.508,112.722C489.413,347.912,470.75,380.178,439.318,390.397z"/><polygon points="157.453,172.061 123.912,172.061 123.912,210.579 85.387,210.579 85.387,244.105 123.912,244.105 123.912,282.637 157.453,282.637 157.453,244.105 195.978,244.105 195.978,210.579 157.453,210.579"/><path d="M365.721,206.247c11.668,0,21.113-9.445,21.113-21.098c0-11.669-9.445-21.114-21.113-21.114c-11.653,0-21.098,9.445-21.098,21.114C344.622,196.802,354.068,206.247,365.721,206.247z"/><path d="M323.509,206.247c-11.653,0-21.106,9.453-21.106,21.098c0,11.669,9.453,21.122,21.106,21.122c11.661,0,21.106-9.453,21.106-21.122C344.615,215.7,335.17,206.247,323.509,206.247z"/><path d="M365.721,248.459c-11.653,0-21.098,9.445-21.098,21.114c0,11.653,9.445,21.098,21.098,21.098c11.668,0,21.113-9.445,21.113-21.098C386.834,257.904,377.388,248.459,365.721,248.459z"/><path d="M407.933,206.247c-11.653,0-21.099,9.453-21.099,21.098c0,11.669,9.446,21.122,21.099,21.122c11.66,0,21.113-9.453,21.113-21.122C429.046,215.7,419.593,206.247,407.933,206.247z"/></svg>'
};

/* ==================== STATE ==================== */
const LV = {
  Data: {}, Utils: {}, Render: {}, UI: {}, Drag: {}, Mention: {}, Group: {}, Undo: {}, Keyboard: {},
  curCat: CAT_ALL,
  sortDir: 'asc',
  editingId: null,
  focusedGroupId: null,
  detailCards: [],
  activeAttrs: [],
  excludedAttrs: [],
  pwShown: {},
  visitTimer: null,
  lastFocusedEl: null,
  dragOverEl: null,
  catDragId: null,
  detailDragIdx: null,
  ctxGid: null,
  ctxCard: null,
  editingGeId: null,
  addToGid: null,
  saveToGroup: null,
  layoutMode: 'grid',
  batchMode: false,
  batchSelected: [],
  // Undo/redo
  undoStacks: {},
  undoTimers: {},
  saveTimers: {},
  // @mention
  mentionGid: null,
  mentionQuery: '',
  mentionIdx: 0,
  mentionRange: null,
  mentionActive: false,
  mentionType: 'bm',
  mentionSubMode: false,
  mentionSubIdx: 0,
  // Touch / long-press
  lpTimer: null,
  lpTarget: null,
  lpFired: false
};

LV.Data = LV.Data || {};
LV.Data.init = function () { window.addEventListener('beforeunload', save); };
LV.Data.destroy = function () { window.removeEventListener('beforeunload', save); };


// ==================== XSS Hardening: img error delegation ====================
function _onImgError(e) { if (e.target.tagName === 'IMG') { e.target.classList.add('img-error'); } }
LV.XSS = {
  init: function () { document.addEventListener('error', _onImgError, true); },
  destroy: function () { document.removeEventListener('error', _onImgError, true); }
};

// ==================== Virtual Scroll ====================
var VS = {
  /** Item count above which placeholders kick in. */
  THRESHOLD: 100,
  /** First N items rendered immediately (above the fold). */
  INITIAL: 60,
  /** IntersectionObserver rootMargin — pre-load buffer. */
  MARGIN: '800px 0px',
  observer: null,

  shouldEnable: function (count) { return count > this.THRESHOLD; },

  init: function () {
    if (this.observer) return;
    var self = this;
    this.observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) self._render(entries[i].target);
      }
    }, { root: document.getElementById('panelContent'), rootMargin: this.MARGIN, threshold: 0 });
  },

  observeAll: function () {
    if (!this.observer) return;
    var phs = document.querySelectorAll('#cardGrid .vs-ph');
    for (var i = 0; i < phs.length; i++) this.observer.observe(phs[i]);
  },

  disconnect: function () {
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
  },

  _render: function (el) {
    if (!this.observer) return;
    this.observer.unobserve(el);
    var id = el.dataset.vsId;
    var type = el.dataset.vsType;
    var html = '';
    if (type === 'group') {
      for (var i = 0; i < A.siblingGroups.length; i++) {
        if (A.siblingGroups[i].id === id) { html = renderGroupCardHTML(A.siblingGroups[i]); break; }
      }
    } else {
      for (var i = 0; i < A.bookmarks.length; i++) {
        if (A.bookmarks[i].id === id) { html = renderCardHTML(A.bookmarks[i]); break; }
      }
    }
    if (html) el.outerHTML = html; else el.remove();
  }
};

// ==================== Keyboard Module 键盘模块 (Nav History) ====================
//#region Keyboard Module 键盘模块
/* ==================== NAV HISTORY (浏览器返回) ==================== */

function captureNavState() {
  return {
    curCat: LV.curCat,
    focusedGroupId: LV.focusedGroupId,
    detailPanelOpen: document.getElementById('detailPanel').classList.contains('open'),
    bmModalOpen: document.getElementById('bmModal').classList.contains('open'),
    groupEditOpen: document.getElementById('groupEditModal').classList.contains('open'),
    catModalOpen: document.getElementById('catModal').classList.contains('open'),
    attrModalOpen: document.getElementById('attrModal').classList.contains('open')
  };
}

function pushNavState() {
  history.pushState(captureNavState(), '');
}

function restoreNavState(prev) {
  // 1. 关闭模态框（优先级最高）
  if (prev.bmModalOpen !== true && document.getElementById('bmModal').classList.contains('open')) {
    closeBmModal(); return;
  }
  if (prev.groupEditOpen !== true && document.getElementById('groupEditModal').classList.contains('open')) {
    closeGroupEdit(); return;
  }
  if (prev.catModalOpen !== true && document.getElementById('catModal').classList.contains('open')) {
    closeCatModal(); return;
  }
  if (prev.attrModalOpen !== true && document.getElementById('attrModal').classList.contains('open')) {
    closeAttrModal(); return;
  }

  // 2. 退出组聚焦
  if (prev.focusedGroupId === null && LV.focusedGroupId !== null) {
    exitGroupFocus();
    // 如果同时需要切换分类
    if (prev.curCat !== LV.curCat) {
      LV.curCat = prev.curCat;
      renderContent();
    }
    return;
  }

  // 3. 关闭辅助栏
  if (!prev.detailPanelOpen && document.getElementById('detailPanel').classList.contains('open')) {
    document.getElementById('detailPanel').classList.remove('open');
    document.getElementById('detailPanel').style.width = '';
    document.getElementById('detailSearchWrap').style.display = 'none';
    return;
  }
  if (prev.detailPanelOpen && !document.getElementById('detailPanel').classList.contains('open')) {
    document.getElementById('detailPanel').classList.add('open');
    document.getElementById('detailPanel').style.width = '';
    renderDetailPanel();
    return;
  }

  // 4. 切换分类
  if (prev.curCat !== LV.curCat) {
    LV.curCat = prev.curCat;
    LV.focusedGroupId = null;
    renderContent();
    return;
  }
}

function _onPopState(e) { var prev = e.state; if (prev) restoreNavState(prev); }

function snapSize(s) {
  return (s.notes ? s.notes.length * 2 : 0) + (s.bookmarkIds ? s.bookmarkIds.length * 20 : 0);
}

let _totalUndoBytes = 0;
let _undoBytesDirty = true;  // 首次查询时触发全量计算

function _recalcUndoBytes() {
  _totalUndoBytes = 0;
  for (const gid in LV.undoStacks) {
    const st = LV.undoStacks[gid];
    if (st.undo) st.undo.forEach(function (s) { _totalUndoBytes += snapSize(s); });
    if (st.redo) st.redo.forEach(function (s) { _totalUndoBytes += snapSize(s); });
  }
  _undoBytesDirty = false;
}

function totalUndoBytes() {
  if (_undoBytesDirty) _recalcUndoBytes();
  return _totalUndoBytes;
}

function evictOldestUndo() {
  let oldestGid = null;
  for (const gid in LV.undoStacks) {
    const st = LV.undoStacks[gid];
    if (st.undo && st.undo.length) {
      if (!oldestGid || gid < oldestGid) { oldestGid = gid; }
    }
  }
  if (oldestGid && LV.undoStacks[oldestGid].undo.length) {
    _totalUndoBytes -= snapSize(LV.undoStacks[oldestGid].undo[0]);
    LV.undoStacks[oldestGid].undo.shift();
    if (!LV.undoStacks[oldestGid].undo.length && !LV.undoStacks[oldestGid].redo.length) {
      delete LV.undoStacks[oldestGid];
    }
  }
}

function cleanStaleUndoStacks() {
  let removed = false;
  for (const gid in LV.undoStacks) {
    if (!A.siblingGroups.find(function (g) { return g.id === gid; })) {
      delete LV.undoStacks[gid];
      removed = true;
      if (LV.undoTimers[gid]) { clearTimeout(LV.undoTimers[gid]); delete LV.undoTimers[gid]; }
    }
  }
  if (removed) _undoBytesDirty = true;
}


//#endregion Keyboard Module 键盘模块

// ==================== Theme Module 主题模块 ====================
//#region Theme Module 主题模块
/* ==================== THEME ==================== */
function toggleTheme() {
  const el = document.documentElement;
  const next = el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  el.setAttribute('data-theme', next);
  try { localStorage.setItem('lv_theme', next); } catch (e) { }
}
function setThemeStyle(style) {
  const el = document.documentElement;
  if (style === 'comfortable') {
    el.setAttribute('data-theme-style', 'comfortable');
  } else {
    el.removeAttribute('data-theme-style');
  }
  try { localStorage.setItem('lv_themeStyle', style); } catch (e) { }
  updateSettingsMenuActive();
}
(function () {
  try {
    const t = localStorage.getItem('lv_theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
    const s = localStorage.getItem('lv_themeStyle');
    if (s === 'comfortable') document.documentElement.setAttribute('data-theme-style', 'comfortable');
  } catch (e) { }
})();


//#endregion Theme Module 主题模块

// ==================== Toast & Confirm 提示与确认 ====================
//#region Toast & Confirm
/* ==================== TOAST ==================== */
function toast(msg, ok) {
  if (ok === undefined) ok = true;
  const c = document.getElementById('toasts');
  const d = document.createElement('div');
  d.className = 'toast ' + (ok ? 'ok' : 'err');
  d.innerHTML = (ok ? I.external : I.trash) + esc(msg);
  c.appendChild(d);
  setTimeout(function () { d.style.opacity = '0'; d.style.transform = 'translateX(30px)'; d.style.transition = 'all 0.25s ease-in'; }, TOAST_FADE_MS);
  setTimeout(function () { d.remove(); }, TOAST_REMOVE_MS);
}

function toastWithUndo(msg, undoFn, duration) {
  duration = duration || 6000;
  // Remove any existing undo toast
  const old = document.querySelector('.undo-toast');
  if (old) old.remove();
  const d = document.createElement('div');
  d.className = 'undo-toast';
  const sec = Math.ceil(duration / 1000);
  d.innerHTML = '<span class="undo-toast-msg">' + esc(msg) + '</span>'
    + '<button class="undo-toast-btn undo-toast-undo">撤回</button>'
    + '<button class="undo-toast-btn undo-toast-confirm">确认</button>'
    + '<span class="undo-toast-countdown">' + sec + 's</span>';
  function dismiss() {
    clearInterval(cdTimer);
    clearTimeout(dismissTimer);
    d.classList.add('undo-toast-out');
    setTimeout(function () { d.remove(); }, 300);
  }
  d.querySelector('.undo-toast-undo').addEventListener('click', function () {
    undoFn();
    dismiss();
  });
  d.querySelector('.undo-toast-confirm').addEventListener('click', function () {
    dismiss();
  });
  document.body.appendChild(d);
  requestAnimationFrame(function () { d.classList.add('undo-toast-in'); });
  const remaining = duration;
  const cdEl = d.querySelector('.undo-toast-countdown');
  const cdTimer = setInterval(function () {
    remaining -= 1000;
    if (remaining > 0) cdEl.textContent = Math.ceil(remaining / 1000) + 's';
  }, 1000);
  const dismissTimer = setTimeout(function () {
    dismiss();
  }, duration);
}

function showConfirm(msg, onConfirm) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmMsg').textContent = msg;
  modal.classList.add('open');
  const okBtn = document.getElementById('confirmOk');
  const cancelBtn = document.getElementById('confirmCancel');
  function close() { modal.classList.remove('open'); okBtn.onclick = null; cancelBtn.onclick = null; }
  okBtn.onclick = function () { close(); onConfirm(); };
  cancelBtn.onclick = close;
  modal.onclick = function (e) { if (e.target === modal) close(); };
}


//#endregion Toast & Confirm

// ==================== Render Module 渲染模块 ====================
//#region Render Module 渲染模块
/* ==================== RENDERING ==================== */

function renderAll() {
  renderRail();
  renderContent();
  renderDetailPanel();
}

function renderRail() {
  const counts = getCardCounts();
  const nav = document.getElementById('railNav');
  nav.innerHTML = A.categories.map(function (c) {
    return '<button class="rail-item' + (LV.curCat === c.id ? ' active' : '') + '" data-cat-id="' + c.id + '"'
      + (c.id !== CAT_ALL ? ' draggable="true"' : '') + '>'
      + (I[c.icon] || I.star)
      + esc(c.name)
      + '<span class="rail-count">' + (counts[c.id] || 0) + '</span>'
      + '</button>';
  }).join('');
  const sto = document.getElementById('railStorage');
  if (sto) {
    const info = getStorageInfo();
    const barColor = info.percent > 90 ? 'var(--danger)' : info.percent > 70 ? 'var(--warn)' : 'var(--accent)';
    sto.innerHTML = '<div style="flex:1;min-width:0"><div style="height:4px;background:var(--bg-alt);border-radius:2px;overflow:hidden"><div class="rail-storage-bar" style="width:' + info.percent + '%;background:' + barColor + '"></div></div></div><span class="rail-storage-text">' + info.label + ' <span class="rail-storage-pct">(' + info.percent + '%)</span></span>';
  }
}

function getCardCounts() {
  const counts = {};
  A.bookmarks.forEach(function (b) { if (!b.parentId) counts[b.categoryId] = (counts[b.categoryId] || 0) + 1; });
  A.siblingGroups.forEach(function (g) { counts[g.categoryId] = (counts[g.categoryId] || 0) + 1; });
  counts[CAT_ALL] = A.bookmarks.filter(function (b) { return !b.parentId; }).length + A.siblingGroups.length;
  return counts;
}

function selectCat(id) {
  if (id !== LV.curCat) pushNavState();
  LV.curCat = id;
  LV.focusedGroupId = null;
  renderContent();
}

function getFiltered() {
  let bm = A.bookmarks.slice();
  if (LV.curCat !== CAT_ALL) bm = bm.filter(function (b) { return b.categoryId === LV.curCat; });
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  if (q) bm = bm.filter(function (b) {
    if (b.title.toLowerCase().indexOf(q) !== -1 || b.url.toLowerCase().indexOf(q) !== -1 || b.notes.toLowerCase().indexOf(q) !== -1 || b.username.toLowerCase().indexOf(q) !== -1) return true;
    return A.customAttributes.some(function (a) { return a.name.toLowerCase().indexOf(q) !== -1 && (b.attributes || {})[a.id]; });
  });
  LV.activeAttrs.forEach(function (aid) { bm = bm.filter(function (b) { return (b.attributes || {})[aid]; }); });
  LV.excludedAttrs.forEach(function (aid) { bm = bm.filter(function (b) { return !(b.attributes || {})[aid]; }); });
  const sort = document.getElementById('sortSelect').value;
  bm.sort(function (a, b) {
    const d = LV.sortDir === 'asc' ? 1 : -1;
    if (sort === 'useCount') return (a.useCount - b.useCount) * d;
    if (sort === 'title') return a.title.localeCompare(b.title) * d;
    if (sort === 'date') return ((a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt)) * d;
    return (a.order - b.order) * d;
  });
  return bm;
}

function getFilteredGroups() {
  let groups = A.siblingGroups.slice().sort(function (a, b) { return a.order - b.order; });
  if (LV.curCat !== CAT_ALL) groups = groups.filter(function (g) { return g.categoryId === LV.curCat; });
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  if (q) {
    groups = groups.filter(function (g) {
      if (g.name.toLowerCase().indexOf(q) !== -1) return true;
      if (A.customAttributes.some(function (a) { return a.name.toLowerCase().indexOf(q) !== -1 && (g.attributes || {})[a.id]; })) return true;
      return g.bookmarkIds.some(function (bid) {
        const b = A.bookmarks.find(function (x) { return x.id === bid; });
        return b && (b.title.toLowerCase().indexOf(q) !== -1 || b.url.toLowerCase().indexOf(q) !== -1);
      });
    });
  }
  LV.activeAttrs.forEach(function (aid) { groups = groups.filter(function (g) { return (g.attributes || {})[aid]; }); });
  LV.excludedAttrs.forEach(function (aid) { groups = groups.filter(function (g) { return !(g.attributes || {})[aid]; }); });
  return groups;
}

function buildCombinedList(groups, topLevel) {
  const combined = [];
  groups.forEach(function (g) { combined.push({ type: 'group', data: g }); });
  if (!LV.focusedGroupId) topLevel.forEach(function (b) { combined.push({ type: 'bm', data: b }); });
  combined.sort(function (a, b) {
    if (a.data.order !== b.data.order) return a.data.order - b.data.order;
    return a.type === 'group' ? -1 : 1;
  });
  return combined;
}

/* ---- Reused HTML builders ---- */

/** Generate card-tag spans for a set of attributes. */
function renderAttrTags(attrs, skipGroupId) {
  let html = '';
  A.customAttributes.forEach(function (a) {
    if (a.id === skipGroupId) return;
    if (!(attrs && attrs[a.id])) return;
    html += '<span class="card-tag tag-custom" data-action="filterAttr" data-id="' + a.id + '" title="按此属性筛选">' + esc(a.name) + '</span>';
  });
  return html;
}

/** Build <option> list for category dropdown. */
function buildCatOptions(selectedId) {
  return A.categories.filter(function (c) { return c.id !== CAT_ALL; }).map(function (c) {
    return '<option value="' + c.id + '" ' + (c.id === selectedId ? 'selected' : '') + '>' + esc(c.name) + '</option>';
  }).join('');
}

/** Build check-chip labels for custom attributes (modal forms). */
function buildAttrCheckboxes(attrs, parentAttrs) {
  return A.customAttributes.map(function (a) {
    let checked = '', disabled = '';
    if (parentAttrs && parentAttrs[a.id]) { checked = 'checked'; disabled = 'disabled'; }
    else if (attrs && attrs[a.id]) checked = 'checked';
    return '<label class="check-chip' + (disabled ? ' locked' : '') + '"><input type="checkbox" data-attr="' + a.id + '" ' + checked + ' ' + disabled + '>' + esc(a.name) + '</label>';
  }).join('');
}

/* ---- Card HTML generators (no inline event handlers) ---- */

function renderCardHTML(bm) {
  const icon = bm.icon || favicon(bm.url);
  const dm = domain(bm.url);
  const _a = bm.attributes || {};
  const attrTags = renderAttrTags(_a);
  const notes = bm.notes ? '<div class="card-notes">' + esc(bm.notes) + '</div>' : '';
  const hasAcct = bm.username || bm.password;
  const subs = A.bookmarks.filter(function (b) { return b.parentId === bm.id; });
  let subsHTML = '';
  if (subs.length) {
    subsHTML = '<div class="sub-sites">';
    subs.forEach(function (sub) {
      subsHTML += '<span class="group-inline-card" contenteditable="false" data-bm-id="' + sub.id + '" data-action="visit" data-id="' + sub.id + '">'
        + '<img src="' + esc(sub.icon || favicon(sub.url)) + '" alt="">'
        + '<span class="gic-name">' + esc(sub.title) + '</span>'
        + '<span class="gic-btn" data-action="openDetail" data-id="' + sub.id + '">详情</span>'
        + '</span>';
    });
    subsHTML += '</div>';
  }
  const previewText = bm.notes ? bm.notes : '';
  const expandCls = (LV.layoutMode === 'list' && bm.isExpanded) ? ' card-expanded' : '';
  return '<div class="card' + expandCls + '" draggable="true" data-id="' + bm.id + '">'
    + (LV.batchMode ? '<input type="checkbox" class="batch-chk" id="batchChk_' + bm.id + '">' : '')
    + (LV.batchMode ? '<span class="batch-grip">' + I.grip + '</span>' : '')
    + '<div class="card-body">'
    + '<div class="card-topline">'
    + '<div class="card-toprow">'
    + '<div class="card-logo" title="打开链接" data-action="visit" data-id="' + bm.id + '"><img src="' + icon + '" alt=""><span class="card-logo-fallback">' + bm.title.charAt(0) + '</span></div>'
    + '<div class="card-titlewrap">'
    + '<div class="card-name">' + esc(bm.title) + '</div>'
    + '<div class="card-domain">' + esc(dm) + '</div>'
    + '</div></div>'
    + (attrTags ? '<div class="card-tags">' + attrTags + '</div>' : '')
    + '</div>'
    + notes
    + (previewText ? '<div class="card-preview">' + esc(previewText) + '</div>' : '')
    + (hasAcct ? '<button class="card-acct-toggle" data-action="toggleAcct" data-id="' + bm.id + '">' + I.chevron + ' 账户信息</button><div class="card-acct-body">'
      + (bm.username ? '<div class="acct-row"><span class="acct-label">账户</span><span class="acct-val">' + esc(bm.username) + '</span><button class="acct-copy-btn" data-action="copyUser" data-id="' + bm.id + '" title="复制账户">' + I.copy + '</button></div>' : '')
      + (bm.password ? '<div class="acct-row"><span class="acct-label">密码</span><span class="acct-val" id="pwdisp_' + bm.id + '">••••••</span><button class="acct-show-pw" data-action="togglePw" data-id="' + bm.id + '" title="显示密码"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button><button class="acct-copy-btn" data-action="copyPw" data-id="' + bm.id + '" title="复制密码">' + I.copy + '</button></div>' : '')
      + '</div>' : '')
    + subsHTML
    + '</div>'
    + '<div class="card-foot">'
    + '<span class="card-stat">' + I.click + ' ' + bm.useCount + '次</span>'
    + '<span class="card-actions">'
    + (!bm.parentId ? '<button class="btn-xs" data-action="addSub" data-id="' + bm.id + '" title="添加子网站">' + I.plus + '</button>' : '')
    + '<button class="btn-xs" data-action="editBm" data-id="' + bm.id + '" title="编辑">' + I.edit + '</button>'
    + '<button class="btn-xs btn-danger" data-action="deleteBm" data-id="' + bm.id + '" title="删除">' + I.trash + '</button>'
    + '</span>'
    + '</div>'
    + ((hasAcct || subs.length) ? '<button class="list-expand-btn" data-action="toggleExpand" data-id="' + bm.id + '" title="展开">' + I.chevronDown + '</button>' : '')
    + '</div>';
}

/** Extract plain-text preview from group notes HTML.
 *  Inline bookmark cards → 【书签名】, plain text kept as-is. CSS handles truncation. */
function extractGroupPreview(g) {
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeHTML(g.notes || '');
  let text = '';
  function walk(node) {
    if (node.nodeType === 3) {
      text += node.textContent.trim();
    } else if (node.nodeType === 1) {
      if (node.classList && node.classList.contains('group-inline-card')) {
        const nameEl = node.querySelector('.gic-name');
        if (nameEl) text += '【' + nameEl.textContent.trim() + '】';
      } else {
        for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      }
    }
  }
  for (let i = 0; i < tmp.childNodes.length; i++) walk(tmp.childNodes[i]);
  return text || '无附加文案';
}

function renderGroupCardHTML(g) {
  const bmCount = g.bookmarkIds.length;
  const isFocused = LV.focusedGroupId === g.id;
  const stack = LV.undoStacks[g.id];
  const hasUndo = !!(stack && stack.undo && stack.undo.length > 0);
  const hasRedo = !!(stack && stack.redo && stack.redo.length > 0);
  const bodyHTML = sanitizeHTML(g.notes || '');
  const gIcon = g.icon || '';
  const gTags = renderAttrTags(g.attributes, ATTR_IS_GROUP);
  const gItemId = 'group:' + g.id;
  const gPreview = extractGroupPreview(g);
  const gExpandCls = (LV.layoutMode === 'list' && g.isExpanded) ? ' group-expanded' : '';
  return '<div class="card group-card' + (isFocused ? ' group-card-focus' : '') + gExpandCls + '" data-group-id="' + g.id + '" draggable="true">'
    + '<div class="group-card-accent"></div>'
    + (LV.batchMode ? '<input type="checkbox" class="batch-chk" id="batchChk_' + gItemId + '">' : '')
    + (LV.batchMode ? '<span class="batch-grip">' + I.grip + '</span>' : '')
    + '<div class="card-body">'
    + '<div class="group-card-head">'
    + '<div class="card-logo group-card-icon" data-action="toggleFocus" data-id="' + g.id + '" style="cursor:pointer">'
    + (gIcon ? '<img src="' + esc(gIcon) + '" alt=""><span class="card-logo-fallback">' + I.note + '</span>'
      : I.note)
    + '</div>'
    + '<div class="card-titlewrap">'
    + '<div class="card-name" data-group-name="' + g.id + '">' + esc(g.name || '未命名组') + '</div>'
    + '<div class="card-domain group-domain"></div>'
    + '</div>'
    + '<div class="group-head-actions">'
    + '<button class="btn-undo-group' + (hasUndo ? '' : ' disabled') + '" data-action="undoGroup" data-id="' + g.id + '" title="撤销">' + I.undo + '</button>'
    + '<button class="btn-redo-group' + (hasRedo ? '' : ' disabled') + '" data-action="redoGroup" data-id="' + g.id + '" title="前进">' + I.redo + '</button>'
    + '</div>'
    + '</div>'
    + (gTags ? '<div class="card-tags">' + gTags + '</div>' : '')
    + '<div class="group-body" id="sgBody_' + g.id + '" data-gid="' + g.id + '" contenteditable="true">' + bodyHTML + '</div>'
    + '<div class="card-preview">' + esc(gPreview || '') + '</div>'
    + '</div>'
    + (bodyHTML.trim() ? '<button class="list-expand-btn" data-action="toggleExpand" data-group-id="' + g.id + '" title="展开">' + I.chevronDown + '</button>' : '')
    + (isFocused ? '' : '<div class="card-foot">'
      + '<span class="card-stat">' + bmCount + ' 个书签</span>'
      + '<span class="card-actions">'
      + '<button class="btn-xs" data-action="addToGroup" data-id="' + g.id + '" title="添加书签到组">' + I.plus + '</button>'
      + '<button class="btn-xs" data-action="editGroup" data-id="' + g.id + '" title="编辑组">' + I.edit + '</button>'
      + '<button class="btn-xs btn-danger" data-action="deleteGroup" data-id="' + g.id + '" title="删除组">' + I.trash + '</button>'
      + '</span>'
      + '</div>')
    + '</div>';
}

/* ---- Full render ---- */

/** ViewManager — single source of truth for view class on #cardGrid.
 *  CSS namespaces: .grid-view / .list-view / .focus-view
 *  Each namespace has fully independent rules — no specificity conflicts. */
const ViewManager = {
  /** Apply the correct view class to #cardGrid. Called by setupFocusModeUI / setupGridModeUI / applyLayoutMode. */
  apply: function (mode) {
    const grid = document.getElementById('cardGrid');
    grid.classList.remove('grid-view', 'list-view', 'focus-view');
    grid.classList.add(mode + '-view');
  }
};

/** Fetch filtered data and resolve focus mode → returns { combined, groups, topLevel } */
function getRenderData() {
  const filtered = getFiltered();
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  let groups = getFilteredGroups();
  const topLevel = filtered.filter(function (b) { return !b.parentId; });

  if (LV.focusedGroupId) {
    const fg = A.siblingGroups.find(function (sg) { return sg.id === LV.focusedGroupId; });
    if (fg) {
      groups = [fg];
      setupFocusModeUI(fg);
    } else {
      LV.focusedGroupId = null;
      setupGridModeUI();
    }
  } else {
    setupGridModeUI();
  }

  const combined = buildCombinedList(groups, topLevel);
  return { combined: combined, groups: groups, topLevel: topLevel };
}

/** Build grid HTML string from combined list. Uses virtual-scroll placeholders when count > threshold. */
function buildGridHTML(combined) {
  var useVS = VS.shouldEnable(combined.length);
  var html = '';
  combined.forEach(function (item, i) {
    if (useVS && i >= VS.INITIAL) {
      var id = item.data.id;
      html += '<div class="vs-ph" data-vs-id="' + id + '" data-vs-type="' + item.type + '">'
        + '<div class="vs-ph-row"><div class="vs-ph-avatar"></div>'
        + '<div class="vs-ph-lines"><div class="vs-ph-line" style="width:60%"></div>'
        + '<div class="vs-ph-line" style="width:40%"></div></div></div></div>';
    } else {
      html += item.type === 'group' ? renderGroupCardHTML(item.data) : renderCardHTML(item.data);
    }
  });
  if (!html) {
    html = '<div class="empty"><div class="empty-icon">' + I.bookmark + '</div><h3>暂无书签</h3><p>点击 + 按钮开始收藏</p></div>';
  }
  return html;
}

/** Update panel header (count, title) */
function updatePanelHeader(combined) {
  if (!LV.focusedGroupId) {
    document.getElementById('panelCount').textContent = combined.length + ' 个';
    document.getElementById('panelTitle').textContent = (A.categories.find(function (c) { return c.id === LV.curCat; }) || {}).name || '全部书签';
  }
}

function renderContent() {
  try {
    const data = getRenderData();
    VS.disconnect();
    document.getElementById('cardGrid').innerHTML = buildGridHTML(data.combined);
    if (VS.shouldEnable(data.combined.length)) { VS.init(); VS.observeAll(); }
    updatePanelHeader(data.combined);
    renderRail();
    requestAnimationFrame(function() {
      updateCardTagsOverflow();
    });
  } catch (err) {
    console.error('[LinkVault] renderContent error:', err);
    /* Fallback: still render rail + show error in grid */
    try { renderRail(); } catch (_) {}
    document.getElementById('cardGrid').innerHTML =
      '<div class="empty"><div class="empty-icon">' + (typeof I !== 'undefined' ? I.bookmark : '') + '</div>'
      + '<h3>渲染出错</h3><p style="color:var(--text-muted);font-size:0.82rem">' + esc(String(err.message || err)) + '</p></div>';
  }
}

function setupFocusModeUI(g) {
  document.getElementById('filterTools').style.display = 'none';
  document.getElementById('focusBack').style.display = '';
  document.getElementById('focusBack').innerHTML = buildFocusToolbarHTML(g.id);
  document.getElementById('panelCount').textContent = '';
  // 显示组名和图标到面板标题
  const gIcon = g.icon || '';
  const panelTitle = document.getElementById('panelTitle');
  const iconHTML = gIcon
    ? '<img src="' + esc(gIcon) + '" alt=""><span class="panel-title-group-icon-fallback">' + I.note + '</span>'
    : I.note;
  const si = document.getElementById('searchInput');
  si.placeholder = '搜索组内…';
  si.dataset.focus = '1';
  // 保存当前列表模式，退出focus时恢复
  LV._prevLayoutMode = LV.layoutMode;
  ViewManager.apply('focus');
  const btnAdd = document.getElementById('btnAdd');
  if (btnAdd) btnAdd.style.display = 'none';
  const addWrap = document.getElementById('addWrap');
  if (addWrap) addWrap.style.display = 'none';
  const btnBatch = document.getElementById('btnBatch');
  if (btnBatch) btnBatch.style.display = 'none';
  const hamburger = document.getElementById('hamburgerBtn');
  if (hamburger) hamburger.style.display = 'none';
  if (window.innerWidth <= 768) document.getElementById('cardGrid').classList.add('focus-mobile');

  let title = document.getElementById('panelTitle');
  title.innerHTML = '<span class="panel-title-group-icon" onclick="exitGroupFocus()" title="返回" style="cursor:pointer">' + iconHTML + '</span><input id="focusGroupTitle" value="' + esc(g.name) + '" placeholder="输入组名…">';
  const input = document.getElementById('focusGroupTitle');
  input.style.cssText = 'font-family:Clash Display,system-ui,sans-serif;font-size:1.1rem;font-weight:600;background:transparent;border:none;border-bottom:1.5px dashed var(--border);outline:none;color:var(--text);padding:2px 4px;border-radius:0;min-width:40px;width:auto';
  const r = document.createElement('span');
  r.style.cssText = 'position:absolute;visibility:hidden;font-family:Clash Display,system-ui,sans-serif;font-size:1.1rem;font-weight:600;white-space:nowrap';
  document.body.appendChild(r);
  function fitTitle() { r.textContent = input.value || input.placeholder; input.style.width = (r.offsetWidth + 12) + 'px'; }
  input.oninput = fitTitle;
  fitTitle();
  input.onchange = function () { renameGroup(LV.focusedGroupId, this.value); };
  input.onblur = function () { this.style.borderBottomColor = 'var(--border)'; this.style.borderBottomStyle = 'dashed'; renameGroup(LV.focusedGroupId, this.value); };
  input.onfocus = function () { this.style.borderBottomColor = 'var(--accent)'; this.style.borderBottomStyle = 'solid'; this.select(); };
}

function setupGridModeUI() {
  document.getElementById('filterTools').style.display = 'flex';
  document.getElementById('focusBack').style.display = 'none';
  document.getElementById('cardGrid').classList.remove('focus-view', 'focus-mobile');
  const hamburger = document.getElementById('hamburgerBtn');
  if (hamburger) hamburger.style.display = '';
  const btnAdd = document.getElementById('btnAdd');
  if (btnAdd) btnAdd.style.display = '';
  const addWrap = document.getElementById('addWrap');
  if (addWrap) addWrap.style.display = '';
  const btnBatch = document.getElementById('btnBatch');
  if (btnBatch) btnBatch.style.display = '';
  // 恢复之前的列表模式（如果从focus模式退出）
  if (LV._prevLayoutMode) {
    LV.layoutMode = LV._prevLayoutMode;
    delete LV._prevLayoutMode;
  }
  applyLayoutMode();
  const si = document.getElementById('searchInput');
  si.placeholder = '搜索…';
  delete si.dataset.focus;
}

function initLayoutMode() {
  try {
    const saved = localStorage.getItem('lv_layoutMode');
    if (saved === 'list' || saved === 'grid') LV.layoutMode = saved;
  } catch(e) {}
  applyLayoutMode();
}

function setLayoutMode(mode) {
  if (LV.focusedGroupId) return;
  LV.layoutMode = mode;
  try { localStorage.setItem('lv_layoutMode', mode); } catch(e) {}
  applyLayoutMode();
  updateSettingsMenuActive();
}

function applyLayoutMode() {
  if (LV.focusedGroupId) return;
  ViewManager.apply(LV.layoutMode === 'list' ? 'list' : 'grid');
}

function updateSettingsMenuActive() {
  // Theme style
  const ts = document.documentElement.getAttribute('data-theme-style');
  const isComfortable = ts === 'comfortable';
  const segBtns = document.querySelectorAll('#themeStyleSegment .seg-btn');
  segBtns.forEach(function (btn) {
    const s = btn.getAttribute('data-style');
    btn.classList.toggle('active', (s === 'comfortable') === isComfortable);
  });
  // Layout mode
  const segBtns2 = document.querySelectorAll('#layoutSegment .seg-btn');
  segBtns2.forEach(function (btn) {
    const m = btn.getAttribute('data-mode');
    btn.classList.toggle('active', m === LV.layoutMode);
  });
}

function toggleBatchMode() {
  LV.batchMode = !LV.batchMode;
  LV.batchSelected = [];
  const btn = document.getElementById('btnBatch');
  if (btn) {
    btn.title = LV.batchMode ? '取消' : '批量管理';
    btn.classList.toggle('active', LV.batchMode);
  }
  if (LV.focusedGroupId) exitGroupFocus();
  renderContent();
  const bar = document.getElementById('batchBar');
  if (bar) bar.style.display = LV.batchMode ? 'flex' : 'none';
}

function toggleBatchSelect(itemId, e) {
  if (!LV.batchMode) return;
  if (e) e.stopPropagation();
  const idx = LV.batchSelected.indexOf(itemId);
  if (idx > -1) {
    LV.batchSelected.splice(idx, 1);
  } else {
    LV.batchSelected.push(itemId);
  }
  const cb = document.getElementById('batchChk_' + itemId);
  if (cb) cb.checked = idx === -1;
  updateBatchCount();
}

function selectAllBatch() {
  const filtered = getFiltered();
  const groups = getFilteredGroups();
  const allIds = filtered.map(function (b) { return b.id; })
    .concat(groups.map(function (g) { return 'group:' + g.id; }));
  const allSelected = allIds.length > 0 && allIds.every(function (id) { return LV.batchSelected.indexOf(id) !== -1; });
  if (allSelected) {
    LV.batchSelected = [];
    document.querySelectorAll('.batch-chk').forEach(function (cb) { cb.checked = false; });
  } else {
    LV.batchSelected = allIds;
    document.querySelectorAll('.batch-chk').forEach(function (cb) { cb.checked = true; });
  }
  updateBatchCount();
}

function batchDelete() {
  if (!LV.batchSelected.length) return;
  const bookmarkSnaps = [];
  const groupSnaps = [];
  LV.batchSelected.forEach(function (id) {
    if (id.indexOf('group:') === 0) {
      const gid = id.slice(6);
      const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
      if (sg) groupSnaps.push(JSON.parse(JSON.stringify(sg)));
      _deleteGroupInternal(gid);
    } else {
      const bm = A.bookmarks.find(function (b) { return b.id === id; });
      if (bm) {
        const snap = { bookmarks: [JSON.parse(JSON.stringify(bm))], groups: {} };
        A.siblingGroups.forEach(function (g) {
          if (g.bookmarkIds.indexOf(id) > -1) {
            if (!snap.groups[id]) snap.groups[id] = [];
            snap.groups[id].push(g.id);
            pushUndo(g.id);
          }
          g.bookmarkIds = g.bookmarkIds.filter(function (bid) { return bid !== id; });
          const gb = document.getElementById('sgBody_' + g.id);
          if (gb) {
            gb.querySelectorAll('.group-inline-card[data-bm-id="' + id + '"]').forEach(function (c) { c.remove(); });
            saveGroupBody(g.id);
          }
        });
        A.bookmarks = A.bookmarks.filter(function (b) { return b.id !== id; });
        bookmarkSnaps.push(snap);
      }
    }
  });
  LV.batchSelected = [];
  const totalCount = bookmarkSnaps.length + groupSnaps.length;
  debouncedSave(); renderContent();
  if (totalCount) {
    toast('已删除 ' + totalCount + ' 项');
    toastWithUndo('已删除 ' + totalCount + ' 项', function () {
      // 先恢复组，再恢复书签（书签可能属于被删除的组）
      groupSnaps.forEach(function (sg) {
        A.siblingGroups.push(sg);
      });
      if (groupSnaps.length) A.siblingGroups.sort(function (a, b) { return a.order - b.order; });
      bookmarkSnaps.forEach(function (snap) {
        snap.bookmarks.forEach(function (b) { A.bookmarks.push(b); });
        Object.keys(snap.groups).forEach(function (bid) {
          snap.groups[bid].forEach(function (gid) { addBmToGroup(bid, gid); });
        });
      });
      debouncedSave(); renderContent();
      toast('已恢复');
    });
  } else {
    toast('已删除');
  }
}

function batchAddToGroup(gid) {
  const bmIds = LV.batchSelected.filter(function (id) { return id.indexOf('group:') !== 0; });
  if (!bmIds.length) return;
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  pushUndo(gid);
  const body = document.getElementById('sgBody_' + gid);
  let added = 0;
  bmIds.forEach(function (bmId) {
    if (sg.bookmarkIds.indexOf(bmId) !== -1) return;
    sg.bookmarkIds.push(bmId);
    const b = A.bookmarks.find(function (x) { return x.id === bmId; });
    if (b && body) body.appendChild(buildInlineCard(b));
    added++;
  });
  if (body) saveGroupBody(gid);
  save();
  LV.batchSelected = [];
  updateCardStat(gid);
  if (added) toast('已将 ' + added + ' 个书签加入组');
  renderContent();
}

function updateBatchCount() {
  const el = document.getElementById('batchCount');
  if (el) el.textContent = '已选 ' + LV.batchSelected.length + ' 项';
}

function searchInFocusedGroup() {
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const body = document.getElementById('sgBody_' + LV.focusedGroupId);
  if (!body) return;
  const cards = body.querySelectorAll('.group-inline-card');
  cards.forEach(function (c) {
    const bmId = c.getAttribute('data-bm-id');
    if (!q) { c.style.display = ''; return; }
    if (bmId && bmId.indexOf('ref:') === 0) {
      const refGid = bmId.slice(4);
      const rg = A.siblingGroups.find(function (g) { return g.id === refGid; });
      if (rg && (rg.name || '').toLowerCase().indexOf(q) !== -1) c.style.display = '';
      else c.style.display = 'none';
    } else if (bmId) {
      const bm = A.bookmarks.find(function (b) { return b.id === bmId; });
      if (bm && (bm.title.toLowerCase().indexOf(q) !== -1 || bm.url.toLowerCase().indexOf(q) !== -1)) c.style.display = '';
      else c.style.display = 'none';
    }
  });
}

function toggleGroupFocus(gid) {
  const prev = LV.focusedGroupId;
  if (prev) { saveGroupBody(prev); save(); }
  const entering = (LV.focusedGroupId !== gid);
  LV.focusedGroupId = entering ? gid : null;
  if (prev !== LV.focusedGroupId) document.getElementById('searchInput').value = '';
  if (entering) pushNavState();
  renderContent();
}

function exitGroupFocus() {
  if (LV.focusedGroupId) { saveGroupBody(LV.focusedGroupId); save(); }
  document.getElementById('searchInput').value = '';
  LV.focusedGroupId = null;
  renderContent();
}

function toggleRail() {
  const rail = document.querySelector('.icon-rail');
  const overlay = document.getElementById('railOverlay');
  if (rail) rail.classList.toggle('open');
  if (overlay) overlay.classList.toggle('show');
}

function closeRail() {
  const rail = document.querySelector('.icon-rail');
  const overlay = document.getElementById('railOverlay');
  if (rail) rail.classList.remove('open');
  if (overlay) overlay.classList.remove('show');
}

/* Action Sheet */
function showActionSheet(items) {
  const sheet = document.getElementById('actionSheet');
  const list = document.getElementById('actionSheetList');
  list.innerHTML = items.map(function(it) {
    return '<button class="as-item' + (it.danger ? ' danger' : '') + '" onclick="' + it.action + ';hideActionSheet()">' + esc(it.label) + '</button>';
  }).join('');
  sheet.classList.add('show');
}
function hideActionSheet() { document.getElementById('actionSheet').classList.remove('show'); }

/* Long-press for mobile action sheet */
function _onTouchStart(e) {
  if (window.innerWidth > 768) return;
  LV.lpFired = false;
  if (LV.batchMode) return;
  if (e.target.closest('input, button, textarea, [contenteditable="true"]')) return;
  var card = e.target.closest('.card,.group-card');
  if (!card || card.classList.contains('group-card-focus')) return;
  LV.lpTarget = card;
  LV.lpTimer = setTimeout(function () {
    LV.lpTimer = null;
    LV.lpFired = true;
    var bmId = card.dataset.id;
    var gid = card.dataset.groupId;
    if (bmId) {
      showActionSheet([
        { label: '打开链接', action: 'visit(null,\'' + bmId + '\')' },
        { label: '编辑', action: 'editBm(\'' + bmId + '\')' },
        { label: '添加到组', action: 'addToGroup(null,event)' },
        { label: '删除', action: 'deleteBookmark(\'' + bmId + '\',true)', danger: true }
      ]);
    } else if (gid) {
      showActionSheet([
        { label: '展开组', action: 'toggleGroupFocus(\'' + gid + '\')' },
        { label: '编辑组', action: 'editGroup(\'' + gid + '\')' },
        { label: '删除组', action: 'deleteGroup(\'' + gid + '\')', danger: true }
      ]);
    }
  }, 500);
}
function _onTouchMove() { if (LV.lpTimer) { clearTimeout(LV.lpTimer); LV.lpTimer = null; LV.lpTarget = null; } }
function _onTouchEnd() { if (LV.lpTimer) { clearTimeout(LV.lpTimer); LV.lpTimer = null; LV.lpTarget = null; } }
LV.Touch = {
  init: function () {
    document.addEventListener('touchstart', _onTouchStart, { passive: true });
    document.addEventListener('touchmove', _onTouchMove, { passive: true });
    document.addEventListener('touchend', _onTouchEnd);
  },
  destroy: function () {
    document.removeEventListener('touchstart', _onTouchStart);
    document.removeEventListener('touchmove', _onTouchMove);
    document.removeEventListener('touchend', _onTouchEnd);
  }
};

function swapCardsDOM(a, b) {
  const elA = typeof a === 'string' ? document.querySelector(a) : a;
  const elB = typeof b === 'string' ? document.querySelector(b) : b;
  if (!elA || !elB || elA === elB) return;
  const parent = elA.parentNode;
  const nextA = elA.nextSibling, nextB = elB.nextSibling;
  if (nextA === elB) { parent.insertBefore(elB, elA); }
  else if (nextB === elA) { parent.insertBefore(elA, elB); }
  else { parent.insertBefore(elA, nextB); parent.insertBefore(elB, nextA); }
}


function toggleListExpand(btn) {
  const card = btn.closest('.card, .group-card');
  if (!card) return;
  const isGroup = card.classList.contains('group-card');
  const expandedClass = isGroup ? 'group-expanded' : 'card-expanded';
  const expanding = !card.classList.contains(expandedClass);
  card.classList.toggle(expandedClass);
  // 保存展开状态
  saveExpandState(card.dataset.id || card.dataset.groupId, expanding);
  if (expanding) {
    setTimeout(function () { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 360);
  }
  requestAnimationFrame(updateCardTagsOverflow);
}

// 展开状态管理
function saveExpandState(id, expanded) {
  if (!id) return;
  // 数据模型是主数据源
  const bm = A.bookmarks.find(function (b) { return b.id === id; });
  if (bm) { bm.isExpanded = expanded; save(); return; }
  const g = A.siblingGroups.find(function (sg) { return sg.id === id; });
  if (g) { g.isExpanded = expanded; save(); }
}

/* ---- Detail panel ---- */

function toggleDetailPanel() {
  const panel = document.getElementById('detailPanel');
  if (!panel) return;
  // 清除拖拽遗留的内联 width，避免覆盖 CSS 的 open 类
  panel.style.width = '';
  const wasOpen = panel.classList.contains('open');
  if (!wasOpen) pushNavState();
  if (!LV.detailCards.length && !wasOpen) { panel.classList.add('open'); renderDetailPanel(); }
  else { panel.classList.toggle('open'); if (!panel.classList.contains('open')) document.getElementById('detailSearchWrap').style.display = 'none'; }
}

function openDetail(bmId) {
  if (LV.detailCards.indexOf(bmId) === -1) LV.detailCards.push(bmId);
  renderDetailPanel();
}

function closeDetailCard(bmId) {
  LV.detailCards = LV.detailCards.filter(function (id) { return id !== bmId; });
  if (!LV.detailCards.length) {
    const panel = document.getElementById('detailPanel');
    panel.classList.remove('open');
    panel.style.width = '';
    document.getElementById('detailSearchWrap').style.display = 'none';
    return;
  }
  renderDetailPanel();
}

function renderDetailPanel() {
  const panel = document.getElementById('detailPanel');
  const inner = document.getElementById('detailInner');
  if (!LV.detailCards.length) {
    document.getElementById('detailSearchWrap').style.display = 'none';
    if (!panel.classList.contains('open')) return;
    inner.innerHTML = '<div class="empty" style="padding:40px 20px"><div class="empty-icon">' + I.bookmark + '</div><h3>辅助栏</h3><p>拖拽书签到此处查看</p></div>';
    return;
  }
  const wasClosed = !panel.classList.contains('open');
  panel.classList.add('open');
  document.getElementById('detailSearchWrap').style.display = '';
  if (wasClosed) document.getElementById('detailSearch').value = '';
  inner.innerHTML = LV.detailCards.map(function (entry, idx) {
    if (typeof entry === 'string' && entry.indexOf('group:') === 0) {
      const gid = entry.slice(6);
      const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
      if (!sg) return '';
      return '<div class="detail-card detail-group-card" draggable="true" data-bm-id="' + entry + '" data-didx="' + idx + '">'
        + '<button class="detail-close" data-action="closeDetail" data-id="' + entry + '">&times;</button>'
        + '<div style="margin-bottom:6px;display:flex;align-items:center;gap:8px">'
        + (sg.icon ? '<img src="' + esc(sg.icon) + '" alt="" style="border-radius:4px;object-fit:contain;width:36px;height:36px">' : '<div class="card-icon">' + I.note + '</div>')
        + '<div><div class="card-name">' + esc(sg.name || '未命名组') + '</div><div class="card-domain">' + sg.bookmarkIds.length + ' 个书签</div></div>'
        + '</div>'
        + '<div style="font-size:0.85rem;line-height:1.7;padding:4px 0;max-height:300px;overflow-y:auto;-webkit-mask-image:linear-gradient(to bottom,black calc(100% - 20px),transparent 100%);mask-image:linear-gradient(to bottom,black calc(100% - 20px),transparent 100%)">' + sanitizeHTML(sg.notes || '') + '</div>'
        + '</div>';
    }
    const bm = A.bookmarks.find(function (b) { return b.id === entry; });
    if (!bm) return '';
    const _da = bm.attributes || {};
    const dTags = renderAttrTags(_da);
    const dSubs = A.bookmarks.filter(function (b) { return b.parentId === bm.id; });
    let dSubsHTML = '';
    if (dSubs.length) {
      dSubsHTML = '<div class="sub-sites">';
      dSubs.forEach(function (sub) {
        dSubsHTML += '<span class="group-inline-card" contenteditable="false" data-bm-id="' + sub.id + '" data-action="visit" data-id="' + sub.id + '">'
          + '<img src="' + esc(sub.icon || favicon(sub.url)) + '" alt="">'
          + '<span class="gic-name">' + esc(sub.title) + '</span>'
          + '<span class="gic-btn" data-action="openDetail" data-id="' + sub.id + '">详情</span>'
          + '</span>';
      });
      dSubsHTML += '</div>';
    }
    return '<div class="detail-card" draggable="true" data-bm-id="' + bm.id + '" data-didx="' + idx + '">'
      + '<button class="detail-close" data-action="closeDetail" data-id="' + bm.id + '">&times;</button>'
      + '<div style="margin-bottom:8px;display:flex;align-items:center;gap:8px">'
      + '<div class="card-icon"><img src="' + (bm.icon || favicon(bm.url)) + '" alt=""><span class="icon-fallback">' + bm.title.charAt(0) + '</span></div>'
      + '<div><div class="card-name">' + esc(bm.title) + '</div><div class="card-domain">' + domain(bm.url) + '</div></div>'
      + '</div>'
      + (dTags ? '<div class="card-tags" style="margin-bottom:6px">' + dTags + '</div>' : '')
      + (bm.notes ? '<div class="card-notes" style="margin-bottom:6px">' + esc(bm.notes) + '</div>' : '')
      + (bm.username || bm.password ? '<div class="card-acct-body show" style="margin-bottom:8px">'
        + (bm.username ? '<div class="acct-row"><span class="acct-label">账户</span><span class="acct-val">' + esc(bm.username) + '</span><button class="acct-copy-btn" data-action="copyUser" data-id="' + bm.id + '" title="复制账户">' + I.copy + '</button></div>' : '')
        + (bm.password ? '<div class="acct-row"><span class="acct-label">密码</span><span class="acct-val">' + esc(bm.password ? safeAtob(bm.password) : '') + '</span><button class="acct-copy-btn" data-action="copyPw" data-id="' + bm.id + '" title="复制密码">' + I.copy + '</button></div>' : '')
        + '</div>' : '')
      + dSubsHTML
      + '<div style="display:flex;gap:6px;align-items:center;margin-top:8px">'
      + '<button class="btn btn-primary btn-sm" data-action="visit" data-id="' + bm.id + '">打开网站</button>'
      + '<button class="btn btn-secondary btn-sm" data-action="editBm" data-id="' + bm.id + '">编辑</button>'
      + '<span class="card-stat" style="margin-left:auto">' + I.click + ' ' + bm.useCount + '次</span>'
      + '</div></div>';
  }).join('');
  filterDetailCards();
}

function filterDetailCards() {
  const q = (document.getElementById('detailSearch').value || '').trim().toLowerCase();
  document.querySelectorAll('#detailInner .detail-card').forEach(function (c) {
    const name = c.querySelector('.card-name');
    const dom = c.querySelector('.card-domain');
    const t = (name ? name.textContent : '') + (dom ? dom.textContent : '');
    if (!q || t.toLowerCase().indexOf(q) !== -1) c.style.display = '';
    else c.style.display = 'none';
  });
}


//#endregion Render Module 渲染模块

// ==================== UI Module 界面模块 ====================
//#region UI Module 界面模块
/* ==================== BOOKMARK CRUD ==================== */

function visit(e, id) {
  if (e && e.target.closest('button')) return;
  const bm = A.bookmarks.find(function (b) { return b.id === id; });
  if (!bm) return;
  bm.useCount++; debouncedSave();
  const a = document.createElement('a');
  a.href = fixUrl(bm.url); a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  // Update useCount display without full re-render
  clearTimeout(LV.visitTimer);
  LV.visitTimer = setTimeout(function () {
    document.querySelectorAll('.card[data-id="' + id + '"] .card-stat').forEach(function (el) {
      el.innerHTML = I.click + ' ' + bm.useCount + '次';
    });
  }, 150);
}

function openBmModal(bm) {
  LV.lastFocusedEl = document.activeElement;
  LV.editingId = bm ? bm.id : null;
  const isSub = !!(bm && bm.parentId);
  document.getElementById('bmModalTitle').textContent = bm ? (isSub ? '编辑子书签' : '编辑书签') : '添加书签';
  document.getElementById('bmId').value = bm ? bm.id : '';
  document.getElementById('bmTitle').value = bm ? bm.title : '';
  document.getElementById('bmUrl').value = bm ? bm.url : '';
  document.getElementById('bmUser').value = bm ? bm.username : '';
  document.getElementById('bmPass').value = bm && bm.password ? safeAtob(bm.password) : '';
  document.getElementById('bmNotes').value = bm ? bm.notes : '';
  document.getElementById('bmIcon').value = bm && bm.icon ? bm.icon : '';
  ['bmCat', 'bmUser', 'bmPass', 'bmIcon'].forEach(function (id) {
    const el = document.getElementById(id); if (el) el.closest('.form-group').style.display = isSub ? 'none' : '';
  });
  ['btnClearIcon', 'iconPreview'].forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = isSub ? 'none' : ''; });
  const lp = document.getElementById('logoPreview'); if (lp) lp.style.display = isSub ? 'none' : '';
  if (bm && bm.icon && !isSub) {
    document.getElementById('btnClearIcon').style.display = '';
    document.getElementById('iconPreview').style.display = 'flex';
    document.getElementById('iconPreviewImg').src = bm.icon;
  } else {
    document.getElementById('btnClearIcon').style.display = 'none';
    document.getElementById('iconPreview').style.display = 'none';
  }
  const catSel = document.getElementById('bmCat');
  catSel.innerHTML = buildCatOptions(bm ? bm.categoryId : CAT_UNCATEGORIZED);
  const pSel = document.getElementById('bmParent');
  // 排除自身及其所有子孙（避免循环引用）
  const excludeIds = {};
  if (bm) {
    excludeIds[bm.id] = true;
    (function collectDescendants(pid) {
      A.bookmarks.forEach(function (b) {
        if (b.parentId === pid && !excludeIds[b.id]) {
          excludeIds[b.id] = true;
          collectDescendants(b.id);
        }
      });
    })(bm.id);
  }
  const opts = A.bookmarks.filter(function (b) { return !excludeIds[b.id]; });
  pSel.innerHTML = '<option value="">无（顶级书签）</option>' + opts.map(function (b) { return '<option value="' + b.id + '" ' + (bm && bm.parentId === b.id ? 'selected' : '') + '>' + esc(b.title) + '</option>'; }).join('');
  const attrDiv = document.getElementById('bmAttrs');
  const parentAttrs = bm && bm.parentId ? (A.bookmarks.find(function (b) { return b.id === bm.parentId; }) || {}).attributes || {} : {};
  // 新建书签时默认勾选「国内可用」
  const initAttrs = bm ? bm.attributes : { 'china-available': true };
  attrDiv.innerHTML = buildAttrCheckboxes(initAttrs, parentAttrs);
  pushNavState();
  document.getElementById('bmModal').classList.add('open');
  setTimeout(function () { document.getElementById('bmTitle').focus(); }, 100);
  previewLogo();
}

function closeBmModal() { document.getElementById('bmModal').classList.remove('open'); LV.editingId = null; if (LV.lastFocusedEl) LV.lastFocusedEl.focus(); LV.lastFocusedEl = null; }

function previewLogo() {
  const url = document.getElementById('bmUrl').value;
  const pv = document.getElementById('logoPreview');
  const fixed = url.indexOf('http') === 0 ? url : 'https://' + url;
  if (url && url.length > 3) { pv.style.display = 'flex'; document.getElementById('logoPreviewImg').src = favicon(fixed); document.getElementById('logoPreviewText').textContent = domain(fixed); }
  else pv.style.display = 'none';
}

function previewIconUrl() {
  const url = document.getElementById('bmIcon').value.trim();
  if (url) { document.getElementById('btnClearIcon').style.display = ''; document.getElementById('iconPreview').style.display = 'flex'; document.getElementById('iconPreviewImg').src = url; }
  else { document.getElementById('btnClearIcon').style.display = 'none'; document.getElementById('iconPreview').style.display = 'none'; }
}

function clearIcon() { document.getElementById('bmIcon').value = ''; document.getElementById('btnClearIcon').style.display = 'none'; document.getElementById('iconPreview').style.display = 'none'; }

function saveBm() {
  const title = document.getElementById('bmTitle').value.trim();
  const url = document.getElementById('bmUrl').value.trim();
  if (!title || !url) { toast('请填写名称和网址', false); return; }
  const parentId = document.getElementById('bmParent').value || null;
  const attrs = {};
  if (parentId) { const pBm = A.bookmarks.find(function (b) { return b.id === parentId; }); if (pBm) Object.assign(attrs, pBm.attributes || {}); }
  A.customAttributes.forEach(function (a) { const cb = document.querySelector('#bmAttrs input[data-attr="' + a.id + '"]'); attrs[a.id] = !!(cb && cb.checked); });
  const data = {
    title: title, url: fixUrl(url),
    username: document.getElementById('bmUser').value.trim(),
    password: document.getElementById('bmPass').value ? btoa(document.getElementById('bmPass').value) : '',
    notes: document.getElementById('bmNotes').value.trim(),
    icon: document.getElementById('bmIcon').value.trim(),
    categoryId: document.getElementById('bmCat').value,
    parentId: parentId,
    attributes: attrs,
    updatedAt: Date.now()
  };
  let savedId;
  if (LV.editingId) {
    const idx = A.bookmarks.findIndex(function (b) { return b.id === LV.editingId; });
    if (idx >= 0) { A.bookmarks[idx] = Object.assign({}, A.bookmarks[idx], data); savedId = LV.editingId; }
  } else {
    const maxOrder = Math.max(0, A.bookmarks.filter(function (b) { return b.parentId === data.parentId; }).reduce(function (m, b) { return Math.max(m, b.order); }, 0));
    savedId = gid();
    A.bookmarks.push(Object.assign({ id: savedId }, data, { order: maxOrder + 1, useCount: 0, isExpanded: false, createdAt: Date.now() }));
  }
  if (LV.saveToGroup && savedId) { saveGroupBody(LV.saveToGroup); addBmToGroup(savedId, LV.saveToGroup); }
  LV.saveToGroup = null;
  save(); closeBmModal(); renderContent();
  toast(LV.editingId ? '书签已更新' : '书签已添加');
}

function editBm(id) { const bm = A.bookmarks.find(function (b) { return b.id === id; }); if (bm) openBmModal(bm); }

function addSub(pid) {
  openBmModal(null);
  document.getElementById('bmParent').value = pid;
  document.getElementById('bmModalTitle').textContent = '添加子书签';
  ['bmCat', 'bmUser', 'bmPass', 'bmIcon'].forEach(function (id) { const el = document.getElementById(id); if (el) el.closest('.form-group').style.display = 'none'; });
  ['btnClearIcon', 'iconPreview', 'logoPreview'].forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
}

/** Collect all sub-bookmark IDs recursively */
function collectSubIds(id) {
  let ids = [id];
  A.bookmarks.filter(function (b) { return b.parentId === id; }).forEach(function (c) {
    ids = ids.concat(collectSubIds(c.id));
  });
  return ids;
}

function deleteBookmark(id, skipRender) {
  _doDeleteBookmark(id, skipRender);
}

function _doDeleteBookmark(id, skipRender) {
  const ids = collectSubIds(id);
  // Snapshot for undo: bookmark data + group memberships
  const snapshot = { bookmarks: [], groups: {} };
  ids.forEach(function (bid) {
    const b = A.bookmarks.find(function (x) { return x.id === bid; });
    if (b) {
      snapshot.bookmarks.push(JSON.parse(JSON.stringify(b)));
      delete LV.pwShown[bid];
    }
  });
  // Record group memberships & remove from groups
  ids.forEach(function (bid) {
    A.siblingGroups.forEach(function (g) {
      if (g.bookmarkIds.indexOf(bid) > -1) {
        if (!snapshot.groups[bid]) snapshot.groups[bid] = [];
        if (snapshot.groups[bid].indexOf(g.id) === -1) snapshot.groups[bid].push(g.id);
        pushUndo(g.id);
      }
      g.bookmarkIds = g.bookmarkIds.filter(function (bid2) { return bid2 !== bid; });
      const gb = document.getElementById('sgBody_' + g.id);
      if (gb) {
        gb.querySelectorAll('.group-inline-card[data-bm-id="' + bid + '"]').forEach(function (c) { c.remove(); });
        saveGroupBody(g.id);
      }
    });
  });
  // Actually remove bookmarks
  A.bookmarks = A.bookmarks.filter(function (b) { return ids.indexOf(b.id) === -1; });

  if (skipRender) {
    // Surgical DOM update — remove cards directly, patch counts
    var removedFromGrid = 0;
    ids.forEach(function (bid) {
      var card = document.querySelector('#cardGrid .card[data-id="' + bid + '"]');
      if (card) { card.remove(); removedFromGrid++; }
      removeFromDetailPanel(bid);
    });
    if (removedFromGrid) {
      var grid = document.getElementById('cardGrid');
      if (!grid.querySelector('.card')) {
        grid.innerHTML = '<div class="empty"><div class="empty-icon">' + I.bookmark + '</div><h3>暂无书签</h3><p>点击 + 按钮开始收藏</p></div>';
      }
    }
    updateRailCounts();
    if (removedFromGrid) updatePanelCount(removedFromGrid);
    A.siblingGroups.forEach(function (g) { updateCardStat(g.id); });
    debouncedSave();
  } else {
    debouncedSave(); renderContent();
  }

  toast('书签已删除');
  toastWithUndo('书签已删除', function () {
    // Restore bookmarks
    snapshot.bookmarks.forEach(function (b) { A.bookmarks.push(b); });
    // Restore group memberships
    Object.keys(snapshot.groups).forEach(function (bid) {
      snapshot.groups[bid].forEach(function (gid) { addBmToGroup(bid, gid); });
    });
    debouncedSave(); renderContent();
    toast('已恢复');
  });
}

function toggleAcct(btn, id) { btn.classList.toggle('open'); btn.nextElementSibling.classList.toggle('show'); }

function togglePwCard(id) {
  const bm = A.bookmarks.find(function (b) { return b.id === id; });
  if (!bm) return;
  LV.pwShown[id] = !LV.pwShown[id];
  const el = document.getElementById('pwdisp_' + id);
  if (el) el.textContent = LV.pwShown[id] ? (bm.password ? safeAtob(bm.password) : '') : '••••••';
}

/* ==================== GROUP OPERATIONS ==================== */

function createGroup() {
  A.siblingGroups.forEach(function (g) { g.order++; });
  A.bookmarks.filter(function (b) { return !b.parentId; }).forEach(function (b) { b.order++; });
  const sg = { id: gid(), name: '未命名', bookmarkIds: [], notes: '', categoryId: CAT_UNCATEGORIZED, icon: '', attributes: { [ATTR_IS_GROUP]: true }, order: 0, isExpanded: false };
  A.siblingGroups.push(sg);
  debouncedSave(); renderContent();
}

function renameGroup(id, name) { const sg = A.siblingGroups.find(function (g) { return g.id === id; }); if (sg) { sg.name = name || '未命名'; save(); } }

function _deleteGroupInternal(id) {
  A.siblingGroups = A.siblingGroups.filter(function (g) { return g.id !== id; });
  delete LV.undoStacks[id];
  _undoBytesDirty = true;
  if (LV.undoTimers[id]) { clearTimeout(LV.undoTimers[id]); delete LV.undoTimers[id]; }
  A.siblingGroups.forEach(function (g) {
    const bodyEl = document.getElementById('sgBody_' + g.id);
    if (bodyEl) {
      bodyEl.querySelectorAll('.group-ref-card[data-bm-id="ref:' + id + '"]').forEach(function (c) { c.remove(); });
      saveGroupBody(g.id);
    }
  });
}

function deleteGroup(id) {
  const sg = A.siblingGroups.find(function (g) { return g.id === id; });
  if (!sg) return;
  const snapshot = JSON.parse(JSON.stringify(sg));
  _deleteGroupInternal(id);
  debouncedSave(); renderContent();
  toast('组已删除');
  toastWithUndo('组已删除', function () {
    A.siblingGroups.push(snapshot);
    A.siblingGroups.sort(function (a, b) { return a.order - b.order; });
    debouncedSave(); renderContent();
    toast('组已恢复');
  });
}

/* ---- Group body management ---- */

function saveGroupBody(gid) {
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  const el = document.getElementById('sgBody_' + gid);
  if (!sg || !el) return;
  sg.notes = sanitizeHTML(el.innerHTML);
}

function syncGroupBookmarks(gid) {
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  const el = document.getElementById('sgBody_' + gid);
  if (!sg || !el) return;
  const cards = el.querySelectorAll('.group-inline-card[data-bm-id]');
  const ids = [], seen = {};
  cards.forEach(function (c) {
    const bmid = c.getAttribute('data-bm-id');
    if (bmid && bmid.indexOf('ref:') !== 0 && !seen[bmid]) { seen[bmid] = true; ids.push(bmid); }
  });
  sg.bookmarkIds = ids;
  save();
}

function handleGroupPaste(e, gid) {
  e.preventDefault();
  pushUndo(gid);
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
}

function ensureTextSibling(el, side) {
  const t = side === 'before' ? el.previousSibling : el.nextSibling;
  if (!t || t.nodeType !== 3 || t.textContent !== '​') {
    const z = document.createTextNode('​');
    if (side === 'before') el.parentNode.insertBefore(z, el);
    else el.parentNode.insertBefore(z, el.nextSibling);
  }
}

/* ---- Undo/redo ---- */

function pushUndo(gid) {
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  const body = document.getElementById('sgBody_' + gid);
  if (body) sg.notes = sanitizeHTML(body.innerHTML);
  if (!LV.undoStacks[gid]) LV.undoStacks[gid] = { undo: [], redo: [] };
  const stack = LV.undoStacks[gid];
  if (LV.undoTimers[gid]) { clearTimeout(LV.undoTimers[gid]); }
  else {
    // 清空 redo 栈，同步扣减已跟踪的字节数
    if (stack.redo.length) {
      stack.redo.forEach(function (s) { _totalUndoBytes -= snapSize(s); });
    }
    stack.redo = [];
    if (stack.undo.length >= MAX_UNDO) {
      _totalUndoBytes -= snapSize(stack.undo[0]);
      stack.undo.shift();
    }
    const newSnap = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() };
    stack.undo.push(newSnap);
    _totalUndoBytes += snapSize(newSnap);
    // Evict oldest snapshots if total memory exceeds cap
    while (totalUndoBytes() > MAX_UNDO_BYTES && stack.undo.length > 1) {
      evictOldestUndo();
    }
  }
  LV.undoTimers[gid] = setTimeout(function () { delete LV.undoTimers[gid]; }, UNDO_WINDOW);
  updateUndoRedoButtons(gid);
}

function performUndo(gid) {
  const stack = LV.undoStacks[gid];
  if (!stack || !stack.undo.length) return false;
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return false;
  const body = document.getElementById('sgBody_' + gid);
  if (body) sg.notes = sanitizeHTML(body.innerHTML);
  if (stack.redo.length >= MAX_UNDO) {
    _totalUndoBytes -= snapSize(stack.redo[0]);
    stack.redo.shift();
  }
  const redoSnap = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() };
  stack.redo.push(redoSnap);
  _totalUndoBytes += snapSize(redoSnap);
  const snap = stack.undo.pop();
  _totalUndoBytes -= snapSize(snap);
  restoreSnapshot(gid, snap);
  debouncedSave(); toast('已撤销');
  return true;
}

function performRedo(gid) {
  const stack = LV.undoStacks[gid];
  if (!stack || !stack.redo || !stack.redo.length) return false;
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return false;
  const body = document.getElementById('sgBody_' + gid);
  if (body) sg.notes = sanitizeHTML(body.innerHTML);
  if (stack.undo.length >= MAX_UNDO) {
    _totalUndoBytes -= snapSize(stack.undo[0]);
    stack.undo.shift();
  }
  const undoSnap = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() };
  stack.undo.push(undoSnap);
  _totalUndoBytes += snapSize(undoSnap);
  const snap = stack.redo.pop();
  _totalUndoBytes -= snapSize(snap);
  restoreSnapshot(gid, snap);
  debouncedSave(); toast('已前进');
  return true;
}

function restoreSnapshot(gid, snap) {
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  sg.bookmarkIds = snap.bookmarkIds.filter(function (bid) {
    return A.bookmarks.find(function (b) { return b.id === bid; });
  });
  sg.notes = snap.notes;
  const body = document.getElementById('sgBody_' + gid);
  if (body) {
    body.innerHTML = sg.notes || '';
    body.querySelectorAll('.group-inline-card[data-bm-id]').forEach(function (c) {
      const bmid = c.getAttribute('data-bm-id');
      const bm = A.bookmarks.find(function (b) { return b.id === bmid; });
      if (!bm) c.remove();
    });
  }
  updateUndoRedoButtons(gid);
  const stat = document.querySelector('.group-card[data-group-id="' + gid + '"] .card-stat');
  if (stat) stat.innerHTML = sg.bookmarkIds.length + ' 个书签';
}

function buildFocusToolbarHTML(gid) {
  const stack = LV.undoStacks[gid];
  const hasUndo = !!(stack && stack.undo && stack.undo.length > 0);
  const hasRedo = !!(stack && stack.redo && stack.redo.length > 0);
  return '<button class="ft-btn" data-action="addToGroup" data-id="' + gid + '" title="添加书签到组">' + I.plus + '</button>'
    + '<button class="ft-btn" data-action="editGroup" data-id="' + gid + '" title="编辑组">' + I.edit + '</button>'
    + '<button class="ft-btn' + (hasUndo ? '' : ' disabled') + '" style="margin-left:auto" data-action="undoGroup" data-id="' + gid + '" title="撤销">' + I.undo + '</button>'
    + '<button class="ft-btn' + (hasRedo ? '' : ' disabled') + '" data-action="redoGroup" data-id="' + gid + '" title="前进">' + I.redo + '</button>'
    + '<button class="ft-btn" data-action="exitFocus" title="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
}

function updateUndoRedoButtons(gid) {
  const card = document.querySelector('.group-card[data-group-id="' + gid + '"]');
  if (!card) return;
  const undoBtn = card.querySelector('.btn-undo-group');
  const redoBtn = card.querySelector('.btn-redo-group');
  const stack = LV.undoStacks[gid];
  if (undoBtn) undoBtn.classList.toggle('disabled', !(stack && stack.undo && stack.undo.length > 0));
  if (redoBtn) redoBtn.classList.toggle('disabled', !(stack && stack.redo && stack.redo.length > 0));
  const focusBack = document.getElementById('focusBack');
  if (focusBack) {
    const ftUndo = focusBack.querySelector('[data-action="undoGroup"]');
    const ftRedo = focusBack.querySelector('[data-action="redoGroup"]');
    if (ftUndo) ftUndo.classList.toggle('disabled', !(stack && stack.undo && stack.undo.length > 0));
    if (ftRedo) ftRedo.classList.toggle('disabled', !(stack && stack.redo && stack.redo.length > 0));
  }
}

function updateCardStat(gid) {
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  const stat = document.querySelector('.group-card[data-group-id="' + gid + '"] .card-stat');
  if (stat) stat.innerHTML = sg.bookmarkIds.length + ' 个书签';
}

/** Patch rail category counts without rebuilding rail HTML. */
function updateRailCounts() {
  var counts = getCardCounts();
  A.categories.forEach(function (c) {
    var el = document.querySelector('.rail-item[data-cat-id="' + c.id + '"] .rail-count');
    if (el) el.textContent = counts[c.id] || 0;
  });
  var sto = document.getElementById('railStorage');
  if (sto) {
    var info = getStorageInfo();
    var barEl = sto.querySelector('.rail-storage-bar');
    if (barEl) {
      barEl.style.width = info.percent + '%';
      barEl.style.background = info.percent > 90 ? 'var(--danger)' : info.percent > 70 ? 'var(--warn)' : 'var(--accent)';
    }
    var txtEl = sto.querySelector('.rail-storage-text');
    if (txtEl) txtEl.innerHTML = info.label + ' <span class="rail-storage-pct">(' + info.percent + '%)</span>';
  }
}

/** Decrement the panel item count by delta (surgical). */
function updatePanelCount(delta) {
  if (LV.focusedGroupId) return;
  var el = document.getElementById('panelCount');
  if (!el) return;
  var m = el.textContent.match(/(\d+)/);
  if (m) el.textContent = Math.max(0, parseInt(m[1]) - delta) + ' 个';
}

/** Remove a single card from the detail panel if present. */
function removeFromDetailPanel(bid) {
  var idx = LV.detailCards.indexOf(bid);
  if (idx < 0) return;
  LV.detailCards.splice(idx, 1);
  var card = document.querySelector('#detailInner .detail-card[data-bm-id="' + bid + '"]');
  if (card) card.remove();
  if (!LV.detailCards.length) {
    var panel = document.getElementById('detailPanel');
    panel.classList.remove('open');
    panel.style.width = '';
    document.getElementById('detailSearchWrap').style.display = 'none';
  }
}

/* ---- Inline card const ructors ---- */

function inlineCardHTML(bm) {
  return '<span class="group-inline-card" contenteditable="false" data-bm-id="' + bm.id + '" draggable="true">'
    + '<img src="' + esc(bm.icon || favicon(bm.url)) + '" alt="">'
    + '<span class="gic-name">' + esc(bm.title) + '</span>'
    + '<span class="gic-domain">' + domain(bm.url) + '</span>'
    + '<span class="gic-btn">详情</span>'
    + '<span class="gic-remove" title="移除">&times;</span>'
    + '</span>';
}

function groupRefCardHTML(g) {
  return '<span class="group-inline-card group-ref-card" contenteditable="false" data-bm-id="ref:' + g.id + '" draggable="true">'
    + (g.icon ? '<img src="' + esc(g.icon) + '" alt="">' : '<span style="width:16px;height:16px;flex-shrink:0;color:var(--accent)">' + I.note + '</span>')
    + '<span class="gic-name">' + esc(g.name || '未命名组') + '</span>'
    + '<span class="gic-count">' + g.bookmarkIds.length + '个</span>'
    + '<span class="gic-btn">详情</span>'
    + '<span class="gic-remove" title="移除">&times;</span>'
    + '</span>';
}

function buildInlineCard(bm) {
  const span = document.createElement('span');
  span.className = 'group-inline-card';
  span.setAttribute('contenteditable', 'false');
  span.setAttribute('data-bm-id', bm.id);
  span.setAttribute('draggable', 'true');
  const img = document.createElement('img');
  img.src = bm.icon || favicon(bm.url);
  img.alt = '';
  img.onerror = function () { this.classList.add('img-error'); };
  const name = document.createElement('span');
  name.className = 'gic-name';
  name.textContent = bm.title;
  const dm = document.createElement('span');
  dm.className = 'gic-domain';
  dm.textContent = domain(bm.url);
  const btn = document.createElement('span');
  btn.className = 'gic-btn';
  btn.textContent = '详情';
  const rm = document.createElement('span');
  rm.className = 'gic-remove';
  rm.innerHTML = '&times;';
  span.appendChild(img); span.appendChild(name); span.appendChild(dm);
  span.appendChild(btn); span.appendChild(rm);
  return span;
}

/* ---- Add/remove bookmarks to/from groups (DOM-only, no full re-render) ---- */

function addBmToGroup(bmId, gid) {
  pushUndo(gid);
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  sg.bookmarkIds.push(bmId);
  const b = A.bookmarks.find(function (x) { return x.id === bmId; });
  if (b) {
    const body = document.getElementById('sgBody_' + gid);
    if (body) body.appendChild(buildInlineCard(b));
    saveGroupBody(gid);
  }
  save();
  updateCardStat(gid);
  toast('已加入组');
}

function removeBmFromGroup(bmId, gid, cardEl) {
  pushUndo(gid);
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  const idx = sg.bookmarkIds.indexOf(bmId);
  if (idx >= 0) sg.bookmarkIds.splice(idx, 1);
  if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
  saveGroupBody(gid);
  save();
  updateCardStat(gid);
  toast('已从组移除');
}

function addGroupRefToGroup(srcGid, targetGid) {
  pushUndo(targetGid);
  const src = A.siblingGroups.find(function (g) { return g.id === srcGid; });
  const target = A.siblingGroups.find(function (g) { return g.id === targetGid; });
  if (!src || !target || srcGid === targetGid) return;
  const body = document.getElementById('sgBody_' + targetGid);
  if (body) {
    const tmp = document.createElement('div');
    tmp.innerHTML = groupRefCardHTML(src);
    while (tmp.firstChild) body.appendChild(tmp.firstChild);
    saveGroupBody(targetGid);
  }
  save(); toast('已添加组引用');
}

function removeGroupRef(targetGid, srcGid) {
  const body = document.getElementById('sgBody_' + targetGid);
  if (body) {
    const card = body.querySelector('.group-ref-card[data-bm-id="ref:' + srcGid + '"]');
    if (card) card.remove();
    saveGroupBody(targetGid);
  }
  save(); toast('已移除组引用');
}

function removeFromSrcGroup(srcGid, bmId) {
  if (!srcGid || !bmId) return false;
  const sg = A.siblingGroups.find(function (g) { return g.id === srcGid; });
  if (!sg) return false;
  const idx = sg.bookmarkIds.indexOf(bmId);
  if (idx < 0) return false;
  sg.bookmarkIds.splice(idx, 1);
  const body = document.getElementById('sgBody_' + srcGid);
  if (body) {
    const card = body.querySelector('.group-inline-card[data-bm-id="' + bmId + '"]');
    if (card) card.remove();
    saveGroupBody(srcGid);
  }
  return true;
}

/* ---- Add-to-group popover ---- */

function addToGroup(gid, event) {
  LV.addToGid = gid;
  const btn = event.target.closest('button');
  const rect = btn ? btn.getBoundingClientRect() : null;
  const card = document.getElementById('addBmPopover');
  const inner = card.querySelector('.popover-card');
  document.getElementById('addBmSearch').value = '';
  card.style.display = 'block';
  if (rect) {
    inner.style.top = Math.min(rect.bottom + 4, window.innerHeight - 370) + 'px';
    inner.style.left = Math.min(rect.left, window.innerWidth - 370) + 'px';
  } else {
    inner.style.top = Math.max(80, (window.innerHeight - 370) / 2) + 'px';
    inner.style.left = Math.max(20, (window.innerWidth - 360) / 2) + 'px';
  }
  setTimeout(function () { document.getElementById('addBmSearch').focus(); }, 50);
  renderAddBmResults();
}

function closeAddBmPopover() { document.getElementById('addBmPopover').style.display = 'none'; LV.addToGid = null; }

function renderAddBmResults() {
  const q = (document.getElementById('addBmSearch').value || '').toLowerCase();
  let results = A.bookmarks.slice();
  if (q) results = results.filter(function (b) { return b.title.toLowerCase().indexOf(q) !== -1 || b.url.toLowerCase().indexOf(q) !== -1 || b.notes.toLowerCase().indexOf(q) !== -1; });
  results = results.slice(0, 20);
  const container = document.getElementById('addBmResults');
  if (!results.length) { container.innerHTML = '<div class="popover-result" style="justify-content:center;color:var(--text-muted);cursor:default">' + (q ? '无匹配书签' : '输入关键词搜索…') + '</div>'; return; }
  container.innerHTML = results.map(function (b) {
    return '<div class="popover-result" onclick="addBmExisting(\'' + b.id + '\')">'
      + '<img src="' + (b.icon || favicon(b.url)) + '" alt="">'
      + '<span class="pr-name">' + esc(b.title) + '</span>'
      + '<span class="pr-url">' + domain(b.url) + '</span></div>';
  }).join('');
}

function addBmExisting(bmId) { if (!LV.addToGid) return; addBmToGroup(bmId, LV.addToGid); closeAddBmPopover(); }

function addBmNew() {
  if (!LV.addToGid) return;
  LV.saveToGroup = LV.addToGid;
  openBmModal(null);
  document.getElementById('bmModalTitle').textContent = '新建书签并添加到组';
  closeAddBmPopover();
}

/* ---- Group edit modal ---- */

function editGroup(gid) {
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  LV.editingGeId = gid;
  document.getElementById('geId').value = gid;
  document.getElementById('geName').value = sg.name || '';
  document.getElementById('geIcon').value = sg.icon || '';
  if (sg.icon) { document.getElementById('btnClearGeIcon').style.display = ''; document.getElementById('geIconPreview').style.display = 'flex'; document.getElementById('geIconPreviewImg').src = sg.icon; }
  else { document.getElementById('btnClearGeIcon').style.display = 'none'; document.getElementById('geIconPreview').style.display = 'none'; }
  document.getElementById('geCat').innerHTML = buildCatOptions(sg.categoryId);
  document.getElementById('geAttrs').innerHTML = buildAttrCheckboxes(sg.attributes);
  LV.lastFocusedEl = document.activeElement;
  renderGeBookmarks(gid);
  pushNavState();
  document.getElementById('groupEditModal').classList.add('open');
}

function renderGeBookmarks(gid) {
  const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  const container = document.getElementById('geBookmarks');
  if (!sg || !sg.bookmarkIds.length) { container.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">暂无书签</div>'; return; }
  container.innerHTML = sg.bookmarkIds.map(function (id) {
    const bm = A.bookmarks.find(function (b) { return b.id === id; });
    if (!bm) return '';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:4px;background:var(--bg-alt);border-radius:8px;border:1px solid var(--border-light)">'
      + '<img src="' + (bm.icon || favicon(bm.url)) + '" style="width:18px;height:18px" alt="">'
      + '<span style="flex:1;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(bm.title) + '</span>'
      + '<span style="font-size:0.7rem;color:var(--text-muted)">' + domain(bm.url) + '</span>'
      + '<button class="btn-xs btn-danger" data-action="removeBmFromGe" data-id="' + id + '" data-gid="' + gid + '">' + I.trash + '</button></div>';
  }).join('');
}

function previewGeIconUrl() {
  const url = document.getElementById('geIcon').value.trim();
  if (url) { document.getElementById('btnClearGeIcon').style.display = ''; document.getElementById('geIconPreview').style.display = 'flex'; document.getElementById('geIconPreviewImg').src = url; }
  else { document.getElementById('btnClearGeIcon').style.display = 'none'; document.getElementById('geIconPreview').style.display = 'none'; }
}

function clearGeIcon() { document.getElementById('geIcon').value = ''; document.getElementById('btnClearGeIcon').style.display = 'none'; document.getElementById('geIconPreview').style.display = 'none'; }

function closeGroupEdit() { document.getElementById('groupEditModal').classList.remove('open'); LV.editingGeId = null; if (LV.lastFocusedEl) LV.lastFocusedEl.focus(); LV.lastFocusedEl = null; }

function saveGroupEdit() {
  if (!LV.editingGeId) return;
  const sg = A.siblingGroups.find(function (g) { return g.id === LV.editingGeId; });
  if (!sg) return;
  sg.name = document.getElementById('geName').value.trim() || '未命名';
  sg.categoryId = document.getElementById('geCat').value;
  sg.icon = document.getElementById('geIcon').value.trim();
  sg.attributes = {};
  A.customAttributes.forEach(function (a) { const cb = document.querySelector('#geAttrs input[data-attr="' + a.id + '"]'); sg.attributes[a.id] = !!(cb && cb.checked); });
  save(); closeGroupEdit(); renderContent(); toast('组已更新');
}

/* ==================== CATEGORY / ATTRIBUTE MANAGEMENT ==================== */

function openCatModal() { LV.lastFocusedEl = document.activeElement; renderCatList(); pushNavState(); document.getElementById('catModal').classList.add('open'); setTimeout(function () { document.getElementById('newCatName').focus(); }, 50); }
function closeCatModal() { document.getElementById('catModal').classList.remove('open'); if (LV.lastFocusedEl) LV.lastFocusedEl.focus(); LV.lastFocusedEl = null; }

function renderCatList() {
  document.getElementById('catManageList').innerHTML = A.categories.filter(function (c) { return c.id !== CAT_ALL; }).map(function (c) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:4px;background:var(--bg-alt);border-radius:8px;border:1px solid var(--border-light)">'
      + '<span style="color:' + c.color + '">' + (I[c.icon] || I.star) + '</span>'
      + '<span style="flex:1;font-size:0.85rem">' + esc(c.name) + '</span>'
      + '<button class="btn-xs btn-danger" data-action="deleteCat" data-id="' + c.id + '">' + I.trash + '</button></div>';
  }).join('');
}

function addCat() {
  const n = document.getElementById('newCatName').value.trim();
  if (!n) { toast('请输入名称', false); return; }
  const colors = ['#122E8A', '#E6397C', '#d97706', '#7c3aed', '#0d9488', '#db2777', '#2563eb', '#059669'];
  A.categories.push({ id: gid(), name: n, icon: 'star', color: colors[Math.floor(Math.random() * colors.length)] });
  document.getElementById('newCatName').value = '';
  save(); renderRail(); renderCatList(); toast('分类已添加');
}

function renameCategory(id) {
  const c = A.categories.find(function (x) { return x.id === id; });
  if (!c) return;
  const newName = prompt('重命名分类', c.name);
  if (!newName || !newName.trim() || newName.trim() === c.name) return;
  c.name = newName.trim();
  save(); renderRail(); renderCatList(); renderContent();
  toast('分类已重命名');
}

function deleteCategory(id) {
  showConfirm('删除此分类？内容将移至"未分类"。', function () {
    A.bookmarks.forEach(function (b) { if (b.categoryId === id) b.categoryId = CAT_UNCATEGORIZED; });
    A.siblingGroups.forEach(function (g) { if (g.categoryId === id) g.categoryId = CAT_UNCATEGORIZED; });
    A.categories = A.categories.filter(function (c) { return c.id !== id; });
    save(); renderCatList(); renderContent(); toast('已删除');
  });
}

function openAttrModal() { LV.lastFocusedEl = document.activeElement; renderAttrList(); pushNavState(); document.getElementById('attrModal').classList.add('open'); setTimeout(function () { document.getElementById('newAttrName').focus(); }, 50); }
function closeAttrModal() { document.getElementById('attrModal').classList.remove('open'); if (LV.lastFocusedEl) LV.lastFocusedEl.focus(); LV.lastFocusedEl = null; }

function renderAttrList() {
  document.getElementById('attrManageList').innerHTML = A.customAttributes.map(function (a) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:4px;background:var(--bg-alt);border-radius:8px;border:1px solid var(--border-light)">'
      + '<span class="card-tag tag-custom">' + esc(a.name) + '</span>'
      + '<span style="flex:1"></span>'
      + '<button class="btn-xs btn-danger" data-action="deleteAttr" data-id="' + a.id + '">' + I.trash + '</button></div>';
  }).join('');
}

function addAttr() {
  const n = document.getElementById('newAttrName').value.trim();
  if (!n) { toast('请输入属性名称', false); return; }
  const id = n.replace(/[\s]+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  A.customAttributes.push({ id: id || gid(), name: n, type: 'boolean' });
  document.getElementById('newAttrName').value = '';
  save(); renderAttrList(); toast('属性已添加');
}

function deleteAttribute(id) {
  A.customAttributes = A.customAttributes.filter(function (a) { return a.id !== id; });
  A.bookmarks.forEach(function (b) { delete b.attributes[id]; });
  save(); renderAttrList(); renderContent(); toast('已删除');
}

function editAttr(id) {
  const a = A.customAttributes.find(function (x) { return x.id === id; });
  if (!a) return;
  const newName = prompt('编辑属性名称', a.name);
  if (!newName || newName.trim() === a.name) return;
  if (A.customAttributes.find(function (x) { return x.name === newName.trim(); })) { toast('属性名称已存在', false); return; }
  a.name = newName.trim();
  save(); renderAttrDropdown(); renderAttrChips(); renderAttrList(); renderContent(); toast('属性已重命名');
}

/* ---- Attribute filter UI ---- */

function toggleAttrDropdown() {
  if (LV.focusedGroupId) return;
  const drop = document.getElementById('attrDropdown');
  if (drop.style.display === 'none') {
    document.getElementById('attrSearchInput').value = '';
    renderAttrDropdown();
    drop.style.display = 'block';
    // Clamp to viewport on mobile
    const rect = drop.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      drop.style.maxHeight = Math.max(150, window.innerHeight - rect.top - 8) + 'px';
    }
    setTimeout(function () { document.getElementById('attrSearchInput').focus(); }, 50);
  } else {
    drop.style.display = 'none';
    drop.style.maxHeight = '';
  }
}

function renderAttrDropdown() {
  const list = document.getElementById('attrDropList');
  const q = (document.getElementById('attrSearchInput').value || '').toLowerCase();
  const filtered = A.customAttributes.filter(function (a) { return a.name.toLowerCase().indexOf(q) !== -1; });
  if (!filtered.length) { list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:0.78rem">无匹配属性</div>'; return; }
  list.innerHTML = filtered.map(function (a) {
    return '<div class="attr-drop-item' + (LV.activeAttrs.indexOf(a.id) !== -1 ? ' active' : '') + (LV.excludedAttrs.indexOf(a.id) !== -1 ? ' excluded' : '') + '">'
      + '<span class="attr-drop-main" data-action="toggleAttrFilter" data-id="' + a.id + '" title="包含此属性">'
      + '<span class="attr-dot"></span>' + esc(a.name) + '</span>'
      + '<button class="attr-drop-exclude' + (LV.excludedAttrs.indexOf(a.id) !== -1 ? ' on' : '') + '" data-action="toggleAttrExclude" data-id="' + a.id + '" title="' + (LV.excludedAttrs.indexOf(a.id) !== -1 ? '取消排除' : '排除此属性') + '">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></button></div>';
  }).join('');
}

function addAttrQuick() {
  const input = document.getElementById('attrSearchInput');
  const name = input.value.trim();
  if (!name) { toast('请输入属性名称', false); return; }
  const id = name.replace(/[\s]+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || gid();
  if (A.customAttributes.find(function (a) { return a.id === id || a.name === name; })) { toast('属性已存在', false); return; }
  A.customAttributes.push({ id: id, name: name, type: 'boolean' });
  save(); input.value = ''; renderAttrDropdown(); toast('属性已添加');
}

function toggleAttrFilter(attrId) {
  if (LV.activeAttrs.indexOf(attrId) !== -1) LV.activeAttrs = LV.activeAttrs.filter(function (id) { return id !== attrId; });
  else { LV.activeAttrs.push(attrId); LV.excludedAttrs = LV.excludedAttrs.filter(function (id) { return id !== attrId; }); }
  renderAttrChips(); renderContent(); renderAttrDropdown();
}

function toggleAttrExclude(attrId) {
  if (LV.excludedAttrs.indexOf(attrId) !== -1) LV.excludedAttrs = LV.excludedAttrs.filter(function (id) { return id !== attrId; });
  else { LV.excludedAttrs.push(attrId); LV.activeAttrs = LV.activeAttrs.filter(function (id) { return id !== attrId; }); }
  renderAttrChips(); renderContent(); renderAttrDropdown();
}

function renderAttrChips() {
  if (LV.focusedGroupId) return;
  const container = document.getElementById('attrChips');
  container.innerHTML = LV.activeAttrs.map(function (id) {
    const a = A.customAttributes.find(function (x) { return x.id === id; });
    return a ? '<span class="attr-chip" data-action="toggleAttrFilter" data-id="' + id + '">' + esc(a.name) + '<span class="attr-chip-x">&times;</span></span>' : '';
  }).join('') + LV.excludedAttrs.map(function (id) {
    const a = A.customAttributes.find(function (x) { return x.id === id; });
    return a ? '<span class="attr-chip attr-chip-excluded" data-action="toggleAttrExclude" data-id="' + id + '"><span class="attr-chip-txt">' + esc(a.name) + '</span><span class="attr-chip-x">&times;</span></span>' : '';
  }).join('');
  updateChipsFade();
}

function toggleSortDir() {
  LV.sortDir = LV.sortDir === 'asc' ? 'desc' : 'asc';
  document.getElementById('sortAsc').classList.toggle('active', LV.sortDir === 'asc');
  document.getElementById('sortDesc').classList.toggle('active', LV.sortDir === 'desc');
  renderContent();
}

/* ---- Search suggest ---- */

var _ssCache = { q: '', html: '' };

function renderSearchSuggest() {
  if (LV.focusedGroupId) return;
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var drop = document.getElementById('searchSuggest');
  if (!q) { drop.style.display = 'none'; return; }
  // Re-generate DOM only when query changes
  if (q !== _ssCache.q) {
    _ssCache.q = q;
    var results = A.bookmarks.filter(function (b) {
      return b.title.toLowerCase().indexOf(q) !== -1 || b.url.toLowerCase().indexOf(q) !== -1 || b.notes.toLowerCase().indexOf(q) !== -1 || b.username.toLowerCase().indexOf(q) !== -1;
    }).slice(0, MAX_SUGGESTIONS);
    if (!results.length) { drop.style.display = 'none'; _ssCache.html = ''; return; }
    _ssCache.html = results.map(function (b) {
      return '<div class="search-suggest-item" data-action="searchSuggest" data-id="' + b.id + '">'
        + '<img src="' + (b.icon || favicon(b.url)) + '" alt="">'
        + '<span class="ss-name">' + esc(b.title) + '</span>'
        + '<span class="ss-url">' + domain(b.url) + '</span></div>';
    }).join('');
  }
  if (!_ssCache.html) { drop.style.display = 'none'; return; }
  drop.innerHTML = _ssCache.html;
  drop.style.display = 'block';
}

function selectSearchSuggest(bmId) { document.getElementById('searchSuggest').style.display = 'none'; document.getElementById('searchInput').value = ''; _ssCache.q = ''; visit(null, bmId); }
function hideSearchSuggest() { document.getElementById('searchSuggest').style.display = 'none'; _ssCache.q = ''; }


//#endregion UI Module 界面模块

// ==================== Drag Module 拖拽模块 ====================
//#region Drag Module 拖拽模块
/* ==================== DRAG & DROP (centralized via document delegation) ==================== */

function _onDragStart(e) {
  if (LV.batchMode) { e.preventDefault(); return; }
  // 1. Bookmark card in grid
  const bmCard = e.target.closest('.card[data-id]:not(.group-card)');
  if (bmCard) {
    let id = bmCard.dataset.id;
    let gc = bmCard.closest('.group-card');
    let srcGid = gc ? gc.dataset.groupId : null;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'bm', id: id, srcGid: srcGid }));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    bmCard.classList.add('dragging');
    return;
  }
  // 2. Inline card (bookmark or group ref) — both have data-bm-id
  const inlineCard = e.target.closest('.group-inline-card[data-bm-id]');
  if (inlineCard) {
    const id = inlineCard.getAttribute('data-bm-id');
    const gc = inlineCard.closest('.group-card');
    let srcGid = gc ? gc.dataset.groupId : null;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'bm', id: id, srcGid: srcGid }));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    inlineCard.classList.add('dragging');
    return;
  }
  // 3. Group card
  const gCard = e.target.closest('.group-card[data-group-id]');
  if (gCard) {
    const gid = gCard.dataset.groupId;
    const parentGc = gCard.parentElement ? gCard.parentElement.closest('.group-card') : null;
    const srcGid = parentGc ? parentGc.dataset.groupId : null;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'group', id: 'group:' + gid, srcGid: srcGid }));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    gCard.classList.add('dragging');
    return;
  }
  // 4. Detail card
  const dCard = e.target.closest('.detail-card[data-didx]');
  if (dCard) {
    LV.detailDragIdx = parseInt(dCard.dataset.didx);
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'detail', id: dCard.dataset.bmId, srcGid: DRAG_SRC_DETAIL }));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    dCard.classList.add('dragging');
    return;
  }
  // 5. Rail category
  const rItem = e.target.closest('.rail-item[draggable="true"]');
  if (rItem) {
    LV.catDragId = rItem.dataset.catId;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'cat', id: LV.catDragId }));
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
}
function _onDragEnd() { clearDragState(); }
function _onDragOver(e) {
  const target = e.target.closest('.card, .group-body, .group-card-head, .detail-card, .rail-item, #detailPanel, #cardGrid');
  if (target !== LV.dragOverEl) {
    if (LV.dragOverEl) LV.dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over');
    LV.dragOverEl = target;
    if (target) {
      e.preventDefault();
      const cls = target.classList.contains('detail-card') ? 'detail-drag-over' : target.classList.contains('rail-item') ? 'rail-drag-over' : 'drag-over';
      target.classList.add(cls);
    }
  } else if (target) {
    e.preventDefault();
  }
}
function _onDrop(e) {
  // Clear visuals
  if (LV.dragOverEl) { LV.dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over'); LV.dragOverEl = null; }
  const p = dragPayload(e);
  if (!p) return;

  // 1. Group body (most specific)
  const gBody = e.target.closest('.group-body');
  if (gBody) { handleBodyDrop(e, gBody, p); return; }

  // 2. Group card head
  const gHead = e.target.closest('.group-card-head');
  if (gHead) { handleGroupHeadDrop(e, gHead, p); return; }

  // 3. Bookmark card in grid
  const bmCard = e.target.closest('.card:not(.group-card)');
  if (bmCard) { handleBmCardDrop(e, bmCard, p); return; }

  // 4. Group card (exterior)
  const gCard = e.target.closest('.group-card');
  if (gCard) { handleGroupCardDrop(e, gCard, p); return; }

  // 5. Detail card
  const dCard = e.target.closest('.detail-card');
  if (dCard) { handleDetailCardDrop(e, dCard, p); return; }

  // 6. Detail panel
  if (e.target.closest('#detailPanel')) { handleDetailPanelDrop(e, p); return; }

  // 7. Grid empty area
  if (e.target.closest('#cardGrid')) { handleGridDrop(e, p); return; }

  // 8. Rail category
  var rItem = e.target.closest('.rail-item');
  if (rItem) { handleRailDrop(e, rItem); return; }
}
LV.Drag = LV.Drag || {};
LV.Drag.init = function () {
  document.addEventListener('dragstart', _onDragStart);
  document.addEventListener('dragend', _onDragEnd);
  document.addEventListener('dragover', _onDragOver);
  document.addEventListener('drop', _onDrop);
};
LV.Drag.destroy = function () {
  document.removeEventListener('dragstart', _onDragStart);
  document.removeEventListener('dragend', _onDragEnd);
  document.removeEventListener('dragover', _onDragOver);
  document.removeEventListener('drop', _onDrop);
};

function clearDragState() {
  document.querySelectorAll('.dragging').forEach(function (el) { el.classList.remove('dragging'); });
  if (LV.dragOverEl) { LV.dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over'); LV.dragOverEl = null; }
  LV.catDragId = null; LV.detailDragIdx = null;
}

/* ---- Individual drop handlers ---- */

function handleBodyDrop(e, body, p) {
  e.preventDefault(); e.stopPropagation();
  body.classList.remove('drag-over');
  if (!p) return;
  const gid = body.dataset.gid;

  // Group card drag (from grid/nested) — add as ref
  if (p.type === 'group') {
    let refGid = p.id.slice(6);
    addGroupRefToGroup(refGid, gid);
    return;
  }
  if (p.type !== 'bm') return;

  // Detect group ref card (data-bm-id starts with "ref:")
  const isRef = p.id && p.id.indexOf('ref:') === 0;

  if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL && p.srcGid !== gid) {
    removeFromSrcGroup(p.srcGid, p.id);
  }
  if (p.srcGid === DRAG_SRC_DETAIL) {
    LV.detailCards = LV.detailCards.filter(function (id) { return id !== p.id; }); renderDetailPanel();
  }

  if (p.srcGid === gid) {
    // Same group — reorder (works for both bookmarks and ref cards)
    reorderInlineCard(gid, p.id, e.clientX, e.clientY, e.target);
  } else {
    pushUndo(gid);
    if (isRef) {
      // Ref card dropped into different group — create new ref
      const refGid = p.id.slice(4);
      const src = A.siblingGroups.find(function (g) { return g.id === refGid; });
      if (!src) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = groupRefCardHTML(src);
      const card = tmp.firstChild;
      if (insertCardAtPoint(body, card, e.clientX, e.clientY)) {
        // inserted at drop point
      } else {
        body.appendChild(card);
      }
      saveGroupBody(gid);
      save();
      toast('已移动组引用');
    } else {
      const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
      const b = A.bookmarks.find(function (x) { return x.id === p.id; });
      if (!sg || !b) return;
      const card = buildInlineCard(b);
      if (insertCardAtPoint(body, card, e.clientX, e.clientY)) {
        // inserted at drop point
      } else {
        body.appendChild(card);
      }
      if (sg.bookmarkIds.indexOf(p.id) === -1) sg.bookmarkIds.push(p.id);
      saveGroupBody(gid);
      updateCardStat(gid);
      save();
      toast('已加入组');
    }
  }
}

function handleGroupHeadDrop(e, head, p) {
  e.preventDefault(); e.stopPropagation();
  head.classList.remove('drag-over');
  const gid = head.closest('.group-card').dataset.groupId;
  if (!gid) return;
  if (p.type === 'group') {
    const srcGid = p.id.slice(6);
    if (srcGid === gid) return;
    const a = A.siblingGroups.find(function (g) { return g.id === srcGid; });
    const b = A.siblingGroups.find(function (g) { return g.id === gid; });
    if (a && b) { swapOrder(a, b); debouncedSave(); swapCardsDOM('.group-card[data-group-id="' + a.id + '"]', '.group-card[data-group-id="' + b.id + '"]'); }
  } else if (p.type === 'bm') {
    const bm = A.bookmarks.find(function (b) { return b.id === p.id; });
    const sg = A.siblingGroups.find(function (g) { return g.id === gid; });
    if (!bm || !sg) return;
    let dirty = false;
    if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL) { removeFromSrcGroup(p.srcGid, p.id); dirty = true; }
    if (p.srcGid === DRAG_SRC_DETAIL) { LV.detailCards = LV.detailCards.filter(function (id) { return id !== p.id; }); renderDetailPanel(); dirty = true; }
    swapOrder(bm, sg);
    debouncedSave();
    if (dirty) { renderContent(); }
    else { swapCardsDOM('.card[data-id="' + bm.id + '"]:not(.group-card)', '.group-card[data-group-id="' + sg.id + '"]'); }
  }
}

function handleBmCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('drag-over');
  const tid = card.dataset.id;
  if (p.id === tid) return;

  // Dragging from source group → remove if dropping outside source group
  if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL) {
    const onGroup = e.target.closest('.group-card');
    if (!onGroup || onGroup.dataset.groupId !== p.srcGid) {
      if (removeFromSrcGroup(p.srcGid, p.id)) { debouncedSave(); renderContent(); toast('已移出组'); }
    }
    return;
  }

  // Group dropped on bookmark → swap order
  if (p.type === 'group') {
    const sg = A.siblingGroups.find(function (g) { return g.id === p.id.slice(6); });
    const bm = A.bookmarks.find(function (b) { return b.id === tid; });
    if (sg && bm && !bm.parentId) { swapOrder(sg, bm); debouncedSave(); swapCardsDOM('.group-card[data-group-id="' + sg.id + '"]', '.card[data-id="' + bm.id + '"]:not(.group-card)'); }
    return;
  }

  // Bookmark on bookmark → same-parent reorder
  const a = A.bookmarks.find(function (b) { return b.id === p.id; });
  const b = A.bookmarks.find(function (b) { return b.id === tid; });
  if (a && b) {
    if (a.parentId === b.parentId) { swapOrder(a, b); debouncedSave(); swapCardsDOM('.card[data-id="' + a.id + '"]:not(.group-card)', '.card[data-id="' + b.id + '"]:not(.group-card)'); }
    else toast('只能在同级书签间拖拽排序', false);
  }
}

function handleGroupCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('drag-over');
  if (p.type !== 'group') return;
  const gid = card.dataset.groupId;
  const srcGid = p.id.slice(6);
  if (srcGid === gid) return;
  addGroupRefToGroup(srcGid, gid);
}

function handleDetailCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('detail-drag-over');
  if (p.type !== 'detail') return;
  const toIdx = parseInt(card.dataset.didx);
  if (LV.detailDragIdx == null || LV.detailDragIdx === toIdx) return;
  const tmp = LV.detailCards[LV.detailDragIdx];
  LV.detailCards[LV.detailDragIdx] = LV.detailCards[toIdx];
  LV.detailCards[toIdx] = tmp;
  renderDetailPanel();
}

function handleDetailPanelDrop(e, p) {
  e.preventDefault();
  if (p.srcGid === DRAG_SRC_DETAIL) return;
  if (p.type === 'group') {
    if (LV.detailCards.indexOf(p.id) === -1) LV.detailCards.push(p.id);
    renderDetailPanel();
  } else {
    if (p.srcGid) { removeFromSrcGroup(p.srcGid, p.id); debouncedSave(); renderContent(); }
    openDetail(p.id);
  }
}

function handleGridDrop(e, p) {
  e.preventDefault();
  if (!p || p.type === 'group') return;
  if (p.srcGid === DRAG_SRC_DETAIL) {
    LV.detailCards = LV.detailCards.filter(function (id) { return id !== p.id; });
    renderDetailPanel();
  } else if (p.srcGid && removeFromSrcGroup(p.srcGid, p.id)) {
    debouncedSave(); renderContent(); toast('已移出组');
  }
}

function handleRailDrop(e, item) {
  e.preventDefault();
  item.classList.remove('rail-drag-over');
  if (!LV.catDragId) return;
  const targetId = item.dataset.catId;
  if (!targetId || LV.catDragId === targetId || targetId === CAT_ALL) return;
  const srcIdx = A.categories.findIndex(function (c) { return c.id === LV.catDragId; });
  const tgtIdx = A.categories.findIndex(function (c) { return c.id === targetId; });
  if (srcIdx < 0 || tgtIdx < 0) return;
  const src = A.categories.splice(srcIdx, 1)[0];
  A.categories.splice(tgtIdx, 0, src);
  debouncedSave(); renderRail();
}

/* ---- In-group reorder ---- */

function insertCardAtPoint(body, card, clientX, clientY) {
  try {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        // caretPositionFromPoint offsetNode 可能是文本节点，
        // 需要取其父元素以确保后续操作安全
        let anchor = pos.offsetNode;
        if (anchor && anchor.nodeType === 3) anchor = anchor.parentElement;
        if (anchor) {
          range = document.createRange();
          range.setStart(anchor, Math.min(pos.offset, anchor.childNodes.length));
          range.collapse(true);
        }
      }
    }
    if (range) {
      const c = range.startContainer;
      const el = c && c.nodeType === 3 ? c.parentElement : c;
      if (el && body.contains(el) && !el.closest('.group-inline-card') && !el.closest('.group-ref-card')) {
        range.insertNode(card);
        ensureTextSibling(card, 'before');
        ensureTextSibling(card, 'after');
        const sel = window.getSelection();
        const r = document.createRange();
        r.setStartAfter(card); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
        return true;
      }
    }
  } catch (_) {
    // 跨 iframe / shadow DOM 等场景下 caret API 可能抛异常，静默降级
  }
  return false;
}

function reorderInlineCard(gid, bmId, clientX, clientY, dropTarget) {
  pushUndo(gid);
  const body = document.getElementById('sgBody_' + gid);
  const card = body && body.querySelector('.group-inline-card[data-bm-id="' + bmId + '"]');
  if (!card) return;
  const targetCard = dropTarget && dropTarget.closest && dropTarget.closest('.group-inline-card');
  if (targetCard && targetCard !== card && body.contains(targetCard)) {
    if (card.compareDocumentPosition(targetCard) & Node.DOCUMENT_POSITION_FOLLOWING) {
      targetCard.parentNode.insertBefore(card, targetCard.nextSibling);
    } else {
      targetCard.parentNode.insertBefore(card, targetCard);
    }
  } else if (!insertCardAtPoint(body, card, clientX, clientY)) {
    body.appendChild(card);
  }
  saveGroupBody(gid);
  save();
}


//#endregion Drag Module 拖拽模块

// ==================== Event Delegation 事件委托 ====================
//#region Event Delegation 事件委托
/* ==================== EVENT DELEGATION ==================== */

// Unified click delegation (document level — survives renderContent)
function _onGlobalClick(e) {
  // Suppress click after mobile long-press
  if (LV.lpFired) { LV.lpFired = false; e.preventDefault(); e.stopPropagation(); return; }

  // Always close dropdowns on outside click (before any early returns)
  var _drop = document.getElementById('attrDropdown');
  if (_drop && _drop.style.display !== 'none' && !e.target.closest('.attr-filter-wrap')) _drop.style.display = 'none';
  if (!e.target.closest('#ctxMenu')) hideCtx();
  if (!e.target.closest('#settingsMenu') && !e.target.closest('.settings-wrap')) hideSettingsMenu();
  if (!e.target.closest('#addWrap')) hideAddDropdown();
  if (!e.target.closest('#mentionDrop') && !e.target.closest('.group-body')) hideMention();
  if (!e.target.closest('.search-wrapper')) hideSearchSuggest();

  // 0. Batch mode: intercept ALL card clicks for batch selection only
  if (LV.batchMode) {
    const bmCard = e.target.closest('.card[data-id]');
    const gCardBatch = e.target.closest('.group-card[data-group-id]');
    if (bmCard) {
      e.stopPropagation();
      toggleBatchSelect(bmCard.dataset.id, e);
      return;
    }
    if (gCardBatch) {
      e.stopPropagation();
      toggleBatchSelect('group:' + gCardBatch.dataset.groupId, e);
      return;
    }
    if (e.target.closest('.card, .group-card, .card-foot, .card-actions')) {
      e.stopPropagation(); return;
    }
  }

  // 0b. List mode: click blank area → toggle expand/collapse (only expand cards with expandable content)
  if (LV.layoutMode === 'list') {
    const listCard = e.target.closest('.list-view .card[data-id], .list-view .group-card[data-group-id]');
    if (listCard && !e.target.closest('[data-action], button, input, select, textarea, .card-name, .card-domain, .card-tag, .card-stat, .card-acct-toggle, .card-acct-body, .batch-chk, .batch-grip, .card-logo, .card-actions, .group-inline-card, .group-body')) {
      const isGrp = listCard.classList.contains('group-card');
      const cls = isGrp ? 'group-expanded' : 'card-expanded';
      e.stopPropagation();
      const wasExpanded = listCard.classList.contains(cls);
      // 已展开的卡片始终可以收起；未展开的卡片需要有展开内容才能展开
      if (!wasExpanded && !listCard.querySelector('.list-expand-btn')) return;
      listCard.classList.toggle(cls);
      // 保存展开状态
      saveExpandState(listCard.dataset.id || listCard.dataset.groupId, listCard.classList.contains(cls));
      if (listCard.classList.contains(cls)) {
        setTimeout(function () { listCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 360);
      }
      return;
    }
  }

  // 1. Inline card buttons inside group bodies (no data-action, uses class selectors)
  const gic = e.target.closest('.gic-btn');
  const gicRm = e.target.closest('.gic-remove');
  const gicName = e.target.closest('.gic-name');
  if (gic || gicRm || gicName) {
    const card = e.target.closest('.group-inline-card');
    if (card) {
      const gb = card.closest('.group-body');
      if (gb) {
        const gid = gb.closest('.group-card') ? gb.closest('.group-card').dataset.groupId : null;
        const bmId = card.getAttribute('data-bm-id');
        const isRef = bmId && bmId.indexOf('ref:') === 0;
        const refGid = isRef ? bmId.slice(4) : null;
        if (gic) { e.stopPropagation(); if (isRef) openDetail('group:' + refGid); else if (bmId) openDetail(bmId); }
        else if (gicRm) { e.stopPropagation(); if (isRef && gid) removeGroupRef(gid, refGid); else if (bmId && gid) removeBmFromGroup(bmId, gid, card); }
        else if (gicName) { e.stopPropagation(); if (isRef) toggleGroupFocus(refGid); else if (bmId) visit(null, bmId); }
        return;
      }
    }
  }

  // 2. Generic data-action dispatch (works everywhere: grid, detail panel, attr chips, popover, modals, etc.)
  const btn = e.target.closest('[data-action]');
  if (btn) {
    if (LV.batchMode && btn.closest('.card, .group-card')) { e.stopPropagation(); return; }
    e.stopPropagation();
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const gid = btn.dataset.gid;
    switch (action) {
      case 'visit': visit(null, id); break;
      case 'editBm': editBm(id); break;
      case 'deleteBm': deleteBookmark(id, true); break;
      case 'addSub': addSub(id); break;
      case 'toggleFocus': toggleGroupFocus(id); break;
      case 'undoGroup': performUndo(id); break;
      case 'redoGroup': performRedo(id); break;
      case 'addToGroup': addToGroup(id, e); break;
      case 'editGroup': editGroup(id); break;
      case 'exitFocus': exitGroupFocus(); break;
      case 'deleteGroup': deleteGroup(id); break;
      case 'toggleAcct': toggleAcct(btn, id); break;
      case 'togglePw': togglePwCard(id); break;
      case 'copyUser': { const ub = A.bookmarks.find(function (b) { return b.id === id; }); if (ub && ub.username) copyToClipboard(ub.username, '账户'); break; }
      case 'copyPw': { const pb = A.bookmarks.find(function (b) { return b.id === id; }); if (pb && pb.password) copyToClipboard(safeAtob(pb.password), '密码'); break; }
      case 'filterAttr': toggleAttrFilter(id); break;
      case 'toggleAttrFilter': toggleAttrFilter(id); break;
      case 'toggleAttrExclude': toggleAttrExclude(id); break;
      case 'closeDetail': closeDetailCard(id); break;
      case 'removeBmFromGe': removeBmFromGroup(id, gid); renderGeBookmarks(gid); break;
      case 'deleteCat': deleteCategory(id); break;
      case 'deleteAttr': deleteAttribute(id); renderAttrDropdown(); renderAttrChips(); renderContent(); break;
      case 'addBmExisting': addBmExisting(id); break;
      case 'searchSuggest': selectSearchSuggest(id); break;
      case 'toggleExpand': toggleListExpand(btn); break;
      case 'addBmDropdown': hideAddDropdown(); openBmModal(); break;
      case 'addGrpDropdown': hideAddDropdown(); createGroup(); break;
      case 'openDetail': openDetail(id); break;
      case 'multiSelect': toggleBatchMode(); break;
    }
    return;
  }

  // 3. Rail nav item click
  var railItem = e.target.closest('.rail-item[data-cat-id]');
  if (railItem) { selectCat(railItem.dataset.catId); }
}

// Double-click: group name → focus mode; bookmark name → open website
document.getElementById('cardGrid').addEventListener('dblclick', function (e) {
  if (LV.batchMode) return;
  const nameEl = e.target.closest('[data-group-name]');
  if (nameEl) {
    e.stopPropagation();
    toggleGroupFocus(nameEl.dataset.groupName);
    return;
  }
  const bmTarget = e.target.closest('.card-name') || e.target.closest('.card-domain');
  if (bmTarget) {
    const card = bmTarget.closest('.card[data-id]:not(.group-card)');
    if (card) {
      e.stopPropagation();
      visit(null, card.dataset.id);
    }
  }
});

// contenteditable event delegation on card grid
document.getElementById('cardGrid').addEventListener('focusin', function (e) {
  const body = e.target.closest('.group-body[contenteditable]');
  if (body) {
    const gid = body.dataset.gid;
    if (LV.saveTimers[gid]) { clearTimeout(LV.saveTimers[gid]); delete LV.saveTimers[gid]; }
  }
});

document.getElementById('cardGrid').addEventListener('focusout', function (e) {
  const body = e.target.closest('.group-body[contenteditable]');
  if (body) {
    const gid = body.dataset.gid;
    LV.saveTimers[gid] = setTimeout(function () {
      saveGroupBody(gid);
      debouncedSave();
      delete LV.saveTimers[gid];
    }, 200);
  }
});

document.getElementById('cardGrid').addEventListener('beforeinput', function (e) {
  const body = e.target.closest('.group-body[contenteditable]');
  if (body && (e.inputType === 'insertText' || e.inputType === 'insertCompositionText' || e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward')) {
    pushUndo(body.dataset.gid);
  }
});

document.getElementById('cardGrid').addEventListener('input', function (e) {
  const body = e.target.closest('.group-body[contenteditable]');
  if (body) syncGroupBookmarks(body.dataset.gid);
});

document.getElementById('cardGrid').addEventListener('paste', function (e) {
  const body = e.target.closest('.group-body[contenteditable]');
  if (body) handleGroupPaste(e, body.dataset.gid);
});

// Double-click delegation
function _onGlobalDblclick(e) {
  if (LV.batchMode) return;
  if (e.target.closest('.btn-undo-group, .btn-redo-group, .ft-btn')) { e.stopPropagation(); return; }

  // Inline edit of bookmark notes on double-click
  const notesEl = e.target.closest('.card-notes');
  if (notesEl && !notesEl.hasAttribute('contenteditable')) {
    const card = notesEl.closest('.card[data-id]');
    if (card) {
      e.stopPropagation();
      const bmId = card.dataset.id;
      const bm = A.bookmarks.find(function (b) { return b.id === bmId; });
      if (!bm) return;
      notesEl.setAttribute('contenteditable', 'true');
      notesEl.style.cssText = 'outline:1px dashed var(--accent);padding:4px;border-radius:4px;cursor:text;white-space:pre-wrap;-webkit-line-clamp:unset;display:block';
      notesEl.textContent = bm.notes || '';
      notesEl.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(notesEl);

      function saveNotes() {
        notesEl.removeAttribute('contenteditable');
        notesEl.style.cssText = '';
        const newNotes = notesEl.textContent.trim();
        const curBm = A.bookmarks.find(function (b) { return b.id === bmId; });
        if (curBm && curBm.notes !== newNotes) {
          curBm.notes = newNotes;
          debouncedSave();
          renderContent();
          toast('备注已更新');
        }
        notesEl.removeEventListener('blur', saveNotes);
        notesEl.removeEventListener('keydown', onKey);
      }

      function onKey(e2) {
        if (e2.key === 'Escape') { e2.preventDefault(); saveNotes(); }
        if (e2.key === 'Enter' && !e2.shiftKey) { e2.preventDefault(); saveNotes(); }
      }

      notesEl.addEventListener('blur', saveNotes);
      notesEl.addEventListener('keydown', onKey);
      return;
    }
  }

  // Double-click group card name → focus group (fallback if #cardGrid handler didn't fire)
  const gCardName = e.target.closest('.group-card .card-name');
  if (gCardName) {
    e.stopPropagation();
    const gc = gCardName.closest('.group-card');
    if (gc) toggleGroupFocus(gc.dataset.groupId);
    return;
  }
}


/* ==================== CONTEXT MENU ==================== */

let ctxTarget = null;
let ctxType = '';

/** Context menu item visibility rules per type */
const CTX_RULES = {
  card:         { show: ['visit', 'edit', 'delete', 'multiSelect'] },
  sub:          { show: ['visit', 'edit', 'delete'], text: { visit: '查看详情' } },
  cat:          { show: ['edit', 'delete'], text: { edit: '重命名' } },
  attr:         { show: ['edit', 'delete'] },
  group:        { show: ['edit', 'delete'], text: { edit: '编辑组名', delete: '删除组' } },
  'group-card': { show: ['visit', 'delete'], text: { visit: '查看详情', delete: '从组移除' } },
  'rail-empty': { show: ['addcat'] },
  'grid-empty': { show: ['addbookmark', 'addgroup', 'multiSelect'] }
};
/** Default text for context menu items (restored before each show) */
const CTX_DEFAULT_TEXT = { visit: '打开网站', edit: '编辑', delete: '删除' };

/** Unified context menu dispatcher */
function showContextMenu(e, type, id) {
  e.preventDefault();
  ctxType = type; ctxTarget = id;
  const menu = document.getElementById('ctxMenu');
  const rule = CTX_RULES[type] || { show: [] };
  const showSet = {};
  rule.show.forEach(function (a) { showSet[a] = true; });
  // 合并默认文本与规则覆盖，单次遍历完成可见性 + 文本
  const textMap = {};
  for (const k in CTX_DEFAULT_TEXT) textMap[k] = CTX_DEFAULT_TEXT[k];
  if (rule.text) { for (const k2 in rule.text) textMap[k2] = rule.text[k2]; }

  menu.querySelectorAll('.ctx-item').forEach(function (el) {
    const act = el.dataset.action;
    el.style.display = showSet[act] ? '' : 'none';
    if (textMap[act]) el.textContent = textMap[act];
  });
  positionCtx(e);
}

function toggleSettingsMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('settingsMenu');
  if (menu.style.display === 'block') { hideSettingsMenu(); return; }
  const btn = document.getElementById('btnSettings');
  const rect = btn.getBoundingClientRect();
  menu.style.display = 'block';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
}

function hideSettingsMenu() { document.getElementById('settingsMenu').style.display = 'none'; }

function hideCtx() { document.getElementById('ctxMenu').style.display = 'none'; ctxTarget = null; ctxType = ''; LV.ctxGid = null; LV.ctxCard = null; }

function positionCtx(e) {
  const menu = document.getElementById('ctxMenu');
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 170) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px';
}

// Global contextmenu handler
function _onContextMenu(e) {
  if (LV.batchMode && e.target.closest('.card, .group-card, .group-body, .sub-sites')) return;
  // Sub-site item (inline card inside .sub-sites)
  const subSitesEl = e.target.closest('.sub-sites');
  if (subSitesEl) {
    const subItem = e.target.closest('.group-inline-card');
    if (!subItem) { e.preventDefault(); return; }
    const subId = subItem.dataset.bmId || subItem.dataset.id;
    if (subId) { LV.ctxCard = null; showContextMenu(e, 'sub', subId); return; }
  }
  // Inline card inside group body
  const inlineCard = e.target.closest('.group-inline-card');
  if (inlineCard) {
    let gCard = inlineCard.closest('.group-card');
    if (gCard) {
      LV.ctxCard = inlineCard;
      LV.ctxGid = gCard.dataset.groupId;
      showContextMenu(e, 'group-card', inlineCard.getAttribute('data-bm-id'));
      return;
    }
  }
  // Group card
  const gCard = e.target.closest('.group-card');
  if (gCard) { LV.ctxCard = null; showContextMenu(e, 'group', gCard.dataset.groupId); return; }
  // Bookmark card
  const bmCard = e.target.closest('.card');
  if (bmCard) { LV.ctxCard = null; showContextMenu(e, 'card', bmCard.dataset.id); return; }
  // Rail item
  const railItem = e.target.closest('.rail-item');
  if (railItem) {
    const catId = railItem.dataset.catId;
    if (catId && catId !== CAT_ALL) { showContextMenu(e, 'cat', catId); return; }
  }
  // Rail empty area
  if (e.target.closest('.icon-rail') && !e.target.closest('.rail-item') && !e.target.closest('.rail-logo') && !e.target.closest('.rail-bottom')) { showContextMenu(e, 'rail-empty', ''); return; }
  // Grid empty area
  if (e.target.closest('#panelContent') && !e.target.closest('.card') && !e.target.closest('.empty')) { showContextMenu(e, 'grid-empty', ''); return; }
}

document.getElementById('ctxMenu').addEventListener('click', function (e) {
  const btn = e.target.closest('.ctx-item');
  if (!btn) return;
  const act = btn.dataset.action;
  const tid = ctxTarget, ttype = ctxType, tgid = LV.ctxGid, tcard = LV.ctxCard;
  hideCtx();
  if (ttype === 'card') {
    if (act === 'visit') visit(null, tid);
    if (act === 'edit') editBm(tid);
    if (act === 'delete') deleteBookmark(tid, true);
  } else if (ttype === 'sub') {
    if (act === 'visit') openDetail(tid);
    if (act === 'edit') editBm(tid);
    if (act === 'delete') deleteBookmark(tid, true);
  } else if (ttype === 'cat') {
    if (act === 'edit') renameCategory(tid);
    if (act === 'delete') deleteCategory(tid);
  } else if (ttype === 'attr') {
    if (act === 'edit') editAttr(tid);
    if (act === 'delete') { deleteAttribute(tid); renderAttrDropdown(); renderAttrChips(); renderContent(); }
  } else if (ttype === 'group') {
    if (act === 'edit') editGroup(tid);
    if (act === 'delete') deleteGroup(tid);
  } else if (ttype === 'group-card') {
    if (act === 'visit') openDetail(tid);
    if (act === 'delete') removeBmFromGroup(tid, tgid, tcard);
  } else if (ttype === 'grid-empty') {
    if (act === 'addbookmark') openBmModal();
    if (act === 'addgroup') createGroup();
  } else if (ttype === 'rail-empty') {
    if (act === 'addcat') { openCatModal(); setTimeout(function () { document.getElementById('newCatName').focus(); }, 200); }
  }
});

LV.UI = LV.UI || {};
LV.UI.initDelegation = function () {
  document.addEventListener('click', _onGlobalClick);
  document.addEventListener('dblclick', _onGlobalDblclick);
  document.addEventListener('contextmenu', _onContextMenu);
};
LV.UI.destroyDelegation = function () {
  document.removeEventListener('click', _onGlobalClick);
  document.removeEventListener('dblclick', _onGlobalDblclick);
  document.removeEventListener('contextmenu', _onContextMenu);
};

//#endregion Event Delegation 事件委托

// ==================== Mention Module 提及模块 ====================
//#region Mention Module 提及模块
/* ==================== @MENTION ==================== */

function _onMentionTrigger(e) {
  if (e.key === '@' || e.key === '#') {
    var gb = e.target.closest('.group-body');
    if (!gb || !gb.isContentEditable) return;
    LV.mentionGid = gb.closest('.group-card') ? gb.closest('.group-card').dataset.groupId : null;
    LV.mentionQuery = ''; LV.mentionIdx = 0; LV.mentionRange = null;
    LV.mentionActive = true;
    LV.mentionType = e.key === '@' ? 'bm' : 'group';
  }
}

function _onMentionInput(e) {
  if (!LV.mentionActive || !LV.mentionGid) return;
  const gb = e.target.closest('.group-body');
  if (!gb || !gb.isContentEditable || (gb.closest('.group-card') ? gb.closest('.group-card').dataset.groupId : null) !== LV.mentionGid) { hideMention(); return; }
  const sel = window.getSelection();
  if (!sel.rangeCount) { hideMention(); return; }
  const node = sel.focusNode;
  const offset = sel.focusOffset;
  if (node.nodeType !== 3) { hideMention(); return; }
  const text = node.textContent;
  const trigger = LV.mentionType === 'group' ? '#' : '@';
  const atIdx = text.lastIndexOf(trigger, offset - 1);
  if (atIdx >= 0 && atIdx < offset) {
    LV.mentionQuery = text.slice(atIdx + 1, offset).toLowerCase();
    LV.mentionRange = document.createRange();
    LV.mentionRange.setStart(node, atIdx);
    LV.mentionRange.setEnd(node, offset);
    showMentionNear(LV.mentionQuery);
    return;
  }
  hideMention();
}

function showMentionNear(query) {
  const drop = document.getElementById('mentionDrop');
  if (LV.mentionType === 'group') {
    const matches = A.siblingGroups.filter(function (g) {
      return g.id !== LV.mentionGid && (g.name || '').toLowerCase().indexOf(query) !== -1;
    }).slice(0, MAX_SUGGESTIONS);
    if (!matches.length) { drop.style.display = 'none'; return; }
    LV.mentionIdx = 0;
    drop.innerHTML = matches.map(function (g, i) {
      return '<div class="mention-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '" data-ref-gid="' + g.id + '">'
        + (g.icon ? '<img src="' + esc(g.icon) + '" alt="">' : '<span style="width:18px;height:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--accent)">' + I.note + '</span>')
        + '<span class="mi-name">' + esc(g.name || '未命名组') + '</span>'
        + '<span class="mi-url">' + g.bookmarkIds.length + '个书签</span>'
        + '</div>';
    }).join('');
    drop.style.display = 'block';
  } else {
    const matches = A.bookmarks.filter(function (b) {
      return !b.parentId && (b.title.toLowerCase().indexOf(query) !== -1 || b.url.toLowerCase().indexOf(query) !== -1);
    }).slice(0, MAX_SUGGESTIONS);
    if (!matches.length) { drop.style.display = 'none'; return; }
    LV.mentionIdx = 0;
    drop.innerHTML = matches.map(function (b, i) {
      const subs = A.bookmarks.filter(function (s) { return s.parentId === b.id; });
      const hasSub = subs.length > 0;
      let subHTML = '';
      if (hasSub) {
        subHTML = '<div class="mention-sub-menu">' + subs.map(function (s, j) {
          return '<div class="mention-item mention-sub-item" data-bm-id="' + s.id + '" data-sub-idx="' + j + '">'
            + '<img src="' + (s.icon || favicon(s.url)) + '" alt="">'
            + '<span class="mi-name">' + esc(s.title) + '</span>'
            + '<span class="mi-url">' + domain(s.url) + '</span></div>';
        }).join('') + '</div>';
      }
      return '<div class="mention-item' + (hasSub ? ' has-sub' : '') + (i === 0 ? ' active' : '') + '" data-idx="' + i + '" data-bm-id="' + b.id + '">'
        + '<img src="' + (b.icon || favicon(b.url)) + '" alt="">'
        + '<span class="mi-name">' + esc(b.title) + '</span>'
        + '<span class="mi-url">' + domain(b.url) + '</span>'
        + subHTML
        + '</div>';
    }).join('');
    drop.style.display = 'block';
  }
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0).getClientRects()[0];
    if (r) { drop.style.left = Math.min(r.left, window.innerWidth - 310) + 'px'; drop.style.top = Math.min(r.bottom + 4, window.innerHeight - 220) + 'px'; }
  }
}

function hideMention() { document.getElementById('mentionDrop').style.display = 'none'; LV.mentionGid = null; LV.mentionQuery = ''; LV.mentionIdx = 0; LV.mentionRange = null; LV.mentionActive = false; LV.mentionType = 'bm'; LV.mentionSubMode = false; LV.mentionSubIdx = 0; }

function selectMention(bmId) {
  if (!LV.mentionGid) return;
  pushUndo(LV.mentionGid);
  const sg = A.siblingGroups.find(function (g) { return g.id === LV.mentionGid; });
  const b = A.bookmarks.find(function (x) { return x.id === bmId; });
  if (!sg || !b) { hideMention(); return; }
  const body = document.getElementById('sgBody_' + LV.mentionGid);
  if (!body) { hideMention(); return; }
  if (LV.mentionRange) {
    LV.mentionRange.deleteContents();
    const card = buildInlineCard(b);
    LV.mentionRange.insertNode(card);
    ensureTextSibling(card, 'before');
    ensureTextSibling(card, 'after');
    const sel = window.getSelection();
    const newRange = document.createRange();
    newRange.setStartAfter(card);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    body.appendChild(buildInlineCard(b));
  }
  if (sg.bookmarkIds.indexOf(bmId) === -1) sg.bookmarkIds.push(bmId);
  saveGroupBody(LV.mentionGid);
  save();
  updateCardStat(LV.mentionGid);
  hideMention();
}

function selectGroupMention(refGid) {
  if (!LV.mentionGid || refGid === LV.mentionGid) { hideMention(); return; }
  pushUndo(LV.mentionGid);
  const src = A.siblingGroups.find(function (g) { return g.id === refGid; });
  if (!src) { hideMention(); return; }
  const body = document.getElementById('sgBody_' + LV.mentionGid);
  if (!body) { hideMention(); return; }
  if (LV.mentionRange) {
    LV.mentionRange.deleteContents();
    const tmp = document.createElement('span');
    tmp.innerHTML = groupRefCardHTML(src);
    const card = tmp.firstChild;
    LV.mentionRange.insertNode(card);
    ensureTextSibling(card, 'before');
    ensureTextSibling(card, 'after');
    const sel = window.getSelection();
    const newRange = document.createRange();
    newRange.setStartAfter(card);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    const tmp = document.createElement('div');
    tmp.innerHTML = groupRefCardHTML(src);
    while (tmp.firstChild) body.appendChild(tmp.firstChild);
  }
  saveGroupBody(LV.mentionGid);
  save();
  hideMention();
  toast('已添加组引用');
}

// Mention dropdown click delegation
document.getElementById('mentionDrop').addEventListener('mousedown', function (e) {
  const item = e.target.closest('.mention-item');
  if (!item) return;
  // Click on sub-menu item
  if (e.target.closest('.mention-sub-menu')) {
    const subItem = e.target.closest('.mention-item');
    if (subItem && subItem.dataset.bmId) {
      e.preventDefault();
      selectMention(subItem.dataset.bmId);
    }
  } else if (item.dataset.refGid) {
    e.preventDefault();
    selectGroupMention(item.dataset.refGid);
  } else if (item.dataset.bmId) {
    e.preventDefault();
    selectMention(item.dataset.bmId);
  }
});

// Mention keyboard navigation
function _onMentionKeydown(e) {
  const drop = document.getElementById('mentionDrop');
  if (drop.style.display === 'none') return;
  if (!document.activeElement || !document.activeElement.closest('.group-body')) { hideMention(); return; }
  const items = drop.querySelectorAll(':scope > .mention-item');

  // For group mentions, sub-menu navigation is not applicable
  if (LV.mentionType === 'group') {
    if (e.key === 'ArrowDown') { e.preventDefault(); LV.mentionIdx = (LV.mentionIdx + 1) % items.length; updateMentionActive(items); }
    if (e.key === 'ArrowUp') { e.preventDefault(); LV.mentionIdx = (LV.mentionIdx - 1 + items.length) % items.length; updateMentionActive(items); }
    if (e.key === 'Enter') { e.preventDefault(); let sel = items[LV.mentionIdx]; if (sel && sel.dataset.refGid) selectGroupMention(sel.dataset.refGid); }
    if (e.key === 'Escape') hideMention();
    return;
  }

  if (LV.mentionSubMode) {
    const activeParent = drop.querySelector('.mention-item.has-sub.active');
    const subItems = activeParent ? activeParent.querySelectorAll('.mention-sub-item') : [];
    if (e.key === 'ArrowDown') { e.preventDefault(); LV.mentionSubIdx = (LV.mentionSubIdx + 1) % subItems.length; updateSubActive(subItems); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); LV.mentionSubIdx = (LV.mentionSubIdx - 1 + subItems.length) % subItems.length; updateSubActive(subItems); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); LV.mentionSubMode = false; LV.mentionSubIdx = 0; clearSubActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); const selSub = subItems[LV.mentionSubIdx]; if (selSub) selectMention(selSub.dataset.bmId); }
    else if (e.key === 'Escape') { hideMention(); }
    return;
  }

  if (e.key === 'ArrowDown') { e.preventDefault(); LV.mentionIdx = (LV.mentionIdx + 1) % items.length; updateMentionActive(items); }
  if (e.key === 'ArrowUp') { e.preventDefault(); LV.mentionIdx = (LV.mentionIdx - 1 + items.length) % items.length; updateMentionActive(items); }
  if (e.key === 'ArrowRight') {
    const cur = items[LV.mentionIdx];
    if (cur && cur.classList.contains('has-sub')) {
      e.preventDefault();
      LV.mentionSubMode = true; LV.mentionSubIdx = 0;
      const subItems2 = cur.querySelectorAll('.mention-sub-item');
      if (subItems2.length) { updateSubActive(subItems2); subItems2[0].classList.add('active'); }
    }
  }
  if (e.key === 'Enter') { e.preventDefault(); const sel = items[LV.mentionIdx]; if (sel) selectMention(sel.dataset.bmId); }
  if (e.key === 'Escape') hideMention();
}

function updateMentionActive(items) { items.forEach(function (el, i) { el.classList.toggle('active', i === LV.mentionIdx); }); }
function updateSubActive(items) { items.forEach(function (el, i) { el.classList.toggle('active', i === LV.mentionSubIdx); }); }
function clearSubActive() { document.querySelectorAll('.mention-sub-item.active').forEach(function (el) { el.classList.remove('active'); }); }

LV.Mention = LV.Mention || {};
LV.Mention.init = function () {
  document.addEventListener('keydown', _onMentionTrigger);
  document.addEventListener('input', _onMentionInput);
  document.addEventListener('keydown', _onMentionKeydown);
};
LV.Mention.destroy = function () {
  document.removeEventListener('keydown', _onMentionTrigger);
  document.removeEventListener('input', _onMentionInput);
  document.removeEventListener('keydown', _onMentionKeydown);
};

// Reposition mention dropdown on scroll
document.getElementById('panelContent').addEventListener('scroll', function () {
  const drop = document.getElementById('mentionDrop');
  if (drop.style.display !== 'none' && LV.mentionGid) {
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0).getClientRects()[0];
      if (r) { drop.style.left = Math.min(r.left, window.innerWidth - 310) + 'px'; drop.style.top = Math.min(r.bottom + 4, window.innerHeight - 220) + 'px'; }
    }
  }
});


//#endregion Mention Module 提及模块

// ==================== Keyboard Shortcuts 快捷键 ====================
//#region Keyboard Shortcuts 快捷键
/* ==================== KEYBOARD SHORTCUTS ==================== */

function _onGlobalKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('searchInput').focus(); }
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); openBmModal(); }
  }
  // Tab trap within open modals
  if (e.key === 'Tab') {
    const modal = document.querySelector('.modal-mask.open .modal');
    if (!modal) return;
    const focusable = modal.querySelectorAll('input:not([type="hidden"]),textarea,select,button,[tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  // Ctrl+Z/Ctrl+Y in group body (skip if focus is in input/textarea — let browser handle natively)
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
    let gid;
    const gb = ae && ae.closest ? ae.closest('.group-body') : null;
    if (gb) gid = gb.closest('.group-card') ? gb.closest('.group-card').dataset.groupId : null;
    if (!gid && LV.focusedGroupId) gid = LV.focusedGroupId;
    if (gid) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) performUndo(gid);
      else performRedo(gid);
      return;
    }
  }
  if (e.key === 'Escape') {
    if (LV.batchMode) { toggleBatchMode(); return; }
    closeBmModal(); closeCatModal(); closeAttrModal(); closeGroupEdit();
    hideCtx(); hideSettingsMenu(); hideSearchSuggest(); closeAddBmPopover(); hideAddDropdown();
    document.getElementById('confirmModal').classList.remove('open');
  }
  // Batch mode shortcuts
  if (LV.batchMode) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAllBatch();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && LV.batchSelected.length) {
      e.preventDefault();
      batchDelete();
      return;
    }
  }
}

LV.Keyboard = LV.Keyboard || {};
LV.Keyboard.initNavHistory = function () { window.addEventListener('popstate', _onPopState); };
LV.Keyboard.destroyNavHistory = function () { window.removeEventListener('popstate', _onPopState); };
LV.Keyboard.initShortcuts = function () { document.addEventListener('keydown', _onGlobalKeydown); };
LV.Keyboard.destroyShortcuts = function () { document.removeEventListener('keydown', _onGlobalKeydown); };

// Search keyboard: Enter selects first, Escape closes
document.getElementById('searchInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { const first = document.querySelector('#searchSuggest .search-suggest-item'); if (first) first.click(); }
  if (e.key === 'Escape') hideSearchSuggest();
});

document.getElementById('addBmSearch').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); const first = document.querySelector('#addBmResults .popover-result'); if (first) first.click(); }
  if (e.key === 'Escape') closeAddBmPopover();
});


//#endregion Keyboard Shortcuts 快捷键

// ==================== Static Bindings & Init 静态绑定与初始化 ====================
//#region Static Bindings & Init
/* ==================== STATIC EVENT BINDINGS ==================== */

document.getElementById('btnAdd').addEventListener('click', function (e) {
  e.stopPropagation();
  if (LV.focusedGroupId) { addToGroup(LV.focusedGroupId, e); return; }
  toggleAddDropdown();
});

function toggleAddDropdown() {
  const drop = document.getElementById('addDropdown');
  if (drop.style.display === 'block') { hideAddDropdown(); return; }
  const btn = document.getElementById('btnAdd');
  const rect = btn.getBoundingClientRect();
  drop.style.display = 'block';
  drop.style.top = (rect.bottom + 4) + 'px';
  drop.style.left = Math.min(rect.left, window.innerWidth - 150) + 'px';
}
function hideAddDropdown() { document.getElementById('addDropdown').style.display = 'none'; }

document.getElementById('bmModalClose').addEventListener('click', closeBmModal);
document.getElementById('bmModalCancel').addEventListener('click', closeBmModal);
document.getElementById('bmModalSave').addEventListener('click', saveBm);
document.getElementById('bmModal').addEventListener('click', function (e) { if (e.target === this) closeBmModal(); });

document.getElementById('btnManageCats').addEventListener('click', openCatModal);
document.getElementById('catModalClose').addEventListener('click', closeCatModal);
document.getElementById('catModal').addEventListener('click', function (e) { if (e.target === this) closeCatModal(); });
document.getElementById('btnAddCat').addEventListener('click', addCat);
document.getElementById('newCatName').addEventListener('keydown', function (e) { if (e.key === 'Enter') addCat(); });

document.getElementById('groupEditClose').addEventListener('click', closeGroupEdit);
document.getElementById('groupEditCancel').addEventListener('click', closeGroupEdit);
document.getElementById('groupEditSave').addEventListener('click', saveGroupEdit);
document.getElementById('groupEditModal').addEventListener('click', function (e) { if (e.target === this) closeGroupEdit(); });

document.getElementById('attrModalClose').addEventListener('click', closeAttrModal);
document.getElementById('attrModal').addEventListener('click', function (e) { if (e.target === this) closeAttrModal(); });
document.getElementById('btnAddAttr').addEventListener('click', addAttr);
document.getElementById('newAttrName').addEventListener('keydown', function (e) { if (e.key === 'Enter') addAttr(); });

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

document.getElementById('pwToggle').addEventListener('click', function () {
  const pw = document.getElementById('bmPass');
  const show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
  this.innerHTML = show
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
});

document.getElementById('searchInput').addEventListener('focus', function () { renderSearchSuggest(); });
document.getElementById('searchInput').addEventListener('input', debounce(function () {
  if (LV.focusedGroupId) searchInFocusedGroup();
  else { renderContent(); renderSearchSuggest(); }
}, 300));

document.getElementById('sortSelect').addEventListener('change', function () { renderContent(); });

/* ==================== RESIZE HANDLES ==================== */

(function () {
  const leftHandle = document.getElementById('resizeLeft');
  const rightHandle = document.getElementById('resizeRight');
  const leftPanel = document.querySelector('.icon-rail');
  const rightPanel = document.getElementById('detailPanel');

  const savedLeft = localStorage.getItem('lv_railWidth');
  const savedRight = localStorage.getItem('lv_detailWidth');
  if (savedLeft) leftPanel.style.width = savedLeft + 'px';
  if (savedRight) rightPanel.style.setProperty('--detail-width', savedRight + 'px');

  let raf = null, handle = null, panel = null, dir = null, startX = 0, startW = 0;

  function onDown(e, h, p, d) {
    handle = h; panel = p; dir = d;
    handle.classList.add('active');
    panel.style.transition = 'none';
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onMove(e) {
    if (!handle) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      const delta = (e.clientX - startX) * dir;
      const min = dir > 0 ? 120 : 200;
      const max = dir > 0 ? 500 : 600;
      const w = Math.max(min, Math.min(startW + delta, max));
      if (panel === leftPanel) panel.style.width = w + 'px';
      else { panel.style.setProperty('--detail-width', w + 'px'); if (panel.classList.contains('open')) panel.style.width = w + 'px'; }
    });
  }

  function onUp() {
    if (!handle) return;
    handle.classList.remove('active');
    panel.style.transition = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (panel === leftPanel) localStorage.setItem('lv_railWidth', parseInt(panel.style.width));
    else localStorage.setItem('lv_detailWidth', parseInt(panel.style.getPropertyValue('--detail-width')));
    handle = panel = null;
  }

  leftHandle.addEventListener('mousedown', function (e) { onDown(e, leftHandle, leftPanel, 1); });
  rightHandle.addEventListener('mousedown', function (e) { onDown(e, rightHandle, rightPanel, -1); });
})();

/* ==================== INIT ==================== */

function updateChipsFade() {
  const el = document.getElementById('attrChips');
  if (!el) return;
  if (el.scrollWidth > el.clientWidth + 1) {
    const fade = Math.max(24, Math.round(el.clientWidth * 0.1)) + 'px';
    el.style.webkitMaskImage = el.style.maskImage = 'linear-gradient(to right,black calc(100% - ' + fade + '),transparent 100%)';
    el.style.webkitMaskRepeat = el.style.maskRepeat = 'no-repeat';
  } else {
    el.style.webkitMaskImage = el.style.maskImage = '';
    el.style.webkitMaskRepeat = el.style.maskRepeat = '';
  }
}

function initChipsScroll() {
  var el = document.getElementById('attrChips');
  if (!el) return;
  function _onChipsWheel(e) {
    if (el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY || e.deltaX;
    updateChipsFade();
  }
  function _onChipsMouseMove(e) {
    if (!el._drag) return;
    el.scrollLeft = el._drag.s - (e.clientX - el._drag.x);
    updateChipsFade();
  }
  function _onChipsMouseUp() {
    if (!el._drag) return;
    el._drag = null; el.style.cursor = '';
  }
  function _onChipsMouseDown(e) {
    if (e.target.closest('.attr-chip')) return;
    el._drag = { x: e.clientX, s: el.scrollLeft };
    el.style.cursor = 'grabbing'; e.preventDefault();
  }
  el.addEventListener('wheel', _onChipsWheel, { passive: false });
  document.addEventListener('mousemove', _onChipsMouseMove);
  document.addEventListener('mouseup', _onChipsMouseUp);
  el.addEventListener('mousedown', _onChipsMouseDown);
  window.addEventListener('resize', updateChipsFade);
}

// Card tags horizontal scroll on wheel
function _onCardTagsWheel(e) {
  var tags = e.target.closest('.card-tags');
  if (tags && tags.scrollWidth > tags.clientWidth) {
    e.preventDefault();
    tags.scrollLeft += e.deltaY;
  }
}
LV.UI = LV.UI || {};
LV.UI.initCardTags = function () { document.addEventListener('wheel', _onCardTagsWheel, { passive: false }); };
LV.UI.destroyCardTags = function () { document.removeEventListener('wheel', _onCardTagsWheel); };

// Update overflow class on card tags
function updateCardTagsOverflow() {
  document.querySelectorAll('.card-tags').forEach(function (el) {
    if (el.scrollWidth > el.clientWidth) {
      el.classList.add('tags-overflow');
    } else {
      el.classList.remove('tags-overflow');
    }
  });
}

document.querySelector('.panel-header').addEventListener('dblclick', function (e) {
  if (LV.focusedGroupId && !e.target.closest('input, button')) exitGroupFocus();
});

renderContent();
initLayoutMode();
initChipsScroll();
updateSettingsMenuActive();
updateCardTagsOverflow();

// — Module event-listener init —
LV.XSS.init();
LV.Data.init();
LV.Keyboard.initNavHistory();
LV.Touch.init();
LV.Drag.init();
LV.UI.initDelegation();
LV.UI.initCardTags();
LV.Mention.init();
LV.Keyboard.initShortcuts();

// 初始状态：用 replaceState 记录当前状态，不产生新历史条目
if (history.replaceState) history.replaceState(captureNavState(), '');

//#endregion Static Bindings & Init

// ================================================================
//  Module Namespace Assignments 模块命名空间挂载
// ================================================================

// ---- LV.Data ----
LV.Data.load = load;
LV.Data.save = save;
LV.Data.getStorageInfo = getStorageInfo;
LV.Data.exportData = exportData;
LV.Data.validateImportData = validateImportData;
LV.Data.importData = importData;
LV.Data.triggerImport = triggerImport;
LV.Data.resetData = resetData;

// ---- LV.Utils ----
LV.Utils.gid = gid;
LV.Utils.favicon = favicon;
LV.Utils.domain = domain;
LV.Utils.safeAtob = safeAtob;
LV.Utils.fixUrl = fixUrl;
LV.Utils.esc = esc;
LV.Utils.sanitizeHTML = sanitizeHTML;
LV.Utils.debounce = debounce;
LV.Utils.swapOrder = swapOrder;
LV.Utils.copyToClipboard = copyToClipboard;
LV.Utils.setDragImage = setDragImage;
LV.Utils.dragPayload = dragPayload;
LV.Utils.collectSubIds = collectSubIds;

// ---- LV.Render ----
LV.Render.renderAll = renderAll;
LV.Render.renderRail = renderRail;
LV.Render.getCardCounts = getCardCounts;
LV.Render.selectCat = selectCat;
LV.Render.getFiltered = getFiltered;
LV.Render.getFilteredGroups = getFilteredGroups;
LV.Render.buildCombinedList = buildCombinedList;
LV.Render.renderCardHTML = renderCardHTML;
LV.Render.extractGroupPreview = extractGroupPreview;
LV.Render.renderGroupCardHTML = renderGroupCardHTML;
LV.Render.getRenderData = getRenderData;
LV.Render.buildGridHTML = buildGridHTML;
LV.Render.updatePanelHeader = updatePanelHeader;
LV.Render.renderContent = renderContent;
LV.Render.setupFocusModeUI = setupFocusModeUI;
LV.Render.setupGridModeUI = setupGridModeUI;
LV.Render.initLayoutMode = initLayoutMode;
LV.Render.applyLayoutMode = applyLayoutMode;
LV.Render.renderDetailPanel = renderDetailPanel;
LV.Render.filterDetailCards = filterDetailCards;
LV.Render.renderSearchSuggest = renderSearchSuggest;
LV.Render.renderAttrDropdown = renderAttrDropdown;
LV.Render.renderAttrChips = renderAttrChips;
LV.Render.renderCatList = renderCatList;
LV.Render.renderAttrList = renderAttrList;
LV.Render.renderGeBookmarks = renderGeBookmarks;
LV.Render.renderAddBmResults = renderAddBmResults;
LV.Render.buildFocusToolbarHTML = buildFocusToolbarHTML;
LV.Render.updateUndoRedoButtons = updateUndoRedoButtons;
LV.Render.updateCardStat = updateCardStat;
LV.Render.inlineCardHTML = inlineCardHTML;
LV.Render.groupRefCardHTML = groupRefCardHTML;
LV.Render.buildInlineCard = buildInlineCard;
LV.Render.updateCardTagsOverflow = updateCardTagsOverflow;
LV.Render.updateChipsFade = updateChipsFade;
LV.Render.searchInFocusedGroup = searchInFocusedGroup;

// ---- LV.UI ----
LV.UI.toggleTheme = toggleTheme;
LV.UI.setThemeStyle = setThemeStyle;
LV.UI.toast = toast;
LV.UI.toastWithUndo = toastWithUndo;
LV.UI.showConfirm = showConfirm;
LV.UI.visit = visit;
LV.UI.openBmModal = openBmModal;
LV.UI.closeBmModal = closeBmModal;
LV.UI.previewLogo = previewLogo;
LV.UI.previewIconUrl = previewIconUrl;
LV.UI.clearIcon = clearIcon;
LV.UI.saveBm = saveBm;
LV.UI.editBm = editBm;
LV.UI.addSub = addSub;
LV.UI.deleteBookmark = deleteBookmark;
LV.UI._doDeleteBookmark = _doDeleteBookmark;
LV.UI.toggleAcct = toggleAcct;
LV.UI.togglePwCard = togglePwCard;
LV.UI.createGroup = createGroup;
LV.UI.renameGroup = renameGroup;
LV.UI._deleteGroupInternal = _deleteGroupInternal;
LV.UI.deleteGroup = deleteGroup;
LV.UI.addToGroup = addToGroup;
LV.UI.closeAddBmPopover = closeAddBmPopover;
LV.UI.addBmExisting = addBmExisting;
LV.UI.addBmNew = addBmNew;
LV.UI.editGroup = editGroup;
LV.UI.previewGeIconUrl = previewGeIconUrl;
LV.UI.clearGeIcon = clearGeIcon;
LV.UI.closeGroupEdit = closeGroupEdit;
LV.UI.saveGroupEdit = saveGroupEdit;
LV.UI.openCatModal = openCatModal;
LV.UI.closeCatModal = closeCatModal;
LV.UI.renderCatList = renderCatList;
LV.UI.addCat = addCat;
LV.UI.renameCategory = renameCategory;
LV.UI.deleteCategory = deleteCategory;
LV.UI.openAttrModal = openAttrModal;
LV.UI.closeAttrModal = closeAttrModal;
LV.UI.renderAttrList = renderAttrList;
LV.UI.addAttr = addAttr;
LV.UI.deleteAttribute = deleteAttribute;
LV.UI.editAttr = editAttr;
LV.UI.toggleAttrDropdown = toggleAttrDropdown;
LV.UI.addAttrQuick = addAttrQuick;
LV.UI.toggleAttrFilter = toggleAttrFilter;
LV.UI.toggleAttrExclude = toggleAttrExclude;
LV.UI.toggleSortDir = toggleSortDir;
LV.UI.selectSearchSuggest = selectSearchSuggest;
LV.UI.hideSearchSuggest = hideSearchSuggest;
LV.UI.setLayoutMode = setLayoutMode;
LV.UI.updateSettingsMenuActive = updateSettingsMenuActive;
LV.UI.toggleSettingsMenu = toggleSettingsMenu;
LV.UI.hideSettingsMenu = hideSettingsMenu;
LV.UI.toggleBatchMode = toggleBatchMode;
LV.UI.toggleBatchSelect = toggleBatchSelect;
LV.UI.selectAllBatch = selectAllBatch;
LV.UI.batchDelete = batchDelete;
LV.UI.batchAddToGroup = batchAddToGroup;
LV.UI.updateBatchCount = updateBatchCount;
LV.UI.toggleGroupFocus = toggleGroupFocus;
LV.UI.exitGroupFocus = exitGroupFocus;
LV.UI.toggleRail = toggleRail;
LV.UI.closeRail = closeRail;
LV.UI.showActionSheet = showActionSheet;
LV.UI.hideActionSheet = hideActionSheet;
LV.UI.swapCardsDOM = swapCardsDOM;
LV.UI.toggleListExpand = toggleListExpand;
LV.UI.saveExpandState = saveExpandState;
LV.UI.toggleDetailPanel = toggleDetailPanel;
LV.UI.openDetail = openDetail;
LV.UI.closeDetailCard = closeDetailCard;
LV.UI.initChipsScroll = initChipsScroll;
LV.UI.hideCtx = hideCtx;
LV.UI.positionCtx = positionCtx;
LV.UI.showContextMenu = showContextMenu;
LV.UI.toggleAddDropdown = toggleAddDropdown;
LV.UI.hideAddDropdown = hideAddDropdown;
LV.UI.renderAddBmResults = renderAddBmResults;

// ---- LV.Drag ----
LV.Drag.clearDragState = clearDragState;
LV.Drag.handleBodyDrop = handleBodyDrop;
LV.Drag.handleGroupHeadDrop = handleGroupHeadDrop;
LV.Drag.handleBmCardDrop = handleBmCardDrop;
LV.Drag.handleGroupCardDrop = handleGroupCardDrop;
LV.Drag.handleDetailCardDrop = handleDetailCardDrop;
LV.Drag.handleDetailPanelDrop = handleDetailPanelDrop;
LV.Drag.handleGridDrop = handleGridDrop;
LV.Drag.handleRailDrop = handleRailDrop;
LV.Drag.insertCardAtPoint = insertCardAtPoint;
LV.Drag.reorderInlineCard = reorderInlineCard;

// ---- LV.Mention ----
LV.Mention.showMentionNear = showMentionNear;
LV.Mention.hideMention = hideMention;
LV.Mention.selectMention = selectMention;
LV.Mention.selectGroupMention = selectGroupMention;
LV.Mention.updateMentionActive = updateMentionActive;
LV.Mention.updateSubActive = updateSubActive;
LV.Mention.clearSubActive = clearSubActive;

// ---- LV.Group ----
LV.Group.saveGroupBody = saveGroupBody;
LV.Group.syncGroupBookmarks = syncGroupBookmarks;
LV.Group.handleGroupPaste = handleGroupPaste;
LV.Group.ensureTextSibling = ensureTextSibling;
LV.Group.addBmToGroup = addBmToGroup;
LV.Group.removeBmFromGroup = removeBmFromGroup;
LV.Group.addGroupRefToGroup = addGroupRefToGroup;
LV.Group.removeGroupRef = removeGroupRef;
LV.Group.removeFromSrcGroup = removeFromSrcGroup;

// ---- LV.Undo ----
LV.Undo.snapSize = snapSize;
LV.Undo.totalUndoBytes = totalUndoBytes;
LV.Undo.evictOldestUndo = evictOldestUndo;
LV.Undo.cleanStaleUndoStacks = cleanStaleUndoStacks;
LV.Undo.pushUndo = pushUndo;
LV.Undo.performUndo = performUndo;
LV.Undo.performRedo = performRedo;
LV.Undo.restoreSnapshot = restoreSnapshot;

// ---- LV.Keyboard ----
LV.Keyboard.captureNavState = captureNavState;
LV.Keyboard.pushNavState = pushNavState;
LV.Keyboard.restoreNavState = restoreNavState;

