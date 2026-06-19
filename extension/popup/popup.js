// popup.js — LinkVault Extension Popup Logic

const searchInput = document.getElementById('searchInput')
const resultsEl = document.getElementById('results')
const emptyEl = document.getElementById('empty')
const statusEl = document.getElementById('status')
const saveBtn = document.getElementById('saveCurrentPage')
const openBtn = document.getElementById('openLinkVault')

let allBookmarks = []
let debounceTimer = null

// ── 初始化 ──
async function init() {
  allBookmarks = await loadBookmarks()
  renderResults(allBookmarks)
  searchInput.focus()
}

// ── 加载书签 ──
async function loadBookmarks() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_ALL_BOOKMARKS' }, response => {
      resolve(response?.bookmarks || [])
    })
  })
}

// ── 搜索 ──
function search(query) {
  if (!query.trim()) {
    renderResults(allBookmarks)
    return
  }
  const q = query.toLowerCase()
  const filtered = allBookmarks.filter(b =>
    b.title?.toLowerCase().includes(q) ||
    b.url?.toLowerCase().includes(q)
  )
  renderResults(filtered)
}

// ── 渲染结果 ──
function renderResults(bookmarks) {
  resultsEl.innerHTML = ''
  if (bookmarks.length === 0) {
    emptyEl.style.display = 'flex'
    return
  }
  emptyEl.style.display = 'none'

  for (const b of bookmarks.slice(0, 30)) {
    const item = document.createElement('a')
    item.className = 'result-item'
    item.href = b.url
    item.target = '_blank'
    item.rel = 'noopener'

    const domain = (() => {
      try { return new URL(b.url).hostname } catch { return '' }
    })()

    const iconUrl = domain ? `https://api.xinac.net/icon/?url=${encodeURIComponent(domain)}` : ''

    item.innerHTML = `
      ${iconUrl ? `<img class="result-icon" src="${iconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="result-info">
        <div class="result-title">${escapeHtml(b.title || domain)}</div>
        <div class="result-url">${escapeHtml(domain)}</div>
      </div>
    `
    resultsEl.appendChild(item)
  }
}

// ── 保存当前页面 ──
saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true
  saveBtn.textContent = '保存中...'

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url) {
      showStatus('无法获取当前页面 URL', 'error')
      return
    }

    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'SAVE_BOOKMARK',
        data: { url: tab.url, title: tab.title || tab.url }
      }, resolve)
    })

    if (response?.success) {
      showStatus('✓ 已保存到 LinkVault', 'success')
      allBookmarks = await loadBookmarks()
      search(searchInput.value)
    } else {
      showStatus('已暂存，打开 LinkVault 时自动同步', 'info')
    }
  } catch (e) {
    showStatus('保存失败: ' + e.message, 'error')
  } finally {
    saveBtn.disabled = false
    saveBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      保存当前页面
    `
  }
})

// ── 打开 LinkVault ──
openBtn.addEventListener('click', async () => {
  const response = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_LINKVAULT_TAB' }, resolve)
  })
  if (response?.found && response.tabId) {
    chrome.tabs.update(response.tabId, { active: true })
  } else {
    chrome.tabs.create({ url: 'http://localhost:5173' })
  }
  window.close()
})

// ── 搜索输入 ──
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => search(searchInput.value), 200)
})

// ── 快捷键 ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
  if (e.key === 'Enter' && resultsEl.firstChild) {
    resultsEl.firstChild.click()
  }
})

// ── 状态提示 ──
function showStatus(msg, type) {
  statusEl.textContent = msg
  statusEl.className = 'status ' + type
  statusEl.style.display = 'block'
  setTimeout(() => { statusEl.style.display = 'none' }, 3000)
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

init()
