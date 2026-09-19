// sidepanel.js — 与链（ulink）Side Panel（云端模式，就地静默保存与分类管理）

(function () {
  'use strict'

  // ── 跨浏览器 API 统一兼容（Chrome, Edge, Firefox, Brave, Arc 等）──
  if (typeof window !== 'undefined' && typeof window.chrome === 'undefined' && typeof window.browser !== 'undefined') {
    window.chrome = window.browser
  }

  // ── Supabase 配置（来自 config.js，与主项目 .env 对齐）──
  const _cfg = window.LinkVaultExtConfig || {}
  const SUPABASE_URL = _cfg.SUPABASE_URL || ''
  const SUPABASE_ANON_KEY = _cfg.SUPABASE_ANON_KEY || ''
  const MASTER_PASSWORD_TTL_MS = _cfg.MASTER_PASSWORD_TTL_MS || 60000
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[sidepanel] LinkVaultExtConfig missing SUPABASE_URL / SUPABASE_ANON_KEY')
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: localStorage, storageKey: 'linkvault_ext_auth' }
  })

  // ── 静态 HTML 国际化替换（Chrome 仅对 manifest/CSS 自动替换，HTML 需脚本替换）──
  function localizeHtml() {
    if (typeof chrome === 'undefined' || !chrome.i18n || !chrome.i18n.getMessage) return

    // 1. 遍历所有文本节点替换 __MSG_xxx__，即使父容器含有子元素亦不漏网
    if (document.body && typeof document.createTreeWalker === 'function') {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false)
      var node
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.indexOf('__MSG_') !== -1) {
          node.nodeValue = node.nodeValue.replace(/__MSG_(\w+)__/g, function (_, k) {
            return chrome.i18n.getMessage(k) || k
          })
        }
      }
    }

    // 2. 遍历所有常用文本属性（placeholder, title, alt, aria-label）
    var all = document.querySelectorAll('*')
    var attrs = ['placeholder', 'title', 'alt', 'aria-label']
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      for (var a = 0; a < attrs.length; a++) {
        var attr = attrs[a]
        var val = el.getAttribute(attr)
        if (val && val.indexOf('__MSG_') !== -1) {
          el.setAttribute(attr, val.replace(/__MSG_(\w+)__/g, function (_, k) {
            return chrome.i18n.getMessage(k) || k
          }))
        }
      }
    }

    if (document.title && document.title.indexOf('__MSG_') !== -1) {
      document.title = document.title.replace(/__MSG_(\w+)__/g, function (_, k) {
        return chrome.i18n.getMessage(k) || k
      })
    }
  }

  localizeHtml()

  // ── 主站标准矢量图标库 ──
  const Icons = window.LinkVaultIcons || {}

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
  const bdNotesEditWrap = $('#bdNotesEditWrap')
  const bdNotesInput = $('#bdNotesInput')
  const bdNotesSave = $('#bdNotesSave')
  const bdNotesCancel = $('#bdNotesCancel')
  const bdCreatedAt = $('#bdCreatedAt')
  const bdUseCount = $('#bdUseCount')
  const bdEditNotes = $('#bdEditNotes')
  const bdCopyUrl = $('#bdCopyUrl')
  const bdDelete = $('#bdDelete')
  const bdPasswordWrap = $('#bdPasswordWrap')
  const bdPasswordText = $('#bdPasswordText')
  const bdPwShow = $('#bdPwShow')
  const bdPwCopy = $('#bdPwCopy')
  const bdCategorySelect = $('#bdCategorySelect')
  const searchInput = $('#searchInput')
  const searchWrap = $('#searchWrap')
  const searchIcon = $('#searchIcon')
  const searchClear = $('#searchClear')
  const recentTitle = $('#recentTitle')
  const mainContent = $('#mainSection')
  const loginGate = $('#loginGate')
  const saveOptionsWrap = $('#saveOptionsWrap')
  const saveCategorySelect = $('#saveCategorySelect')
  const saveCatIconWrap = $('#saveCatIconWrap')
  const bdCatIconWrap = $('#bdCatIconWrap')
  const bdSavedBadge = $('#bdSavedBadge')
  const bdNotesLabel = $('#bdNotesLabel')
  const bdNotesEditLabel = $('#bdNotesEditLabel')
  const bdPasswordLabel = $('#bdPasswordLabel')
  const btnToggleNotes = $('#btnToggleNotes')
  const quickNotesWrap = $('#quickNotesWrap')
  const quickNotesInput = $('#quickNotesInput')
  const categoryBar = $('#categoryBar')
  const tabUrlHint = $('#tabUrlHint')
  const currentPageEl = $('#currentPage')
  const masterPwModal = $('#masterPwModal')
  const masterPwModalTitle = $('#masterPwModalTitle')
  const modalMasterPwInput = $('#modalMasterPwInput')
  const modalMasterPwSubmit = $('#modalMasterPwSubmit')
  const modalMasterPwCancel = $('#modalMasterPwCancel')
  const deleteConfirmModal = $('#deleteConfirmModal')
  const deleteConfirmModalTitle = $('#deleteConfirmModalTitle')
  const deleteConfirmText = $('#deleteConfirmText')
  const btnConfirmDelete = $('#btnConfirmDelete')
  const btnCancelDelete = $('#btnCancelDelete')
  const btnThemeToggle = $('#btnThemeToggle')
  const btnRefresh = $('#btnRefresh')
  const btnSyncWebLogin = $('#btnSyncWebLogin')

  // ── 主题管理（对齐主站 lv_theme / tokens.css）──
  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme)
      document.documentElement.style.colorScheme = theme
      localStorage.setItem('lv_theme', theme)
      if (btnThemeToggle) {
        btnThemeToggle.innerHTML = theme === 'dark' ? (Icons.sun || '') : (Icons.moon || '')
        btnThemeToggle.title = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'
      }
    } else {
      document.documentElement.removeAttribute('data-theme')
      document.documentElement.style.colorScheme = ''
      localStorage.removeItem('lv_theme')
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      if (btnThemeToggle) {
        btnThemeToggle.innerHTML = isDark ? (Icons.sun || '') : (Icons.moon || '')
        btnThemeToggle.title = isDark ? '切换到浅色模式' : '切换到深色模式'
      }
    }
  }

  function initTheme() {
    var savedTheme = localStorage.getItem('lv_theme')
    if (savedTheme) {
      applyTheme(savedTheme)
    } else {
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      if (btnThemeToggle) {
        btnThemeToggle.innerHTML = isDark ? (Icons.sun || '') : (Icons.moon || '')
        btnThemeToggle.title = isDark ? '切换到浅色模式' : '切换到深色模式'
      }
    }
  }

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme')
      if (!current) {
        current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      var next = current === 'dark' ? 'light' : 'dark'
      applyTheme(next)
    })
  }

  // ── 静态矢量图标挂载（全面淘汰 Emoji，与主站设计语言严格一致）──
  function initStaticIcons() {
    if (btnRefresh) btnRefresh.innerHTML = Icons.refresh || ''
    if (searchIcon) searchIcon.innerHTML = Icons.search || ''
    if (searchClear) searchClear.innerHTML = Icons.close || ''
    if (saveCatIconWrap) saveCatIconWrap.innerHTML = Icons.folder || ''
    if (bdCatIconWrap) bdCatIconWrap.innerHTML = Icons.folder || ''
    if (btnToggleNotes) btnToggleNotes.innerHTML = (Icons.note || '') + ' <span>' + esc(chrome.i18n.getMessage('quick_notes_toggle')) + '</span>'
    if (btnSave) btnSave.innerHTML = (Icons.zap || '') + ' <span>' + esc(chrome.i18n.getMessage('save_current_page')) + '</span>'
    if (btnSyncWebLogin) btnSyncWebLogin.innerHTML = (Icons.sync || '') + ' <span>' + esc(chrome.i18n.getMessage('sync_web_login')) + '</span>'
    if (bdSavedBadge) bdSavedBadge.innerHTML = (Icons.check || '') + ' <span>' + esc(chrome.i18n.getMessage('already_saved')) + '</span>'
    if (bdNotesLabel) bdNotesLabel.innerHTML = (Icons.note || '') + ' <span>' + esc(chrome.i18n.getMessage('notes')) + '</span>'
    if (bdNotesEditLabel) bdNotesEditLabel.innerHTML = (Icons.note || '') + ' <span>' + esc(chrome.i18n.getMessage('notes')) + '</span>'
    if (bdEditNotes) bdEditNotes.innerHTML = (Icons.edit || '') + ' <span>' + esc(chrome.i18n.getMessage('edit_notes')) + '</span>'
    if (bdPasswordLabel) bdPasswordLabel.innerHTML = (Icons.lock || '') + ' <span>' + esc(chrome.i18n.getMessage('password')) + '</span>'
    if (bdCopyUrl) bdCopyUrl.innerHTML = (Icons.link || '') + ' <span>' + esc(chrome.i18n.getMessage('copy_url')) + '</span>'
    if (bdDelete) bdDelete.innerHTML = (Icons.trash || '') + ' <span>' + esc(chrome.i18n.getMessage('delete')) + '</span>'
    if (masterPwModalTitle) masterPwModalTitle.innerHTML = (Icons.lock || '') + ' <span>' + esc(chrome.i18n.getMessage('master_password_title')) + '</span>'
    if (deleteConfirmModalTitle) deleteConfirmModalTitle.innerHTML = (Icons.trash || '') + ' <span>' + esc(chrome.i18n.getMessage('delete')) + '</span>'
  }

  initTheme()
  initStaticIcons()

  // R16：MV3 CSP 拦截内联 onerror 属性，用事件委托 capture 替代
  bookmarkList.addEventListener('error', function (e) {
    if (e.target.tagName === 'IMG' && e.target.src) e.target.style.display = 'none'
  }, true)

  // F1-001：click 委托只注册一次
  bookmarkList.addEventListener('click', function (e) {
    var target = e.target
    while (target && target !== bookmarkList) {
      if (target.dataset && target.dataset.action === 'delete') {
        e.stopPropagation()
        deleteBookmark(target.dataset.id, target.dataset.title)
        return
      }
      if (target.classList && target.classList.contains('bookmark-item')) {
        var openUrl = target.dataset.url
        if (!isSafeHttpUrl(openUrl)) {
          toast(chrome.i18n.getMessage('err_unsafe_protocol'), 2000)
          return
        }
        chrome.tabs.create({ url: openUrl })
        return
      }
      target = target.parentElement
    }
  })

  let currentTab = null
  let allBookmarks = []
  let allCategories = []
  let selectedCategory = 'all'
  let userId = null
  let loggedIn = false
  let lastSyncTime = null
  let currentMatchedBookmark = null
  let currentDetailPassword = null
  let searchQuery = ''
  let searchTimer = null
  let sessionMasterPassword = ''
  let passwordRevealed = false
  let _mpClearTimer = null
  let cachedCanaryData = null
  let _masterPwResolver = null
  let _deleteResolver = null
  let _isSaving = false

  /** M6/F1-002：主密码 TTL 到期时同步掩码 DOM 明文密码 */
  function maskRevealedPassword() {
    passwordRevealed = false
    if (bdPasswordText) {
      bdPasswordText.textContent = '••••••••'
      bdPasswordText.className = 'bd-pw-text'
    }
    if (bdPwShow) bdPwShow.innerHTML = (Icons.eye || '') + ' <span>' + esc(chrome.i18n.getMessage('show')) + '</span>'
  }

  function scheduleClearMasterPassword() {
    if (_mpClearTimer) clearTimeout(_mpClearTimer)
    _mpClearTimer = setTimeout(function () {
      sessionMasterPassword = ''
      _mpClearTimer = null
      maskRevealedPassword()
    }, MASTER_PASSWORD_TTL_MS)
  }

  function clearMasterPasswordNow() {
    if (_mpClearTimer) { clearTimeout(_mpClearTimer); _mpClearTimer = null }
    sessionMasterPassword = ''
    maskRevealedPassword()
  }

  async function ensureCanaryData() {
    if (cachedCanaryData) return cachedCanaryData
    try {
      var res = await sb.from('user_security')
        .select('master_canary')
        .eq('user_id', userId)
        .single()
      if (res.error || !res.data || !res.data.master_canary) return null
      cachedCanaryData = res.data.master_canary
      return cachedCanaryData
    } catch (e) { return null }
  }

  function isSafeHttpUrl(url) {
    if (!url || typeof url !== 'string') return false
    try {
      var u = new URL(url.trim())
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch (_) {
      return false
    }
  }

  // ── Toast ──
  function toast(msg, dur, action) {
    if (dur === undefined) { dur = 2000 }
    if (action) {
      toastEl.innerHTML = esc(msg) + '<button class="toast-action" id="toastAction">' + esc(action.label) + '</button>'
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
      if (headerLoginHint) {
        headerLoginHint.textContent = chrome.i18n.getMessage('status_connected')
        headerLoginHint.style.color = '#22c55e'
      }
      if (btnShowLogin) btnShowLogin.classList.add('hidden')
      if (btnLogout) btnLogout.classList.remove('hidden')
      if (loginBanner) loginBanner.classList.add('hidden')
      if (loginGate) loginGate.classList.add('hidden')
      if (mainContent) mainContent.classList.remove('hidden')
      setStatus('ok', chrome.i18n.getMessage('status_connected'))
    } else {
      if (headerLoginHint) {
        headerLoginHint.textContent = chrome.i18n.getMessage('status_logged_out')
        headerLoginHint.style.color = ''
      }
      if (btnShowLogin) btnShowLogin.classList.remove('hidden')
      if (btnLogout) btnLogout.classList.add('hidden')
      if (loginGate) loginGate.classList.remove('hidden')
      if (mainContent) mainContent.classList.add('hidden')
      setStatus('local', chrome.i18n.getMessage('status_logged_out'))
    }
  }

  function updateSyncTime() {
    if (lastSyncTime && lastSyncEl) {
      var ago = Math.round((Date.now() - lastSyncTime) / 1000)
      var text = ''
      if (ago < 10) text = chrome.i18n.getMessage('sync_just_now')
      else if (ago < 60) text = chrome.i18n.getMessage('sync_seconds_ago', [String(ago)])
      else if (ago < 3600) text = chrome.i18n.getMessage('sync_minutes_ago', [String(Math.round(ago / 60))])
      else text = chrome.i18n.getMessage('sync_hours_ago', [String(Math.round(ago / 3600))])
      lastSyncEl.textContent = text
    }
  }

  // ── 分类支持 ──
  function isReservedCategory(id, name) {
    var rawId = (id || '').trim().toLowerCase()
    var rawName = (name || '').trim().toLowerCase()
    return rawId === 'all' || rawId === 'uncategorized' ||
           rawName === '全部' || rawName === '未分类' ||
           rawName === 'all' || rawName === 'uncategorized'
  }

  function getCategoryName(catId) {
    if (!catId || catId === 'uncategorized') {
      var uncat = allCategories.find(function (c) {
        return c.id === 'uncategorized' || (c.name && (c.name === '未分类' || c.name.toLowerCase() === 'uncategorized'))
      })
      return (uncat && uncat.name) || chrome.i18n.getMessage('uncategorized')
    }
    var found = allCategories.find(function (c) { return c.id === catId })
    return found ? found.name : catId
  }

  function renderCategoryOptions() {
    var uncatObj = allCategories.find(function (c) {
      return c.id === 'uncategorized' || (c.name && (c.name === '未分类' || c.name.toLowerCase() === 'uncategorized'))
    })
    var uncatName = (uncatObj && uncatObj.name) || chrome.i18n.getMessage('uncategorized')
    var optsHtml = '<option value="uncategorized">' + esc(uncatName) + '</option>'

    var seenIds = { all: true, uncategorized: true }
    for (var i = 0; i < allCategories.length; i++) {
      var c = allCategories[i]
      if (isReservedCategory(c.id, c.name)) continue
      if (seenIds[c.id]) continue
      seenIds[c.id] = true
      optsHtml += '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'
    }
    if (saveCategorySelect) saveCategorySelect.innerHTML = optsHtml
    if (bdCategorySelect) bdCategorySelect.innerHTML = optsHtml
  }

  function renderCategoryChips() {
    if (!categoryBar) return
    var folderSvg = Icons.folder || ''
    var uncatObj = allCategories.find(function (c) {
      return c.id === 'uncategorized' || (c.name && (c.name === '未分类' || c.name.toLowerCase() === 'uncategorized'))
    })
    var uncatIcon = (uncatObj && uncatObj.icon && Icons.getCategoryIcon ? Icons.getCategoryIcon(uncatObj.icon) : folderSvg) || folderSvg
    var uncatName = (uncatObj && uncatObj.name) || chrome.i18n.getMessage('uncategorized')

    // 1. 全部
    var html = '<button class="cat-chip ' + (selectedCategory === 'all' ? 'active' : '') + '" data-id="all">' + esc(chrome.i18n.getMessage('category_all')) + '</button>'
    // 2. 未分类
    html += '<button class="cat-chip ' + (selectedCategory === 'uncategorized' ? 'active' : '') + '" data-id="uncategorized">' + uncatIcon + ' ' + esc(uncatName) + '</button>'

    // 3. 用户真实分类（去重且排除保留分类）
    var seenIds = { all: true, uncategorized: true }
    for (var i = 0; i < allCategories.length; i++) {
      var c = allCategories[i]
      if (isReservedCategory(c.id, c.name)) continue
      if (seenIds[c.id]) continue
      seenIds[c.id] = true
      var isActive = selectedCategory === c.id
      var catIcon = (Icons.getCategoryIcon ? Icons.getCategoryIcon(c.icon) : folderSvg) || folderSvg
      html += '<button class="cat-chip ' + (isActive ? 'active' : '') + '" data-id="' + esc(c.id) + '">' + catIcon + ' ' + esc(c.name) + '</button>'
    }
    categoryBar.innerHTML = html
  }

  if (categoryBar) {
    categoryBar.addEventListener('click', function (e) {
      var btn = e.target.closest('.cat-chip')
      if (!btn) return
      selectedCategory = btn.dataset.id || 'all'
      var chips = categoryBar.querySelectorAll('.cat-chip')
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.toggle('active', chips[i].dataset.id === selectedCategory)
      }
      applyFilterAndRender()
    })
  }

  // ── 云端加载 ──
  function loadBookmarks() {
    if (!loggedIn || !userId) return
    loadFromCloud()
  }

  async function loadFromCloud() {
    setStatus('sync', chrome.i18n.getMessage('loading'))
    bookmarkList.classList.add('loading')
    try {
      var [bmRes, catRes] = await Promise.race([
        Promise.all([
          sb.from('bookmarks')
            .select('id,title,url,icon,category_id,notes,use_count,created_at_num,order')
            .eq('user_id', userId).is('deleted_at', null)
            .order('created_at_num', { ascending: false }).limit(500),
          sb.from('categories')
            .select('id,name,icon,color,order')
            .eq('user_id', userId).is('deleted_at', null)
            .order('order', { ascending: true }),
        ]),
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('TIMEOUT')) }, 10000)
        })
      ])

      if (bmRes.error) {
        setStatus('err', chrome.i18n.getMessage('load_failed') + (bmRes.error.message || chrome.i18n.getMessage('unknown_error')))
        applyFilterAndRender()
        return
      }
      allBookmarks = bmRes.data || []
      allCategories = (catRes && catRes.data) || []
      renderCategoryOptions()
      renderCategoryChips()
      lastSyncTime = Date.now()
      updateSyncTime()
      setStatus('ok', chrome.i18n.getMessage('status_connected'))
      applyFilterAndRender()
      checkCurrentPageMatch(currentTab && currentTab.url)
      clearInterval(window._syncTimer)
      window._syncTimer = setInterval(updateSyncTime, 30000)
    } catch (err) {
      console.error('[sidepanel] loadFromCloud error:', err)
      setStatus('err', chrome.i18n.getMessage('load_failed') + (err.message === 'TIMEOUT' ? '超时' : err.message || ''))
      applyFilterAndRender()
    } finally {
      bookmarkList.classList.remove('loading')
    }
  }

  // ── 过滤与渲染 ──
  function getFilteredBookmarks() {
    var list = allBookmarks
    if (selectedCategory && selectedCategory !== 'all') {
      list = list.filter(function (b) {
        var c = b.category_id || 'uncategorized'
        return c === selectedCategory
      })
    }
    if (searchQuery) {
      var q = searchQuery.toLowerCase()
      list = list.filter(function (b) {
        return (b.title && b.title.toLowerCase().indexOf(q) !== -1)
          || (b.url && b.url.toLowerCase().indexOf(q) !== -1)
          || (domain(b.url) && domain(b.url).toLowerCase().indexOf(q) !== -1)
          || (b.notes && b.notes.toLowerCase().indexOf(q) !== -1)
      })
    }
    return list
  }

  function applyFilterAndRender() {
    var filtered = getFilteredBookmarks()
    if (searchQuery) {
      recentTitle.textContent = chrome.i18n.getMessage('search_results')
      bookmarkCount.textContent = chrome.i18n.getMessage('found_count', [String(filtered.length)])
    } else if (selectedCategory !== 'all') {
      recentTitle.textContent = getCategoryName(selectedCategory)
      bookmarkCount.textContent = chrome.i18n.getMessage('count_bookmarks', [String(filtered.length)])
    } else {
      recentTitle.textContent = chrome.i18n.getMessage('recent_saved')
      bookmarkCount.textContent = chrome.i18n.getMessage('count_bookmarks', [String(allBookmarks.length)])
    }
    renderBookmarks(filtered)
  }

  function renderBookmarks(list) {
    var displayList = list || allBookmarks
    var isSearching = searchQuery.trim().length > 0

    if (!displayList.length) {
      if (isSearching) {
        bookmarkList.innerHTML = '<div class="search-empty">'
          + '<div style="margin-bottom:8px;opacity:0.35">' + (Icons.search || '') + '</div>'
          + '<div>' + chrome.i18n.getMessage('search_no_results') + '</div>'
          + '</div>'
      } else {
        bookmarkList.innerHTML = '<div class="empty">'
          + '<div style="margin-bottom:8px">' + (Icons.emptyBookmark || Icons.bookmark || '') + '</div>'
          + '<div style="font-weight:600;margin-bottom:4px">' + chrome.i18n.getMessage('no_bookmarks') + '</div>'
          + '<div style="font-size:12px;color:var(--text-muted);line-height:1.6">'
          + chrome.i18n.getMessage('empty_hint')
          + '</div></div>'
      }
      return
    }

    var query = isSearching ? searchQuery.toLowerCase() : ''
    var closeSvg = Icons.close || '&times;'
    bookmarkList.innerHTML = displayList.slice(0, 50).map(function (b) {
      const host = domain(b.url)
      const icon = b.icon || (host ? 'https://www.google.com/s2/favicons?domain=' + host + '&sz=32' : '')
      var titleHtml = esc(b.title || host)
      var urlHtml = esc(host)
      if (isSearching) {
        titleHtml = highlightMatch(titleHtml, query)
        urlHtml = highlightMatch(urlHtml, query)
      }
      var catBadge = ''
      if (b.category_id && b.category_id !== 'uncategorized') {
        catBadge = '<span class="bookmark-item-cat">' + esc(getCategoryName(b.category_id)) + '</span>'
      }
      return '<div class="bookmark-item" data-id="' + esc(b.id) + '" data-url="' + esc(b.url) + '">'
        + (icon ? '<img src="' + esc(icon) + '" alt="">' : '')
        + '<div class="bookmark-item-info">'
        + '<div class="bookmark-item-title">' + titleHtml + '</div>'
        + '<div class="bookmark-item-sub">'
        + '<span class="bookmark-item-url">' + urlHtml + '</span>'
        + catBadge
        + '</div>'
        + '</div>'
        + '<span class="bookmark-item-del" data-action="delete" data-id="' + esc(b.id) + '" data-title="' + esc(b.title) + '" title="' + esc(chrome.i18n.getMessage('delete')) + '">' + closeSvg + '</span>'
        + '</div>'
    }).join('')

    if (isSearching && displayList.length > 0) {
      var cf = document.createElement('div')
      cf.className = 'list-footer'
      cf.textContent = chrome.i18n.getMessage('found_count', [String(displayList.length)])
      bookmarkList.appendChild(cf)
    } else if (!isSearching && displayList.length > 50) {
      var f2 = document.createElement('div')
      f2.className = 'list-footer'
      f2.textContent = chrome.i18n.getMessage('show_limited_count', [String(displayList.length)])
      bookmarkList.appendChild(f2)
    }
  }

  // ── 搜索 ──
  function doSearch(query) {
    searchQuery = (query || '').trim()
    if (!searchQuery) {
      searchWrap.classList.remove('active')
    } else {
      searchWrap.classList.add('active')
    }
    applyFilterAndRender()
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
    if (window.LinkVaultKeyHijack && window.LinkVaultKeyHijack.shouldHijackSearchKey(e)) {
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

  // ── 模态框：删除确认 ──
  function confirmDeleteDialog(title) {
    return new Promise(function (resolve) {
      _deleteResolver = resolve
      var label = (title && String(title).trim()) || chrome.i18n.getMessage('this_bookmark')
      deleteConfirmText.textContent = chrome.i18n.getMessage('confirm_delete', [label])
      deleteConfirmModal.classList.remove('hidden')
    })
  }

  function closeDeleteModal(ok) {
    deleteConfirmModal.classList.add('hidden')
    if (_deleteResolver) {
      var r = _deleteResolver
      _deleteResolver = null
      r(ok)
    }
  }

  btnConfirmDelete.addEventListener('click', function () { closeDeleteModal(true) })
  btnCancelDelete.addEventListener('click', function () { closeDeleteModal(false) })

  // ── 删除 ──
  async function deleteBookmark(id, title) {
    var ok = await confirmDeleteDialog(title)
    if (!ok) return
    const result = await sb.from('bookmarks').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
    if (result.error) { toast(chrome.i18n.getMessage('delete_failed') + result.error.message); return }
    toast(chrome.i18n.getMessage('deleted'), 2500)
    allBookmarks = allBookmarks.filter(function (b) { return b.id !== id })
    if (currentMatchedBookmark && currentMatchedBookmark.id === id) {
      currentMatchedBookmark = null
      hideBookmarkDetail()
    }
    applyFilterAndRender()
  }

  // ── 当前标签页 ──
  function setTabUrlHint(show) {
    if (!tabUrlHint) return
    if (show) tabUrlHint.classList.remove('hidden')
    else tabUrlHint.classList.add('hidden')
  }

  function loadCurrentTab() {
    function handleTab(tab) {
      if (!tab) {
        currentTab = null
        pageTitle.textContent = chrome.i18n.getMessage('no_active_tab')
        pageUrl.textContent = ''
        setTabUrlHint(true)
        hideBookmarkDetail()
        return
      }
      currentTab = tab
      const hasUrl = !!(tab.url && String(tab.url).trim())
      pageTitle.textContent = tab.title || (hasUrl ? chrome.i18n.getMessage('untitled') : chrome.i18n.getMessage('url_unavailable'))
      pageUrl.textContent = hasUrl ? domain(tab.url) : chrome.i18n.getMessage('click_to_refresh_and_save')
      if (tab.favIconUrl) {
        pageIcon.style.display = ''
        pageIcon.src = tab.favIconUrl
        pageIcon.onerror = function () { pageIcon.style.display = 'none' }
      } else {
        pageIcon.style.display = 'none'
      }
      setTabUrlHint(!hasUrl)
      if (hasUrl) checkCurrentPageMatch(tab.url)
      else hideBookmarkDetail()
    }

    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
        if (!chrome.runtime.lastError && tabs && tabs[0] && tabs[0].url) {
          handleTab(tabs[0])
          return
        }
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs2) {
          if (!chrome.runtime.lastError && tabs2 && tabs2[0] && tabs2[0].url) {
            handleTab(tabs2[0])
            return
          }
          chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, function (tab) {
            handleTab(tab)
          })
        })
      })
    } else {
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, function (tab) {
        handleTab(tab)
      })
    }
  }

  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(function () {
      loadCurrentTab()
    })
  }
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        loadCurrentTab()
      }
    })
  }

  if (currentPageEl) {
    currentPageEl.addEventListener('click', function () {
      loadCurrentTab()
    })
  }

  function checkCurrentPageMatch(url) {
    if (!url || !allBookmarks.length) { hideBookmarkDetail(); return }
    var normUrl = window.LinkVaultSavePayload ? window.LinkVaultSavePayload.normalizeUrlForMatch(url) : url.replace(/\/+$/, '')
    var matched = allBookmarks.find(function (b) {
      var bNorm = window.LinkVaultSavePayload ? window.LinkVaultSavePayload.normalizeUrlForMatch(b.url) : (b.url || '').replace(/\/+$/, '')
      return bNorm === normUrl
    })
    if (matched) showBookmarkDetail(matched)
    else hideBookmarkDetail()
  }

  // ── 详情面板 ──
  var _detailGen = 0
  async function showBookmarkDetail(bm) {
    var localGen = ++_detailGen
    currentMatchedBookmark = bm
    if (saveOptionsWrap) saveOptionsWrap.classList.add('hidden')
    bookmarkDetail.classList.remove('hidden')
    passwordRevealed = false

    if (bdCategorySelect) {
      bdCategorySelect.value = bm.category_id || 'uncategorized'
    }

    if (bdNotesEditWrap) bdNotesEditWrap.classList.add('hidden')
    if (bm.notes && bm.notes.trim()) {
      bdNotesWrap.classList.remove('hidden')
      bdNotes.textContent = bm.notes
    } else {
      bdNotesWrap.classList.add('hidden')
    }

    currentDetailPassword = null
    var hasPw = false
    if (loggedIn && userId && bm.id) {
      try {
        var pwRes = await sb.from('bookmarks').select('password').eq('id', bm.id).eq('user_id', userId).is('deleted_at', null).single()
        if (localGen !== _detailGen) return
        if (!pwRes.error && pwRes.data) {
          var pw = pwRes.data.password
          currentDetailPassword = pw || null
          hasPw = pw && pw !== '' && pw !== '""' && JSON.stringify(pw) !== '""'
        }
      } catch (e) { }
    }
    if (localGen !== _detailGen) return
    if (hasPw) {
      bdPasswordWrap.classList.remove('hidden')
      bdPasswordText.textContent = '••••••••'
      bdPasswordText.className = 'bd-pw-text'
      bdPwShow.innerHTML = (Icons.eye || '') + ' <span>' + esc(chrome.i18n.getMessage('show')) + '</span>'
      bdPwCopy.innerHTML = (Icons.copy || '') + ' <span>' + esc(chrome.i18n.getMessage('copy')) + '</span>'
    } else { bdPasswordWrap.classList.add('hidden') }

    if (bm.created_at_num) {
      var d = new Date(bm.created_at_num)
      var dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
      bdCreatedAt.innerHTML = (Icons.history || '') + ' <span>' + esc(dateStr) + '</span>'
    } else { bdCreatedAt.innerHTML = '' }
    bdUseCount.innerHTML = (Icons.eye || '') + ' <span>' + esc(chrome.i18n.getMessage('use_count', [String(bm.use_count || 0)])) + '</span>'
  }

  function hideBookmarkDetail() {
    _detailGen++
    currentMatchedBookmark = null
    currentDetailPassword = null
    bookmarkDetail.classList.add('hidden')
    if (bdNotesEditWrap) bdNotesEditWrap.classList.add('hidden')
    if (saveOptionsWrap) saveOptionsWrap.classList.remove('hidden')
    btnSave.classList.remove('hidden')
  }

  // ── 模态框：主密码解锁 ──
  function requestMasterPassword() {
    return new Promise(function (resolve) {
      _masterPwResolver = resolve
      modalMasterPwInput.value = ''
      masterPwModal.classList.remove('hidden')
      setTimeout(function () { modalMasterPwInput.focus() }, 50)
    })
  }

  function closeMasterPwModal(val) {
    masterPwModal.classList.add('hidden')
    if (_masterPwResolver) {
      var r = _masterPwResolver
      _masterPwResolver = null
      r(val)
    }
  }

  modalMasterPwSubmit.addEventListener('click', function () {
    closeMasterPwModal(modalMasterPwInput.value)
  })

  modalMasterPwCancel.addEventListener('click', function () {
    closeMasterPwModal(null)
  })

  modalMasterPwInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      closeMasterPwModal(modalMasterPwInput.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMasterPwModal(null)
    }
  })

  // ── 密码解密 ──
  bdPwShow.addEventListener('click', async function () {
    if (!currentMatchedBookmark || !currentDetailPassword) return
    var localGen = _detailGen
    if (passwordRevealed) {
      bdPasswordText.textContent = '••••••••'; bdPasswordText.className = 'bd-pw-text'
      bdPwShow.innerHTML = (Icons.eye || '') + ' <span>' + esc(chrome.i18n.getMessage('show')) + '</span>'; passwordRevealed = false
      return
    }
    try {
      var stored = currentDetailPassword
      if (typeof stored === 'string' && stored.charAt(0) === '{' && stored.charAt(stored.length - 1) === '}') {
        try { stored = JSON.parse(stored) } catch (e) {}
      }
      var plaintext = ''
      var isObjE2E = typeof stored === 'object' && stored && stored.encrypted === true && stored.iv && stored.data
      var isStrE2E = typeof stored === 'string' && stored.split('.').length === 3 && stored.split('.').every(function (p) { return !!p })
      if (isObjE2E || isStrE2E) {
        if (!window.LinkVaultCrypto || !window.LinkVaultCrypto.decryptWithGlobalKey) { toast(chrome.i18n.getMessage('crypto_lib_not_loaded')); return }
        if (!sessionMasterPassword) {
          sessionMasterPassword = await requestMasterPassword()
          if (!sessionMasterPassword) return
        }
        var canaryData = await ensureCanaryData()
        if (localGen !== _detailGen) return
        if (!canaryData) {
          toast(chrome.i18n.getMessage('unlock_data_unavailable'))
          clearMasterPasswordNow()
          return
        }
        plaintext = await window.LinkVaultCrypto.decryptWithGlobalKey(stored, sessionMasterPassword, canaryData)
        if (localGen !== _detailGen) return
        if (!plaintext) {
          toast(chrome.i18n.getMessage('decrypt_failed_check_password'))
          clearMasterPasswordNow()
          return
        }
      } else {
        if (window.LinkVaultCrypto) plaintext = await window.LinkVaultCrypto.autoDecryptPassword(stored, '')
        else plaintext = typeof stored === 'string' ? stored : ''
        if (localGen !== _detailGen) return
      }
      if (localGen !== _detailGen) return
      bdPasswordText.textContent = plaintext; bdPasswordText.className = 'bd-pw-text revealed'
      bdPwShow.innerHTML = (Icons.eye || '') + ' <span>' + esc(chrome.i18n.getMessage('hide')) + '</span>'; passwordRevealed = true
      scheduleClearMasterPassword()
    } catch (e) {
      toast(chrome.i18n.getMessage('decrypt_failed') + (e && e.message ? e.message : chrome.i18n.getMessage('unknown_error')))
      clearMasterPasswordNow()
    }
  })

  bdPwCopy.addEventListener('click', async function () {
    if (!currentMatchedBookmark || !currentDetailPassword) return
    var copyGen = _detailGen
    if (!passwordRevealed) {
      bdPwShow.click()
      var waited = 0
      while (!passwordRevealed && waited < 15000) {
        await new Promise(function (r) { setTimeout(r, 100) })
        waited += 100
        if (copyGen !== _detailGen) return
      }
      if (!passwordRevealed) return
    }
    if (copyGen !== _detailGen) return
    var text = bdPasswordText.textContent
    if (text === '••••••••') return
    navigator.clipboard.writeText(text).then(function () { toast(chrome.i18n.getMessage('password_copied'), 1500) }).catch(function () { toast(chrome.i18n.getMessage('copy_failed'), 1500) })
  })

  // ── 行内编辑备注 ──
  bdEditNotes.addEventListener('click', function () {
    if (!currentMatchedBookmark) return
    bdNotesWrap.classList.add('hidden')
    bdNotesEditWrap.classList.remove('hidden')
    bdNotesInput.value = currentMatchedBookmark.notes || ''
    bdNotesInput.focus()
  })

  bdNotesCancel.addEventListener('click', function () {
    bdNotesEditWrap.classList.add('hidden')
    if (currentMatchedBookmark && currentMatchedBookmark.notes) {
      bdNotesWrap.classList.remove('hidden')
    }
  })

  async function saveInlineNotes() {
    if (!currentMatchedBookmark) return
    var newNotes = bdNotesInput.value.trim()
    var r = await sb.from('bookmarks').update({ notes: newNotes, updated_at_num: Date.now() }).eq('id', currentMatchedBookmark.id).eq('user_id', userId)
    var outcome = window.LinkVaultNotesUpdate ? window.LinkVaultNotesUpdate.notesUpdateOutcome(newNotes, r) : { writeLocal: true, toast: chrome.i18n.getMessage('refreshed') }
    if (outcome.writeLocal) {
      currentMatchedBookmark.notes = newNotes
      var found = allBookmarks.find(function (b) { return b.id === currentMatchedBookmark.id })
      if (found) found.notes = newNotes
      bdNotes.textContent = newNotes
    }
    toast(outcome.toast, 1500)
    bdNotesEditWrap.classList.add('hidden')
    if (newNotes) bdNotesWrap.classList.remove('hidden')
    else bdNotesWrap.classList.add('hidden')
  }

  bdNotesSave.addEventListener('click', saveInlineNotes)
  bdNotesInput.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      saveInlineNotes()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      bdNotesCancel.click()
    }
  })

  // ── 切换已保存书签分类 ──
  bdCategorySelect.addEventListener('change', async function () {
    if (!currentMatchedBookmark) return
    var newCat = bdCategorySelect.value
    var res = await sb.from('bookmarks').update({ category_id: newCat, updated_at_num: Date.now() }).eq('id', currentMatchedBookmark.id).eq('user_id', userId)
    if (res.error) {
      toast(chrome.i18n.getMessage('save_failed') + res.error.message)
      return
    }
    currentMatchedBookmark.category_id = newCat
    var found = allBookmarks.find(function (b) { return b.id === currentMatchedBookmark.id })
    if (found) found.category_id = newCat
    applyFilterAndRender()
    toast(chrome.i18n.getMessage('refreshed'), 1500)
  })

  bdCopyUrl.addEventListener('click', function () {
    if (!currentMatchedBookmark || !currentMatchedBookmark.url) return
    navigator.clipboard.writeText(currentMatchedBookmark.url).then(function () { toast(chrome.i18n.getMessage('url_copied'), 1500) }).catch(function () { toast(chrome.i18n.getMessage('copy_failed'), 1500) })
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

  // ── 保存按钮（就地直接写 Supabase，绝不跳标签页）──
  if (btnToggleNotes) {
    btnToggleNotes.addEventListener('click', function () {
      if (!quickNotesWrap) return
      quickNotesWrap.classList.toggle('hidden')
      if (!quickNotesWrap.classList.contains('hidden') && quickNotesInput) {
        quickNotesInput.focus()
      }
    })
  }

  async function saveCurrentPageDirectly() {
    if (!loggedIn || !userId) {
      toast(chrome.i18n.getMessage('status_logged_out'))
      return
    }
    if (_isSaving) return
    if (!currentTab || !currentTab.url) {
      toast(chrome.i18n.getMessage('cannot_get_page'))
      return
    }

    var savePayloadApi = window.LinkVaultSavePayload
    if (!savePayloadApi || !savePayloadApi.isSafeHttpUrl(currentTab.url)) {
      toast(chrome.i18n.getMessage('cannot_save_internal_page'))
      return
    }

    var normUrl = savePayloadApi.normalizeUrlForMatch(currentTab.url)
    var existing = allBookmarks.find(function (b) {
      return savePayloadApi.normalizeUrlForMatch(b.url) === normUrl
    })
    if (existing) {
      showBookmarkDetail(existing)
      toast(chrome.i18n.getMessage('already_saved'))
      return
    }

    var selectedCat = (saveCategorySelect && saveCategorySelect.value) || 'uncategorized'
    var notesVal = (quickNotesInput && quickNotesInput.value.trim()) || ''

    var payload
    try {
      payload = savePayloadApi.buildBookmarkPayload({
        url: currentTab.url,
        title: currentTab.title,
        categoryId: selectedCat,
        notes: notesVal,
        favIconUrl: currentTab.favIconUrl,
        userId: userId,
        existingBookmarks: allBookmarks,
      })
    } catch (err) {
      toast(chrome.i18n.getMessage('save_failed') + err.message)
      return
    }

    _isSaving = true
    btnSave.disabled = true
    var spinSync = (Icons.sync || '').replace('class="svg-icon"', 'class="svg-icon svg-spin"')
    btnSave.innerHTML = spinSync + ' <span>' + esc(chrome.i18n.getMessage('sending') || '...') + '</span>'

    var res = await sb.from('bookmarks').insert(payload).select().single()
    _isSaving = false
    btnSave.disabled = false
    btnSave.innerHTML = (Icons.zap || '') + ' <span>' + esc(chrome.i18n.getMessage('save_current_page')) + '</span>'

    if (res.error) {
      toast(chrome.i18n.getMessage('save_failed') + (res.error.message || ''))
      return
    }

    var savedBm = res.data || payload
    allBookmarks.unshift(savedBm)
    if (quickNotesInput) quickNotesInput.value = ''
    if (quickNotesWrap) quickNotesWrap.classList.add('hidden')

    applyFilterAndRender()
    showBookmarkDetail(savedBm)

    toast(chrome.i18n.getMessage('saved_with_undo'), 5000, {
      label: chrome.i18n.getMessage('undo'),
      onClick: function () {
        undoSave(savedBm.id)
      },
    })
  }

  async function undoSave(id) {
    var res = await sb.from('bookmarks').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
    if (res.error) {
      toast(chrome.i18n.getMessage('unknown_error'))
      return
    }
    allBookmarks = allBookmarks.filter(function (b) { return b.id !== id })
    if (currentMatchedBookmark && currentMatchedBookmark.id === id) {
      hideBookmarkDetail()
    }
    applyFilterAndRender()
    toast(chrome.i18n.getMessage('undone'), 2000)
  }

  btnSave.addEventListener('click', function () {
    saveCurrentPageDirectly()
  })

  $('#btnRefresh').addEventListener('click', function () {
    loadCurrentTab()
    loadBookmarks()
    toast(chrome.i18n.getMessage('refreshed'))
  })

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
    if (!email) return toast(chrome.i18n.getMessage('enter_email'))
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast(chrome.i18n.getMessage('invalid_email'))
    setStatus('sync', chrome.i18n.getMessage('sending'))
    const result = await sb.auth.signInWithOtp({ email: email })
    if (result.error) { setStatus('local', chrome.i18n.getMessage('status_logged_out')); toast(result.error.message); return }
    otpSection.classList.remove('hidden')
    setStatus('ok', chrome.i18n.getMessage('code_sent'))
    otpInput.focus()
  })
  $('#btnVerify').addEventListener('click', async function () {
    const email = emailInput.value.trim()
    const token = otpInput.value.trim()
    if (!token) return toast(chrome.i18n.getMessage('enter_code'))
    setStatus('sync', chrome.i18n.getMessage('verifying'))
    const result = await sb.auth.verifyOtp({ email: email, token: token, type: 'email' })
    if (result.error) { setStatus('local', chrome.i18n.getMessage('status_logged_out')); toast(result.error.message); return }
    toast(chrome.i18n.getMessage('login_success'))
    loginBanner.classList.add('hidden'); otpSection.classList.add('hidden')
    emailInput.value = ''; otpInput.value = ''
  })

  $('#btnLogout').addEventListener('click', async function () {
    clearMasterPasswordNow()
    passwordRevealed = false
    allBookmarks = []
    allCategories = []
    currentMatchedBookmark = null
    if (bookmarkList) bookmarkList.innerHTML = ''
    hideBookmarkDetail()
    await sb.auth.signOut()
  })

  $('#btnLoginGate').addEventListener('click', function () {
    loginBanner.classList.remove('hidden')
    emailInput.focus()
  })

  // ── 一键同步已打开网页端的登录状态 ──
  async function trySyncSessionFromWeb(showToast) {
    return new Promise(function (resolve) {
      if (!chrome.tabs || !chrome.scripting) {
        if (showToast) toast(chrome.i18n.getMessage('sync_login_no_tab'), 2500)
        resolve(false)
        return
      }
      chrome.tabs.query({ url: ['https://ulink.ren/*', 'http://localhost:5173/*', 'https://localhost:5173/*'] }, function (tabs) {
        if (chrome.runtime.lastError || !tabs || !tabs.length) {
          if (showToast) toast(chrome.i18n.getMessage('sync_login_no_tab'), 2500)
          resolve(false)
          return
        }
        var targetTab = tabs[0]
        chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: function () {
            try {
              return {
                auth: localStorage.getItem('linkvault_auth'),
                theme: localStorage.getItem('lv_theme'),
              }
            } catch (e) {
              return null
            }
          }
        }, async function (results) {
          if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
            if (showToast) toast(chrome.i18n.getMessage('sync_login_no_tab'), 2500)
            resolve(false)
            return
          }
          try {
            var raw = results[0].result
            if (raw && raw.theme && (raw.theme === 'light' || raw.theme === 'dark')) {
              applyTheme(raw.theme)
            }
            var authRaw = raw && raw.auth
            var sessionData = typeof authRaw === 'string' ? JSON.parse(authRaw) : authRaw
            if (sessionData && sessionData.access_token && sessionData.refresh_token) {
              var res = await sb.auth.setSession({
                access_token: sessionData.access_token,
                refresh_token: sessionData.refresh_token,
              })
              if (res.data && res.data.session && res.data.session.user) {
                userId = res.data.session.user.id
                loggedIn = true
                updateLoginUI()
                await loadFromCloud()
                toast(chrome.i18n.getMessage('login_success'), 1500)
                resolve(true)
                return
              }
            }
          } catch (e) { }
          if (showToast) toast(chrome.i18n.getMessage('sync_login_no_tab'), 2500)
          resolve(false)
        })
      })
    })
  }

  if (btnSyncWebLogin) {
    btnSyncWebLogin.addEventListener('click', function () {
      trySyncSessionFromWeb(true)
    })
  }

  // ── 认证检查 ──
  async function checkAuth() {
    const result = await sb.auth.getSession()
    if (result.data && result.data.session && result.data.session.user) {
      userId = result.data.session.user.id
      loggedIn = true
      updateLoginUI()
      await loadFromCloud()
    } else {
      var synced = await trySyncSessionFromWeb(false)
      if (!synced) {
        userId = null
        loggedIn = false
        updateLoginUI()
      }
    }
    loadCurrentTab()
  }

  // ── Auth 状态变化 ──
  sb.auth.onAuthStateChange(async function (event, session) {
    var decision = window.LinkVaultAuthFlow.handleAuthStateChange(event, session)
    if (decision.action === 'skip') return
    if (decision.action === 'authed') {
      userId = decision.user.id; loggedIn = true
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
