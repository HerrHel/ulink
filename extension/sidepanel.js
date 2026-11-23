// sidepanel.js — 与链侧边栏（2.0：iframe 壳）
//
// 侧边栏只做三件事：嵌入主站 /app?mode=panel、把当前标签页推给主站、根据主站回报设置角标。
// 书签的读写、登录、加密、同步、AI 预填全部在主站 iframe 内完成，扩展不再直连数据库。
// 协议见 panel-bridge.js（与主站 src/lib/extPanel.ts 对应）。

import {
  appPanelUrl,
  buildTabPayload,
  parseAppMessage,
  resolveAppOrigin,
  sameUrl,
  toAppMessage,
} from './panel-bridge.js'

if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser
}

const APP_ORIGIN = resolveAppOrigin(location.search)
/** 主站超过该时长没握手（离线 / 被拦截 / 服务异常）就显示兜底页 */
const READY_TIMEOUT_MS = 15000

const frame = document.getElementById('app')
const loadingEl = document.getElementById('loading')
const offlineEl = document.getElementById('offline')

let ready = false
let readyTimer = null
let pushTimer = null
/** 每次推送当前页递增；异步读取返回时序号已变（期间有更新的推送或保存）则丢弃，防旧结果覆盖新页面 */
let pushSeq = 0
/** 最近推给主站的页面（含快捷键保存的页面）：主站回报 matched 时按网址找回标签页设角标 */
const recentPushed = []
const RECENT_MAX = 8

function msg(key) {
  try { return chrome.i18n.getMessage(key) || '' } catch (_) { return '' }
}

function localize() {
  document.title = msg('ext_name') || document.title
  frame.title = document.title
  document.documentElement.lang = (msg('@@ui_locale') || 'zh_CN').replace('_', '-')
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = msg(el.getAttribute('data-i18n'))
  document.getElementById('openSite').href = APP_ORIGIN + '/app'
}

function showLoading() {
  loadingEl.hidden = false
  offlineEl.hidden = true
}

function showOffline() {
  if (ready) return
  loadingEl.hidden = true
  offlineEl.hidden = false
}

function loadApp() {
  ready = false
  showLoading()
  clearTimeout(readyTimer)
  readyTimer = setTimeout(showOffline, READY_TIMEOUT_MS)
  frame.src = appPanelUrl(APP_ORIGIN)
}

function post(message) {
  if (!frame.contentWindow) return
  frame.contentWindow.postMessage(message, APP_ORIGIN)
}

function sendTab(tabId, payload) {
  pushSeq++
  if (payload && tabId) {
    recentPushed.unshift({ tabId, url: payload.url })
    if (recentPushed.length > RECENT_MAX) recentPushed.length = RECENT_MAX
  }
  post(toAppMessage('tab', { tab: payload }))
}

/** 读当前标签页（含现场提取的元数据，由 background 统一执行）并推给主站 */
async function pushCurrentTab() {
  if (!ready) return
  const seq = ++pushSeq
  let tab = null
  try { tab = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }) } catch (_) { tab = null }
  if (seq !== pushSeq) return
  sendTab(tab && tab.id, buildTabPayload(tab, tab))
}

function schedulePush() {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushCurrentTab, 150)
}

function setBadge(tabId, saved) {
  if (!tabId || !chrome.action || !chrome.action.setBadgeText) return
  chrome.action.setBadgeText({ tabId, text: saved ? '✓' : '' }).catch(function () {})
  if (saved && chrome.action.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#122E8A' }).catch(function () {})
  }
}

/** 快捷键 / 右键菜单触发的保存：先把那一页推过去，再让主站打开保存弹窗 */
function performSave(save) {
  sendTab(save.tabId, save.tab)
  post(toAppMessage('save'))
}

window.addEventListener('message', function (e) {
  if (e.source !== frame.contentWindow) return
  const m = parseAppMessage(e.origin, e.data, APP_ORIGIN)
  if (!m) return
  if (m.type === 'ready') {
    ready = true
    clearTimeout(readyTimer)
    loadingEl.hidden = true
    offlineEl.hidden = true
    // 侧边栏是被快捷键 / 右键菜单拉起时，background 里有一条待处理的保存
    chrome.runtime.sendMessage({ type: 'PANEL_READY' }).then(function (res) {
      if (res && res.save && res.save.tab) performSave(res.save)
      else pushCurrentTab()
    }).catch(function () { pushCurrentTab() })
  } else if (m.type === 'matched') {
    const hit = recentPushed.find(function (p) { return sameUrl(p.url, m.url) })
    if (hit) setBadge(hit.tabId, m.saved)
  }
})

// background 在侧边栏已打开时直接转发保存请求；主站未就绪则回 false，由 PANEL_READY 补取
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!sender || sender.id !== chrome.runtime.id) return
  if (message && message.type === 'PANEL_SAVE' && message.save && message.save.tab) {
    if (!ready) { sendResponse({ ok: false }); return }
    performSave(message.save)
    sendResponse({ ok: true })
  }
})

if (chrome.tabs && chrome.tabs.onActivated) chrome.tabs.onActivated.addListener(schedulePush)
if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(function (_tabId, changeInfo, tab) {
    if (tab && tab.active && (changeInfo.status === 'complete' || changeInfo.url)) schedulePush()
  })
}

document.getElementById('retry').addEventListener('click', loadApp)
localize()
loadApp()
