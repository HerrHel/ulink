// sidepanel.js — LinkVault Side Panel（仅云端模式，需登录使用）

(function () {
  'use strict'

  // ── Supabase 配置 ──
  const SUPABASE_URL = 'https://yqouglfopbmujkqmjgpu.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxb3VnbGZvcGJtdWprcW1qZ3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjI2NjAsImV4cCI6MjA5NTUzODY2MH0.jiS802kT9rZZibDC8N3hB1cyvSxHV5xHs9pNjE7Wmnw'

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: localStorage, storageKey: 'linkvault_ext_auth' }
  })

  // ── DOM ──
  const $ = function (s) { return document.querySelector(s) }

  const pageTitle = $('#pageTitle')
  const pageUrl = $('#pageUrl')
  const pageIcon = $('#pageIcon')
  const bookmarkList = $('#bookmarkList')
  const statusDot = $('#statusDot')
  const statusText = $('#statusText')
  const bookmarkCount = $('#bookmarkCount')
  const toastEl = $('#toast')
  const loginBanner = $('#loginBanner')
  const otpSection = $('#otpSection')
  const emailInput = $('#emailInput')
  const otpInput = $('#otpInput')
  const headerLoginHint = $('#headerLoginHint')
  const btnShowLogin = $('#btnShowLogin')
  const btnLogout = $('#btnLogout')
  const btnSave = $('#btnSave')
  const lastSyncEl = $('#lastSync')
  const bookmarkDetail = $('#bookmarkDetail')
  const bdNotes = $('#bdNotes')
  const bdNotesWrap = $('#bdNotesWrap')
  const bdCreatedAt = $('#bdCreatedAt')
  const bdUseCount = $('#bdUseCount')
  const bdEditNotes = $('#bdEditNotes')
  const bdCopyUrl = $('#bdCopyUrl')
  const bdDelete = $('#bdDelete')
  const bdPasswordWrap = $('#bdPasswordWrap')
  const bdPasswordText = $('#bdPasswordText')
  const bdPwShow = $('#bdPwShow')
  const bdPwCopy = $('#bdPwCopy')
  const searchInput = $('#searchInput')
  const searchWrap = $('#searchWrap')
  const searchClear = $('#searchClear')
  const recentTitle = $('#recentTitle')
  const mainContent = $('#mainSection')
  const loginGate = $('#loginGate')

  let currentTab = null
  let allBookmarks = []
  let userId = null
  let loggedIn = false
  let lastSyncTime = null
  let currentMatchedBookmark = null
  let searchQuery = ''
  let searchTimer = null
  let sessionMasterPassword = ''
  let passwordRevealed = false

  // ── Toast ──
  function toast(msg, dur, action) {
    if (dur === undefined) { dur = 2000 }
    if (action) {
      toastEl.innerHTML = msg + '<button class="toast-action" id="toastAction">' + action.label + '</button>'
    } else {
      toastEl.textContent = msg
    }
    toastEl.classList.add('show')
    clearTimeout(toastEl._hideTimer)
    toastEl._hideTimer = setTimeout(function () {
      toastEl.classList.remove('show')
      if (action && action.onTimeout) action.onTimeout()
    }, dur)
    if (action) {
      var actionBtn = document.getElementById('toastAction')
      if (actionBtn) {
        actionBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          clearTimeout(toastEl._hideTimer)
          toastEl.classList.remove('show')
          action.onClick()
        }, { once: true })
      }
    }
  }

  // ── 状态指示 ──
  function setStatus(state, text) { statusDot.className = 'status-dot ' + state; statusText.textContent = text }

  function updateLoginUI() {
    if (loggedIn) {
      headerLoginHint.textContent = '已连接'
      headerLoginHint.style.color = '#22c55e'
      btnShowLogin.classList.add('hidden')
      btnLogout.classList.remove('hidden')
      loginBanner.classList.add('hidden')
      loginGate.classList.add('hidden')
      mainContent.classList.remove('hidden')
      setStatus('ok', '已连接')
    } else {
      headerLoginHint.textContent = '未登录'
      headerLoginHint.style.color = ''
      btnShowLogin.classList.remove('hidden')
      btnLogout.classList.add('hidden')
      loginGate.classList.remove('hidden')
      mainContent.classList.add('hidden')
      setStatus('local', '未登录')
    }
  }

  function updateSyncTime() {
    if (lastSyncTime && lastSyncEl) {
      var ago = Math.round((Date.now() - lastSyncTime) / 1000)
      var text = ''
      if (ago < 10) text = '刚刚同步'
      else if (ago < 60) text = ago + '秒前同步'
      else if (ago < 3600) text = Math.round(ago / 60) + '分钟前同步'
      else text = Math.round(ago / 3600) + '小时前同步'
      lastSyncEl.textContent = text
    }
  }

  // ── 云端加载 ──
  function loadBookmarks() {
    if (!loggedIn || !userId) return
    loadFromCloud()
  }

  async function loadFromCloud() {
    setStatus('sync', '加载中…')
    bookmarkList.classList.add('loading')
    const result = await sb.from('bookmarks')
      .select('id,title,url,icon,category_id,notes,password,use_count,created_at_num')
      .eq('user_id', userId).is('deleted_at', null)
      .order('created_at_num', { ascending: false }).limit(500)
    bookmarkList.classList.remove('loading')
    if (result.error) { setStatus('err', '加载失败: ' + (result.error.message || '未知错误')); return }
    allBookmarks = result.data || []
    bookmarkCount.textContent = allBookmarks.length + ' 个书签'
    lastSyncTime = Date.now()
    updateSyncTime()
    setStatus('ok', '已连接')
    if (searchQuery) {
      doSearch(searchInput.value)
    } else {
      renderBookmarks(allBookmarks)
    }
    checkCurrentPageMatch(currentTab && currentTab.url)
    clearInterval(window._syncTimer)
    window._syncTimer = setInterval(updateSyncTime, 30000)
  }

  // ── 渲染 ──
  function renderBookmarks(list) {
    var displayList = list || allBookmarks
    var isSearching = searchQuery.trim().length > 0

    if (!displayList.length) {
      if (isSearching) {
        bookmarkList.innerHTML = '<div class="search-empty">🔍 未找到匹配的书签<br><span style="font-size:11px;opacity:.7">试试其他关键词</span></div>'
      } else {
        bookmarkList.innerHTML = '<div class="empty">'
          + '<div style="font-size:24px;margin-bottom:8px">📑</div>'
          + '<div style="font-weight:600;margin-bottom:4px">暂无书签</div>'
          + '<div style="font-size:12px;color:var(--text2);line-height:1.6">'
          + '💡 在网页上右键选择「保存到 LinkVault」<br>'
          + '或快捷键 <kbd style="background:#e5e7eb;padding:1px 5px;border-radius:3px;font-size:11px">Ctrl+Shift+S</kbd>'
          + '</div></div>'
      }
      return
    }

    var query = isSearching ? searchQuery.toLowerCase() : ''
    bookmarkList.innerHTML = displayList.slice(0, 50).map(function (b) {
      const host = domain(b.url)
      const icon = b.icon || (host ? 'https://www.google.com/s2/favicons?domain=' + host + '&sz=32' : '')
      var titleHtml = esc(b.title || host)
      var urlHtml = esc(host)
      if (isSearching) {
        titleHtml = highlightMatch(titleHtml, query)
        urlHtml = highlightMatch(urlHtml, query)
      }
      return '<div class="bookmark-item" data-id="' + esc(b.id) + '" data-url="' + esc(b.url) + '">'
        + (icon ? '<img src="' + esc(icon) + '" alt="" onerror="this.style.display=\'none\'">' : '')
        + '<div class="bookmark-item-info">'
        + '<div class="bookmark-item-title">' + titleHtml + '</div>'
        + '<div class="bookmark-item-url">' + urlHtml + '</div>'
        + '</div>'
        + '<span class="bookmark-item-del" data-action="delete" data-id="' + esc(b.id) + '" data-title="' + esc(b.title) + '">&times;</span>'
        + '</div>'
    }).join('')

    if (isSearching && displayList.length > 0) {
      var cf = document.createElement('div')
      cf.className = 'list-footer'
      cf.textContent = '找到 ' + displayList.length + ' 条结果'
      bookmarkList.appendChild(cf)
    } else if (!isSearching && displayList.length > 50) {
      var f2 = document.createElement('div')
      f2.className = 'list-footer'
      f2.textContent = '仅显示最近 50 条，共 ' + displayList.length + ' 条'
      bookmarkList.appendChild(f2)
    }

    bookmarkList.addEventListener('click', function (e) {
      var target = e.target
      while (target && target !== bookmarkList) {
        if (target.dataset.action === 'delete') {
          e.stopPropagation()
          deleteBookmark(target.dataset.id, target.dataset.title)
          return
        }
        if (target.classList.contains('bookmark-item')) {
          chrome.tabs.create({ url: target.dataset.url })
          return
        }
        target = target.parentElement
      }
    }, { once: false })
  }

  // ── 搜索 ──
  function doSearch(query) {
    searchQuery = (query || '').trim()
    if (!searchQuery) {
      searchWrap.classList.remove('active')
      recentTitle.textContent = '最近保存'
      renderBookmarks(allBookmarks)
      bookmarkCount.textContent = allBookmarks.length + ' 个书签'
      return
    }
    searchWrap.classList.add('active')
    var q = searchQuery.toLowerCase()
    var filtered = allBookmarks.filter(function (b) {
      return (b.title && b.title.toLowerCase().indexOf(q) !== -1)
        || (b.url && b.url.toLowerCase().indexOf(q) !== -1)
        || (domain(b.url) && domain(b.url).toLowerCase().indexOf(q) !== -1)
        || (b.notes && b.notes.toLowerCase().indexOf(q) !== -1)
    })
    recentTitle.textContent = '搜索结果'
    bookmarkCount.textContent = '找到 ' + filtered.length + ' 条结果'
    renderBookmarks(filtered)
  }

  function highlightMatch(text, query) {
    if (!query) return text
    var idx = text.toLowerCase().indexOf(query)
    if (idx === -1) return text
    return text.slice(0, idx) + '<mark>' + esc(text.slice(idx, idx + query.length)) + '</mark>' + text.slice(idx + query.length)
  }

  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(function () { doSearch(searchInput.value) }, 200)
  })

  searchClear.addEventListener('click', function () {
    searchInput.value = ''
    searchInput.focus()
    doSearch('')
  })

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey && e.key === 'f') || (!e.ctrlKey && !e.metaKey && e.key === '/' && e.target.tagName !== 'INPUT')) {
      e.preventDefault()
      searchInput.focus()
      searchInput.select()
    }
    if (e.key === 'Escape' && searchQuery) {
      searchInput.value = ''
      doSearch('')
      searchInput.blur()
    }
  })

  // ── 删除（仅云端）──
  async function deleteBookmark(id, title) {
    const result = await sb.from('bookmarks').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
    if (result.error) { toast('删除失败: ' + result.error.message); return }
    toast('已删除', 2500)
    loadBookmarks()
  }

  // ── 当前标签页 ──
  function loadCurrentTab() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, function (tab) {
      if (!tab) return
      currentTab = tab
      pageTitle.textContent = tab.title || '无标题'
      pageUrl.textContent = domain(tab.url)
      pageIcon.src = tab.favIconUrl || ''
      pageIcon.onerror = function () { pageIcon.style.display = 'none' }
      checkCurrentPageMatch(tab.url)
    })
  }

  function checkCurrentPageMatch(url) {
    if (!url || !allBookmarks.length) { hideBookmarkDetail(); return }
    var nUrl = url.replace(/\/+$/, '').replace(/^http:\/\//, 'https://')
    var matched = allBookmarks.find(function (b) {
      var bUrl = (b.url || '').replace(/\/+$/, '').replace(/^http:\/\//, 'https://')
      return bUrl === nUrl
    })
    if (matched) showBookmarkDetail(matched)
    else hideBookmarkDetail()
  }

  // ── 详情面板 ──
  function showBookmarkDetail(bm) {
    currentMatchedBookmark = bm
    btnSave.classList.add('hidden')
    bookmarkDetail.classList.remove('hidden')
    passwordRevealed = false

    if (bm.notes && bm.notes.trim()) { bdNotesWrap.classList.remove('hidden'); bdNotes.textContent = bm.notes }
    else { bdNotesWrap.classList.add('hidden') }

    var hasPw = bm.password && bm.password !== '' && bm.password !== '""' && JSON.stringify(bm.password) !== '""'
    if (hasPw) {
      bdPasswordWrap.classList.remove('hidden')
      bdPasswordText.textContent = '••••••••'
      bdPasswordText.className = 'bd-pw-text'
      bdPwShow.textContent = '显示'
    } else { bdPasswordWrap.classList.add('hidden') }

    if (bm.created_at_num) {
      var d = new Date(bm.created_at_num)
      bdCreatedAt.textContent = '📅 ' + d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
    } else { bdCreatedAt.textContent = '' }
    bdUseCount.textContent = '👁️ ' + (bm.use_count || 0) + ' 次'
  }

  function hideBookmarkDetail() {
    currentMatchedBookmark = null
    bookmarkDetail.classList.add('hidden')
    btnSave.classList.remove('hidden')
  }

  // ── 密码 ──
  bdPwShow.addEventListener('click', async function () {
    if (!currentMatchedBookmark || !currentMatchedBookmark.password) return
    if (passwordRevealed) {
      bdPasswordText.textContent = '••••••••'; bdPasswordText.className = 'bd-pw-text'
      bdPwShow.textContent = '显示'; passwordRevealed = false; return
    }
    try {
      var stored = currentMatchedBookmark.password
      if (typeof stored === 'string') { try { stored = JSON.parse(stored) } catch (e) {} }
      var plaintext = ''
      if (typeof stored === 'object' && stored && stored.encrypted === true) {
        if (!sessionMasterPassword) {
          sessionMasterPassword = prompt('输入主密码以解密密码：')
          if (!sessionMasterPassword) return
        }
        if (window.LinkVaultCrypto) plaintext = await window.LinkVaultCrypto.autoDecryptPassword(stored, sessionMasterPassword)
        else { toast('解密库未加载'); return }
      } else {
        if (window.LinkVaultCrypto) plaintext = await window.LinkVaultCrypto.autoDecryptPassword(stored, '')
        else plaintext = typeof stored === 'string' ? stored : ''
      }
      bdPasswordText.textContent = plaintext; bdPasswordText.className = 'bd-pw-text revealed'
      bdPwShow.textContent = '隐藏'; passwordRevealed = true
    } catch (e) {
      toast('解密失败: ' + e.message)
      if (e.message && e.message.indexOf('主密码') !== -1) sessionMasterPassword = ''
    }
  })

  bdPwCopy.addEventListener('click', async function () {
    if (!currentMatchedBookmark || !currentMatchedBookmark.password) return
    if (!passwordRevealed) { bdPwShow.click(); await new Promise(function (r) { setTimeout(r, 100) }); if (!passwordRevealed) return }
    var text = bdPasswordText.textContent
    if (text === '••••••••') return
    navigator.clipboard.writeText(text).then(function () { toast('密码已复制', 1500) }).catch(function () { toast('复制失败', 1500) })
  })

  // ── 编辑备注（仅云端）──
  bdEditNotes.addEventListener('click', function () {
    if (!currentMatchedBookmark) return
    var newNotes = prompt('编辑备注：', currentMatchedBookmark.notes || '')
    if (newNotes === null) return
    currentMatchedBookmark.notes = newNotes
    sb.from('bookmarks').update({ notes: newNotes, updated_at_num: Date.now() }).eq('id', currentMatchedBookmark.id).eq('user_id', userId).then(function (r) {
      if (r.error) { toast('保存失败: ' + r.error.message); return }
      toast('备注已更新', 1500)
      showBookmarkDetail(currentMatchedBookmark)
    })
  })

  bdCopyUrl.addEventListener('click', function () {
    if (!currentMatchedBookmark || !currentMatchedBookmark.url) return
    navigator.clipboard.writeText(currentMatchedBookmark.url).then(function () { toast('链接已复制', 1500) }).catch(function () { toast('复制失败', 1500) })
  })

  bdDelete.addEventListener('click', function () {
    if (!currentMatchedBookmark) return
    deleteBookmark(currentMatchedBookmark.id, currentMatchedBookmark.title)
  })

  // ── 标签页切换监听 ──
  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(function () { setTimeout(loadCurrentTab, 300) })
  }
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
      if (changeInfo.url || changeInfo.status === 'complete') {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0] && tabs[0].id === tabId) setTimeout(loadCurrentTab, 300)
        })
      }
    })
  }

  // ── 保存按钮 ──
  // 数据流：side panel → background → 打开 PWA 标签页 → PWA 走 sync queue 保存
  // 这样确保保存操作经过 PWA 的 IndexedDB 队列 + 离线同步机制，
  // 与右键菜单 / 快捷键 Ctrl+Shift+S 行为一致。
  function flashSaveButton(success) {
    if (success) { btnSave.innerHTML = '✓ 已保存'; btnSave.style.background = '#22c55e' }
    else { btnSave.innerHTML = '✗ 保存失败'; btnSave.style.background = '#ef4444' }
    setTimeout(function () { btnSave.innerHTML = '⚡ 保存当前页面'; btnSave.style.background = '' }, 2000)
  }

  btnSave.addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, function (tab) {
      if (!tab || !tab.url) { toast('无法获取当前页面，请刷新后重试'); return }
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')
          || tab.url.startsWith('file:') || tab.url.startsWith('javascript:') || tab.url.startsWith('data:')
          || tab.url.startsWith('blob:') || tab.url.startsWith('view-source:')) { return toast('浏览器内部页面无法保存') }

      // 委托 background 打开 PWA 保存（走 PWA 的 sync queue）
      chrome.runtime.sendMessage({ type: 'SAVE_TO_VAULT', url: tab.url, title: tab.title || tab.url })
      flashSaveButton(true)
      setStatus('ok', '已连接')
      toast('已发送到 LinkVault 保存')
    })
  })

  $('#btnRefresh').addEventListener('click', function () { loadBookmarks(); toast('已刷新') })

  // ── 登录 ──
  $('#btnShowLogin').addEventListener('click', function () {
    loginBanner.classList.remove('hidden')
    emailInput.focus()
  })
  $('#btnCancelLogin').addEventListener('click', function () {
    loginBanner.classList.add('hidden')
    otpSection.classList.add('hidden')
    emailInput.value = ''; otpInput.value = ''
  })
  $('#btnLogin').addEventListener('click', async function () {
    const email = emailInput.value.trim()
    if (!email) return toast('请输入邮箱')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('邮箱格式不正确')
    setStatus('sync', '发送中…')
    const result = await sb.auth.signInWithOtp({ email: email })
    if (result.error) { setStatus('local', '未登录'); toast(result.error.message); return }
    otpSection.classList.remove('hidden')
    setStatus('ok', '验证码已发送')
    otpInput.focus()
  })
  $('#btnVerify').addEventListener('click', async function () {
    const email = emailInput.value.trim()
    const token = otpInput.value.trim()
    if (!token) return toast('请输入验证码')
    setStatus('sync', '验证中…')
    const result = await sb.auth.verifyOtp({ email: email, token: token, type: 'email' })
    if (result.error) { setStatus('local', '未登录'); toast(result.error.message); return }
    toast('登录成功')
    loginBanner.classList.add('hidden'); otpSection.classList.add('hidden')
    emailInput.value = ''; otpInput.value = ''
  })
  $('#btnLogout').addEventListener('click', async function () { await sb.auth.signOut() })

  // ── 登录门上的登录按钮 ──
  $('#btnLoginGate').addEventListener('click', function () {
    loginBanner.classList.remove('hidden')
    emailInput.focus()
  })

  // ── 认证检查 ──
  async function checkAuth() {
    const result = await sb.auth.getSession()
    if (result.data && result.data.session && result.data.session.user) {
      userId = result.data.session.user.id
      loggedIn = true
      updateLoginUI()
      await loadFromCloud()
    } else {
      userId = null; loggedIn = false
      updateLoginUI()
    }
    loadCurrentTab()
  }

  // ── Auth 状态变化 ──
  sb.auth.onAuthStateChange(async function (_event, session) {
    if (session && session.user) {
      userId = session.user.id; loggedIn = true
      updateLoginUI()
      await loadFromCloud()
      loadCurrentTab()
    } else {
      userId = null; loggedIn = false
      updateLoginUI()
      loadCurrentTab()
    }
  })

  // ── 消息 ──
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'REFRESH_BOOKMARKS') { loadBookmarks(); sendResponse({ ok: true }); return true }
  })

  // ── 工具 ──
  function ensureProtocol(u) { return u && !u.startsWith('http') ? 'https://' + u : u || '' }
  function domain(u) { try { return new URL(ensureProtocol(u)).hostname } catch (e) { return u || '' } }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML }

  checkAuth()
})()
