// sidepanel.js — LinkVault Side Panel 主逻辑

(function () {
  'use strict'

  // ── Supabase 配置（与 Web App 共享）──
  const SUPABASE_URL = 'https://yqouglfopbmujkqmjgpu.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxb3VnbGZvcGJtdWprcW1qZ3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjI2NjAsImV4cCI6MjA5NTUzODY2MH0.jiS802kT9rZZibDC8N3hB1cyvSxHV5xHs9pNjE7Wmnw'

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: localStorage, storageKey: 'linkvault_ext_auth' }
  })

  // ── DOM ──
  const $ = (s) => document.querySelector(s)
  const authSection = $('#authSection')
  const mainSection = $('#mainSection')
  const emailInput = $('#emailInput')
  const otpSection = $('#otpSection')
  const otpInput = $('#otpInput')
  const pageTitle = $('#pageTitle')
  const pageUrl = $('#pageUrl')
  const pageIcon = $('#pageIcon')
  const searchInput = $('#searchInput')
  const bookmarkList = $('#bookmarkList')
  const importResult = $('#importResult')
  const statusDot = $('#statusDot')
  const statusText = $('#statusText')
  const bookmarkCount = $('#bookmarkCount')
  const toastEl = $('#toast')

  let currentTab = null
  let allBookmarks = []
  let userId = null

  // ── Toast ──
  function toast(msg, dur = 2000) { toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), dur) }

  // ── 状态 ──
  function setStatus(state, text) { statusDot.className = 'status-dot ' + state; statusText.textContent = text }

  // ── 认证 ──
  async function checkAuth() {
    const { data: { session } } = await sb.auth.getSession()
    if (session?.user) {
      userId = session.user.id
      authSection.classList.add('hidden')
      mainSection.classList.remove('hidden')
      setStatus('ok', '已连接')
      await loadBookmarks()
      await loadCurrentTab()
    } else {
      authSection.classList.remove('hidden')
      mainSection.classList.add('hidden')
      setStatus('', '未登录')
    }
  }

  // 发送验证码
  $('#btnLogin').addEventListener('click', async () => {
    const email = emailInput.value.trim()
    if (!email) return toast('请输入邮箱')
    setStatus('sync', '发送中…')
    const { error } = await sb.auth.signInWithOtp({ email })
    if (error) { setStatus('err', '发送失败'); toast(error.message); return }
    otpSection.classList.remove('hidden')
    setStatus('ok', '验证码已发送')
    otpInput.focus()
  })

  // 验证码
  $('#btnVerify').addEventListener('click', async () => {
    const email = emailInput.value.trim()
    const token = otpInput.value.trim()
    if (!token || token.length !== 6) return toast('请输入 6 位验证码')
    setStatus('sync', '验证中…')
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' })
    if (error) { setStatus('err', '验证失败'); toast(error.message); return }
    toast('登录成功')
    await checkAuth()
  })

  // 退出
  $('#btnLogout').addEventListener('click', async () => {
    await sb.auth.signOut()
    userId = null
    allBookmarks = []
    checkAuth()
  })

  // ── 加载书签 ──
  async function loadBookmarks() {
    if (!userId) return
    setStatus('sync', '加载中…')
    const { data, error } = await sb.from('bookmarks').select('id,title,url,icon,category_id,notes,use_count').eq('user_id', userId).is('deleted_at', null).order('use_count', { ascending: false }).limit(500)
    if (error) { setStatus('err', '加载失败'); return }
    allBookmarks = data || []
    bookmarkCount.textContent = allBookmarks.length + ' 个书签'
    setStatus('ok', '已连接')
    renderBookmarks(allBookmarks)
  }

  // ── 渲染书签列表 ──
  function renderBookmarks(list) {
    if (!list.length) { bookmarkList.innerHTML = '<div class="empty">暂无书签</div>'; return }
    bookmarkList.innerHTML = list.slice(0, 50).map(b => {
      const host = domain(b.url)
      const icon = b.icon || (host ? 'https://www.google.com/s2/favicons?domain=' + host + '&sz=32' : '')
      return '<div class="bookmark-item" data-url="' + esc(b.url) + '">'
        + (icon ? '<img src="' + esc(icon) + '" alt="" onerror="this.style.display=\'none\'">' : '')
        + '<div class="bookmark-item-info">'
        + '<div class="bookmark-item-title">' + esc(b.title) + '</div>'
        + '<div class="bookmark-item-url">' + esc(host) + '</div>'
        + '</div></div>'
    }).join('')

    bookmarkList.querySelectorAll('.bookmark-item').forEach(el => {
      el.addEventListener('click', () => { chrome.tabs.create({ url: el.dataset.url }) })
    })
  }

  // ── 搜索 ──
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase()
    if (!q) return renderBookmarks(allBookmarks)
    const filtered = allBookmarks.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      (b.notes || '').toLowerCase().includes(q)
    )
    renderBookmarks(filtered)
  })

  // ── 当前页 ──
  async function loadCurrentTab() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, (tab) => {
      if (!tab) return
      currentTab = tab
      pageTitle.textContent = tab.title || '无标题'
      pageUrl.textContent = domain(tab.url)
      pageIcon.src = tab.favIconUrl || ''
      pageIcon.onerror = () => { pageIcon.style.display = 'none' }
    })
  }

  // ── 保存当前页 ──
  $('#btnSave').addEventListener('click', async () => {
    if (!currentTab?.url || !userId) return
    if (currentTab.url.startsWith('chrome://') || currentTab.url.startsWith('edge://')) return toast('浏览器内部页面无法保存')

    setStatus('sync', '保存中…')
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const now = Date.now()
    const { error } = await sb.from('bookmarks').upsert({
      id, user_id: userId,
      title: currentTab.title || currentTab.url,
      url: currentTab.url,
      icon: currentTab.favIconUrl || '',
      category_id: 'uncategorized',
      notes: '', username: '',
      password: JSON.stringify(''),
      parent_id: null, order: 0, use_count: 0,
      attributes: {}, is_expanded: false,
      created_at_num: now, updated_at_num: now,
    }, { onConflict: 'id' })

    if (error) { setStatus('err', '保存失败'); toast(error.message); return }
    toast('已保存 ✓')
    setStatus('ok', '已连接')
    await loadBookmarks()
  })

  // ── Chrome 书签导入 ──
  $('#btnImport').addEventListener('click', async () => {
    setStatus('sync', '导入中…')
    chrome.runtime.sendMessage({ type: 'IMPORT_CHROME_BOOKMARKS' }, async (result) => {
      if (!result?.bookmarks?.length) { setStatus('ok', '已连接'); toast('Chrome 中没有书签'); return }

      const toImport = result.bookmarks.filter(b => {
        if (!b.url) return false
        if (b.url.startsWith('chrome://') || b.url.startsWith('edge://') || b.url.startsWith('about:')) return false
        return !allBookmarks.some(existing => existing.url === b.url)
      })

      if (!toImport.length) { importResult.textContent = '所有书签已存在，无需导入'; importResult.classList.remove('hidden'); setStatus('ok', '已连接'); return }

      // 批量插入（每批 20 条）
      const BATCH = 20
      let imported = 0
      for (let i = 0; i < toImport.length; i += BATCH) {
        const batch = toImport.slice(i, i + BATCH).map(b => {
          const now = Date.now() + i
          return {
            id: 'b' + now.toString(36) + Math.random().toString(36).slice(2, 6),
            user_id: userId, title: b.title || b.url, url: b.url,
            icon: '', category_id: 'uncategorized', notes: '', username: '',
            password: JSON.stringify(''), parent_id: null, order: 0,
            use_count: 0, attributes: {}, is_expanded: false,
            created_at_num: b.dateAdded || Date.now(), updated_at_num: Date.now(),
          }
        })
        const { error } = await sb.from('bookmarks').upsert(batch, { onConflict: 'id' })
        if (error) { toast('导入中断: ' + error.message); break }
        imported += batch.length
      }

      importResult.textContent = '已导入 ' + imported + ' 个书签（跳过 ' + (toImport.length - imported) + ' 个）'
      importResult.classList.remove('hidden')
      toast('导入完成 ✓')
      setStatus('ok', '已连接')
      await loadBookmarks()
    })
  })

  // ── 刷新 ──
  $('#btnRefresh').addEventListener('click', async () => { await loadBookmarks(); toast('已刷新') })

  // ── 工具 ──
  function ensureProtocol(u) { return u && !u.startsWith('http') ? 'https://' + u : u || '' }
  function domain(u) { try { return new URL(ensureProtocol(u)).hostname } catch { return u || '' } }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML }

  // ── 监听 auth 状态变化 ──
  sb.auth.onAuthStateChange((_event, session) => {
    if (!session) { userId = null; checkAuth() }
  })

  // ── 启动 ──
  checkAuth()
})()
