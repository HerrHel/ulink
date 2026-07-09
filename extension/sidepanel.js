// sidepanel.js — LinkVault Side Panel（本地优先，可选云端同步）

(function () {
  'use strict'

  // ── Supabase 配置 ──
  const SUPABASE_URL = 'https://yqouglfopbmujkqmjgpu.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxb3VnbGZvcGJtdWprcW1qZ3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjI2NjAsImV4cCI6MjA5NTUzODY2MH0.jiS802kT9rZZibDC8N3hB1cyvSxHV5xHs9pNjE7Wmnw'

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: localStorage, storageKey: 'linkvault_ext_auth' }
  })

  // ── 存储键名（与 background.js / popup.js 统一）──
  const STORAGE_KEY = 'linkvault_ext_bookmarks'

  /** 所有 chrome.storage.local 写入走 background 消息，避免并发竞态 */
  async function saveLocalViaBackground(bookmarks) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'SAVE_BOOKMARKS', payload: bookmarks }, function () {
        resolve()
      })
    })
  }

  /** 从 chrome.storage.local 读取 */
  async function loadLocal() {
    try { return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || [] } catch (e) { console.warn('loadLocal failed', e); return [] }
  }

  /** 写入 chrome.storage.local（仅在 background 消息不可用时 fallback） */
  async function saveLocalDirect(bookmarks) {
    try { await chrome.storage.local.set({ [STORAGE_KEY]: bookmarks }) } catch (e) { console.warn('saveLocal failed', e) }
  }

  /** 从 localStorage 迁移到 chrome.storage.local（首次加载时执行一次） */
  async function migrateFromLocalStorage() {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    if (result[STORAGE_KEY] && result[STORAGE_KEY].length) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.length) {
          await chrome.storage.local.set({ [STORAGE_KEY]: parsed })
        }
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch (e) { console.warn('migrateFromLocalStorage failed', e) }
  }

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
  const searchInput = $('#searchInput')
  const searchWrap = $('#searchWrap')
  const searchClear = $('#searchClear')
  const recentTitle = $('#recentTitle')

  let currentTab = null
  let allBookmarks = []
  let userId = null
  let loggedIn = false
  let lastSyncTime = null
  let undoTimeout = null
  let lastDeleted = null
  let currentMatchedBookmark = null
  let searchQuery = ''
  let searchTimer = null

  // ── Toast（支持可操作的撤销 toast）──
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
      // 撤销超时未点击，永久执行
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
      setStatus('ok', '已连接')
    } else {
      headerLoginHint.textContent = '未登录'
      headerLoginHint.style.color = ''
      btnShowLogin.classList.remove('hidden')
      btnLogout.classList.add('hidden')
      setStatus('local', '本地模式')
    }
  }

  // 更新同步时间显示
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

  // ── 书签加载 ──
  function loadBookmarks() {
    if (loggedIn && userId) {
      loadFromCloud()
    } else {
      loadFromLocal()
    }
  }

  async function loadFromLocal() {
    allBookmarks = await loadLocal()
    bookmarkCount.textContent = allBookmarks.length + ' 个书签'
    // 数据刷新时保留搜索状态——重新执行搜索
    if (searchQuery) {
      doSearch(searchInput.value)
    } else {
      renderBookmarks(allBookmarks)
    }
    checkCurrentPageMatch(currentTab && currentTab.url)
  }

  async function loadFromCloud() {
    setStatus('sync', '加载中…')
    bookmarkList.classList.add('loading')
    const result = await sb.from('bookmarks')
      .select('id,title,url,icon,category_id,notes,use_count,created_at_num')
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

  // ── 渲染书签列表 ──
  function renderBookmarks(list) {
    // 搜索模式下用搜索结果覆盖显示
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
          + '💡 在当前页面点击「保存当前页」<br>'
          + '或右键页面选择「保存到 LinkVault」<br>'
          + '快捷键 <kbd style="background:#e5e7eb;padding:1px 5px;border-radius:3px;font-size:11px">Ctrl+Shift+S</kbd>'
          + '</div></div>'
      }
      return
    }

    // 标记匹配的文字（搜索模式下）
    var query = isSearching ? searchQuery.toLowerCase() : ''
    bookmarkList.innerHTML = displayList.slice(0, 50).map(function (b) {
      const host = domain(b.url)
      const icon = b.icon || (host ? 'https://www.google.com/s2/favicons?domain=' + host + '&sz=32' : '')
      var titleHtml = esc(b.title || host)
      var urlHtml = esc(host)
      // 搜索模式下高亮匹配
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

    // 搜索模式结果计数
    if (isSearching && displayList.length > 0) {
      var countFooter = document.createElement('div')
      countFooter.className = 'list-footer'
      countFooter.textContent = '找到 ' + displayList.length + ' 条结果'
      bookmarkList.appendChild(countFooter)
    } else if (!isSearching && displayList.length > 50) {
      var total = displayList.length
      var footer = document.createElement('div')
      footer.className = 'list-footer'
      footer.textContent = '仅显示最近 50 条，共 ' + total + ' 条'
      bookmarkList.appendChild(footer)
    }

    // 事件委托
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

  // ── 搜索书签（实时过滤）──
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

  // ── 高亮匹配文字 ──
  function highlightMatch(text, query) {
    if (!query) return text
    var idx = text.toLowerCase().indexOf(query)
    if (idx === -1) return text
    return text.slice(0, idx) + '<mark>' + esc(text.slice(idx, idx + query.length)) + '</mark>' + text.slice(idx + query.length)
  }

  // ── 搜索输入 ──
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(function () {
      doSearch(searchInput.value)
    }, 200)
  })

  // ── 清除搜索 ──
  searchClear.addEventListener('click', function () {
    searchInput.value = ''
    searchInput.focus()
    doSearch('')
  })

  // ── 键盘快捷键 ──
  document.addEventListener('keydown', function (e) {
    // Ctrl+F 或 / 聚焦搜索框
    if ((e.ctrlKey && e.key === 'f') || (!e.ctrlKey && !e.metaKey && e.key === '/' && e.target.tagName !== 'INPUT')) {
      e.preventDefault()
      searchInput.focus()
      searchInput.select()
    }
    // Escape 清除搜索
    if (e.key === 'Escape' && searchQuery) {
      searchInput.value = ''
      doSearch('')
      searchInput.blur()
    }
  })

  // ── 删除书签（toast + 可撤销）──
  async function deleteBookmark(id, title) {
    if (loggedIn && userId) {
      // 云端模式：直接软删除，toast 提示
      const result = await sb.from('bookmarks').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
      if (result.error) { toast('删除失败: ' + result.error.message); return }
      toast('已删除', 2500)
      loadBookmarks()
    } else {
      // 本地模式：保留待撤销数据，3 秒后永久删除
      var item = allBookmarks.find(function (b) { return b.id === id })
      if (!item) return
      // 立即从界面移除
      allBookmarks = allBookmarks.filter(function (b) { return b.id !== id })
      renderBookmarks(allBookmarks)
      bookmarkCount.textContent = allBookmarks.length + ' 个书签'
      // 显示撤销 toast
      toast('已删除', 3000, {
        label: '撤销',
        onClick: function () {
          // 撤销：恢复数据
          clearTimeout(undoTimeout)
          allBookmarks.unshift(item)
          saveLocalViaBackground(allBookmarks).then(function () {
            renderBookmarks(allBookmarks)
            bookmarkCount.textContent = allBookmarks.length + ' 个书签'
            toast('已恢复', 1500)
          })
        },
        onTimeout: function () {
          // 超时确认删除
          saveLocalViaBackground(allBookmarks)
        }
      })
    }
  }

  // ── 加载当前标签页信息 ──
  function loadCurrentTab() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, function (tab) {
      if (!tab) return
      currentTab = tab
      pageTitle.textContent = tab.title || '无标题'
      pageUrl.textContent = domain(tab.url)
      pageIcon.src = tab.favIconUrl || ''
      pageIcon.onerror = function () { pageIcon.style.display = 'none' }
      // 检测当前 URL 是否已收藏
      checkCurrentPageMatch(tab.url)
    })
  }

  // ── 检测当前页面是否已收藏 ──
  function checkCurrentPageMatch(url) {
    if (!url || !allBookmarks.length) {
      hideBookmarkDetail()
      return
    }
    // URL 标准化匹配：忽略末尾斜杠、协议差异
    var normalizedUrl = url.replace(/\/+$/, '').replace(/^http:\/\//, 'https://')
    var matched = allBookmarks.find(function (b) {
      var bUrl = (b.url || '').replace(/\/+$/, '').replace(/^http:\/\//, 'https://')
      return bUrl === normalizedUrl
    })
    if (matched) {
      showBookmarkDetail(matched)
    } else {
      hideBookmarkDetail()
    }
  }

  // ── 显示已收藏详情 ──
  function showBookmarkDetail(bm) {
    currentMatchedBookmark = bm
    btnSave.classList.add('hidden')
    bookmarkDetail.classList.remove('hidden')

    // 备注
    if (bm.notes && bm.notes.trim()) {
      bdNotesWrap.classList.remove('hidden')
      bdNotes.textContent = bm.notes
    } else {
      bdNotesWrap.classList.add('hidden')
    }

    // 收藏时间
    if (bm.created_at_num) {
      var d = new Date(bm.created_at_num)
      var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      bdCreatedAt.textContent = '📅 ' + dateStr
    } else {
      bdCreatedAt.textContent = ''
    }

    // 使用次数
    bdUseCount.textContent = '👁️ ' + (bm.use_count || 0) + ' 次'
  }

  // ── 隐藏已收藏详情 ──
  function hideBookmarkDetail() {
    currentMatchedBookmark = null
    bookmarkDetail.classList.add('hidden')
    btnSave.classList.remove('hidden')
  }

  // ── 编辑备注 ──
  bdEditNotes.addEventListener('click', function () {
    if (!currentMatchedBookmark) return
    var newNotes = prompt('编辑备注：', currentMatchedBookmark.notes || '')
    if (newNotes === null) return // 取消
    // 本地更新
    currentMatchedBookmark.notes = newNotes
    // 持久化
    if (loggedIn && userId) {
      sb.from('bookmarks').update({ notes: newNotes, updated_at_num: Date.now() }).eq('id', currentMatchedBookmark.id).eq('user_id', userId).then(function (result) {
        if (result.error) { toast('保存失败: ' + result.error.message); return }
        toast('备注已更新', 1500)
        showBookmarkDetail(currentMatchedBookmark)
      })
    } else {
      // 更新本地存储
      var idx = allBookmarks.findIndex(function (b) { return b.id === currentMatchedBookmark.id })
      if (idx !== -1) {
        allBookmarks[idx].notes = newNotes
        saveLocalViaBackground(allBookmarks)
        showBookmarkDetail(currentMatchedBookmark)
        toast('备注已更新', 1500)
      }
    }
  })

  // ── 复制链接 ──
  bdCopyUrl.addEventListener('click', function () {
    if (!currentMatchedBookmark || !currentMatchedBookmark.url) return
    navigator.clipboard.writeText(currentMatchedBookmark.url).then(function () {
      toast('链接已复制', 1500)
    }).catch(function () {
      toast('复制失败', 1500)
    })
  })

  // ── 从详情面板删除 ──
  bdDelete.addEventListener('click', function () {
    if (!currentMatchedBookmark) return
    deleteBookmark(currentMatchedBookmark.id, currentMatchedBookmark.title)
  })

  // ── 监听标签页切换/导航，自动更新匹配 ──
  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(function () {
      setTimeout(loadCurrentTab, 300)
    })
  }
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
      if (changeInfo.url || changeInfo.status === 'complete') {
        // 轮询：只关心当前活动标签页
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0] && tabs[0].id === tabId) {
            setTimeout(loadCurrentTab, 300)
          }
        })
      }
    })
  }

  // ── 保存按钮视觉反馈 ──
  function flashSaveButton(success) {
    if (success) {
      btnSave.innerHTML = '✓ 已保存'
      btnSave.style.background = '#22c55e'
    } else {
      btnSave.innerHTML = '✗ 保存失败'
      btnSave.style.background = '#ef4444'
    }
    setTimeout(function () {
      btnSave.innerHTML = '⚡ 保存当前页面'
      btnSave.style.background = ''
    }, 2000)
  }

  // ── 保存当前页 ──
  btnSave.addEventListener('click', async function () {
    // 通过 background 获取标签页信息（更可靠）
    const tab = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, function (t) { resolve(t) })
    })
    if (!tab || !tab.url) { toast('无法获取当前页面，请刷新后重试'); return }
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')
        || tab.url.startsWith('file:') || tab.url.startsWith('javascript:') || tab.url.startsWith('data:')
        || tab.url.startsWith('blob:') || tab.url.startsWith('view-source:')) {
      return toast('浏览器内部页面无法保存')
    }

    // ── URL 去重 ──
    if (loggedIn && userId) {
      // 云端保存：先查是否已存在
      const dupCheck = await sb.from('bookmarks').select('id').eq('user_id', userId).eq('url', tab.url).is('deleted_at', null).maybeSingle()
      if (!dupCheck.error && dupCheck.data) {
        toast('已存在，无需重复保存')
        flashSaveButton(true)
        return
      }
    } else {
      // 本地保存：查重
      if (allBookmarks.some(function (b) { return b.url === tab.url })) {
        toast('已存在，无需重复保存')
        flashSaveButton(true)
        return
      }
    }

    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const now = Date.now()
    const bookmark = {
      id: id,
      title: tab.title || tab.url,
      url: tab.url,
      icon: tab.favIconUrl || '',
      notes: '',
      use_count: 0,
    }

    if (loggedIn && userId) {
      setStatus('sync', '保存中…')
      const result = await sb.from('bookmarks').upsert({
        id: id, user_id: userId,
        title: bookmark.title, url: bookmark.url,
        icon: bookmark.icon, category_id: 'uncategorized',
        notes: '', username: '',
        password: JSON.stringify(''),
        parent_id: null, order: 0, use_count: 0,
        attributes: {}, is_expanded: false,
        created_at_num: now, updated_at_num: now,
      }, { onConflict: 'id' })
      if (result.error) { setStatus('err', '保存失败'); toast(result.error.message); flashSaveButton(false); return }
    } else {
      // 本地存储（通过 background 集中写入，防止并发竞态）
      allBookmarks.unshift(bookmark)
      await saveLocalViaBackground(allBookmarks)
    }

    toast('已保存')
    flashSaveButton(true)
    if (loggedIn) { setStatus('ok', '已连接') }
    loadBookmarks()
  })

  // ── 刷新 ──
  $('#btnRefresh').addEventListener('click', function () { loadBookmarks(); toast('已刷新') })

  // ── 登录横幅 ──
  $('#btnShowLogin').addEventListener('click', function () {
    loginBanner.classList.remove('hidden')
    emailInput.focus()
  })

  $('#btnCancelLogin').addEventListener('click', function () {
    loginBanner.classList.add('hidden')
    otpSection.classList.add('hidden')
    emailInput.value = ''
    otpInput.value = ''
  })

  // 发送验证码
  $('#btnLogin').addEventListener('click', async function () {
    const email = emailInput.value.trim()
    // 邮箱格式校验
    if (!email) return toast('请输入邮箱')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('邮箱格式不正确')
    setStatus('sync', '发送中…')
    const result = await sb.auth.signInWithOtp({ email: email })
    if (result.error) { setStatus('local', '本地模式'); toast(result.error.message); return }
    otpSection.classList.remove('hidden')
    setStatus('ok', '验证码已发送')
    otpInput.focus()
  })

  // 验证码
  $('#btnVerify').addEventListener('click', async function () {
    const email = emailInput.value.trim()
    const token = otpInput.value.trim()
    if (!token) return toast('请输入验证码')
    setStatus('sync', '验证中…')
    const result = await sb.auth.verifyOtp({ email: email, token: token, type: 'email' })
    if (result.error) { setStatus('local', '本地模式'); toast(result.error.message); return }
    toast('登录成功')
    loginBanner.classList.add('hidden')
    otpSection.classList.add('hidden')
    emailInput.value = ''
    otpInput.value = ''
  })

  // 退出
  $('#btnLogout').addEventListener('click', async function () {
    await sb.auth.signOut()
  })

  // ── 认证状态检查 ──
  async function checkAuth() {
    // 迁移 localStorage → chrome.storage.local
    await migrateFromLocalStorage()

    const result = await sb.auth.getSession()
    if (result.data && result.data.session && result.data.session.user) {
      userId = result.data.session.user.id
      loggedIn = true
      updateLoginUI()
      await mergeLocalToCloud()
      await loadFromCloud()
    } else {
      userId = null
      loggedIn = false
      updateLoginUI()
      await loadFromLocal()
    }
    loadCurrentTab()
  }

  // ── 本地书签合并到云端 ──
  async function mergeLocalToCloud() {
    const local = await loadLocal()
    if (!local.length) return

    const result = await sb.from('bookmarks').select('url').eq('user_id', userId).is('deleted_at', null)
    if (result.error) {
      console.warn('mergeLocalToCloud: 查询云端书签失败', result.error)
      return
    }
    const cloudUrls = new Set((result.data || []).map(function (b) { return b.url }))

    const toUpsert = local.filter(function (b) { return !cloudUrls.has(b.url) })
    if (!toUpsert.length) return // 没有需要合并的，不清空本地（可能有其他未迁移数据）

    const now = Date.now()
    const rows = toUpsert.map(function (b) {
      return {
        id: b.id, user_id: userId,
        title: b.title, url: b.url, icon: b.icon || '',
        category_id: 'uncategorized', notes: '', username: '',
        password: JSON.stringify(''),
        parent_id: null, order: 0, use_count: b.use_count || 0,
        attributes: {}, is_expanded: false,
        created_at_num: now, updated_at_num: now,
      }
    })

    // 先 upsert，成功后再清空本地
    const upsertResult = await sb.from('bookmarks').upsert(rows, { onConflict: 'id' })
    if (upsertResult.error) {
      console.warn('mergeLocalToCloud: upsert 失败，保留本地数据', upsertResult.error)
      toast('云端同步失败，本地书签已保留', 3000)
      return
    }
    // upsert 成功后才清空本地
    await saveLocalViaBackground([])
    if (toUpsert.length > 0) { toast('已同步 ' + toUpsert.length + ' 条本地书签到云端', 3000) }
  }

  // ── 监听 auth 状态变化 ──
  sb.auth.onAuthStateChange(async function (_event, session) {
    if (session && session.user) {
      userId = session.user.id
      loggedIn = true
      updateLoginUI()
      await mergeLocalToCloud()
      await loadFromCloud()
      loadCurrentTab()
    } else {
      userId = null
      loggedIn = false
      updateLoginUI()
      await loadFromLocal()
      loadCurrentTab()
    }
  })

  // ── 监听外部刷新消息（快捷键保存后），支持双向确认 ──
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'REFRESH_BOOKMARKS') {
      loadBookmarks()
      sendResponse({ ok: true })
      return true
    }
  })

  // ── 工具函数 ──
  function ensureProtocol(u) { return u && !u.startsWith('http') ? 'https://' + u : u || '' }
  function domain(u) { try { return new URL(ensureProtocol(u)).hostname } catch (e) { return u || '' } }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML }

  // ── 启动 ──
  checkAuth()
})()
