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
  const saveParentRow = $('#saveParentRow')
  const saveParentSelect = $('#saveParentSelect')
  const bdParentWrap = $('#bdParentWrap')
  const bdParentLink = $('#bdParentLink')
  const bdParentTitle = $('#bdParentTitle')
  const bdSubsWrap = $('#bdSubsWrap')
  const bdSubsCount = $('#bdSubsCount')
  const bdSubsList = $('#bdSubsList')
  const bdParentNotesWrap = $('#bdParentNotesWrap')
  const bdParentNotes = $('#bdParentNotes')
  const bdParentNotesSource = $('#bdParentNotesSource')
  const bdEditParentNotes = $('#bdEditParentNotes')
  const domainParentNotice = $('#domainParentNotice')
  const dpNoticeName = $('#dpNoticeName')
  const dpNotesPreview = $('#dpNotesPreview')
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
  const tabBtnCurrent = $('#tabBtnCurrent')
  const tabBtnLibrary = $('#tabBtnLibrary')
  const paneCurrent = $('#paneCurrent')
  const paneLibrary = $('#paneLibrary')
  const tabBadgeCount = $('#tabBadgeCount')
  const tabIconCurrent = $('#tabIconCurrent')
  const tabIconLibrary = $('#tabIconLibrary')

  let activeTabName = 'current'
  function switchTab(tabName) {
    activeTabName = tabName
    if (tabName === 'current') {
      if (tabBtnCurrent) {
        tabBtnCurrent.classList.add('active')
        tabBtnCurrent.setAttribute('aria-selected', 'true')
      }
      if (tabBtnLibrary) {
        tabBtnLibrary.classList.remove('active')
        tabBtnLibrary.setAttribute('aria-selected', 'false')
      }
      if (paneCurrent) paneCurrent.classList.remove('hidden')
      if (paneLibrary) paneLibrary.classList.add('hidden')
    } else {
      if (tabBtnLibrary) {
        tabBtnLibrary.classList.add('active')
        tabBtnLibrary.setAttribute('aria-selected', 'true')
      }
      if (tabBtnCurrent) {
        tabBtnCurrent.classList.remove('active')
        tabBtnCurrent.setAttribute('aria-selected', 'false')
      }
      if (paneLibrary) paneLibrary.classList.remove('hidden')
      if (paneCurrent) paneCurrent.classList.add('hidden')
      if (searchInput) searchInput.focus()
    }
  }

  if (tabBtnCurrent) tabBtnCurrent.addEventListener('click', function () { switchTab('current') })
  if (tabBtnLibrary) tabBtnLibrary.addEventListener('click', function () { switchTab('library') })

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
    if (tabIconCurrent) tabIconCurrent.innerHTML = Icons.bookmark || ''
    if (tabIconLibrary) tabIconLibrary.innerHTML = Icons.grid || Icons.folder || ''
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
      if (target.classList && (target.classList.contains('bookmark-sub-card') || target.classList.contains('sub-chip'))) {
        e.stopPropagation()
        var subUrl = target.dataset.url
        if (!isSafeHttpUrl(subUrl)) {
          toast(chrome.i18n.getMessage('err_unsafe_protocol'), 2000)
          return
        }
        chrome.tabs.create({ url: subUrl })
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

  if (bdSubsList) {
    bdSubsList.addEventListener('click', function (e) {
      var item = e.target.closest('.bd-sub-item')
      if (!item) return
      var subUrl = item.dataset.url
      if (!isSafeHttpUrl(subUrl)) {
        toast(chrome.i18n.getMessage('err_unsafe_protocol'), 2000)
        return
      }
      chrome.tabs.create({ url: subUrl })
    })
  }


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

  /** 批量解密内存中所有书签的加密字段（notes/title），在解锁时调用 */
  async function decryptAllNotesIfUnlocked() {
    if (!sessionMasterPassword || !window.LinkVaultCrypto) return
    var canary = await ensureCanaryData()
    if (!canary) return
    var promises = []
    for (var i = 0; i < allBookmarks.length; i++) {
      var b = allBookmarks[i]
      if (b.notes && window.LinkVaultCrypto.isThreePartCipher(b.notes) && !b._decryptedNotes) {
        (function (bm) {
          promises.push(window.LinkVaultCrypto.decryptTextIfCipher(bm.notes, sessionMasterPassword, canary).then(function (dec) {
            if (dec) bm._decryptedNotes = dec
          }))
        })(b)
      }
      if (b.title && window.LinkVaultCrypto.isThreePartCipher(b.title) && !b._decryptedTitle) {
        (function (bm) {
          promises.push(window.LinkVaultCrypto.decryptTextIfCipher(bm.title, sessionMasterPassword, canary).then(function (dec) {
            if (dec) bm._decryptedTitle = dec
          }))
        })(b)
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises)
    }
  }

  function scheduleClearMasterPassword() {
    if (_mpClearTimer) clearTimeout(_mpClearTimer)
    _mpClearTimer = setTimeout(function () {
      clearMasterPasswordNow()
    }, MASTER_PASSWORD_TTL_MS)
  }

  function clearMasterPasswordNow() {
    if (_mpClearTimer) { clearTimeout(_mpClearTimer); _mpClearTimer = null }
    sessionMasterPassword = ''
    if (window.LinkVaultCrypto && window.LinkVaultCrypto.clearKeyCache) {
      window.LinkVaultCrypto.clearKeyCache()
    }
    for (var i = 0; i < allBookmarks.length; i++) {
      delete allBookmarks[i]._decryptedNotes
      delete allBookmarks[i]._decryptedTitle
    }
    maskRevealedPassword()
    if (currentMatchedBookmark) {
      showBookmarkDetail(currentMatchedBookmark)
    }
    applyFilterAndRender()
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

  function renderParentOptions(currentUrl) {
    if (!saveParentSelect) return
    var topLevelBms = allBookmarks.filter(function (b) { return !b.parent_id && !b.deleted_at })
    var optsHtml = '<option value="">' + esc(chrome.i18n.getMessage('top_level_bookmark')) + '</option>'

    var curHost = currentUrl ? domain(currentUrl).toLowerCase() : ''
    var matchedParentId = ''

    for (var i = 0; i < topLevelBms.length; i++) {
      var b = topLevelBms[i]
      var bHost = domain(b.url).toLowerCase()
      var isDomainMatch = curHost && bHost && (curHost === bHost || curHost.endsWith('.' + bHost))
      if (isDomainMatch && !matchedParentId) {
        matchedParentId = b.id
      }
      var bTitle = b.title || bHost || b.id
      optsHtml += '<option value="' + esc(b.id) + '">' + esc(bTitle) + '</option>'
    }

    saveParentSelect.innerHTML = optsHtml

    if (matchedParentId) {
      saveParentSelect.value = matchedParentId
      if (saveParentRow) saveParentRow.classList.remove('hidden')
    } else {
      saveParentSelect.value = ''
      if (saveParentRow) saveParentRow.classList.add('hidden')
    }
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
            .select('id,title,url,icon,category_id,parent_id,notes,use_count,created_at_num,order')
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
      renderParentOptions(currentTab && currentTab.url)
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
    if (window.LinkVaultSidepanelMatch) {
      return window.LinkVaultSidepanelMatch.filterRootBookmarks(allBookmarks, selectedCategory, searchQuery)
    }
    var list = allBookmarks.filter(function (b) { return !b.parent_id && !b.deleted_at })
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
      bookmarkCount.textContent = chrome.i18n.getMessage('count_bookmarks', [String(filtered.length)])
    }
    if (tabBadgeCount) {
      tabBadgeCount.textContent = allBookmarks && allBookmarks.length ? String(allBookmarks.length) : ''
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
    var openTitle = esc(chrome.i18n.getMessage('open_link'))
    var deleteTitle = esc(chrome.i18n.getMessage('delete'))

    bookmarkList.innerHTML = displayList.slice(0, 50).map(function (b) {
      var host = domain(b.url)
      var icon = b.icon || (host ? 'https://www.google.com/s2/favicons?domain=' + host + '&sz=32' : '')
      var isTitleCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(b.title) : false
      var rawTitle = b._decryptedTitle || (isTitleCipher ? (host || chrome.i18n.getMessage('encrypted_bookmark')) : (b.title || host))
      var initial = (rawTitle || '?').charAt(0).toUpperCase()
      var titleHtml = esc(rawTitle)
      var urlHtml = esc(host)
      if (isSearching) {
        titleHtml = highlightMatch(titleHtml, query)
        urlHtml = highlightMatch(urlHtml, query)
      }

      var catBadge = ''
      if (b.category_id && b.category_id !== 'uncategorized') {
        catBadge = '<span class="bookmark-cat-pill">' + esc(getCategoryName(b.category_id)) + '</span>'
      }

      // 单行备注纯文本预览（对齐主站列表模式特征）
      var notesCandidate = b._decryptedNotes !== undefined ? b._decryptedNotes : b.notes
      var previewRaw = window.LinkVaultSidepanelMatch ? window.LinkVaultSidepanelMatch.getNotesPreviewText(notesCandidate, 75) : ''
      var previewHtml = previewRaw ? esc(previewRaw) : ''
      if (isSearching && previewHtml) {
        previewHtml = highlightMatch(previewHtml, query)
      }

      // 关联子书签
      var subsHtml = ''
      var subs = allBookmarks.filter(function (s) { return s.parent_id === b.id && !s.deleted_at })
      if (subs.length > 0) {
        subsHtml = '<div class="bookmark-sub-sites">' + subs.map(function (s) {
          var sHost = domain(s.url)
          var sIcon = s.icon || (sHost ? 'https://www.google.com/s2/favicons?domain=' + sHost + '&sz=16' : '')
          var isSubTitleCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(s.title) : false
          var sRawTitle = s._decryptedTitle || (isSubTitleCipher ? (sHost || chrome.i18n.getMessage('encrypted_bookmark')) : (s.title || sHost))
          var sTitle = esc(sRawTitle)
          if (isSearching) {
            sTitle = highlightMatch(sTitle, query)
          }
          return '<span class="bookmark-sub-card" data-url="' + esc(s.url) + '" title="' + esc(s.title || s.url) + '">'
            + (sIcon ? '<img src="' + esc(sIcon) + '" alt="">' : '')
            + '<span class="sub-title">' + sTitle + '</span>'
            + '<span class="sub-arrow">↗</span>'
            + '</span>'
        }).join('') + '</div>'
      }

      return '<div class="bookmark-item" data-id="' + esc(b.id) + '" data-url="' + esc(b.url) + '">'
        + '<div class="bookmark-topline">'
        + '<div class="bookmark-logo" title="' + openTitle + '">'
        + (icon ? '<img src="' + esc(icon) + '" alt="">' : '')
        + '<span class="bookmark-logo-fallback" style="' + (icon ? 'display:none' : '') + '">' + esc(initial) + '</span>'
        + '</div>'
        + '<div class="bookmark-titlewrap" title="' + openTitle + '">'
        + '<div class="bookmark-title-row">'
        + '<span class="bookmark-name">' + titleHtml + '</span>'
        + '<span class="bookmark-open-hint">↗</span>'
        + '</div>'
        + '<div class="bookmark-meta-row">'
        + '<span class="bookmark-domain">' + urlHtml + '</span>'
        + catBadge
        + '</div>'
        + '</div>'
        + '<span class="bookmark-del-btn" data-action="delete" data-id="' + esc(b.id) + '" data-title="' + esc(b.title) + '" title="' + deleteTitle + '">' + closeSvg + '</span>'
        + '</div>'
        + (previewHtml ? '<div class="bookmark-preview">' + previewHtml + '</div>' : '')
        + subsHtml
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
    if (!url || !allBookmarks.length) {
      hideBookmarkDetail()
      renderParentOptions(url)
      return
    }
    var matchRes = window.LinkVaultSidepanelMatch
      ? window.LinkVaultSidepanelMatch.findBookmarkMatch(allBookmarks, url)
      : { exactMatch: null, domainParent: null }

    if (!matchRes.exactMatch && !window.LinkVaultSidepanelMatch) {
      var normUrl = (url || '').replace(/\/+$/, '')
      matchRes.exactMatch = allBookmarks.find(function (b) {
        return (b.url || '').replace(/\/+$/, '') === normUrl
      }) || null
    }

    if (matchRes.exactMatch) {
      if (domainParentNotice) domainParentNotice.classList.add('hidden')
      showBookmarkDetail(matchRes.exactMatch)
    } else {
      hideBookmarkDetail()
      renderParentOptions(url)
      // 若当前页未被收藏，但属于某个已收藏的主站
      if (matchRes.domainParent && domainParentNotice) {
        var dp = matchRes.domainParent
        var isDpTitleCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(dp.title) : false
        if (dpNoticeName) dpNoticeName.textContent = dp._decryptedTitle || (isDpTitleCipher ? (domain(dp.url) || chrome.i18n.getMessage('encrypted_bookmark')) : (dp.title || domain(dp.url)))
        var isDpNotesCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(dp.notes) : false
        var dpNoteCandidate = dp._decryptedNotes !== undefined ? dp._decryptedNotes : (isDpNotesCipher ? '' : dp.notes)
        var pNotes = dpNoteCandidate ? (window.LinkVaultNotesUpdate ? window.LinkVaultNotesUpdate.formatNotesForDisplay(dpNoteCandidate) : dpNoteCandidate.trim()) : ''
        if (isDpNotesCipher && !dp._decryptedNotes && dpNotesPreview) {
          dpNotesPreview.innerHTML = '<span class="bd-encrypted-lock-hint" data-action="unlock-notes" title="' + esc(chrome.i18n.getMessage('click_to_unlock')) + '">🔒 ' + esc(chrome.i18n.getMessage('encrypted_notes_locked')) + '</span>'
          dpNotesPreview.classList.remove('hidden')
        } else if (pNotes && dpNotesPreview) {
          dpNotesPreview.textContent = pNotes
          dpNotesPreview.classList.remove('hidden')
        } else if (dpNotesPreview) {
          dpNotesPreview.classList.add('hidden')
        }
        domainParentNotice.classList.remove('hidden')
      } else if (domainParentNotice) {
        domainParentNotice.classList.add('hidden')
      }
    }
  }

  // ── 详情面板 ──
  var _detailGen = 0
  async function showBookmarkDetail(bm) {
    var localGen = ++_detailGen
    currentMatchedBookmark = bm
    if (saveOptionsWrap) saveOptionsWrap.classList.add('hidden')
    if (domainParentNotice) domainParentNotice.classList.add('hidden')
    bookmarkDetail.classList.remove('hidden')
    passwordRevealed = false

    if (bdCategorySelect) {
      bdCategorySelect.value = bm.category_id || 'uncategorized'
    }

    var hierarchy = window.LinkVaultSidepanelMatch
      ? window.LinkVaultSidepanelMatch.resolveSiteHierarchy(allBookmarks, bm, currentTab && currentTab.url)
      : { isSub: !!bm.parent_id, parentBm: null, mainSiteTitle: '', mainSiteNotes: bm.notes || '', pageNotes: '', subBookmarks: [], effectivePasswordBm: bm }

    // 徽标状态更新：主书签显示「已收藏」，子书签显示「已收藏 (子书签)」
    if (bdSavedBadge) {
      bdSavedBadge.textContent = hierarchy.isSub ? chrome.i18n.getMessage('already_saved_sub') : chrome.i18n.getMessage('already_saved')
    }

    // ── 父子书签关系展示 ──
    if (hierarchy.isSub && hierarchy.parentBm) {
      var parentBm = hierarchy.parentBm
      var isParentTitleCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(parentBm.title) : false
      var pTitle = parentBm._decryptedTitle || (isParentTitleCipher ? (domain(parentBm.url) || chrome.i18n.getMessage('encrypted_bookmark')) : (parentBm.title || domain(parentBm.url)))
      if (bdParentWrap && bdParentTitle && bdParentLink) {
        bdParentTitle.textContent = pTitle
        bdParentLink.onclick = function (e) {
          e.preventDefault()
          if (parentBm.url && isSafeHttpUrl(parentBm.url)) {
            chrome.tabs.create({ url: parentBm.url })
          }
        }
        bdParentWrap.classList.remove('hidden')
      }
    } else if (bdParentWrap) {
      bdParentWrap.classList.add('hidden')
    }

    // ── 主站备注展示（子书签时重点展示所属主站的备注） ──
    if (hierarchy.isSub && hierarchy.parentBm) {
      var pRawNotes = hierarchy.mainSiteNotes || ''
      var isParentCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(pRawNotes) : false
      var pDecrypted = hierarchy.parentBm._decryptedNotes
      if (isParentCipher && !pDecrypted && sessionMasterPassword) {
        var canary = await ensureCanaryData()
        if (canary && window.LinkVaultCrypto) {
          pDecrypted = await window.LinkVaultCrypto.decryptTextIfCipher(pRawNotes, sessionMasterPassword, canary)
          if (pDecrypted) hierarchy.parentBm._decryptedNotes = pDecrypted
        }
      }
      if (localGen !== _detailGen) return

      var pFinalNotes = pDecrypted !== undefined ? pDecrypted : (isParentCipher ? '' : pRawNotes)
      var pDisplayNotes = window.LinkVaultNotesUpdate ? window.LinkVaultNotesUpdate.formatNotesForDisplay(pFinalNotes) : pFinalNotes.trim()
      if (bdParentNotesWrap && bdParentNotes) {
        if (isParentCipher && !pDecrypted) {
          bdParentNotes.innerHTML = '<span class="bd-encrypted-lock-hint" data-action="unlock-notes" title="' + esc(chrome.i18n.getMessage('click_to_unlock')) + '">🔒 ' + esc(chrome.i18n.getMessage('encrypted_notes_locked')) + '</span>'
        } else {
          bdParentNotes.textContent = pDisplayNotes || chrome.i18n.getMessage('no_parent_notes')
        }
        if (bdParentNotesSource) {
          var pSrcTitle = hierarchy.parentBm._decryptedTitle || (isParentTitleCipher ? domain(hierarchy.parentBm.url) : (hierarchy.mainSiteTitle || ''))
          bdParentNotesSource.textContent = '(' + (pSrcTitle || '') + ')'
        }
        bdParentNotesWrap.classList.remove('hidden')
      }
    } else if (bdParentNotesWrap) {
      bdParentNotesWrap.classList.add('hidden')
    }

    // ── 本页备注查看模式 ──
    if (bdNotesEditWrap) bdNotesEditWrap.classList.add('hidden')
    var rawNotes = hierarchy.isSub ? hierarchy.pageNotes : (bm.notes || '')
    var isNotesCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(rawNotes) : false
    var bmDecrypted = hierarchy.isSub ? bm._decryptedNotes : (bm._decryptedNotes || (hierarchy.matchedBm && hierarchy.matchedBm._decryptedNotes))
    if (isNotesCipher && !bmDecrypted && sessionMasterPassword) {
      var canary2 = await ensureCanaryData()
      if (canary2 && window.LinkVaultCrypto) {
        bmDecrypted = await window.LinkVaultCrypto.decryptTextIfCipher(rawNotes, sessionMasterPassword, canary2)
        if (bmDecrypted) {
          bm._decryptedNotes = bmDecrypted
          if (hierarchy.matchedBm) hierarchy.matchedBm._decryptedNotes = bmDecrypted
        }
      }
    }
    if (localGen !== _detailGen) return

    var finalNotes = bmDecrypted !== undefined ? bmDecrypted : (isNotesCipher ? '' : rawNotes)
    var displayNotes = window.LinkVaultNotesUpdate ? window.LinkVaultNotesUpdate.formatNotesForDisplay(finalNotes) : finalNotes.trim()
    if (bdNotesWrap && bdNotes) {
      if (isNotesCipher && !bmDecrypted) {
        bdNotesWrap.classList.remove('hidden')
        bdNotes.innerHTML = '<span class="bd-encrypted-lock-hint" data-action="unlock-notes" title="' + esc(chrome.i18n.getMessage('click_to_unlock')) + '">🔒 ' + esc(chrome.i18n.getMessage('encrypted_notes_locked')) + '</span>'
        if (bdNotesLabel) bdNotesLabel.textContent = hierarchy.isSub ? chrome.i18n.getMessage('page_notes') : chrome.i18n.getMessage('notes')
      } else if (displayNotes) {
        bdNotesWrap.classList.remove('hidden')
        bdNotes.textContent = displayNotes
        if (bdNotesLabel) bdNotesLabel.textContent = hierarchy.isSub ? chrome.i18n.getMessage('page_notes') : chrome.i18n.getMessage('notes')
      } else if (!hierarchy.isSub) {
        // 主站且暂无备注
        bdNotesWrap.classList.remove('hidden')
        bdNotes.textContent = chrome.i18n.getMessage('no_notes')
        if (bdNotesLabel) bdNotesLabel.textContent = chrome.i18n.getMessage('notes')
      } else {
        // 子书签且暂无专属备注（用户已在上方看到主站备注）
        bdNotesWrap.classList.add('hidden')
      }
    }

    // ── 关联子书签列表展示（主站和子站均展示该站的全部子书签） ──
    var subs = hierarchy.subBookmarks || []
    if (subs.length > 0 && bdSubsWrap && bdSubsList) {
      if (bdSubsCount) bdSubsCount.textContent = '(' + subs.length + ')'
      var curNorm = window.LinkVaultSidepanelMatch ? window.LinkVaultSidepanelMatch.normalizeUrl(bm.url) : (bm.url || '').replace(/\/+$/, '')
      bdSubsList.innerHTML = subs.map(function (s) {
        var sHost = domain(s.url)
        var sIcon = s.icon || (sHost ? 'https://www.google.com/s2/favicons?domain=' + sHost + '&sz=16' : '')
        var sNorm = window.LinkVaultSidepanelMatch ? window.LinkVaultSidepanelMatch.normalizeUrl(s.url) : (s.url || '').replace(/\/+$/, '')
        var isCurrent = sNorm === curNorm
        var isSubTitleCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(s.title) : false
        var sTitleText = s._decryptedTitle || (isSubTitleCipher ? (sHost || chrome.i18n.getMessage('encrypted_bookmark')) : (s.title || sHost))
        return '<div class="bd-sub-item' + (isCurrent ? ' current-sub' : '') + '" data-url="' + esc(s.url) + '" title="' + esc(s.url) + '">'
          + (sIcon ? '<img src="' + esc(sIcon) + '" alt="">' : '')
          + '<div class="bd-sub-title">' + esc(sTitleText) + '</div>'
          + (isCurrent ? '<span class="bd-sub-tag">' + esc(chrome.i18n.getMessage('current_page_tag')) + '</span>' : '<span class="bd-sub-btn">↗</span>')
          + '</div>'
      }).join('')
      bdSubsWrap.classList.remove('hidden')
    } else if (bdSubsWrap) {
      bdSubsWrap.classList.add('hidden')
    }

    // ── 密码展示与主站继承 ──
    currentDetailPassword = null
    var hasPw = false
    var pwTargetId = hierarchy.effectivePasswordBm ? hierarchy.effectivePasswordBm.id : bm.id
    if (loggedIn && userId && pwTargetId) {
      try {
        var pwRes = await sb.from('bookmarks').select('password').eq('id', pwTargetId).eq('user_id', userId).is('deleted_at', null).single()
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
      if (bdPasswordLabel) {
        bdPasswordLabel.textContent = (hierarchy.isSub && hierarchy.effectivePasswordBm && hierarchy.effectivePasswordBm.id !== bm.id)
          ? chrome.i18n.getMessage('parent_password')
          : chrome.i18n.getMessage('password')
      }
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
    if (bdParentWrap) bdParentWrap.classList.add('hidden')
    if (bdParentNotesWrap) bdParentNotesWrap.classList.add('hidden')
    if (bdSubsWrap) bdSubsWrap.classList.add('hidden')
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
        decryptAllNotesIfUnlocked().then(function () {
          if (currentMatchedBookmark) showBookmarkDetail(currentMatchedBookmark)
          applyFilterAndRender()
        })
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

  // ── 点击解锁加密备注事件 ──
  async function handleUnlockEncryptedNotes() {
    if (!sessionMasterPassword) {
      var entered = await requestMasterPassword()
      if (!entered) return
      var canary = await ensureCanaryData()
      if (!canary) {
        toast(chrome.i18n.getMessage('unlock_data_unavailable'))
        return
      }
      if (window.LinkVaultCrypto && window.LinkVaultCrypto.verifyMasterPassword) {
        var ok = await window.LinkVaultCrypto.verifyMasterPassword(entered, canary)
        if (!ok) {
          toast(chrome.i18n.getMessage('decrypt_failed_check_password'))
          return
        }
      }
      sessionMasterPassword = entered
      scheduleClearMasterPassword()
    }
    await decryptAllNotesIfUnlocked()
    if (currentMatchedBookmark) {
      showBookmarkDetail(currentMatchedBookmark)
    } else {
      loadCurrentTab()
    }
    applyFilterAndRender()
    toast(chrome.i18n.getMessage('refreshed'), 1000)
  }

  if (bookmarkDetail) {
    bookmarkDetail.addEventListener('click', async function (e) {
      var unlockBtn = e.target.closest('[data-action="unlock-notes"]')
      if (unlockBtn) {
        e.preventDefault()
        e.stopPropagation()
        await handleUnlockEncryptedNotes()
      }
    })
  }

  if (domainParentNotice) {
    domainParentNotice.addEventListener('click', async function (e) {
      var unlockBtn = e.target.closest('[data-action="unlock-notes"]')
      if (unlockBtn) {
        e.preventDefault()
        e.stopPropagation()
        await handleUnlockEncryptedNotes()
      }
    })
  }

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
  var editingNotesTargetId = null

  if (bdEditParentNotes) {
    bdEditParentNotes.addEventListener('click', async function () {
      if (!currentMatchedBookmark || !currentMatchedBookmark.parent_id) return
      var parentBm = allBookmarks.find(function (p) { return p.id === currentMatchedBookmark.parent_id })
      if (!parentBm) return
      var raw = parentBm.notes || ''
      var isCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(raw) : false
      if (isCipher) {
        if (!sessionMasterPassword) {
          sessionMasterPassword = await requestMasterPassword()
          if (!sessionMasterPassword) return
          var canary = await ensureCanaryData()
          if (!canary) {
            toast(chrome.i18n.getMessage('unlock_data_unavailable'))
            clearMasterPasswordNow()
            return
          }
          if (window.LinkVaultCrypto && window.LinkVaultCrypto.verifyMasterPassword) {
            var ok = await window.LinkVaultCrypto.verifyMasterPassword(sessionMasterPassword, canary)
            if (!ok) {
              toast(chrome.i18n.getMessage('decrypt_failed_check_password'))
              clearMasterPasswordNow()
              return
            }
          }
        }
        var canary2 = await ensureCanaryData()
        var dec = await window.LinkVaultCrypto.decryptTextIfCipher(raw, sessionMasterPassword, canary2)
        if (!dec && raw) {
          toast(chrome.i18n.getMessage('decrypt_failed_check_password'))
          clearMasterPasswordNow()
          return
        }
        parentBm._decryptedNotes = dec
        scheduleClearMasterPassword()
      }
      editingNotesTargetId = parentBm.id
      bdNotesWrap.classList.add('hidden')
      if (bdParentNotesWrap) bdParentNotesWrap.classList.add('hidden')
      bdNotesEditWrap.classList.remove('hidden')
      if (bdNotesEditLabel) bdNotesEditLabel.textContent = chrome.i18n.getMessage('parent_notes')
      var noteToEdit = parentBm._decryptedNotes !== undefined ? parentBm._decryptedNotes : (isCipher ? '' : raw)
      var clean = window.LinkVaultNotesUpdate ? window.LinkVaultNotesUpdate.formatNotesForDisplay(noteToEdit) : noteToEdit.trim()
      bdNotesInput.value = clean
      bdNotesInput.focus()
    })
  }

  bdEditNotes.addEventListener('click', async function () {
    if (!currentMatchedBookmark) return
    var raw = currentMatchedBookmark.notes || ''
    var isCipher = window.LinkVaultCrypto ? window.LinkVaultCrypto.isThreePartCipher(raw) : false
    if (isCipher) {
      if (!sessionMasterPassword) {
        sessionMasterPassword = await requestMasterPassword()
        if (!sessionMasterPassword) return
        var canary = await ensureCanaryData()
        if (!canary) {
          toast(chrome.i18n.getMessage('unlock_data_unavailable'))
          clearMasterPasswordNow()
          return
        }
        if (window.LinkVaultCrypto && window.LinkVaultCrypto.verifyMasterPassword) {
          var ok = await window.LinkVaultCrypto.verifyMasterPassword(sessionMasterPassword, canary)
          if (!ok) {
            toast(chrome.i18n.getMessage('decrypt_failed_check_password'))
            clearMasterPasswordNow()
            return
          }
        }
      }
      var canary2 = await ensureCanaryData()
      var dec = await window.LinkVaultCrypto.decryptTextIfCipher(raw, sessionMasterPassword, canary2)
      if (!dec && raw) {
        toast(chrome.i18n.getMessage('decrypt_failed_check_password'))
        clearMasterPasswordNow()
        return
      }
      currentMatchedBookmark._decryptedNotes = dec
      scheduleClearMasterPassword()
    }
    editingNotesTargetId = currentMatchedBookmark.id
    bdNotesWrap.classList.add('hidden')
    if (bdParentNotesWrap) bdParentNotesWrap.classList.add('hidden')
    bdNotesEditWrap.classList.remove('hidden')
    if (bdNotesEditLabel) {
      bdNotesEditLabel.textContent = currentMatchedBookmark.parent_id ? chrome.i18n.getMessage('page_notes') : chrome.i18n.getMessage('notes')
    }
    var noteToEdit = currentMatchedBookmark._decryptedNotes !== undefined ? currentMatchedBookmark._decryptedNotes : (isCipher ? '' : raw)
    var clean = window.LinkVaultNotesUpdate ? window.LinkVaultNotesUpdate.formatNotesForDisplay(noteToEdit) : noteToEdit.trim()
    bdNotesInput.value = clean
    bdNotesInput.focus()
  })

  bdNotesCancel.addEventListener('click', function () {
    bdNotesEditWrap.classList.add('hidden')
    editingNotesTargetId = null
    if (currentMatchedBookmark) showBookmarkDetail(currentMatchedBookmark)
  })

  async function saveInlineNotes() {
    var targetId = editingNotesTargetId || (currentMatchedBookmark && currentMatchedBookmark.id)
    if (!targetId) return
    var newNotes = bdNotesInput.value.trim()
    var r = await sb.from('bookmarks').update({ notes: newNotes, updated_at_num: Date.now() }).eq('id', targetId).eq('user_id', userId)
    var outcome = window.LinkVaultNotesUpdate ? window.LinkVaultNotesUpdate.notesUpdateOutcome(newNotes, r) : { writeLocal: true, toast: chrome.i18n.getMessage('refreshed') }
    if (outcome.writeLocal) {
      var found = allBookmarks.find(function (b) { return b.id === targetId })
      if (found) {
        found.notes = newNotes
        delete found._decryptedNotes
      }
      if (currentMatchedBookmark && currentMatchedBookmark.id === targetId) {
        currentMatchedBookmark.notes = newNotes
        delete currentMatchedBookmark._decryptedNotes
      }
    }
    toast(outcome.toast, 1500)
    bdNotesEditWrap.classList.add('hidden')
    editingNotesTargetId = null
    if (currentMatchedBookmark) showBookmarkDetail(currentMatchedBookmark)
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
    var selectedParent = (saveParentSelect && saveParentSelect.value) || null
    var notesVal = (quickNotesInput && quickNotesInput.value.trim()) || ''

    var payload
    try {
      payload = savePayloadApi.buildBookmarkPayload({
        url: currentTab.url,
        title: currentTab.title,
        categoryId: selectedCat,
        parentId: selectedParent,
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
    if (saveParentRow) saveParentRow.classList.add('hidden')


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
