// background.js — 与链（ulink）Extension

// ── 跨浏览器 API 统一兼容（Chrome, Edge, Firefox, Brave, Arc 等）──
if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser
}

import { decideOpenPwa } from './pwa-open.js'
import { extractPageMetadataInTab } from './meta-extract.js'

const PWA_URL = 'https://ulink.ren'
// H10：仅按 PWA / 本地 dev 域名匹配已开标签，无需 tabs 权限遍历全部标签 URL
const PWA_TAB_URL_PATTERNS = [
  PWA_URL + '/*',
  'http://localhost:5173/*',
  'https://localhost:5173/*',
  'http://127.0.0.1:5173/*',
  'http://localhost:4173/*',
  'http://localhost:5174/*',
]

// ── 统一网页元数据抓取（方案二：现场提取 OpenGraph、SEO 描述与划词）──
async function extractTabMeta(tab) {
  if (!tab || !tab.id || !tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
    return {
      title: (tab && tab.title) || '',
      description: '',
      keywords: '',
      selection: '',
      icon: (tab && tab.favIconUrl) || '',
    }
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageMetadataInTab,
    })
    if (results && results[0] && results[0].result) {
      const r = results[0].result
      return {
        title: r.title || tab.title || '',
        description: r.description || '',
        keywords: r.keywords || '',
        selection: r.selection || '',
        icon: r.icon || tab.favIconUrl || '',
      }
    }
  } catch (_) {
    // 受限或不可注入页面静默降级为标签属性
  }
  return {
    title: tab.title || '',
    description: '',
    keywords: '',
    selection: '',
    icon: tab.favIconUrl || '',
  }
}

// ── 初始化：创建右键菜单（每次 worker 启动时执行，以防重启后丢失）──
const VIDEO_PAGE_PATTERNS = [
  'https://www.bilibili.com/video/*',
  'https://b23.tv/*',
  'https://www.douyin.com/*',
  'https://www.iesdouyin.com/*',
  'https://www.xiaohongshu.com/*',
]

// 由右键菜单同源的 URL Pattern 派生精确主机名集合：只用 new URL().hostname 精确比对，
// 绝不对整条 URL 做子串判定（否则 https://attacker.tld/?x=bilibili.com 会被误放行）。
const VIDEO_PAGE_HOSTS = VIDEO_PAGE_PATTERNS.map(function (p) {
  try { return new URL(p).hostname.toLowerCase() } catch (_) { return '' }
}).filter(Boolean)

function isVideoPageUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    var u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    return VIDEO_PAGE_HOSTS.indexOf(u.hostname.toLowerCase()) !== -1
  } catch (_) {
    return false
  }
}

chrome.contextMenus.removeAll(function () {
  chrome.contextMenus.create({
    id: 'save-to-linkvault',
    title: chrome.i18n.getMessage('menu_save_page'),
    contexts: ['page', 'link'],
  })
  chrome.contextMenus.create({
    id: 'save-selection-to-linkvault',
    title: chrome.i18n.getMessage('menu_save_selection'),
    contexts: ['selection'],
  })
  chrome.contextMenus.create({
    id: 'deep-extract-video',
    title: chrome.i18n.getMessage('menu_deep_extract'),
    contexts: ['page'],
    documentUrlPatterns: VIDEO_PAGE_PATTERNS,
  })
})

// ── 安装/更新时 ──
chrome.runtime.onInstalled.addListener(function () {
  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {})
  }
})

// ── 右键菜单 ──
chrome.contextMenus.onClicked.addListener(async function (info, tab) {
  if (info.menuItemId === 'save-to-linkvault') {
    const meta = await extractTabMeta(tab)
    const finalTitle = meta.title || tab.title
    const finalNotes = meta.selection || meta.description || ''
    openPwaWithUrl(info.linkUrl || tab.url, finalTitle, finalNotes)
  } else if (info.menuItemId === 'save-selection-to-linkvault') {
    const meta = await extractTabMeta(tab)
    const selection = meta.selection || info.selectionText || ''
    const finalTitle = meta.title || tab.title
    openPwaWithUrl(info.pageUrl || tab.url, finalTitle, selection)
  } else if (info.menuItemId === 'deep-extract-video') {
    openVideoExtract(tab)
  }
})

// ── 快捷键 Ctrl+Shift+S ──
// activeTab 在命令/用户手势触发时瞬态授权当前标签，无需持久 tabs 权限
chrome.commands.onCommand.addListener(async function (command) {
  if (command === 'save-to-linkvault') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs && tabs[0]
    if (tab) {
      const meta = await extractTabMeta(tab)
      const finalTitle = meta.title || tab.title
      const finalNotes = meta.selection || meta.description || ''
      openPwaWithUrl(tab.url, finalTitle, finalNotes)
    }
  }
})

/** 新标签页打开 PWA，附带当前页面 URL 和可选的选中文本。B2：返 Promise，调用方 await 后据实响应。 */
function openPwaWithUrl(url, title, notes) {
  return new Promise(function (resolve) {
    // decideOpenPwa 经 ES module import 引入（manifest 已声明 type: module，SW 无 window 故走
    // import 不依赖 window 挂载）。协议拦截+URL 构造在 pwa-open.js 纯函数内，vitest 锁全分支。
    var decision = decideOpenPwa(url, title, notes, PWA_URL)
    if (!decision.shouldOpen) { resolve({ ok: false, reason: decision.reason }); return }

    // H10：按 URL pattern 仅匹配 PWA 标签，不读用户其它标签 URL
    chrome.tabs.query({ url: PWA_TAB_URL_PATTERNS }, function (tabs) {
      if (chrome.runtime.lastError) { resolve({ ok: false, reason: chrome.runtime.lastError.message }); return }
      var existing = tabs && tabs[0]
      if (existing) {
        chrome.tabs.update(existing.id, { active: true, url: decision.targetUrl })
        if (chrome.windows && typeof chrome.windows.update === 'function' && existing.windowId) {
          chrome.windows.update(existing.windowId, { focused: true }).catch(function () {})
        }
      } else {
        chrome.tabs.create({ url: decision.targetUrl })
      }
      resolve({ ok: true })
    })
  })
}

// ── 视频深度解析：从页面态读取平台已签名的媒体地址（MAIN world）──
// 说明：B站/抖音的播放地址是页面 JS 用用户自己的登录态/风控令牌换来的，
// 这里只做「读页面已有数据」，不逆向签名、不发额外请求。
function readBilibiliVideoState() {
  function pick(list) {
    const out = []
    for (const item of list || []) {
      const urls = []
      if (item && (item.baseUrl || item.base_url)) urls.push(item.baseUrl || item.base_url)
      for (const u of (item && (item.backupUrl || item.backup_url)) || []) urls.push(u)
      for (const u of urls) if (u && out.indexOf(u) < 0) out.push(String(u))
    }
    return out.slice(0, 6)
  }
  const play = window.__playinfo__
  const state = window.__INITIAL_STATE__
  const dash = play && play.data && play.data.dash
  const videoData = state && state.videoData
  // 优先 AVC(H.264)，避免 extension 触发的 OCR 下载到 ffmpeg 不一定能解的 AV1/HEVC
  const allVideos = (dash && dash.video) || []
  const avcVideos = allVideos.filter((v) => !v.codecid || v.codecid === 7)
  return {
    platform: 'bilibili',
    title: (videoData && videoData.title) || document.title || '',
    duration: (videoData && videoData.duration) || null,
    uploader: (videoData && videoData.owner && videoData.owner.name) || '',
    audio_urls: pick(dash && dash.audio),
    video_urls: pick(avcVideos.length ? avcVideos : allVideos),
    referer: 'https://www.bilibili.com/',
  }
}

function readDouyinVideoState() {
  const videoUrls = []
  function addUrl(value) {
    if (typeof value !== 'string') return
    const url = value.trim()
    if (!/^https:\/\//i.test(url)) return
    if (!/(douyinvod|bytecdn|byteimg|snssdk|amemv|zjcdn)\./i.test(url)) return
    if (videoUrls.indexOf(url) < 0) videoUrls.push(url)
  }
  // 优先读 douyin-hook.js 在 MAIN world 捕获的页面响应（更接近真实播放地址）
  try {
    const hooked = window.__ULINK_DOUYIN_MEDIA__
    if (hooked && Array.isArray(hooked.urls)) for (const url of hooked.urls) addUrl(url)
  } catch (_) {}
  function collect(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return
    if (Array.isArray(node)) {
      for (const item of node) collect(item, depth + 1)
      return
    }
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (typeof value === 'string') {
        if (/^(url_list|urlList|play_addr|playAddr|download_addr|downloadAddr|playApi)$/i.test(key)) addUrl(value)
        else if (/^https:\/\//i.test(value) && /(douyinvod|bytecdn|amemv|zjcdn)\./i.test(value)) addUrl(value)
      } else if (value && typeof value === 'object') {
        if (/^(play_addr|playAddr|download_addr|downloadAddr|url_list|urlList|bit_rate|bitRate|video)$/i.test(key)) {
          collect(value, depth + 1)
        } else if (depth < 2) {
          collect(value, depth + 1)
        }
      }
    }
  }
  try {
    const el = document.querySelector('#RENDER_DATA')
    if (el && el.textContent) {
      let text = el.textContent
      try {
        text = decodeURIComponent(text)
      } catch (_) {}
      collect(JSON.parse(text), 0)
    }
  } catch (_) {}
  try {
    collect(window._ROUTER_DATA, 0)
  } catch (_) {}
  for (const video of document.querySelectorAll('video')) {
    addUrl(video.currentSrc || video.src)
  }
  try {
    for (const entry of performance.getEntriesByType('resource')) {
      if (/\.(mp4|m4s)(\?|$)/i.test(entry.name)) addUrl(entry.name)
    }
  } catch (_) {}
  return {
    platform: 'douyin',
    title: document.title || '',
    duration: null,
    uploader: '',
    audio_urls: [],
    video_urls: videoUrls.slice(0, 6),
    referer: 'https://www.douyin.com/',
  }
}

function readXiaohongshuVideoState() {
  const videoUrls = []
  function addUrl(value) {
    if (typeof value !== 'string') return
    const url = value.trim()
    if (!/^https:\/\//i.test(url)) return
    if (!/(xhscdn|xhsimg)\./i.test(url)) return
    if (videoUrls.indexOf(url) < 0) videoUrls.push(url)
  }
  function collect(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (typeof value === 'string' && /^https:\/\//i.test(value)) addUrl(value)
      else if (value && typeof value === 'object') collect(value, depth + 1)
    }
  }
  try {
    collect(window.__INITIAL_STATE__, 0)
  } catch (_) {}
  for (const video of document.querySelectorAll('video')) addUrl(video.currentSrc || video.src)
  return {
    platform: 'xiaohongshu',
    title: document.title || '',
    duration: null,
    uploader: '',
    audio_urls: [],
    video_urls: videoUrls.slice(0, 6),
    referer: 'https://www.xiaohongshu.com/',
  }
}

async function extractTabVideoState(tab) {
  const url = (tab && tab.url) || ''
  // 精确 hostname 判定：不再用 /bilibili\.com|b23\.tv/i 对整条 URL 做子串匹配，
  // 否则 https://attacker.tld/?x=bilibili.com 可绕过并注入任意页面
  if (!isVideoPageUrl(url)) return { ok: false, platform: '', reason: 'unsupported_page' }
  const hostname = new URL(url).hostname.toLowerCase()
  let platform = ''
  let func = null
  if (hostname === 'www.bilibili.com' || hostname === 'b23.tv') {
    platform = 'bilibili'
    func = readBilibiliVideoState
  } else if (hostname === 'www.douyin.com' || hostname === 'www.iesdouyin.com') {
    platform = 'douyin'
    func = readDouyinVideoState
  } else if (hostname === 'www.xiaohongshu.com') {
    platform = 'xiaohongshu'
    func = readXiaohongshuVideoState
  }
  if (!platform || !func) return { ok: false, platform: '', reason: 'unsupported_page' }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func,
    })
    const payload = results && results[0] && results[0].result
    if (!payload) return { ok: false, platform, reason: 'no_page_state' }
    const audio = Array.isArray(payload.audio_urls) ? payload.audio_urls : []
    const video = Array.isArray(payload.video_urls) ? payload.video_urls : []
    if (!audio.length && !video.length) return { ok: false, platform, reason: 'no_media_url' }
    return { ok: true, platform, payload: { ...payload, url } }
  } catch (e) {
    return { ok: false, platform, reason: 'inject_failed', message: String((e && e.message) || e).slice(0, 200) }
  }
}

async function openVideoExtract(tab) {
  if (!tab || !tab.id) return
  const state = await extractTabVideoState(tab)
  const key = 'ulink_video_extract_' + tab.id
  await chrome.storage.local.set({ [key]: { ...state, url: tab.url, createdAt: Date.now() } })
  chrome.tabs.create({
    url: chrome.runtime.getURL('video-extract.html') + '?key=' + encodeURIComponent(key),
  })
}

// ── 消息路由：side panel ↔ PWA ──
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  // 只接受本扩展自身（side panel / 扩展页）发出的消息，拒绝外部页面/其它扩展伪造指令
  if (!sender || sender.id !== chrome.runtime.id) return
  if (msg.type === 'GET_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async function (tabs) {
      const tab = tabs && tabs[0]
      if (!tab) { sendResponse(null); return }
      const meta = await extractTabMeta(tab)
      sendResponse({
        id: tab.id,
        url: tab.url,
        title: meta.title || tab.title,
        description: meta.description,
        keywords: meta.keywords,
        selection: meta.selection,
        favIconUrl: meta.icon || tab.favIconUrl,
      })
    }).catch(function () {
      sendResponse(null)
    })
    return true
  }

  if (msg.type === 'SAVE_TO_VAULT') {
    openPwaWithUrl(msg.url, msg.title, msg.notes).then(function (r) {
      sendResponse(r)
    }).catch(function (err) {
      sendResponse({ ok: false, reason: String(err) })
    })
    return true
  }

  if (msg.type === 'OPEN_VIDEO_EXTRACT') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async function (tabs) {
      const tab = tabs && tabs[0]
      if (tab) {
        // 补齐白名单：右键菜单入口有 documentUrlPatterns，消息入口此前对活动标签无 URL 校验
        if (!isVideoPageUrl(tab.url)) {
          sendResponse({ ok: false, reason: 'unsupported_page' })
          return
        }
        await openVideoExtract(tab)
        sendResponse({ ok: true })
      } else {
        sendResponse({ ok: false, reason: 'no_active_tab' })
      }
    }).catch(function (err) {
      sendResponse({ ok: false, reason: String(err) })
    })
    return true
  }
})
