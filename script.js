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

const DEFAULTS = {
  categories: [
    { id: 'all', name: '全部', icon: 'grid', color: '#122E8A' },
    { id: 'uncategorized', name: '未分类', icon: 'bookmark', color: '#6E6860' },
    { id: 'email', name: '邮箱', icon: 'mail', color: '#e11d48' },
    { id: 'tools', name: '工具', icon: 'tool', color: '#d97706' },
    { id: 'dev', name: '开发', icon: 'code', color: '#0d9488' }
  ],
  bookmarks: [
    { id: 'b1', title: 'GitHub', url: 'https://github.com', username: '', password: '', notes: '代码托管平台', icon: '', categoryId: 'dev', parentId: null, order: 0, useCount: 15, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 86400000 },
    { id: 'b2', title: 'QQ邮箱', url: 'https://mail.qq.com', username: '@qq.com', password: 'MTIz', notes: '', icon: '', categoryId: 'email', parentId: null, order: 1, useCount: 8, attributes: { 'requires-login': true, 'china-available': true }, isExpanded: false, createdAt: Date.now() - 172800000 },
    { id: 'b3', title: 'DeepSeek', url: 'https://www.deepseek.com/', username: '', password: '', notes: 'API key:', icon: '', categoryId: 'tools', parentId: null, order: 2, useCount: 5, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 40000000 },
    { id: 'sb1', title: '开始对话', url: 'https://chat.deepseek.com/', username: '', password: '', notes: '', icon: '', categoryId: 'tools', parentId: 'b3', order: 0, useCount: 3, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 30000000 },
    { id: 'sb2', title: 'API开发平台', url: 'https://platform.deepseek.com/usage', username: '', password: '', notes: '', icon: '', categoryId: 'tools', parentId: 'b3', order: 1, useCount: 2, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 20000000 },
    { id: 'b4', title: 'Twitter/X', url: 'https://x.com', username: '', password: '', notes: '社交媒体', icon: '', categoryId: 'uncategorized', parentId: null, order: 3, useCount: 4, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 345600000 }
  ],
  customAttributes: [
    { id: 'requires-login', name: '需要登录', type: 'boolean' },
    { id: 'china-available', name: '国内可用', type: 'boolean' },
    { id: 'ai', name: 'Ai', type: 'boolean' },
    { id: 'is-group', name: '组', type: 'boolean' }
  ],
  siblingGroups: [
    {
      id: 'sg_welcome', name: '欢迎使用', categoryId: 'uncategorized', icon: '', order: 0,
      attributes: { 'is-group': true },
      bookmarkIds: ['b1', 'b2', 'b3'],
      notes: '拖拽书签到此处、或输入 @ 来整理收藏：<br>'
        + '<span class="group-inline-card" contenteditable="false" data-bm-id="b1" draggable="true"><img src="https://api.xinac.net/icon/?url=github.com" alt="" onerror="this.style.display=\'none\'"><span class="gic-name">GitHub</span><span class="gic-domain">github.com</span><span class="gic-btn">详情</span><span class="gic-remove" title="移除">&times;</span></span> '
        + '<span class="group-inline-card" contenteditable="false" data-bm-id="b2" draggable="true"><img src="https://api.xinac.net/icon/?url=mail.qq.com" alt="" onerror="this.style.display=\'none\'"><span class="gic-name">QQ邮箱</span><span class="gic-domain">mail.qq.com</span><span class="gic-btn">详情</span><span class="gic-remove" title="移除">&times;</span></span> '
        + '<span class="group-inline-card" contenteditable="false" data-bm-id="b3" draggable="true"><img src="https://api.xinac.net/icon/?url=www.deepseek.com" alt="" onerror="this.style.display=\'none\'"><span class="gic-name">DeepSeek</span><span class="gic-domain">deepseek.com</span><span class="gic-btn">详情</span><span class="gic-remove" title="移除">&times;</span></span>'
    }
  ]
};

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
          var text = g.notes;
          var ids = [];
          var re = /\[([^\]]+)\]\(([a-zA-Z0-9]+)\)/g;
          var m;
          while ((m = re.exec(text)) !== null) {
            var bm = (d.bookmarks || []).find(function (x) { return x.id === m[2]; });
            if (bm && ids.indexOf(m[2]) < 0) ids.push(m[2]);
          }
          var html = '';
          var lastIdx = 0;
          var re2 = /\[([^\]]+)\]\(([a-zA-Z0-9]+)\)|@(\S+)/g;
          while ((m = re2.exec(text)) !== null) {
            html += esc(text.slice(lastIdx, m.index));
            if (m[1] !== undefined) {
              var bm2 = (d.bookmarks || []).find(function (x) { return x.id === m[2]; });
              if (bm2) html += inlineCardHTML(bm2);
              else html += esc(m[0]);
            } else if (m[3] !== undefined) {
              var sg2 = (d.siblingGroups || []).find(function (x) { return x.name === m[3]; });
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
      var needsPersist = attrs.length !== deduped.length;
      (d.siblingGroups || []).forEach(function (g) { if (g._migrated) needsPersist = true; });
      if (needsPersist) try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ categories: cats, bookmarks: d.bookmarks || [], customAttributes: deduped, siblingGroups: d.siblingGroups || [] })); } catch (e) { }
      return { categories: cats, bookmarks: d.bookmarks || [], customAttributes: deduped, siblingGroups: d.siblingGroups || [] };
    }
  } catch (e) { }
  return JSON.parse(JSON.stringify(DEFAULTS));
}

let A = load();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(A)); }
  catch (e) { toast('存储空间不足，请清理部分数据', false); }
}

const debouncedSave = debounce(function () { save(); }, 300);
window.addEventListener('beforeunload', save);

function estimateStorage() {
  try { const d = localStorage.getItem(STORAGE_KEY); return d ? (new Blob([d]).size / 1024).toFixed(1) + ' KB' : ''; }
  catch (e) { return ''; }
}

function getStoragePercent() {
  try {
    const d = localStorage.getItem(STORAGE_KEY);
    if (!d) return 0;
    return Math.min(100, Math.round(new Blob([d]).size / 5242880 * 100));
  } catch (e) { return 0; }
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

function importData(file) {
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = JSON.parse(reader.result);
      if (!data.categories || !data.bookmarks || !data.customAttributes || !data.siblingGroups) { toast('无效的数据格式', false); return; }
      try { localStorage.setItem(STORAGE_KEY + '_backup', JSON.stringify(A)); } catch (e) { }
      A.categories = data.categories;
      A.bookmarks = data.bookmarks;
      A.customAttributes = data.customAttributes;
      A.siblingGroups = data.siblingGroups;
      save(); curCat = CAT_ALL; _focusedGroupId = null;
      _activeAttrs = []; _excludedAttrs = [];
      _detailCards = []; renderAll();
      toast('数据已导入 (' + A.bookmarks.length + ' 个书签)');
    } catch (e) { toast('导入失败：' + e.message, false); }
  };
  reader.readAsText(file);
}

function triggerImport() { document.getElementById('importFile').click(); }

function resetData() {
  if (!confirm('确认清除所有数据？这将恢复为默认状态，且不可撤销。')) return;
  localStorage.removeItem(STORAGE_KEY);
  A = JSON.parse(JSON.stringify(DEFAULTS));
  curCat = CAT_ALL; _focusedGroupId = null;
  _activeAttrs = []; _excludedAttrs = [];
  _detailCards = [];
  Object.keys(_undoStacks).forEach(function (k) { delete _undoStacks[k]; });
  save(); renderAll();
  toast('数据已重置为默认');
}

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
      if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') { node.remove(); return; }
      for (var i = node.attributes.length - 1; i >= 0; i--) {
        var a = node.attributes[i];
        if (a.name.indexOf('on') === 0 || (a.name === 'href' && a.value.indexOf('javascript:') === 0)) {
          node.removeAttribute(a.name);
        }
      }
    }
    for (var i = node.childNodes.length - 1; i >= 0; i--) walk(node.childNodes[i]);
  })(div);
  return div.innerHTML;
}

function debounce(fn, ms) {
  var t;
  return function () { var args = arguments, ctx = this; clearTimeout(t); t = setTimeout(function () { fn.apply(ctx, args); }, ms); };
}

function swapOrder(a, b) {
  if (a.order === b.order) b.order++;
  var t = a.order; a.order = b.order; b.order = t;
}

function setDragImage(e) {
  var img = new Image();
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  e.dataTransfer.setDragImage(img, 0, 0);
}

function dragPayload(e) {
  try { return JSON.parse(e.dataTransfer.getData(PAYLOAD_KEY)); } catch (_) { return null; }
}

/* ==================== ICONS ==================== */
var I = {
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
  grip: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="3" rx="1.5" fill="currentColor"/><rect x="3" y="10.5" width="18" height="3" rx="1.5" fill="currentColor"/><rect x="3" y="17" width="18" height="3" rx="1.5" fill="currentColor"/></svg>'
};

/* ==================== STATE ==================== */
var curCat = CAT_ALL;
var sortDir = 'asc';
var editingId = null;
var _focusedGroupId = null;
var _detailCards = [];
var _activeAttrs = [];
var _excludedAttrs = [];
var _showTrash = false;
var _pwShown = {};
var _visitTimer = null;
var _lastFocusedEl = null;
var _dragOverEl = null;
var _catDragId = null;
var _detailDragIdx = null;
var _ctxGid = null;
var _ctxCard = null;
var _editingGeId = null;
var _addToGid = null;
var _saveToGroup = null;
var _layoutMode = 'grid';
var _batchMode = false;
var _batchSelected = [];

// Undo/redo
var _undoStacks = {};
var _undoTimers = {};
var _saveTimers = {};

// @mention
var _mentionGid = null;
var _mentionQuery = '';
var _mentionIdx = 0;
var _mentionRange = null;
var _mentionActive = false;

/* ==================== THEME ==================== */
function toggleTheme() {
  var el = document.documentElement;
  var next = el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  el.setAttribute('data-theme', next);
  try { localStorage.setItem('lv_theme', next); } catch (e) { }
}
(function () {
  try { var t = localStorage.getItem('lv_theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) { }
})();

/* ==================== TOAST ==================== */
function toast(msg, ok) {
  if (ok === undefined) ok = true;
  var c = document.getElementById('toasts');
  var d = document.createElement('div');
  d.className = 'toast ' + (ok ? 'ok' : 'err');
  d.innerHTML = (ok ? I.external : I.trash) + esc(msg);
  c.appendChild(d);
  setTimeout(function () { d.style.opacity = '0'; d.style.transform = 'translateX(30px)'; d.style.transition = 'all 0.25s ease-in'; }, TOAST_FADE_MS);
  setTimeout(function () { d.remove(); }, TOAST_REMOVE_MS);
}

/* ==================== RENDERING ==================== */

function renderAll() {
  renderRail();
  renderContent();
  renderDetailPanel();
}

function renderRail() {
  var counts = getCardCounts();
  var nav = document.getElementById('railNav');
  nav.innerHTML = A.categories.map(function (c) {
    return '<button class="rail-item' + (curCat === c.id ? ' active' : '') + '" data-cat-id="' + c.id + '"'
      + (c.id !== CAT_ALL ? ' draggable="true"' : '') + '>'
      + (I[c.icon] || I.star)
      + esc(c.name)
      + '<span class="rail-count">' + (counts[c.id] || 0) + '</span>'
      + '</button>';
  }).join('');
  var sto = document.getElementById('railStorage');
  if (sto) {
    var pct = getStoragePercent();
    sto.innerHTML = '<div class="rail-storage-bar" style="width:' + pct + '%"></div><span>' + estimateStorage() + '</span>';
  }
}

function getCardCounts() {
  var counts = {};
  A.bookmarks.forEach(function (b) { if (!b.parentId) counts[b.categoryId] = (counts[b.categoryId] || 0) + 1; });
  A.siblingGroups.forEach(function (g) { counts[g.categoryId] = (counts[g.categoryId] || 0) + 1; });
  counts[CAT_ALL] = A.bookmarks.filter(function (b) { return !b.parentId; }).length + A.siblingGroups.length;
  return counts;
}

function selectCat(id) {
  curCat = id;
  _focusedGroupId = null;
  renderContent();
}

function getFiltered() {
  if (_showTrash) {
    var tq = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    return A.bookmarks.filter(function (b) {
      if (!b.deletedAt) return false;
      if (!tq) return true;
      return (b.title || '').toLowerCase().indexOf(tq) > -1 || (domain(b.url) || '').toLowerCase().indexOf(tq) > -1;
    });
  }
  var bm = A.bookmarks.filter(function (b) { return !b.deletedAt; });
  if (curCat !== CAT_ALL) bm = bm.filter(function (b) { return b.categoryId === curCat; });
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  if (q) bm = bm.filter(function (b) { return b.title.toLowerCase().indexOf(q) !== -1 || b.url.toLowerCase().indexOf(q) !== -1 || b.notes.toLowerCase().indexOf(q) !== -1 || b.username.toLowerCase().indexOf(q) !== -1; });
  _activeAttrs.forEach(function (aid) { bm = bm.filter(function (b) { return (b.attributes || {})[aid]; }); });
  _excludedAttrs.forEach(function (aid) { bm = bm.filter(function (b) { return !(b.attributes || {})[aid]; }); });
  var sort = document.getElementById('sortSelect').value;
  bm.sort(function (a, b) {
    var d = sortDir === 'asc' ? 1 : -1;
    if (sort === 'useCount') return (a.useCount - b.useCount) * d;
    if (sort === 'title') return a.title.localeCompare(b.title) * d;
    if (sort === 'date') return (a.createdAt - b.createdAt) * d;
    return (a.order - b.order) * d;
  });
  return bm;
}

function getFilteredGroups() {
  if (_showTrash) return [];
  var groups = A.siblingGroups.slice().sort(function (a, b) { return a.order - b.order; });
  if (curCat !== CAT_ALL) groups = groups.filter(function (g) { return g.categoryId === curCat; });
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  if (q) {
    groups = groups.filter(function (g) {
      if (g.name.toLowerCase().indexOf(q) !== -1) return true;
      return g.bookmarkIds.some(function (bid) {
        var b = A.bookmarks.find(function (x) { return x.id === bid; });
        return b && (b.title.toLowerCase().indexOf(q) !== -1 || b.url.toLowerCase().indexOf(q) !== -1);
      });
    });
  }
  _activeAttrs.forEach(function (aid) { groups = groups.filter(function (g) { return (g.attributes || {})[aid]; }); });
  _excludedAttrs.forEach(function (aid) { groups = groups.filter(function (g) { return !(g.attributes || {})[aid]; }); });
  return groups;
}

function buildCombinedList(groups, topLevel) {
  var combined = [];
  groups.forEach(function (g) { combined.push({ type: 'group', data: g }); });
  if (!_focusedGroupId) topLevel.forEach(function (b) { combined.push({ type: 'bm', data: b }); });
  combined.sort(function (a, b) {
    if (a.data.order !== b.data.order) return a.data.order - b.data.order;
    return a.type === 'group' ? -1 : 1;
  });
  return combined;
}

/* ---- Card HTML generators (no inline event handlers) ---- */

function renderCardHTML(bm) {
  var icon = bm.icon || favicon(bm.url);
  var dm = domain(bm.url);
  var _a = bm.attributes || {};
  var attrTags = '';
  A.customAttributes.forEach(function (a) { if (_a[a.id]) attrTags += '<span class="card-tag tag-custom" data-action="filterAttr" data-id="' + a.id + '" title="按此属性筛选">' + esc(a.name) + '</span>'; });
  var notes = bm.notes ? '<div class="card-notes">' + esc(bm.notes) + '</div>' : '';
  var hasAcct = bm.username || bm.password;
  var subs = A.bookmarks.filter(function (b) { return b.parentId === bm.id; });
  var subsHTML = '';
  if (subs.length) {
    subsHTML = '<div class="sub-sites">';
    subs.forEach(function (sub) {
      subsHTML += '<div class="sub-site-item" data-action="visit" data-id="' + sub.id + '">'
        + '<img src="' + (sub.icon || favicon(sub.url)) + '" alt="" onerror="this.style.display=\'none\'">'
        + '<span class="ss-name">' + esc(sub.title) + '</span>'
        + '<span class="ss-domain">' + domain(sub.url) + '</span>'
        + '</div>';
    });
    subsHTML += '</div>';
  }
  return '<div class="card" draggable="true" data-id="' + bm.id + '"' + (_batchMode ? ' onclick="toggleBatchSelect(\'' + bm.id + '\', event)"' : '') + '>'
    + (_batchMode ? '<input type="checkbox" class="batch-chk" id="batchChk_' + bm.id + '" onclick="toggleBatchSelect(\'' + bm.id + '\', event)">' : '')
    + (_batchMode ? '<span class="batch-grip">' + I.grip + '</span>' : '')
    + '<div class="card-body">'
    + '<div class="card-toprow">'
    + '<div class="card-logo" data-action="visit" data-id="' + bm.id + '" title="打开链接"><img src="' + icon + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="card-logo-fallback">' + bm.title.charAt(0) + '</span></div>'
    + '<div class="card-titlewrap" data-action="visit" data-id="' + bm.id + '">'
    + '<div class="card-name">' + esc(bm.title) + '</div>'
    + '<div class="card-domain">' + esc(dm) + '</div>'
    + '</div></div>'
    + notes
    + (attrTags ? '<div class="card-tags">' + attrTags + '</div>' : '')
    + (hasAcct ? '<button class="card-acct-toggle" data-action="toggleAcct" data-id="' + bm.id + '">' + I.chevron + ' 账户信息</button><div class="card-acct-body">'
      + (bm.username ? '<div class="acct-row"><span class="acct-label">账户</span><span class="acct-val">' + esc(bm.username) + '</span></div>' : '')
      + (bm.password ? '<div class="acct-row"><span class="acct-label">密码</span><span class="acct-val" id="pwdisp_' + bm.id + '">••••••</span><button class="acct-show-pw" data-action="togglePw" data-id="' + bm.id + '" title="显示密码"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>' : '')
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
    + '<button class="list-expand-btn" onclick="toggleListExpand(this)" title="展开">' + I.chevronDown + '</button>'
    + '</div>'
    + '</div>';
}

function renderGroupCardHTML(g) {
  var bmCount = g.bookmarkIds.length;
  var isFocused = _focusedGroupId === g.id;
  var stack = _undoStacks[g.id];
  var hasUndo = !!(stack && stack.undo && stack.undo.length > 0);
  var hasRedo = !!(stack && stack.redo && stack.redo.length > 0);
  var bodyHTML = sanitizeHTML(g.notes || '');
  return '<div class="card group-card' + (isFocused ? ' group-card-focus' : '') + '" data-group-id="' + g.id + '" draggable="true">'
    + '<div class="group-card-accent"></div>'
    + (_batchMode ? '<span class="batch-grip">' + I.grip + '</span>' : '')
    + '<div class="group-card-head">'
    + (g.icon ? '<img class="group-card-icon" src="' + esc(g.icon) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'\'" style="border-radius:4px;object-fit:contain">' : '')
    + '<span class="group-card-icon" style="' + (g.icon ? 'display:none' : '') + '">' + I.note + '</span>'
    + (isFocused ? '' : '<span class="group-card-title">' + esc(g.name || '未命名组') + '</span>')
    + (isFocused ? '' : '<span class="group-head-actions">'
    + '<button class="btn-undo-group' + (hasUndo ? '' : ' disabled') + '" data-action="undoGroup" data-id="' + g.id + '" title="撤销">' + I.undo + '</button>'
    + '<button class="btn-redo-group' + (hasRedo ? '' : ' disabled') + '" data-action="redoGroup" data-id="' + g.id + '" title="前进">' + I.redo + '</button>'
    + '</span>')
    + (isFocused ? '' : '<button class="btn-expand-group" data-action="toggleFocus" data-id="' + g.id + '" title="展开组">' + I.expand + '</button>')
    + '</div>'
    + '<div class="group-body" id="sgBody_' + g.id + '" data-gid="' + g.id + '" contenteditable="true">' + bodyHTML + '</div>'
    + '<div class="card-foot">'
    + '<span class="card-stat">' + bmCount + ' 个书签</span>'
    + '<span class="card-actions">'
    + (isFocused ? '' : '<button class="btn-xs" data-action="addToGroup" data-id="' + g.id + '" title="添加书签到组">' + I.plus + '</button>')
    + (isFocused ? '' : '<button class="btn-xs" data-action="editGroup" data-id="' + g.id + '" title="编辑组">' + I.edit + '</button>')
    + (isFocused ? '' : '<button class="btn-xs btn-danger" data-action="deleteGroup" data-id="' + g.id + '" title="删除组">' + I.trash + '</button>')
    + '</span>'
    + '<button class="list-expand-btn" onclick="toggleListExpand(this)" title="展开">' + I.chevronDown + '</button>'
    + '</div>'
    + '</div>';
}

/* ---- Full render ---- */

function renderContent() {
  var grid = document.getElementById('cardGrid');
  var filtered = getFiltered();
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var groups = getFilteredGroups(q);
  var topLevel = filtered.filter(function (b) { return !b.parentId; });

  if (_focusedGroupId) {
    var fg = A.siblingGroups.find(function (sg) { return sg.id === _focusedGroupId; });
    if (fg) {
      groups = [fg];
      setupFocusModeUI(fg);
    } else {
      _focusedGroupId = null;
      setupGridModeUI();
    }
  } else {
    setupGridModeUI();
  }

  var combined = buildCombinedList(groups, topLevel);
  var html = '';
  combined.forEach(function (item) {
    html += item.type === 'group' ? renderGroupCardHTML(item.data) : renderCardHTML(item.data);
  });
  if (_focusedGroupId) {
    html += '<div class="focus-toolbar" id="focusToolbar">' + buildFocusToolbarHTML(_focusedGroupId) + '</div>';
  }
  if (!html) {
    html = '<div class="empty"><div class="empty-icon">' + I.bookmark + '</div><h3>暂无书签</h3><p>点击 + 按钮开始收藏</p></div>';
  }

  grid.innerHTML = html;

  if (_showTrash) {
    document.getElementById('panelCount').textContent = combined.length + ' 个';
    document.getElementById('panelTitle').textContent = '回收站';
    document.getElementById('filterTools').style.display = 'none';
    document.getElementById('focusBack').style.display = '';
    document.getElementById('focusBack').innerHTML = '<button class="btn-xs" onclick="toggleTrash()" style="font-size:0.8rem">← 返回</button>';
    var btnAdd = document.getElementById('btnAdd');
    if (btnAdd) btnAdd.style.display = 'none';
  } else if (!_focusedGroupId) {
    document.getElementById('panelCount').textContent = combined.length + ' 个';
    document.getElementById('panelTitle').textContent = (A.categories.find(function (c) { return c.id === curCat; }) || {}).name || '全部书签';
  }
  renderRail();
}

function setupFocusModeUI(g) {
  document.getElementById('filterTools').style.display = 'none';
  document.getElementById('focusBack').style.display = '';
  document.getElementById('panelCount').textContent = '';
  var si = document.getElementById('searchInput');
  si.placeholder = '搜索组内…';
  si.value = '';
  si.dataset.focus = '1';
  document.getElementById('cardGrid').classList.add('card-grid-focus');
  var ltWrap = document.getElementById('layoutToggleWrap');
  if (ltWrap) ltWrap.style.display = 'none';
  var btnAdd = document.getElementById('btnAdd');
  if (btnAdd) btnAdd.style.display = 'none';
  var hamburger = document.getElementById('hamburgerBtn');
  if (hamburger) hamburger.style.display = 'none';
  if (window.innerWidth <= 768) document.getElementById('cardGrid').classList.add('focus-mobile');

  var title = document.getElementById('panelTitle');
  title.innerHTML = '<input id="focusGroupTitle" value="' + esc(g.name) + '" placeholder="输入组名…">';
  var input = document.getElementById('focusGroupTitle');
  input.style.cssText = 'font-family:Clash Display,system-ui,sans-serif;font-size:1.1rem;font-weight:600;background:transparent;border:none;border-bottom:1.5px dashed var(--border);outline:none;color:var(--text);padding:2px 4px;border-radius:0;min-width:80px;width:auto';
  input.onchange = function () { renameGroup(_focusedGroupId, this.value); };
  input.onblur = function () { this.style.borderBottomColor = 'var(--border)'; this.style.borderBottomStyle = 'dashed'; renameGroup(_focusedGroupId, this.value); };
  input.onfocus = function () { this.style.borderBottomColor = 'var(--accent)'; this.style.borderBottomStyle = 'solid'; this.select(); };
}

function setupGridModeUI() {
  document.getElementById('filterTools').style.display = 'flex';
  document.getElementById('focusBack').style.display = 'none';
  document.getElementById('cardGrid').classList.remove('card-grid-focus', 'focus-mobile');
  var hamburger = document.getElementById('hamburgerBtn');
  if (hamburger) hamburger.style.display = '';
  var ltWrap = document.getElementById('layoutToggleWrap');
  if (ltWrap) ltWrap.style.display = '';
  var btnAdd = document.getElementById('btnAdd');
  if (btnAdd) btnAdd.style.display = '';
  applyLayoutMode();
  var si = document.getElementById('searchInput');
  si.placeholder = '搜索…';
  si.value = '';
  delete si.dataset.focus;
}

function initLayoutMode() {
  try {
    var saved = localStorage.getItem('lv_layoutMode');
    if (saved === 'list' || saved === 'grid') _layoutMode = saved;
  } catch(e) {}
  applyLayoutMode();
}

function setLayoutMode(mode) {
  if (_focusedGroupId) return;
  _layoutMode = mode;
  try { localStorage.setItem('lv_layoutMode', mode); } catch(e) {}
  applyLayoutMode();
}

function applyLayoutMode() {
  if (_focusedGroupId) return;
  var grid = document.getElementById('cardGrid');
  var ltGrid = document.getElementById('ltGrid');
  var ltList = document.getElementById('ltList');
  if (_layoutMode === 'list') {
    grid.classList.add('card-grid-list');
  } else {
    grid.classList.remove('card-grid-list');
  }
  if (ltGrid) ltGrid.classList.toggle('active', _layoutMode === 'grid');
  if (ltList) ltList.classList.toggle('active', _layoutMode === 'list');
  var grip = document.getElementById('btnGrip');
  if (grip) grip.style.display = (_batchMode && _layoutMode === 'list' && window.innerWidth <= 768) ? '' : 'none';
}

function toggleBatchMode() {
  _batchMode = !_batchMode;
  _batchSelected = [];
  var btn = document.getElementById('btnBatch');
  if (btn) {
    btn.title = _batchMode ? '取消' : '批量管理';
    btn.classList.toggle('active', _batchMode);
  }
  var grip = document.getElementById('btnGrip');
  if (grip) grip.style.display = (_batchMode && _layoutMode === 'list' && window.innerWidth <= 768) ? '' : 'none';
  if (_focusedGroupId) exitGroupFocus();
  renderContent();
  var bar = document.getElementById('batchBar');
  if (bar) bar.style.display = _batchMode ? 'flex' : 'none';
}

function toggleBatchSelect(bmId, e) {
  if (!_batchMode) return;
  e.stopPropagation();
  var idx = _batchSelected.indexOf(bmId);
  if (idx > -1) {
    _batchSelected.splice(idx, 1);
  } else {
    _batchSelected.push(bmId);
  }
  var cb = document.getElementById('batchChk_' + bmId);
  if (cb) cb.checked = _batchSelected.indexOf(bmId) > -1;
  updateBatchCount();
}

function selectAllBatch() {
  var filtered = getFiltered();
  _batchSelected = filtered.map(function (b) { return b.id; });
  document.querySelectorAll('.batch-chk').forEach(function (cb) { cb.checked = true; });
  updateBatchCount();
}

function batchDelete() {
  if (!_batchSelected.length) return;
  if (!confirm('确认删除所选的 ' + _batchSelected.length + ' 个书签？')) return;
  var now = Date.now();
  _batchSelected.forEach(function (id) {
    var bm = A.bookmarks.find(function (b) { return b.id === id; });
    if (bm && !bm.deletedAt) _deleteBmInternal(id, now);
  });
  _batchSelected = [];
  debouncedSave(); renderContent();
  toast('已移入回收站');
}

function batchAddToGroup(gid) {
  if (!_batchSelected.length) return;
  var count = _batchSelected.length;
  _batchSelected.forEach(function (bmId) { addBmToGroup(bmId, gid); });
  _batchSelected = [];
  toast('已将 ' + count + ' 个书签加入组');
  renderContent();
}

function updateBatchCount() {
  var el = document.getElementById('batchCount');
  if (el) el.textContent = '已选 ' + _batchSelected.length + ' 项';
}

function searchInFocusedGroup() {
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var body = document.getElementById('sgBody_' + _focusedGroupId);
  if (!body) return;
  var cards = body.querySelectorAll('.group-inline-card');
  cards.forEach(function (c) {
    var bmId = c.getAttribute('data-bm-id');
    var refGid = c.getAttribute('data-ref-gid');
    if (!q) { c.style.display = ''; return; }
    if (bmId) {
      var bm = A.bookmarks.find(function (b) { return b.id === bmId; });
      if (bm && (bm.title.toLowerCase().indexOf(q) !== -1 || bm.url.toLowerCase().indexOf(q) !== -1)) c.style.display = '';
      else c.style.display = 'none';
    } else if (refGid) {
      var rg = A.siblingGroups.find(function (g) { return g.id === refGid; });
      if (rg && (rg.name || '').toLowerCase().indexOf(q) !== -1) c.style.display = '';
      else c.style.display = 'none';
    }
  });
}

function toggleGroupFocus(gid) {
  _focusedGroupId = (_focusedGroupId === gid) ? null : gid;
  renderContent();
}

function exitGroupFocus() { _focusedGroupId = null; renderContent(); }

function toggleRail() {
  var rail = document.querySelector('.icon-rail');
  var overlay = document.getElementById('railOverlay');
  if (rail) rail.classList.toggle('open');
  if (overlay) overlay.classList.toggle('show');
}

function closeRail() {
  var rail = document.querySelector('.icon-rail');
  var overlay = document.getElementById('railOverlay');
  if (rail) rail.classList.remove('open');
  if (overlay) overlay.classList.remove('show');
}

/* Action Sheet */
function showActionSheet(items) {
  var sheet = document.getElementById('actionSheet');
  var list = document.getElementById('actionSheetList');
  list.innerHTML = items.map(function(it) {
    return '<button class="as-item' + (it.danger ? ' danger' : '') + '" onclick="' + it.action + ';hideActionSheet()">' + esc(it.label) + '</button>';
  }).join('');
  sheet.classList.add('show');
}
function hideActionSheet() { document.getElementById('actionSheet').classList.remove('show'); }

/* Touch long-press and drag (mobile only) */
var _touchData = null;
document.addEventListener('touchstart', function (e) {
  if (window.innerWidth > 768) return;
  var grip = e.target.closest('.batch-grip');
  if (!grip) return;
  var card = grip.closest('.card, .group-card');
  if (!card) return;
  e.preventDefault();
  _touchData = { card: card, grip: grip, startX: e.touches[0].clientX, startY: e.touches[0].clientY, moved: false, clone: null, targetCard: null };
}, { passive: false });

document.addEventListener('touchmove', function (e) {
  if (!_touchData) return;
  var dx = e.touches[0].clientX - _touchData.startX;
  var dy = e.touches[0].clientY - _touchData.startY;
  if (!_touchData.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
  _touchData.moved = true;
  if (!_touchData.clone) {
    _touchData.clone = _touchData.card.cloneNode(true);
    _touchData.clone.classList.add('touch-drag-clone');
    _touchData.clone.style.width = _touchData.card.offsetWidth + 'px';
    document.body.appendChild(_touchData.clone);
    _touchData.card.style.opacity = '0.4';
  }
  _touchData.clone.style.left = (e.touches[0].clientX - _touchData.card.offsetWidth / 2) + 'px';
  _touchData.clone.style.top = (e.touches[0].clientY - 30) + 'px';
  _touchData.clone.style.display = '';
  var el = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
  var targetCard = el ? el.closest('.card,.group-card') : null;
  if (targetCard && targetCard !== _touchData.card && targetCard !== _touchData.targetCard) {
    if (_touchData.targetCard) _touchData.targetCard.classList.remove('drag-target');
    _touchData.targetCard = targetCard;
    _touchData.targetCard.classList.add('drag-target');
  }
});

/* Long-press for mobile action sheet */
var _lpTimer = null, _lpTarget = null;
document.addEventListener('touchstart', function (e) {
  if (window.innerWidth > 768) return;
  if (e.target.closest('.batch-grip, input, button, textarea, [contenteditable="true"]')) return;
  var card = e.target.closest('.card,.group-card');
  if (!card || card.classList.contains('group-card-focus')) return;
  _lpTarget = card;
  _lpTimer = setTimeout(function () {
    _lpTimer = null;
    var bmId = card.dataset.id;
    var gid = card.dataset.groupId;
    if (bmId) {
      showActionSheet([
        { label: '打开链接', action: 'visit(null,\'' + bmId + '\')' },
        { label: '编辑', action: 'editBm(\'' + bmId + '\')' },
        { label: '添加到组', action: 'addToGroup(null,event);' + bmId },
        { label: '删除', action: 'deleteBookmark(\'' + bmId + '\')', danger: true }
      ]);
    } else if (gid) {
      showActionSheet([
        { label: '展开组', action: 'toggleGroupFocus(\'' + gid + '\')' },
        { label: '编辑组', action: 'editGroup(\'' + gid + '\')' },
        { label: '删除组', action: 'deleteGroup(\'' + gid + '\')', danger: true }
      ]);
    }
  }, 500);
}, { passive: true });
document.addEventListener('touchmove', function () { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; _lpTarget = null; } }, { passive: true });
document.addEventListener('touchend', function () { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; _lpTarget = null; } });

document.addEventListener('touchend', function () {
  if (!_touchData) return;
  if (_touchData.clone) {
    _touchData.clone.remove();
    _touchData.card.style.opacity = '';
    if (_touchData.targetCard) {
      _touchData.targetCard.classList.remove('drag-target');
      var aId = _touchData.card.dataset.id || _touchData.card.dataset.groupId;
      var bId = _touchData.targetCard.dataset.id || _touchData.targetCard.dataset.groupId;
      if (aId && bId && aId !== bId) {
        var a, b;
        if (_touchData.card.dataset.id) a = A.bookmarks.find(function (x) { return x.id === aId; });
        else a = A.siblingGroups.find(function (x) { return x.id === aId; });
        if (_touchData.targetCard.dataset.id) b = A.bookmarks.find(function (x) { return x.id === bId; });
        else b = A.siblingGroups.find(function (x) { return x.id === bId; });
        if (a && b) { swapOrder(a, b); debouncedSave(); swapCardsDOM(_touchData.card, _touchData.targetCard); }
      }
    }
  }
  _touchData = null;
});

function swapCardsDOM(a, b) {
  var elA = typeof a === 'string' ? document.querySelector(a) : a;
  var elB = typeof b === 'string' ? document.querySelector(b) : b;
  if (!elA || !elB || elA === elB) return;
  var parent = elA.parentNode;
  var nextA = elA.nextSibling, nextB = elB.nextSibling;
  if (nextA === elB) { parent.insertBefore(elB, elA); }
  else if (nextB === elA) { parent.insertBefore(elA, elB); }
  else { parent.insertBefore(elA, nextB); parent.insertBefore(elB, nextA); }
}

function toggleListExpand(btn) {
  var card = btn.closest('.card, .group-card');
  if (!card) return;
  if (card.classList.contains('group-card')) {
    card.classList.toggle('group-expanded');
  } else {
    card.classList.toggle('card-expanded');
  }
}

/* ---- Detail panel ---- */

function toggleDetailPanel() {
  var panel = document.getElementById('detailPanel');
  if (!_detailCards.length && !panel.classList.contains('open')) { panel.classList.add('open'); renderDetailPanel(); }
  else { panel.classList.toggle('open'); if (!panel.classList.contains('open')) document.getElementById('detailSearchWrap').style.display = 'none'; }
}

function openDetail(bmId) {
  if (_detailCards.indexOf(bmId) === -1) _detailCards.push(bmId);
  renderDetailPanel();
}

function closeDetailCard(bmId) {
  _detailCards = _detailCards.filter(function (id) { return id !== bmId; });
  renderDetailPanel();
}

function renderDetailPanel() {
  var panel = document.getElementById('detailPanel');
  var inner = document.getElementById('detailInner');
  if (!_detailCards.length) {
    document.getElementById('detailSearchWrap').style.display = 'none';
    if (!panel.classList.contains('open')) return;
    inner.innerHTML = '<div class="empty" style="padding:40px 20px"><div class="empty-icon">' + I.bookmark + '</div><h3>辅助栏</h3><p>拖拽书签到此处查看</p></div>';
    return;
  }
  var wasClosed = !panel.classList.contains('open');
  panel.classList.add('open');
  document.getElementById('detailSearchWrap').style.display = '';
  if (wasClosed) document.getElementById('detailSearch').value = '';
  inner.innerHTML = _detailCards.map(function (entry, idx) {
    if (typeof entry === 'string' && entry.indexOf('group:') === 0) {
      var gid = entry.slice(6);
      var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
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
    var bm = A.bookmarks.find(function (b) { return b.id === entry; });
    if (!bm) return '';
    var _da = bm.attributes || {};
    var dTags = '';
    A.customAttributes.forEach(function (a) { if (_da[a.id]) dTags += '<span class="card-tag tag-custom" data-action="filterAttr" data-id="' + a.id + '">' + esc(a.name) + '</span>'; });
    var dSubs = A.bookmarks.filter(function (b) { return b.parentId === bm.id; });
    var dSubsHTML = '';
    if (dSubs.length) {
      dSubsHTML = '<div class="sub-sites">';
      dSubs.forEach(function (sub) {
        dSubsHTML += '<div class="sub-site-item" data-action="visit" data-id="' + sub.id + '">'
          + '<img src="' + (sub.icon || favicon(sub.url)) + '" alt="" onerror="this.style.display=\'none\'">'
          + '<span class="ss-name">' + esc(sub.title) + '</span>'
          + '<span class="ss-domain">' + domain(sub.url) + '</span></div>';
      });
      dSubsHTML += '</div>';
    }
    return '<div class="detail-card" draggable="true" data-bm-id="' + bm.id + '" data-didx="' + idx + '">'
      + '<button class="detail-close" data-action="closeDetail" data-id="' + bm.id + '">&times;</button>'
      + '<div style="margin-bottom:8px;display:flex;align-items:center;gap:8px">'
      + '<div class="card-icon"><img src="' + (bm.icon || favicon(bm.url)) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="icon-fallback">' + bm.title.charAt(0) + '</span></div>'
      + '<div><div class="card-name">' + esc(bm.title) + '</div><div class="card-domain">' + domain(bm.url) + '</div></div>'
      + '</div>'
      + (dTags ? '<div class="card-tags" style="margin-bottom:6px">' + dTags + '</div>' : '')
      + (bm.notes ? '<div class="card-notes" style="margin-bottom:6px">' + esc(bm.notes) + '</div>' : '')
      + (bm.username || bm.password ? '<div class="card-acct-body show" style="margin-bottom:8px">'
        + (bm.username ? '<div class="acct-row"><span class="acct-label">账户</span><span class="acct-val">' + esc(bm.username) + '</span></div>' : '')
        + (bm.password ? '<div class="acct-row"><span class="acct-label">密码</span><span class="acct-val">' + esc(bm.password ? safeAtob(bm.password) : '') + '</span></div>' : '')
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
  var q = (document.getElementById('detailSearch').value || '').trim().toLowerCase();
  document.querySelectorAll('#detailInner .detail-card').forEach(function (c) {
    var name = c.querySelector('.card-name');
    var dom = c.querySelector('.card-domain');
    var t = (name ? name.textContent : '') + (dom ? dom.textContent : '');
    if (!q || t.toLowerCase().indexOf(q) !== -1) c.style.display = '';
    else c.style.display = 'none';
  });
}

/* ==================== BOOKMARK CRUD ==================== */

function visit(e, id) {
  if (e && e.target.closest('button')) return;
  var bm = A.bookmarks.find(function (b) { return b.id === id; });
  if (!bm) return;
  bm.useCount++; debouncedSave();
  var a = document.createElement('a');
  a.href = fixUrl(bm.url); a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  clearTimeout(_visitTimer);
  _visitTimer = setTimeout(function () { renderContent(); }, 150);
}

function openBmModal(bm) {
  _lastFocusedEl = document.activeElement;
  editingId = bm ? bm.id : null;
  var isSub = !!(bm && bm.parentId);
  document.getElementById('bmModalTitle').textContent = bm ? (isSub ? '编辑子书签' : '编辑书签') : '添加书签';
  document.getElementById('bmId').value = bm ? bm.id : '';
  document.getElementById('bmTitle').value = bm ? bm.title : '';
  document.getElementById('bmUrl').value = bm ? bm.url : '';
  document.getElementById('bmUser').value = bm ? bm.username : '';
  document.getElementById('bmPass').value = bm && bm.password ? safeAtob(bm.password) : '';
  document.getElementById('bmNotes').value = bm ? bm.notes : '';
  document.getElementById('bmIcon').value = bm && bm.icon ? bm.icon : '';
  ['bmCat', 'bmUser', 'bmPass', 'bmIcon'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.closest('.form-group').style.display = isSub ? 'none' : '';
  });
  ['btnClearIcon', 'iconPreview'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = isSub ? 'none' : ''; });
  var lp = document.getElementById('logoPreview'); if (lp) lp.style.display = isSub ? 'none' : '';
  if (bm && bm.icon && !isSub) {
    document.getElementById('btnClearIcon').style.display = '';
    document.getElementById('iconPreview').style.display = 'flex';
    document.getElementById('iconPreviewImg').src = bm.icon;
  } else {
    document.getElementById('btnClearIcon').style.display = 'none';
    document.getElementById('iconPreview').style.display = 'none';
  }
  var catSel = document.getElementById('bmCat');
  catSel.innerHTML = A.categories.filter(function (c) { return c.id !== CAT_ALL; }).map(function (c) {
    return '<option value="' + c.id + '" ' + (bm ? (bm.categoryId === c.id ? 'selected' : '') : (c.id === CAT_UNCATEGORIZED ? 'selected' : '')) + '>' + esc(c.name) + '</option>';
  }).join('');
  var pSel = document.getElementById('bmParent');
  var opts = A.bookmarks.filter(function (b) { return !bm || b.id !== bm.id; });
  pSel.innerHTML = '<option value="">无（顶级书签）</option>' + opts.map(function (b) { return '<option value="' + b.id + '" ' + (bm && bm.parentId === b.id ? 'selected' : '') + '>' + esc(b.title) + '</option>'; }).join('');
  var attrDiv = document.getElementById('bmAttrs');
  var parentAttrs = bm && bm.parentId ? (A.bookmarks.find(function (b) { return b.id === bm.parentId; }) || {}).attributes || {} : {};
  attrDiv.innerHTML = A.customAttributes.map(function (a) {
    var checked = '', disabled = '';
    if (parentAttrs[a.id]) { checked = 'checked'; disabled = 'disabled'; }
    else if (bm && bm.attributes[a.id]) checked = 'checked';
    else if (!bm && a.id === 'china-available') checked = 'checked';
    return '<label class="check-chip' + (disabled ? ' locked' : '') + '"><input type="checkbox" data-attr="' + a.id + '" ' + checked + ' ' + disabled + '>' + esc(a.name) + '</label>';
  }).join('');
  document.getElementById('bmModal').classList.add('open');
  setTimeout(function () { document.getElementById('bmTitle').focus(); }, 100);
  previewLogo();
}

function closeBmModal() { document.getElementById('bmModal').classList.remove('open'); editingId = null; if (_lastFocusedEl) _lastFocusedEl.focus(); _lastFocusedEl = null; }

function previewLogo() {
  var url = document.getElementById('bmUrl').value;
  var pv = document.getElementById('logoPreview');
  var fixed = url.indexOf('http') === 0 ? url : 'https://' + url;
  if (url && url.length > 3) { pv.style.display = 'flex'; document.getElementById('logoPreviewImg').src = favicon(fixed); document.getElementById('logoPreviewText').textContent = domain(fixed); }
  else pv.style.display = 'none';
}

function previewIconUrl() {
  var url = document.getElementById('bmIcon').value.trim();
  if (url) { document.getElementById('btnClearIcon').style.display = ''; document.getElementById('iconPreview').style.display = 'flex'; document.getElementById('iconPreviewImg').src = url; }
  else { document.getElementById('btnClearIcon').style.display = 'none'; document.getElementById('iconPreview').style.display = 'none'; }
}

function clearIcon() { document.getElementById('bmIcon').value = ''; document.getElementById('btnClearIcon').style.display = 'none'; document.getElementById('iconPreview').style.display = 'none'; }

function saveBm() {
  var title = document.getElementById('bmTitle').value.trim();
  var url = document.getElementById('bmUrl').value.trim();
  if (!title || !url) { toast('请填写名称和网址', false); return; }
  var parentId = document.getElementById('bmParent').value || null;
  var attrs = {};
  if (parentId) { var pBm = A.bookmarks.find(function (b) { return b.id === parentId; }); if (pBm) Object.assign(attrs, pBm.attributes || {}); }
  A.customAttributes.forEach(function (a) { var cb = document.querySelector('#bmAttrs input[data-attr="' + a.id + '"]'); attrs[a.id] = !!(cb && cb.checked); });
  var data = {
    title: title, url: fixUrl(url),
    username: document.getElementById('bmUser').value.trim(),
    password: document.getElementById('bmPass').value ? btoa(document.getElementById('bmPass').value) : '',
    notes: document.getElementById('bmNotes').value.trim(),
    icon: document.getElementById('bmIcon').value.trim(),
    categoryId: document.getElementById('bmCat').value,
    parentId: parentId,
    attributes: attrs
  };
  var savedId;
  if (editingId) {
    var idx = A.bookmarks.findIndex(function (b) { return b.id === editingId; });
    if (idx >= 0) { A.bookmarks[idx] = Object.assign({}, A.bookmarks[idx], data); savedId = editingId; }
  } else {
    var maxOrder = Math.max(0, A.bookmarks.filter(function (b) { return b.parentId === data.parentId; }).reduce(function (m, b) { return Math.max(m, b.order); }, 0));
    savedId = gid();
    A.bookmarks.push(Object.assign({ id: savedId }, data, { order: maxOrder + 1, useCount: 0, isExpanded: false, createdAt: Date.now() }));
  }
  if (_saveToGroup && savedId) { saveGroupBody(_saveToGroup); addBmToGroup(savedId, _saveToGroup); }
  _saveToGroup = null;
  save(); closeBmModal(); renderContent();
  toast(editingId ? '书签已更新' : '书签已添加');
}

function editBm(id) { var bm = A.bookmarks.find(function (b) { return b.id === id; }); if (bm) openBmModal(bm); }

function addSub(pid) {
  openBmModal(null);
  document.getElementById('bmParent').value = pid;
  document.getElementById('bmModalTitle').textContent = '添加子书签';
  ['bmCat', 'bmUser', 'bmPass', 'bmIcon'].forEach(function (id) { var el = document.getElementById(id); if (el) el.closest('.form-group').style.display = 'none'; });
  ['btnClearIcon', 'iconPreview', 'logoPreview'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
}

function _deleteBmInternal(id, now) {
  (function rec(i) {
    A.bookmarks.filter(function (b) { return b.parentId === i; }).forEach(function (c) { rec(c.id); });
    var b = A.bookmarks.find(function (x) { return x.id === i; });
    if (b) { b.deletedAt = now; delete _pwShown[i]; }
  })(id);
  A.siblingGroups.forEach(function (g) {
    if (g.bookmarkIds.indexOf(id) > -1) {
      if (!_deletedBmGroups) _deletedBmGroups = {};
      if (!_deletedBmGroups[id]) _deletedBmGroups[id] = [];
      if (_deletedBmGroups[id].indexOf(g.id) === -1) _deletedBmGroups[id].push(g.id);
      pushUndo(g.id);
    }
    g.bookmarkIds = g.bookmarkIds.filter(function (bid) { return bid !== id; });
    var gb = document.getElementById('sgBody_' + g.id);
    if (gb) {
      gb.querySelectorAll('.group-inline-card[data-bm-id="' + id + '"]').forEach(function (c) { c.remove(); });
      saveGroupBody(g.id);
    }
  });
}

function deleteBookmark(id) {
  if (!confirm('删除此书签及其所有子书签？')) return;
  _deleteBmInternal(id, Date.now());
  debouncedSave(); renderContent(); toast('已移入回收站');
}

function restoreBookmark(id) {
  (function rec(i) {
    A.bookmarks.filter(function (b) { return b.parentId === i; }).forEach(function (c) { rec(c.id); });
    var b = A.bookmarks.find(function (x) { return x.id === i; });
    if (b) b.deletedAt = null;
  })(id);
  if (_deletedBmGroups && _deletedBmGroups[id]) {
    var gids = _deletedBmGroups[id];
    gids.forEach(function (gid) { addBmToGroup(id, gid); });
    delete _deletedBmGroups[id];
  }
  debouncedSave(); renderContent(); toast('已恢复');
}

function emptyTrash() {
  if (!confirm('永久清空回收站中的所有书签？此操作不可撤销。')) return;
  A.bookmarks = A.bookmarks.filter(function (b) { return !b.deletedAt; });
  debouncedSave(); renderContent(); toast('回收站已清空');
}

function permanentlyDelete(id) {
  if (!confirm('永久删除此书签？此操作不可撤销。')) return;
  A.bookmarks = A.bookmarks.filter(function (b) { return b.id !== id; });
  A.siblingGroups.forEach(function (g) {
    g.bookmarkIds = g.bookmarkIds.filter(function (bid) { return bid !== id; });
  });
  save(); renderContent(); toast('已永久删除');
}

function toggleTrash() {
  _showTrash = !_showTrash;
  if (_showTrash) { curCat = CAT_ALL; _focusedGroupId = null; _activeAttrs = []; _excludedAttrs = []; _detailCards = []; }
  renderContent();
}

function getTrashCount() { return A.bookmarks.filter(function (b) { return b.deletedAt; }).length; }

function toggleAcct(btn, id) { btn.classList.toggle('open'); btn.nextElementSibling.classList.toggle('show'); }

function togglePwCard(id) {
  var bm = A.bookmarks.find(function (b) { return b.id === id; });
  if (!bm) return;
  _pwShown[id] = !_pwShown[id];
  var el = document.getElementById('pwdisp_' + id);
  if (el) el.textContent = _pwShown[id] ? (bm.password ? safeAtob(bm.password) : '') : '••••••';
}

/* ==================== GROUP OPERATIONS ==================== */

function createGroup() {
  A.siblingGroups.forEach(function (g) { g.order++; });
  A.bookmarks.filter(function (b) { return !b.parentId; }).forEach(function (b) { b.order++; });
  var sg = { id: gid(), name: '未命名', bookmarkIds: [], notes: '', categoryId: CAT_UNCATEGORIZED, icon: '', attributes: { [ATTR_IS_GROUP]: true }, order: 0 };
  A.siblingGroups.push(sg);
  debouncedSave(); renderContent();
}

function renameGroup(id, name) { var sg = A.siblingGroups.find(function (g) { return g.id === id; }); if (sg) { sg.name = name || '未命名'; save(); } }

function deleteGroup(id) {
  if (!confirm('删除此组？（书签不会被删除）')) return;
  A.siblingGroups = A.siblingGroups.filter(function (g) { return g.id !== id; });
  delete _undoStacks[id];
  delete _undoTimers[id];
  A.siblingGroups.forEach(function (g) {
    var bodyEl = document.getElementById('sgBody_' + g.id);
    if (bodyEl) {
      bodyEl.querySelectorAll('.group-ref-card[data-ref-gid="' + id + '"]').forEach(function (c) { c.remove(); });
      saveGroupBody(g.id);
    }
  });
  debouncedSave(); renderContent(); toast('组已删除');
}

/* ---- Group body management ---- */

function saveGroupBody(gid) {
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  var el = document.getElementById('sgBody_' + gid);
  if (!sg || !el) return;
  sg.notes = sanitizeHTML(el.innerHTML);
}

function syncGroupBookmarks(gid) {
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  var el = document.getElementById('sgBody_' + gid);
  if (!sg || !el) return;
  var cards = el.querySelectorAll('.group-inline-card[data-bm-id]');
  var ids = [], seen = {};
  cards.forEach(function (c) {
    var bmid = c.getAttribute('data-bm-id');
    if (bmid && !seen[bmid]) { seen[bmid] = true; ids.push(bmid); }
  });
  sg.bookmarkIds = ids;
  save();
}

function handleGroupPaste(e, gid) {
  e.preventDefault();
  pushUndo(gid);
  var text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
}

function ensureTextSibling(el, side) {
  var t = side === 'before' ? el.previousSibling : el.nextSibling;
  if (!t || t.nodeType !== 3 || t.textContent.indexOf('​') === -1) {
    var z = document.createTextNode('​');
    if (side === 'before') el.parentNode.insertBefore(z, el);
    else el.parentNode.insertBefore(z, el.nextSibling);
  }
}

/* ---- Undo/redo ---- */

function pushUndo(gid) {
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  var body = document.getElementById('sgBody_' + gid);
  if (body) sg.notes = sanitizeHTML(body.innerHTML);
  if (!_undoStacks[gid]) _undoStacks[gid] = { undo: [], redo: [] };
  var stack = _undoStacks[gid];
  if (_undoTimers[gid]) { clearTimeout(_undoTimers[gid]); }
  else {
    stack.redo = [];
    if (stack.undo.length >= MAX_UNDO) stack.undo.shift();
    stack.undo.push({ notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() });
  }
  _undoTimers[gid] = setTimeout(function () { delete _undoTimers[gid]; }, UNDO_WINDOW);
  updateUndoRedoButtons(gid);
}

function performUndo(gid) {
  var stack = _undoStacks[gid];
  if (!stack || !stack.undo.length) return false;
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return false;
  var body = document.getElementById('sgBody_' + gid);
  if (body) sg.notes = sanitizeHTML(body.innerHTML);
  if (stack.redo.length >= MAX_UNDO) stack.redo.shift();
  stack.redo.push({ notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() });
  var snap = stack.undo.pop();
  restoreSnapshot(gid, snap);
  debouncedSave(); toast('已撤销');
  return true;
}

function performRedo(gid) {
  var stack = _undoStacks[gid];
  if (!stack || !stack.redo || !stack.redo.length) return false;
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return false;
  var body = document.getElementById('sgBody_' + gid);
  if (body) sg.notes = sanitizeHTML(body.innerHTML);
  if (stack.undo.length >= MAX_UNDO) stack.undo.shift();
  stack.undo.push({ notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() });
  var snap = stack.redo.pop();
  restoreSnapshot(gid, snap);
  debouncedSave(); toast('已前进');
  return true;
}

function restoreSnapshot(gid, snap) {
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  sg.bookmarkIds = snap.bookmarkIds.filter(function (bid) {
    var bm = A.bookmarks.find(function (b) { return b.id === bid; });
    return bm && !bm.deletedAt;
  });
  sg.notes = snap.notes;
  var body = document.getElementById('sgBody_' + gid);
  if (body) {
    body.innerHTML = sg.notes || '';
    body.querySelectorAll('.group-inline-card[data-bm-id]').forEach(function (c) {
      var bmid = c.getAttribute('data-bm-id');
      var bm = A.bookmarks.find(function (b) { return b.id === bmid; });
      if (!bm || bm.deletedAt) c.remove();
    });
  }
  updateUndoRedoButtons(gid);
  var stat = document.querySelector('.group-card[data-group-id="' + gid + '"] .card-stat');
  if (stat) stat.innerHTML = sg.bookmarkIds.length + ' 个书签';
}

function buildFocusToolbarHTML(gid) {
  var stack = _undoStacks[gid];
  var hasUndo = !!(stack && stack.undo && stack.undo.length > 0);
  var hasRedo = !!(stack && stack.redo && stack.redo.length > 0);
  return '<button class="ft-btn' + (hasUndo ? '' : ' disabled') + '" data-action="undoGroup" data-id="' + gid + '" title="撤销">' + I.undo + '</button>'
    + '<button class="ft-btn' + (hasRedo ? '' : ' disabled') + '" data-action="redoGroup" data-id="' + gid + '" title="前进">' + I.redo + '</button>'
    + '<div class="ft-divider"></div>'
    + '<button class="ft-btn" onclick="addToGroup(\'' + gid + '\', event)" title="添加书签到组">' + I.plus + '</button>'
    + '<button class="ft-btn" data-action="editGroup" data-id="' + gid + '" title="编辑组">' + I.edit + '</button>'
    + '<button class="ft-btn ft-btn-danger" data-action="deleteGroup" data-id="' + gid + '" title="删除组">' + I.trash + '</button>'
    + '<div class="ft-divider"></div>'
    + '<button class="ft-btn" onclick="exitGroupFocus()" title="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="19 12 5 12"/><polyline points="12 19 5 12 12 5"/></svg></button>';
}

function updateUndoRedoButtons(gid) {
  var card = document.querySelector('.group-card[data-group-id="' + gid + '"]');
  if (!card) return;
  var undoBtn = card.querySelector('.btn-undo-group');
  var redoBtn = card.querySelector('.btn-redo-group');
  var stack = _undoStacks[gid];
  if (undoBtn) undoBtn.classList.toggle('disabled', !(stack && stack.undo && stack.undo.length > 0));
  if (redoBtn) redoBtn.classList.toggle('disabled', !(stack && stack.redo && stack.redo.length > 0));
  var toolbar = document.getElementById('focusToolbar');
  if (toolbar) {
    var ftUndo = toolbar.querySelector('[data-action="undoGroup"]');
    var ftRedo = toolbar.querySelector('[data-action="redoGroup"]');
    if (ftUndo) ftUndo.classList.toggle('disabled', !(stack && stack.undo && stack.undo.length > 0));
    if (ftRedo) ftRedo.classList.toggle('disabled', !(stack && stack.redo && stack.redo.length > 0));
  }
}

function updateCardStat(gid) {
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  var stat = document.querySelector('.group-card[data-group-id="' + gid + '"] .card-stat');
  if (stat) stat.innerHTML = sg.bookmarkIds.length + ' 个书签';
}

/* ---- Inline card constructors ---- */

function inlineCardHTML(bm) {
  return '<span class="group-inline-card" contenteditable="false" data-bm-id="' + bm.id + '" draggable="true">'
    + (bm.icon ? '<img src="' + esc(bm.icon) + '" alt="" onerror="this.style.display=\'none\'">' : '<img src="' + favicon(bm.url) + '" alt="" onerror="this.style.display=\'none\'">')
    + '<span class="gic-name">' + esc(bm.title) + '</span>'
    + '<span class="gic-domain">' + domain(bm.url) + '</span>'
    + '<span class="gic-btn">详情</span>'
    + '<span class="gic-remove" title="移除">&times;</span>'
    + '</span>';
}

function groupRefCardHTML(g) {
  return '<span class="group-inline-card group-ref-card" contenteditable="false" data-ref-gid="' + g.id + '" draggable="true">'
    + (g.icon ? '<img src="' + esc(g.icon) + '" alt="" onerror="this.style.display=\'none\'">' : '<span style="width:16px;height:16px;flex-shrink:0;color:var(--accent)">' + I.note + '</span>')
    + '<span class="gic-name">' + esc(g.name || '未命名组') + '</span>'
    + '<span class="gic-count">' + g.bookmarkIds.length + '个</span>'
    + '<span class="gic-btn">详情</span>'
    + '<span class="gic-remove" title="移除">&times;</span>'
    + '</span>';
}

function buildInlineCard(bm) {
  var span = document.createElement('span');
  span.className = 'group-inline-card';
  span.setAttribute('contenteditable', 'false');
  span.setAttribute('data-bm-id', bm.id);
  span.setAttribute('draggable', 'true');
  var img = document.createElement('img');
  img.src = bm.icon || favicon(bm.url);
  img.alt = '';
  img.onerror = function () { this.style.display = 'none'; };
  var name = document.createElement('span');
  name.className = 'gic-name';
  name.textContent = bm.title;
  var dm = document.createElement('span');
  dm.className = 'gic-domain';
  dm.textContent = domain(bm.url);
  var btn = document.createElement('span');
  btn.className = 'gic-btn';
  btn.textContent = '详情';
  var rm = document.createElement('span');
  rm.className = 'gic-remove';
  rm.innerHTML = '&times;';
  span.appendChild(img); span.appendChild(name); span.appendChild(dm);
  span.appendChild(btn); span.appendChild(rm);
  return span;
}

/* ---- Add/remove bookmarks to/from groups (DOM-only, no full re-render) ---- */

function addBmToGroup(bmId, gid) {
  pushUndo(gid);
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  sg.bookmarkIds.push(bmId);
  var b = A.bookmarks.find(function (x) { return x.id === bmId; });
  if (b) {
    var body = document.getElementById('sgBody_' + gid);
    if (body) body.appendChild(buildInlineCard(b));
    saveGroupBody(gid);
  }
  save();
  updateCardStat(gid);
  toast('已加入组');
}

function removeBmFromGroup(bmId, gid, cardEl) {
  pushUndo(gid);
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  var idx = sg.bookmarkIds.indexOf(bmId);
  if (idx >= 0) sg.bookmarkIds.splice(idx, 1);
  if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
  saveGroupBody(gid);
  save();
  updateCardStat(gid);
  toast('已从组移除');
}

function addGroupRefToGroup(srcGid, targetGid) {
  pushUndo(targetGid);
  var src = A.siblingGroups.find(function (g) { return g.id === srcGid; });
  var target = A.siblingGroups.find(function (g) { return g.id === targetGid; });
  if (!src || !target || srcGid === targetGid) return;
  var body = document.getElementById('sgBody_' + targetGid);
  if (body && body.querySelector('.group-ref-card[data-ref-gid="' + srcGid + '"]')) return;
  if (body) {
    var tmp = document.createElement('div');
    tmp.innerHTML = groupRefCardHTML(src);
    while (tmp.firstChild) body.appendChild(tmp.firstChild);
    saveGroupBody(targetGid);
  }
  save(); toast('已添加组引用');
}

function removeGroupRef(targetGid, srcGid) {
  var body = document.getElementById('sgBody_' + targetGid);
  if (body) {
    var card = body.querySelector('.group-ref-card[data-ref-gid="' + srcGid + '"]');
    if (card) card.remove();
    saveGroupBody(targetGid);
  }
  save(); toast('已移除组引用');
}

function removeFromSrcGroup(srcGid, bmId) {
  if (!srcGid || !bmId) return false;
  var sg = A.siblingGroups.find(function (g) { return g.id === srcGid; });
  if (!sg) return false;
  var idx = sg.bookmarkIds.indexOf(bmId);
  if (idx < 0) return false;
  sg.bookmarkIds.splice(idx, 1);
  var body = document.getElementById('sgBody_' + srcGid);
  if (body) {
    var card = body.querySelector('.group-inline-card[data-bm-id="' + bmId + '"]');
    if (card) card.remove();
    saveGroupBody(srcGid);
  }
  return true;
}

/* ---- Add-to-group popover ---- */

function addToGroup(gid, event) {
  _addToGid = gid;
  var btn = event.target.closest('button');
  var rect = btn ? btn.getBoundingClientRect() : null;
  var card = document.getElementById('addBmPopover');
  var inner = card.querySelector('.popover-card');
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

function closeAddBmPopover() { document.getElementById('addBmPopover').style.display = 'none'; _addToGid = null; }

function renderAddBmResults() {
  var q = (document.getElementById('addBmSearch').value || '').toLowerCase();
  var results = A.bookmarks.slice();
  if (q) results = results.filter(function (b) { return b.title.toLowerCase().indexOf(q) !== -1 || b.url.toLowerCase().indexOf(q) !== -1 || b.notes.toLowerCase().indexOf(q) !== -1; });
  results = results.slice(0, 20);
  var container = document.getElementById('addBmResults');
  if (!results.length) { container.innerHTML = '<div class="popover-result" style="justify-content:center;color:var(--text-muted);cursor:default">' + (q ? '无匹配书签' : '输入关键词搜索…') + '</div>'; return; }
  container.innerHTML = results.map(function (b) {
    return '<div class="popover-result" onclick="addBmExisting(\'' + b.id + '\')">'
      + '<img src="' + (b.icon || favicon(b.url)) + '" alt="" onerror="this.style.display=\'none\'">'
      + '<span class="pr-name">' + esc(b.title) + '</span>'
      + '<span class="pr-url">' + domain(b.url) + '</span></div>';
  }).join('');
}

function addBmExisting(bmId) { if (!_addToGid) return; addBmToGroup(bmId, _addToGid); closeAddBmPopover(); }

function addBmNew() {
  if (!_addToGid) return;
  _saveToGroup = _addToGid;
  openBmModal(null);
  document.getElementById('bmModalTitle').textContent = '新建书签并添加到组';
  closeAddBmPopover();
}

/* ---- Group edit modal ---- */

function editGroup(gid) {
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  if (!sg) return;
  _editingGeId = gid;
  document.getElementById('geId').value = gid;
  document.getElementById('geName').value = sg.name || '';
  document.getElementById('geIcon').value = sg.icon || '';
  if (sg.icon) { document.getElementById('btnClearGeIcon').style.display = ''; document.getElementById('geIconPreview').style.display = 'flex'; document.getElementById('geIconPreviewImg').src = sg.icon; }
  else { document.getElementById('btnClearGeIcon').style.display = 'none'; document.getElementById('geIconPreview').style.display = 'none'; }
  document.getElementById('geCat').innerHTML = A.categories.filter(function (c) { return c.id !== CAT_ALL; }).map(function (c) {
    return '<option value="' + c.id + '" ' + (sg.categoryId === c.id ? 'selected' : '') + '>' + esc(c.name) + '</option>';
  }).join('');
  document.getElementById('geAttrs').innerHTML = A.customAttributes.map(function (a) {
    return '<label class="check-chip"><input type="checkbox" data-attr="' + a.id + '" ' + ((sg.attributes || {})[a.id] ? 'checked' : '') + '>' + esc(a.name) + '</label>';
  }).join('');
  _lastFocusedEl = document.activeElement;
  renderGeBookmarks(gid);
  document.getElementById('groupEditModal').classList.add('open');
}

function renderGeBookmarks(gid) {
  var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
  var container = document.getElementById('geBookmarks');
  if (!sg || !sg.bookmarkIds.length) { container.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">暂无书签</div>'; return; }
  container.innerHTML = sg.bookmarkIds.map(function (id) {
    var bm = A.bookmarks.find(function (b) { return b.id === id; });
    if (!bm) return '';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:4px;background:var(--bg-alt);border-radius:8px;border:1px solid var(--border-light)">'
      + '<img src="' + (bm.icon || favicon(bm.url)) + '" style="width:18px;height:18px" alt="" onerror="this.style.display=\'none\'">'
      + '<span style="flex:1;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(bm.title) + '</span>'
      + '<span style="font-size:0.7rem;color:var(--text-muted)">' + domain(bm.url) + '</span>'
      + '<button class="btn-xs btn-danger" data-action="removeBmFromGe" data-id="' + id + '" data-gid="' + gid + '">' + I.trash + '</button></div>';
  }).join('');
}

function previewGeIconUrl() {
  var url = document.getElementById('geIcon').value.trim();
  if (url) { document.getElementById('btnClearGeIcon').style.display = ''; document.getElementById('geIconPreview').style.display = 'flex'; document.getElementById('geIconPreviewImg').src = url; }
  else { document.getElementById('btnClearGeIcon').style.display = 'none'; document.getElementById('geIconPreview').style.display = 'none'; }
}

function clearGeIcon() { document.getElementById('geIcon').value = ''; document.getElementById('btnClearGeIcon').style.display = 'none'; document.getElementById('geIconPreview').style.display = 'none'; }

function closeGroupEdit() { document.getElementById('groupEditModal').classList.remove('open'); _editingGeId = null; if (_lastFocusedEl) _lastFocusedEl.focus(); _lastFocusedEl = null; }

function saveGroupEdit() {
  if (!_editingGeId) return;
  var sg = A.siblingGroups.find(function (g) { return g.id === _editingGeId; });
  if (!sg) return;
  sg.name = document.getElementById('geName').value.trim() || '未命名';
  sg.categoryId = document.getElementById('geCat').value;
  sg.icon = document.getElementById('geIcon').value.trim();
  sg.attributes = {};
  A.customAttributes.forEach(function (a) { var cb = document.querySelector('#geAttrs input[data-attr="' + a.id + '"]'); sg.attributes[a.id] = !!(cb && cb.checked); });
  save(); closeGroupEdit(); renderContent(); toast('组已更新');
}

/* ==================== CATEGORY / ATTRIBUTE MANAGEMENT ==================== */

function openCatModal() { _lastFocusedEl = document.activeElement; renderCatList(); document.getElementById('catModal').classList.add('open'); setTimeout(function () { document.getElementById('newCatName').focus(); }, 50); }
function closeCatModal() { document.getElementById('catModal').classList.remove('open'); if (_lastFocusedEl) _lastFocusedEl.focus(); _lastFocusedEl = null; }

function renderCatList() {
  document.getElementById('catManageList').innerHTML = A.categories.filter(function (c) { return c.id !== CAT_ALL; }).map(function (c) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:4px;background:var(--bg-alt);border-radius:8px;border:1px solid var(--border-light)">'
      + '<span style="color:' + c.color + '">' + (I[c.icon] || I.star) + '</span>'
      + '<span style="flex:1;font-size:0.85rem">' + esc(c.name) + '</span>'
      + '<button class="btn-xs btn-danger" data-action="deleteCat" data-id="' + c.id + '">' + I.trash + '</button></div>';
  }).join('');
}

function addCat() {
  var n = document.getElementById('newCatName').value.trim();
  if (!n) { toast('请输入名称', false); return; }
  var colors = ['#122E8A', '#E6397C', '#d97706', '#7c3aed', '#0d9488', '#db2777', '#2563eb', '#059669'];
  A.categories.push({ id: gid(), name: n, icon: 'star', color: colors[Math.floor(Math.random() * colors.length)] });
  document.getElementById('newCatName').value = '';
  save(); renderRail(); renderCatList(); toast('分类已添加');
}

function deleteCategory(id) {
  if (!confirm('删除此分类？内容将移至"未分类"。')) return;
  A.bookmarks.forEach(function (b) { if (b.categoryId === id) b.categoryId = CAT_UNCATEGORIZED; });
  A.siblingGroups.forEach(function (g) { if (g.categoryId === id) g.categoryId = CAT_UNCATEGORIZED; });
  A.categories = A.categories.filter(function (c) { return c.id !== id; });
  save(); renderCatList(); renderContent(); toast('已删除');
}

function openAttrModal() { _lastFocusedEl = document.activeElement; renderAttrList(); document.getElementById('attrModal').classList.add('open'); setTimeout(function () { document.getElementById('newAttrName').focus(); }, 50); }
function closeAttrModal() { document.getElementById('attrModal').classList.remove('open'); if (_lastFocusedEl) _lastFocusedEl.focus(); _lastFocusedEl = null; }

function renderAttrList() {
  document.getElementById('attrManageList').innerHTML = A.customAttributes.map(function (a) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:4px;background:var(--bg-alt);border-radius:8px;border:1px solid var(--border-light)">'
      + '<span class="card-tag tag-custom">' + esc(a.name) + '</span>'
      + '<span style="flex:1"></span>'
      + '<button class="btn-xs btn-danger" data-action="deleteAttr" data-id="' + a.id + '">' + I.trash + '</button></div>';
  }).join('');
}

function addAttr() {
  var n = document.getElementById('newAttrName').value.trim();
  if (!n) { toast('请输入属性名称', false); return; }
  var id = n.replace(/[\s]+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
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
  var a = A.customAttributes.find(function (x) { return x.id === id; });
  if (!a) return;
  var newName = prompt('编辑属性名称', a.name);
  if (!newName || newName.trim() === a.name) return;
  if (A.customAttributes.find(function (x) { return x.name === newName.trim(); })) { toast('属性名称已存在', false); return; }
  a.name = newName.trim();
  save(); renderAttrDropdown(); renderAttrChips(); renderAttrList(); renderContent(); toast('属性已重命名');
}

/* ---- Attribute filter UI ---- */

function toggleAttrDropdown() {
  if (_focusedGroupId) return;
  var drop = document.getElementById('attrDropdown');
  if (drop.style.display === 'none') { document.getElementById('attrSearchInput').value = ''; renderAttrDropdown(); drop.style.display = 'block'; setTimeout(function () { document.getElementById('attrSearchInput').focus(); }, 50); }
  else drop.style.display = 'none';
}

function renderAttrDropdown() {
  var list = document.getElementById('attrDropList');
  var q = (document.getElementById('attrSearchInput').value || '').toLowerCase();
  var filtered = A.customAttributes.filter(function (a) { return a.name.toLowerCase().indexOf(q) !== -1; });
  if (!filtered.length) { list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:0.78rem">无匹配属性</div>'; return; }
  list.innerHTML = filtered.map(function (a) {
    return '<div class="attr-drop-item' + (_activeAttrs.indexOf(a.id) !== -1 ? ' active' : '') + (_excludedAttrs.indexOf(a.id) !== -1 ? ' excluded' : '') + '">'
      + '<span class="attr-drop-main" data-action="toggleAttrFilter" data-id="' + a.id + '" title="包含此属性">'
      + '<span class="attr-dot"></span>' + esc(a.name) + '</span>'
      + '<button class="attr-drop-exclude' + (_excludedAttrs.indexOf(a.id) !== -1 ? ' on' : '') + '" data-action="toggleAttrExclude" data-id="' + a.id + '" title="' + (_excludedAttrs.indexOf(a.id) !== -1 ? '取消排除' : '排除此属性') + '">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></button></div>';
  }).join('');
}

function addAttrQuick() {
  var input = document.getElementById('attrSearchInput');
  var name = input.value.trim();
  if (!name) { toast('请输入属性名称', false); return; }
  var id = name.replace(/[\s]+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || gid();
  if (A.customAttributes.find(function (a) { return a.id === id || a.name === name; })) { toast('属性已存在', false); return; }
  A.customAttributes.push({ id: id, name: name, type: 'boolean' });
  save(); input.value = ''; renderAttrDropdown(); toast('属性已添加');
}

function toggleAttrFilter(attrId) {
  if (_activeAttrs.indexOf(attrId) !== -1) _activeAttrs = _activeAttrs.filter(function (id) { return id !== attrId; });
  else { _activeAttrs.push(attrId); _excludedAttrs = _excludedAttrs.filter(function (id) { return id !== attrId; }); }
  renderAttrChips(); renderContent(); renderAttrDropdown();
}

function toggleAttrExclude(attrId) {
  if (_excludedAttrs.indexOf(attrId) !== -1) _excludedAttrs = _excludedAttrs.filter(function (id) { return id !== attrId; });
  else { _excludedAttrs.push(attrId); _activeAttrs = _activeAttrs.filter(function (id) { return id !== attrId; }); }
  renderAttrChips(); renderContent(); renderAttrDropdown();
}

function renderAttrChips() {
  if (_focusedGroupId) return;
  var container = document.getElementById('attrChips');
  container.innerHTML = _activeAttrs.map(function (id) {
    var a = A.customAttributes.find(function (x) { return x.id === id; });
    return a ? '<span class="attr-chip" data-action="toggleAttrFilter" data-id="' + id + '">' + esc(a.name) + '<span class="attr-chip-x">&times;</span></span>' : '';
  }).join('') + _excludedAttrs.map(function (id) {
    var a = A.customAttributes.find(function (x) { return x.id === id; });
    return a ? '<span class="attr-chip attr-chip-excluded" data-action="toggleAttrExclude" data-id="' + id + '"><span class="attr-chip-txt">' + esc(a.name) + '</span><span class="attr-chip-x">&times;</span></span>' : '';
  }).join('');
}

function toggleSortDir() {
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  document.getElementById('sortAsc').classList.toggle('active', sortDir === 'asc');
  document.getElementById('sortDesc').classList.toggle('active', sortDir === 'desc');
  renderContent();
}

/* ---- Search suggest ---- */

function renderSearchSuggest() {
  if (_focusedGroupId) return;
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var drop = document.getElementById('searchSuggest');
  if (!q) { drop.style.display = 'none'; return; }
  var results = A.bookmarks.filter(function (b) {
    return !b.deletedAt && (b.title.toLowerCase().indexOf(q) !== -1 || b.url.toLowerCase().indexOf(q) !== -1 || b.notes.toLowerCase().indexOf(q) !== -1 || b.username.toLowerCase().indexOf(q) !== -1);
  }).slice(0, MAX_SUGGESTIONS);
  if (!results.length) { drop.style.display = 'none'; return; }
  drop.innerHTML = results.map(function (b) {
    return '<div class="search-suggest-item" data-action="searchSuggest" data-id="' + b.id + '">'
      + '<img src="' + (b.icon || favicon(b.url)) + '" alt="" onerror="this.style.display=\'none\'">'
      + '<span class="ss-name">' + esc(b.title) + '</span>'
      + '<span class="ss-url">' + domain(b.url) + '</span></div>';
  }).join('');
  drop.style.display = 'block';
}

function selectSearchSuggest(bmId) { document.getElementById('searchSuggest').style.display = 'none'; document.getElementById('searchInput').value = ''; visit(null, bmId); }
function hideSearchSuggest() { document.getElementById('searchSuggest').style.display = 'none'; }

/* ==================== DRAG & DROP (centralized via document delegation) ==================== */

document.addEventListener('dragstart', function (e) {
  // 1. Bookmark card in grid
  var bmCard = e.target.closest('.card[data-id]:not(.group-card)');
  if (bmCard) {
    var id = bmCard.dataset.id;
    var gc = bmCard.closest('.group-card');
    var srcGid = gc ? gc.dataset.groupId : null;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'bm', id: id, srcGid: srcGid }));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    bmCard.classList.add('dragging');
    return;
  }
  // 2. Inline bookmark card
  var inlineCard = e.target.closest('.group-inline-card[data-bm-id]');
  if (inlineCard) {
    var id = inlineCard.getAttribute('data-bm-id');
    var gc = inlineCard.closest('.group-card');
    var srcGid = gc ? gc.dataset.groupId : null;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'bm', id: id, srcGid: srcGid }));
    e.dataTransfer.effectAllowed = 'move';
    setDragImage(e);
    inlineCard.classList.add('dragging');
    return;
  }
  // 3. Group card
  var gCard = e.target.closest('.group-card[data-group-id]');
  if (gCard) {
    var gid = gCard.dataset.groupId;
    var parentGc = gCard.parentElement ? gCard.parentElement.closest('.group-card') : null;
    var srcGid = parentGc ? parentGc.dataset.groupId : null;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'group', id: 'group:' + gid, srcGid: srcGid }));
    e.dataTransfer.effectAllowed = 'move';
    gCard.classList.add('dragging');
    return;
  }
  // 4. Group ref card
  var refCard = e.target.closest('.group-ref-card[data-ref-gid]');
  if (refCard) {
    var gid = refCard.getAttribute('data-ref-gid');
    var gc = refCard.closest('.group-card');
    var srcGid = gc ? gc.dataset.groupId : null;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'group', id: 'group:' + gid, srcGid: srcGid }));
    e.dataTransfer.effectAllowed = 'move';
    refCard.classList.add('dragging');
    return;
  }
  // 5. Detail card
  var dCard = e.target.closest('.detail-card[data-didx]');
  if (dCard) {
    _detailDragIdx = parseInt(dCard.dataset.didx);
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'detail', id: dCard.dataset.bmId, srcGid: DRAG_SRC_DETAIL }));
    e.dataTransfer.effectAllowed = 'move';
    dCard.classList.add('dragging');
    return;
  }
  // 6. Rail category
  var rItem = e.target.closest('.rail-item[draggable="true"]');
  if (rItem) {
    _catDragId = rItem.dataset.catId;
    e.dataTransfer.setData(PAYLOAD_KEY, JSON.stringify({ type: 'cat', id: _catDragId }));
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
});

document.addEventListener('dragend', function () {
  clearDragState();
});

document.addEventListener('dragover', function (e) {
  var target = e.target.closest('.card, .group-body, .group-card-head, .detail-card, .rail-item, #detailPanel, #cardGrid');
  if (target !== _dragOverEl) {
    if (_dragOverEl) _dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over');
    _dragOverEl = target;
    if (target) {
      e.preventDefault();
      var cls = target.classList.contains('detail-card') ? 'detail-drag-over' : target.classList.contains('rail-item') ? 'rail-drag-over' : 'drag-over';
      target.classList.add(cls);
    }
  } else if (target) {
    e.preventDefault();
  }
});

document.addEventListener('drop', function (e) {
  // Clear visuals
  if (_dragOverEl) { _dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over'); _dragOverEl = null; }
  var p = dragPayload(e);
  if (!p) return;

  // 1. Group body (most specific)
  var gBody = e.target.closest('.group-body');
  if (gBody) { handleBodyDrop(e, gBody, p); return; }

  // 2. Group card head
  var gHead = e.target.closest('.group-card-head');
  if (gHead) { handleGroupHeadDrop(e, gHead, p); return; }

  // 3. Bookmark card in grid
  var bmCard = e.target.closest('.card:not(.group-card)');
  if (bmCard) { handleBmCardDrop(e, bmCard, p); return; }

  // 4. Group card (exterior)
  var gCard = e.target.closest('.group-card');
  if (gCard) { handleGroupCardDrop(e, gCard, p); return; }

  // 5. Detail card
  var dCard = e.target.closest('.detail-card');
  if (dCard) { handleDetailCardDrop(e, dCard, p); return; }

  // 6. Detail panel
  if (e.target.closest('#detailPanel')) { handleDetailPanelDrop(e, p); return; }

  // 7. Grid empty area
  if (e.target.closest('#cardGrid')) { handleGridDrop(e, p); return; }

  // 8. Rail category
  var rItem = e.target.closest('.rail-item');
  if (rItem) { handleRailDrop(e, rItem); return; }
});

function clearDragState() {
  document.querySelectorAll('.dragging').forEach(function (el) { el.classList.remove('dragging'); });
  if (_dragOverEl) { _dragOverEl.classList.remove('drag-over', 'detail-drag-over', 'rail-drag-over'); _dragOverEl = null; }
  _catDragId = null; _detailDragIdx = null;
}

/* ---- Individual drop handlers ---- */

function handleBodyDrop(e, body, p) {
  e.preventDefault(); e.stopPropagation();
  body.classList.remove('drag-over');
  if (!p) return;
  if (p.type === 'group') {
    addGroupRefToGroup(p.id.slice(6), body.dataset.gid);
    return;
  }
  if (p.type !== 'bm') return;
  var gid = body.dataset.gid;

  if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL && p.srcGid !== gid) {
    removeFromSrcGroup(p.srcGid, p.id);
  }
  if (p.srcGid === DRAG_SRC_DETAIL) {
    _detailCards = _detailCards.filter(function (id) { return id !== p.id; }); renderDetailPanel();
  }

  if (p.srcGid === gid) {
    reorderInlineCard(gid, p.id, e.clientX, e.clientY, e.target);
  } else {
    pushUndo(gid);
    var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
    var b = A.bookmarks.find(function (x) { return x.id === p.id; });
    if (!sg || !b) return;
    var card = buildInlineCard(b);
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

function handleGroupHeadDrop(e, head, p) {
  e.preventDefault(); e.stopPropagation();
  head.classList.remove('drag-over');
  var gid = head.closest('.group-card').dataset.groupId;
  if (!gid) return;
  if (p.type === 'group') {
    var srcGid = p.id.slice(6);
    if (srcGid === gid) return;
    var a = A.siblingGroups.find(function (g) { return g.id === srcGid; });
    var b = A.siblingGroups.find(function (g) { return g.id === gid; });
    if (a && b) { swapOrder(a, b); debouncedSave(); swapCardsDOM('.group-card[data-group-id="' + a.id + '"]', '.group-card[data-group-id="' + b.id + '"]'); }
  } else if (p.type === 'bm') {
    var bm = A.bookmarks.find(function (b) { return b.id === p.id; });
    var sg = A.siblingGroups.find(function (g) { return g.id === gid; });
    if (!bm || !sg) return;
    var dirty = false;
    if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL) { removeFromSrcGroup(p.srcGid, p.id); dirty = true; }
    if (p.srcGid === DRAG_SRC_DETAIL) { _detailCards = _detailCards.filter(function (id) { return id !== p.id; }); renderDetailPanel(); dirty = true; }
    swapOrder(bm, sg);
    debouncedSave();
    if (dirty) { renderContent(); }
    else { swapCardsDOM('.card[data-id="' + bm.id + '"]:not(.group-card)', '.group-card[data-group-id="' + sg.id + '"]'); }
  }
}

function handleBmCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('drag-over');
  var tid = card.dataset.id;
  if (p.id === tid) return;

  // Dragging from source group → remove if dropping outside source group
  if (p.srcGid && p.srcGid !== DRAG_SRC_DETAIL) {
    var onGroup = e.target.closest('.group-card');
    if (!onGroup || onGroup.dataset.groupId !== p.srcGid) {
      if (removeFromSrcGroup(p.srcGid, p.id)) { debouncedSave(); renderContent(); toast('已移出组'); }
    }
    return;
  }

  // Group dropped on bookmark → swap order
  if (p.type === 'group') {
    var sg = A.siblingGroups.find(function (g) { return g.id === p.id.slice(6); });
    var bm = A.bookmarks.find(function (b) { return b.id === tid; });
    if (sg && bm && !bm.parentId) { swapOrder(sg, bm); debouncedSave(); swapCardsDOM('.group-card[data-group-id="' + sg.id + '"]', '.card[data-id="' + bm.id + '"]:not(.group-card)'); }
    return;
  }

  // Bookmark on bookmark → same-parent reorder
  var a = A.bookmarks.find(function (b) { return b.id === p.id; });
  var b = A.bookmarks.find(function (b) { return b.id === tid; });
  if (a && b) {
    if (a.parentId === b.parentId) { swapOrder(a, b); debouncedSave(); swapCardsDOM('.card[data-id="' + a.id + '"]:not(.group-card)', '.card[data-id="' + b.id + '"]:not(.group-card)'); }
    else toast('只能在同级书签间拖拽排序', false);
  }
}

function handleGroupCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('drag-over');
  if (p.type !== 'group') return;
  var gid = card.dataset.groupId;
  var srcGid = p.id.slice(6);
  if (srcGid === gid) return;
  if (!p.srcGid) {
    addGroupRefToGroup(srcGid, gid);
  } else {
    addGroupRefToGroup(srcGid, gid);
  }
}

function handleDetailCardDrop(e, card, p) {
  e.preventDefault(); e.stopPropagation();
  card.classList.remove('detail-drag-over');
  if (p.type !== 'detail') return;
  var toIdx = parseInt(card.dataset.didx);
  if (_detailDragIdx == null || _detailDragIdx === toIdx) return;
  var tmp = _detailCards[_detailDragIdx];
  _detailCards[_detailDragIdx] = _detailCards[toIdx];
  _detailCards[toIdx] = tmp;
  renderDetailPanel();
}

function handleDetailPanelDrop(e, p) {
  e.preventDefault();
  if (p.srcGid === DRAG_SRC_DETAIL) return;
  if (p.type === 'group') {
    if (_detailCards.indexOf(p.id) === -1) _detailCards.push(p.id);
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
    _detailCards = _detailCards.filter(function (id) { return id !== p.id; });
    renderDetailPanel();
  } else if (p.srcGid && removeFromSrcGroup(p.srcGid, p.id)) {
    debouncedSave(); renderContent(); toast('已移出组');
  }
}

function handleRailDrop(e, item) {
  e.preventDefault();
  item.classList.remove('rail-drag-over');
  if (!_catDragId) return;
  var targetId = item.dataset.catId;
  if (!targetId || _catDragId === targetId || targetId === CAT_ALL) return;
  var srcIdx = A.categories.findIndex(function (c) { return c.id === _catDragId; });
  var tgtIdx = A.categories.findIndex(function (c) { return c.id === targetId; });
  if (srcIdx < 0 || tgtIdx < 0) return;
  var src = A.categories.splice(srcIdx, 1)[0];
  A.categories.splice(tgtIdx, 0, src);
  debouncedSave(); renderRail();
}

/* ---- In-group reorder ---- */

function insertCardAtPoint(body, card, clientX, clientY) {
  var range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(clientX, clientY);
  } else if (document.caretPositionFromPoint) {
    var pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
  }
  if (range) {
    var c = range.startContainer;
    var el = c && c.nodeType === 3 ? c.parentElement : c;
    if (el && body.contains(el) && !el.closest('.group-inline-card')) {
      range.insertNode(card);
      ensureTextSibling(card, 'before');
      ensureTextSibling(card, 'after');
      var sel = window.getSelection();
      var r = document.createRange();
      r.setStartAfter(card); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
  }
  return false;
}

function reorderInlineCard(gid, bmId, clientX, clientY, dropTarget) {
  pushUndo(gid);
  var body = document.getElementById('sgBody_' + gid);
  var card = body && body.querySelector('.group-inline-card[data-bm-id="' + bmId + '"]');
  if (!card) return;
  var targetCard = dropTarget && dropTarget.closest && dropTarget.closest('.group-inline-card');
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

/* ==================== EVENT DELEGATION ==================== */

// Unified click delegation (document level — survives renderContent)
document.addEventListener('click', function (e) {
  // 0. Batch mode: intercept card clicks
  if (_batchMode) {
    var bmCard = e.target.closest('.card[data-id]');
    if (bmCard && !e.target.closest('.batch-chk, .btn-xs, .card-tag, .card-acct-toggle, .list-expand-btn, .batch-grip')) {
      e.stopPropagation();
      toggleBatchSelect(bmCard.dataset.id, e);
      return;
    }
  }

  // 1. Inline card buttons inside group bodies (no data-action, uses class selectors)
  var gic = e.target.closest('.gic-btn');
  var gicRm = e.target.closest('.gic-remove');
  var gicName = e.target.closest('.gic-name');
  if (gic || gicRm || gicName) {
    var card = e.target.closest('.group-inline-card');
    if (card) {
      var gb = card.closest('.group-body');
      if (gb) {
        var gid = gb.closest('.group-card') ? gb.closest('.group-card').dataset.groupId : null;
        var bmId = card.getAttribute('data-bm-id');
        var refGid = card.getAttribute('data-ref-gid');
        if (gic) { e.stopPropagation(); if (bmId) openDetail(bmId); else if (refGid) openDetail('group:' + refGid); }
        else if (gicRm) { e.stopPropagation(); if (bmId && gid) removeBmFromGroup(bmId, gid, card); else if (refGid && gid) removeGroupRef(gid, refGid); }
        else if (gicName) { e.stopPropagation(); if (bmId) visit(null, bmId); else if (refGid) toggleGroupFocus(refGid); }
        return;
      }
    }
  }

  // 2. Generic data-action dispatch (works everywhere: grid, detail panel, attr chips, popover, modals, etc.)
  var btn = e.target.closest('[data-action]');
  if (btn) {
    e.stopPropagation();
    var action = btn.dataset.action;
    var id = btn.dataset.id;
    var gid = btn.dataset.gid;
    switch (action) {
      case 'visit': visit(null, id); break;
      case 'editBm': editBm(id); break;
      case 'deleteBm': deleteBookmark(id); break;
      case 'addSub': addSub(id); break;
      case 'toggleFocus': toggleGroupFocus(id); break;
      case 'undoGroup': performUndo(id); break;
      case 'redoGroup': performRedo(id); break;
      case 'addToGroup': addToGroup(id, e); break;
      case 'editGroup': editGroup(id); break;
      case 'deleteGroup': deleteGroup(id); break;
      case 'toggleAcct': toggleAcct(btn, id); break;
      case 'togglePw': togglePwCard(id); break;
      case 'filterAttr': toggleAttrFilter(id); break;
      case 'toggleAttrFilter': toggleAttrFilter(id); break;
      case 'toggleAttrExclude': toggleAttrExclude(id); break;
      case 'closeDetail': closeDetailCard(id); break;
      case 'removeBmFromGe': removeBmFromGroup(id, gid); renderGeBookmarks(gid); break;
      case 'deleteCat': deleteCategory(id); break;
      case 'deleteAttr': deleteAttribute(id); renderAttrDropdown(); renderAttrChips(); renderContent(); break;
      case 'addBmExisting': addBmExisting(id); break;
      case 'searchSuggest': selectSearchSuggest(id); break;
    }
    return;
  }

  // 3. Rail nav item click
  var railItem = e.target.closest('.rail-item[data-cat-id]');
  if (railItem) { selectCat(railItem.dataset.catId); }
});

// contenteditable event delegation on card grid
document.getElementById('cardGrid').addEventListener('focusin', function (e) {
  var body = e.target.closest('.group-body[contenteditable]');
  if (body) {
    var gid = body.dataset.gid;
    if (_saveTimers[gid]) { clearTimeout(_saveTimers[gid]); delete _saveTimers[gid]; }
  }
});

document.getElementById('cardGrid').addEventListener('focusout', function (e) {
  var body = e.target.closest('.group-body[contenteditable]');
  if (body) {
    var gid = body.dataset.gid;
    _saveTimers[gid] = setTimeout(function () {
      saveGroupBody(gid);
      debouncedSave();
      delete _saveTimers[gid];
    }, 200);
  }
});

document.getElementById('cardGrid').addEventListener('beforeinput', function (e) {
  var body = e.target.closest('.group-body[contenteditable]');
  if (body && (e.inputType === 'insertText' || e.inputType === 'insertCompositionText' || e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward')) {
    pushUndo(body.dataset.gid);
  }
});

document.getElementById('cardGrid').addEventListener('input', function (e) {
  var body = e.target.closest('.group-body[contenteditable]');
  if (body) syncGroupBookmarks(body.dataset.gid);
});

document.getElementById('cardGrid').addEventListener('paste', function (e) {
  var body = e.target.closest('.group-body[contenteditable]');
  if (body) handleGroupPaste(e, body.dataset.gid);
});

// Double-click delegation
document.addEventListener('dblclick', function (e) {
  if (e.target.closest('.btn-undo-group, .btn-redo-group, .ft-btn')) { e.stopPropagation(); return; }
  var head = e.target.closest('.group-card-head');
  if (head) {
    var gc = head.closest('.group-card');
    if (gc) toggleGroupFocus(gc.dataset.groupId);
  }
});

// Close dropdowns on outside click
document.addEventListener('click', function (e) {
  var drop = document.getElementById('attrDropdown');
  if (drop && drop.style.display !== 'none' && !e.target.closest('.attr-filter-wrap')) drop.style.display = 'none';
  if (!e.target.closest('#ctxMenu')) hideCtx();
  if (!e.target.closest('#settingsMenu') && !e.target.closest('.settings-wrap')) hideSettingsMenu();
  if (!e.target.closest('#mentionDrop') && !e.target.closest('.group-body')) hideMention();
  if (!e.target.closest('.search-wrapper')) hideSearchSuggest();
});

/* ==================== CONTEXT MENU ==================== */

var ctxTarget = null;
var ctxType = '';

function showCtx(e, type, id) {
  e.preventDefault();
  ctxType = type; ctxTarget = id;
  var menu = document.getElementById('ctxMenu');
  menu.querySelectorAll('.ctx-item').forEach(function (el) {
    var act = el.dataset.action;
    if (type === 'card' && ['visit', 'edit', 'delete'].indexOf(act) !== -1) el.style.display = '';
    else if (type === 'cat' && act === 'delete') el.style.display = '';
    else if (type === 'attr' && ['edit', 'delete'].indexOf(act) !== -1) el.style.display = '';
    else if (type === 'rail-empty' && act === 'addcat') el.style.display = '';
    else if (type === 'grid-empty' && ['addbookmark', 'addgroup'].indexOf(act) !== -1) el.style.display = '';
    else if ((type === 'rail-empty' || type === 'grid-empty') && act === 'trash') el.style.display = getTrashCount() > 0 ? '' : 'none';
    else if (type === 'card' && _showTrash && act === 'restore') el.style.display = '';
    else if ((type === 'card' || type === 'sub') && _showTrash && act === 'permanentdelete') el.style.display = '';
    else if (_showTrash && act === 'emptytrash') el.style.display = getTrashCount() > 0 ? '' : 'none';
    else el.style.display = 'none';
  });
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 170) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px';
}

function toggleSettingsMenu(e) {
  e.stopPropagation();
  var menu = document.getElementById('settingsMenu');
  if (menu.style.display === 'block') { hideSettingsMenu(); return; }
  var btn = document.getElementById('btnSettings');
  var rect = btn.getBoundingClientRect();
  menu.style.display = 'block';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
}

function hideSettingsMenu() { document.getElementById('settingsMenu').style.display = 'none'; }

function hideCtx() { document.getElementById('ctxMenu').style.display = 'none'; ctxTarget = null; ctxType = ''; _ctxGid = null; _ctxCard = null; }

function positionCtx(e) {
  var menu = document.getElementById('ctxMenu');
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 170) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px';
}

// Global contextmenu handler
document.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  // Sub-site item
  var subItem = e.target.closest('.sub-site-item');
  if (subItem) {
    var subId = subItem.dataset.id;
    if (!subId) { var m = (subItem.getAttribute('onclick') || '').match(/visit\(null,'(.+?)'\)/); if (m) subId = m[1]; }
    if (subId) { ctxType = 'sub'; ctxTarget = subId; showSubCtx(e, subId); return; }
  }
  // Group card
  var gCard = e.target.closest('.group-card');
  if (gCard) { groupCtx(e, gCard.dataset.groupId); return; }
  // Bookmark card
  var bmCard = e.target.closest('.card');
  if (bmCard) { showCtx(e, 'card', bmCard.dataset.id); return; }
  // Rail item
  var railItem = e.target.closest('.rail-item');
  if (railItem) {
    var catId = railItem.dataset.catId;
    if (catId && catId !== CAT_ALL) { showCtx(e, 'cat', catId); return; }
  }
  // Rail empty area
  if (e.target.closest('.icon-rail') && !e.target.closest('.rail-item') && !e.target.closest('.rail-logo') && !e.target.closest('.rail-bottom')) { showCtx(e, 'rail-empty', ''); return; }
  // Grid empty area
  if (e.target.closest('#panelContent') && !e.target.closest('.card') && !e.target.closest('.empty')) { showCtx(e, 'grid-empty', ''); return; }
});

function showSubCtx(e, subId) {
  ctxType = 'sub'; ctxTarget = subId;
  var menu = document.getElementById('ctxMenu');
  menu.querySelectorAll('.ctx-item').forEach(function (el) {
    var act = el.dataset.action;
    if (act === 'visit' || act === 'edit' || act === 'delete') el.style.display = '';
    else el.style.display = 'none';
  });
  menu.querySelector('[data-action="visit"]').textContent = '查看详情';
  positionCtx(e);
}

function groupCtx(e, gid) {
  e.preventDefault();
  var onCard = e.target.closest('.group-inline-card');
  if (onCard) {
    var bmId = onCard.getAttribute('data-bm-id');
    _ctxCard = onCard;
    _ctxGid = gid;
    ctxType = 'group-card'; ctxTarget = bmId;
    var menu = document.getElementById('ctxMenu');
    menu.querySelectorAll('.ctx-item').forEach(function (el) {
      var act = el.dataset.action;
      if (act === 'visit') { el.style.display = ''; el.textContent = '查看详情'; }
      else if (act === 'delete') { el.style.display = ''; el.textContent = '从组移除'; }
      else el.style.display = 'none';
    });
    positionCtx(e);
  } else {
    _ctxCard = null;
    ctxType = 'group'; ctxTarget = gid;
    var menu = document.getElementById('ctxMenu');
    menu.querySelectorAll('.ctx-item').forEach(function (el) {
      var act = el.dataset.action;
      if (act === 'edit' || act === 'delete') el.style.display = '';
      else el.style.display = 'none';
    });
    menu.querySelector('[data-action="edit"]').textContent = '编辑组名';
    menu.querySelector('[data-action="delete"]').textContent = '删除组';
    positionCtx(e);
  }
}

document.getElementById('ctxMenu').addEventListener('click', function (e) {
  var btn = e.target.closest('.ctx-item');
  if (!btn) return;
  var act = btn.dataset.action;
  var tid = ctxTarget, ttype = ctxType, tgid = _ctxGid, tcard = _ctxCard;
  hideCtx();
  if (ttype === 'card') {
    if (act === 'visit') visit(null, tid);
    if (act === 'edit') editBm(tid);
    if (act === 'delete') deleteBookmark(tid);
  } else if (ttype === 'sub') {
    if (act === 'visit') openDetail(tid);
    if (act === 'edit') editBm(tid);
    if (act === 'delete') deleteBookmark(tid);
  } else if (ttype === 'cat') {
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
    if (act === 'trash') toggleTrash();
  }
  if (act === 'trash') toggleTrash();
  if (act === 'emptytrash') emptyTrash();
  if (act === 'permanentdelete') permanentlyDelete(tid);
  if (act === 'restore') { restoreBookmark(tid); renderContent(); }
});

/* ==================== @MENTION ==================== */

document.addEventListener('keydown', function (e) {
  if (e.key === '@') {
    var gb = e.target.closest('.group-body');
    if (!gb || !gb.isContentEditable) return;
    _mentionGid = gb.closest('.group-card') ? gb.closest('.group-card').dataset.groupId : null;
    _mentionQuery = ''; _mentionIdx = 0; _mentionRange = null;
    _mentionActive = true;
  }
});

document.addEventListener('input', function (e) {
  if (!_mentionActive || !_mentionGid) return;
  var gb = e.target.closest('.group-body');
  if (!gb || !gb.isContentEditable || (gb.closest('.group-card') ? gb.closest('.group-card').dataset.groupId : null) !== _mentionGid) { hideMention(); return; }
  var sel = window.getSelection();
  if (!sel.rangeCount) { hideMention(); return; }
  var node = sel.focusNode;
  var offset = sel.focusOffset;
  if (node.nodeType !== 3) { hideMention(); return; }
  var text = node.textContent;
  var atIdx = text.lastIndexOf('@', offset - 1);
  if (atIdx >= 0 && atIdx < offset) {
    _mentionQuery = text.slice(atIdx + 1, offset).toLowerCase();
    _mentionRange = document.createRange();
    _mentionRange.setStart(node, atIdx);
    _mentionRange.setEnd(node, offset);
    showMentionNear(_mentionQuery);
    return;
  }
  hideMention();
});

function showMentionNear(query) {
  var matches = A.bookmarks.filter(function (b) {
    return !b.deletedAt && (b.title.toLowerCase().indexOf(query) !== -1 || b.url.toLowerCase().indexOf(query) !== -1);
  }).slice(0, MAX_SUGGESTIONS);
  var drop = document.getElementById('mentionDrop');
  if (!matches.length) { drop.style.display = 'none'; return; }
  _mentionIdx = 0;
  drop.innerHTML = matches.map(function (b, i) {
    return '<div class="mention-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '" data-bm-id="' + b.id + '">'
      + '<img src="' + (b.icon || favicon(b.url)) + '" alt="" onerror="this.style.display=\'none\'">'
      + '<span class="mi-name">' + esc(b.title) + '</span>'
      + '<span class="mi-url">' + domain(b.url) + '</span></div>';
  }).join('');
  drop.style.display = 'block';
  var sel = window.getSelection();
  if (sel.rangeCount) {
    var r = sel.getRangeAt(0).getClientRects()[0];
    if (r) { drop.style.left = Math.min(r.left, window.innerWidth - 310) + 'px'; drop.style.top = Math.min(r.bottom + 4, window.innerHeight - 220) + 'px'; }
  }
}

function hideMention() { document.getElementById('mentionDrop').style.display = 'none'; _mentionGid = null; _mentionQuery = ''; _mentionIdx = 0; _mentionRange = null; _mentionActive = false; }

function selectMention(bmId) {
  if (!_mentionGid) return;
  pushUndo(_mentionGid);
  var sg = A.siblingGroups.find(function (g) { return g.id === _mentionGid; });
  var b = A.bookmarks.find(function (x) { return x.id === bmId; });
  if (!sg || !b) { hideMention(); return; }
  var body = document.getElementById('sgBody_' + _mentionGid);
  if (!body) { hideMention(); return; }
  if (_mentionRange) {
    _mentionRange.deleteContents();
    var card = buildInlineCard(b);
    _mentionRange.insertNode(card);
    ensureTextSibling(card, 'before');
    ensureTextSibling(card, 'after');
    var sel = window.getSelection();
    var newRange = document.createRange();
    newRange.setStartAfter(card);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    body.appendChild(buildInlineCard(b));
  }
  if (sg.bookmarkIds.indexOf(bmId) === -1) sg.bookmarkIds.push(bmId);
  saveGroupBody(_mentionGid);
  save();
  updateCardStat(_mentionGid);
  hideMention();
}

// Mention dropdown click delegation
document.getElementById('mentionDrop').addEventListener('mousedown', function (e) {
  var item = e.target.closest('.mention-item');
  if (item) { e.preventDefault(); selectMention(item.dataset.bmId); }
});

// Mention keyboard navigation
document.addEventListener('keydown', function (e) {
  var drop = document.getElementById('mentionDrop');
  if (drop.style.display === 'none') return;
  if (!document.activeElement || !document.activeElement.closest('.group-body')) { hideMention(); return; }
  var items = drop.querySelectorAll('.mention-item');
  if (e.key === 'ArrowDown') { e.preventDefault(); _mentionIdx = (_mentionIdx + 1) % items.length; updateMentionActive(items); }
  if (e.key === 'ArrowUp') { e.preventDefault(); _mentionIdx = (_mentionIdx - 1 + items.length) % items.length; updateMentionActive(items); }
  if (e.key === 'Enter') { e.preventDefault(); var sel = items[_mentionIdx]; if (sel) selectMention(sel.dataset.bmId); }
  if (e.key === 'Escape') hideMention();
});

function updateMentionActive(items) { items.forEach(function (el, i) { el.classList.toggle('active', i === _mentionIdx); }); }

// Reposition mention dropdown on scroll
document.getElementById('panelContent').addEventListener('scroll', function () {
  var drop = document.getElementById('mentionDrop');
  if (drop.style.display !== 'none' && _mentionGid) {
    var sel = window.getSelection();
    if (sel.rangeCount) {
      var r = sel.getRangeAt(0).getClientRects()[0];
      if (r) { drop.style.left = Math.min(r.left, window.innerWidth - 310) + 'px'; drop.style.top = Math.min(r.bottom + 4, window.innerHeight - 220) + 'px'; }
    }
  }
});

/* ==================== KEYBOARD SHORTCUTS ==================== */

document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('searchInput').focus(); }
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); openBmModal(); }
  }
  // Tab trap within open modals
  if (e.key === 'Tab') {
    var modal = document.querySelector('.modal-mask.open .modal');
    if (!modal) return;
    var focusable = modal.querySelectorAll('input:not([type="hidden"]),textarea,select,button,[tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  // Ctrl+Z/Ctrl+Y in group body
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
    var gid;
    var gb = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.group-body') : null;
    if (gb) gid = gb.closest('.group-card') ? gb.closest('.group-card').dataset.groupId : null;
    if (!gid && _focusedGroupId) gid = _focusedGroupId;
    if (gid) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) performUndo(gid);
      else performRedo(gid);
      return;
    }
  }
  if (e.key === 'Escape') {
    closeBmModal(); closeCatModal(); closeAttrModal(); closeGroupEdit();
    hideCtx(); hideSettingsMenu(); hideSearchSuggest(); closeAddBmPopover();
  }
});

// Search keyboard: Enter selects first, Escape closes
document.getElementById('searchInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { var first = document.querySelector('#searchSuggest .search-suggest-item'); if (first) first.click(); }
  if (e.key === 'Escape') hideSearchSuggest();
});

document.getElementById('addBmSearch').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); var first = document.querySelector('#addBmResults .popover-result'); if (first) first.click(); }
  if (e.key === 'Escape') closeAddBmPopover();
});

/* ==================== STATIC EVENT BINDINGS ==================== */

document.getElementById('btnAdd').addEventListener('click', function (e) {
  if (_focusedGroupId) { e.stopPropagation(); addToGroup(_focusedGroupId, e); }
  else openBmModal();
});
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

document.getElementById('btnAddGroup').addEventListener('click', function () { createGroup(); });
document.getElementById('themeToggle').addEventListener('click', toggleTheme);

document.getElementById('pwToggle').addEventListener('click', function () {
  var pw = document.getElementById('bmPass');
  var show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
  this.innerHTML = show
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
});

document.getElementById('searchInput').addEventListener('input', debounce(function () {
  if (_focusedGroupId) searchInFocusedGroup();
  else { renderContent(); renderSearchSuggest(); }
}, 200));

document.getElementById('sortSelect').addEventListener('change', function () { renderContent(); });

/* ==================== RESIZE HANDLES ==================== */

(function () {
  var leftHandle = document.getElementById('resizeLeft');
  var rightHandle = document.getElementById('resizeRight');
  var leftPanel = document.querySelector('.icon-rail');
  var rightPanel = document.getElementById('detailPanel');

  var savedLeft = localStorage.getItem('lv_railWidth');
  var savedRight = localStorage.getItem('lv_detailWidth');
  if (savedLeft) leftPanel.style.width = savedLeft + 'px';
  if (savedRight) rightPanel.style.setProperty('--detail-width', savedRight + 'px');

  var raf = null, handle = null, panel = null, dir = null, startX = 0, startW = 0;

  function onDown(e, h, p, d) {
    handle = h; panel = p; dir = d;
    handle.classList.add('active');
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
      var delta = (e.clientX - startX) * dir;
      var min = dir > 0 ? 120 : 200;
      var max = dir > 0 ? 500 : 600;
      var w = Math.max(min, Math.min(startW + delta, max));
      if (panel === leftPanel) panel.style.width = w + 'px';
      else { panel.style.setProperty('--detail-width', w + 'px'); if (panel.classList.contains('open')) panel.style.width = w + 'px'; }
    });
  }

  function onUp() {
    if (!handle) return;
    handle.classList.remove('active');
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

document.querySelector('.panel-header').addEventListener('dblclick', function (e) {
  if (_focusedGroupId && !e.target.closest('input, button')) exitGroupFocus();
});

renderContent();
initLayoutMode();
