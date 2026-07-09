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

  let currentTab = null
  let allBookmarks = []
  let userId = null
  let loggedIn = false

  // ── Toast ──
  function toast(msg, dur) {
    if (dur === undefined) { dur = 2000 }
    toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(function () { toastEl.classList.remove('show') }, dur)
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
      headerLoginHint.textContent = '本地模式'
      headerLoginHint.style.color = ''
      btnShowLogin.classList.remove('hidden')
      btnLogout.classList.add('hidden')
      setStatus('local', '本地模式')
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
    renderBookmarks(allBookmarks)
  }

  async function loadFromCloud() {
    setStatus('sync', '加载中…')
    bookmarkList.classList.add('loading') // 保留旧列表，叠加加载遮罩
    const result = await sb.from('bookmarks')
      .select('id,title,url,icon,category_id,notes,use_count,created_at_num')
      .eq('user_id', userId).is('deleted_at', null)
      .order('created_at_num', { ascending: false }).limit(500)
    bookmarkList.classList.remove('loading')
    if (result.error) { setStatus('err', '加载失败: ' + (result.error.message || '未知错误')); return }
    allBookmarks = result.data || []
    bookmarkCount.textContent = allBookmarks.length + ' 个书签'
    setStatus('ok', '已连接')
    renderBookmarks(allBookmarks)
  }

  // ── 渲染书签列表 ──
  function renderBookmarks(list) {
    if (!list.length) {
      bookmarkList.innerHTML = '<div class="empty">'
        + '<div style="font-size:24px;margin-bottom:8px">📑</div>'
        + '<div style="font-weight:600;margin-bottom:4px">暂无书签</div>'
        + '<div style="font-size:12px;color:var(--text2);line-height:1.6">'
        + '💡 在当前页面点击「保存当前页」<br>'
        + '或右键页面选择「保存到 LinkVault」<br>'
        + '快捷键 <kbd style="background:#e5e7eb;padding:1px 5px;border-radius:3px;font-size:11px">Ctrl+Shift+S</kbd>'
        + '</div></div>'
      return
    }
    bookmarkList.innerHTML = list.slice(0, 50).map(function (b) {
      const host = domain(b.url)
      const icon = b.icon || (host ? 'https://www.google.com/s2/favicons?domain=' + host + '&sz=32' : '')
      return '<div class="bookmark-item" data-id="' + esc(b.id) + '" data-url="' + esc(b.url) + '">'
        + (icon ? '<img src="' + esc(icon) + '" alt="" onerror="this.style.display=\'none\'">' : '')
        + '<div class="bookmark-item-info">'
        + '<div class="bookmark-item-title">' + esc(b.title) + '</div>'
        + '<div class="bookmark-item-url">' + esc(host) + '</div>'
        + '</div>'
        + '<span class="bookmark-item-del" data-action="delete" data-id="' + esc(b.id) + '" data-title="' + esc(b.title) + '">&times;</span>'
        + '</div>'
    }).join('')

    // 如果书签超过 50 条，显示提示
    var total = list.length
    if (total > 50) {
      var footer = document.createElement('div')
      footer.className = 'list-footer'
      footer.textContent = '仅显示最近 50 条，共 ' + total + ' 条'
      bookmarkList.appendChild(footer)
    }

    // 事件委托：一个监听器处理所有点击
    bookmarkList.addEventListener('click', function (e) {
      var target = e.target
      // 向上查找实际点击的 bookmark-item
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

  // ── 删除书签（带确认）──
  async function deleteBookmark(id, title) {
    // 本地模式：二次确认（不可恢复）
    if (!loggedIn || !userId) {
      if (!confirm('确定删除书签「' + (title || '') + '」吗？\n本地模式下此操作无法撤销。')) return
    }
    if (loggedIn && userId) {
      const result = await sb.from('bookmarks').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
      if (result.error) { toast('删除失败: ' + result.error.message); return }
    } else {
      allBookmarks = allBookmarks.filter(function (b) { return b.id !== id })
      await saveLocalViaBackground(allBookmarks)
    }
    toast('已删除')
    loadBookmarks()
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
    } else {
      userId = null
      loggedIn = false
      updateLoginUI()
      await loadFromLocal()
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
