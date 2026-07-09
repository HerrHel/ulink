// popup.js — LinkVault Extension Popup（快速保存入口）

const statusEl = document.getElementById('status')
const saveBtn = document.getElementById('saveCurrentPage')
const openBtn = document.getElementById('openLinkVault')
const recentList = document.getElementById('recentList')
const emptyEl = document.getElementById('empty')

const STORAGE_KEY = 'linkvault_ext_bookmarks'

// ── chrome.storage.local ──
async function loadBookmarks() {
  try { return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || [] } catch (e) { console.warn('loadBookmarks failed', e); return [] }
}

async function saveBookmarksViaBackground(bookmarks) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage({ type: 'SAVE_BOOKMARKS', payload: bookmarks }, function () { resolve() })
  })
}

async function migrateFromLocalStorage() {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  if (result[STORAGE_KEY] && result[STORAGE_KEY].length) return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.length) await chrome.storage.local.set({ [STORAGE_KEY]: parsed })
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch (e) { console.warn('migrateFromLocalStorage failed', e) }
}

// ── 初始化 ──
async function init() {
  await migrateFromLocalStorage()
  const bookmarks = await loadBookmarks()
  renderRecent(bookmarks)
}

function renderRecent(bookmarks) {
  if (!bookmarks.length) {
    emptyEl.style.display = 'flex'
    return
  }
  emptyEl.style.display = 'none'
  recentList.innerHTML = ''
  for (var i = 0; i < Math.min(bookmarks.length, 3); i++) {
    var b = bookmarks[i]
    var item = document.createElement('a')
    item.className = 'result-item'
    item.href = b.url
    item.target = '_blank'
    item.rel = 'noopener'
    var domain = (function () { try { return new URL(b.url).hostname } catch (e) { return '' } })()
    var iconUrl = domain ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32' : ''
    item.innerHTML = ''
      + (iconUrl ? '<img class="result-icon" src="' + escapeHtml(iconUrl) + '" alt="" onerror="this.style.display=\'none\'">' : '')
      + '<div class="result-info">'
      + '<div class="result-title">' + escapeHtml(b.title || domain) + '</div>'
      + '<div class="result-url">' + escapeHtml(domain) + '</div>'
      + '</div>'
    recentList.appendChild(item)
  }
}

// ── 保存当前页面 ──
saveBtn.addEventListener('click', async function () {
  saveBtn.disabled = true
  saveBtn.textContent = '保存中...'

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    var tab = tabs[0]
    if (!tab || !tab.url) { showStatus('无法获取当前页面 URL', 'error'); return }

    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')
        || tab.url.startsWith('file:') || tab.url.startsWith('javascript:') || tab.url.startsWith('data:')
        || tab.url.startsWith('blob:') || tab.url.startsWith('view-source:')) {
      showStatus('浏览器内部页面无法保存', 'error')
      return
    }

    const now = Date.now()
    const bookmark = {
      id: 'b' + now.toString(36) + Math.random().toString(36).slice(2, 8),
      title: tab.title || tab.url,
      url: tab.url,
      icon: tab.favIconUrl || '',
      notes: '',
      use_count: 0,
    }

    const bookmarks = await loadBookmarks()
    if (!bookmarks.some(function (b) { return b.url === bookmark.url })) {
      bookmarks.unshift(bookmark)
      await saveBookmarksViaBackground(bookmarks)
      showStatus('✓ 已保存', 'success')
      renderRecent(bookmarks)
      // 保存后自动关闭弹窗
      setTimeout(function () { window.close() }, 800)
    } else {
      showStatus('已存在', 'info')
      setTimeout(function () { window.close() }, 1000)
    }
  } catch (e) {
    showStatus('保存失败: ' + e.message, 'error')
  } finally {
    saveBtn.disabled = false
    saveBtn.innerHTML = ''
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
      + ' 保存当前页面'
  }
})

// ── 打开 LinkVault ──
openBtn.addEventListener('click', async function () {
  const tabs = await chrome.tabs.query({})
  const existing = tabs.find(function (t) { return t.url && (t.url.includes('herrh.github.io') || t.url.includes('localhost:5173')) })
  if (existing) {
    chrome.tabs.update(existing.id, { active: true })
  } else {
    chrome.tabs.create({ url: 'https://herrh.github.io' })
  }
  window.close()
})

// ── 快捷键 ──
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') window.close()
  if (e.key === 'Enter' && recentList.firstChild) {
    recentList.firstChild.click()
  }
})

function showStatus(msg, type) {
  statusEl.textContent = msg
  statusEl.className = 'status ' + type
  statusEl.style.display = 'block'
  setTimeout(function () { statusEl.style.display = 'none' }, 3000)
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

init()
