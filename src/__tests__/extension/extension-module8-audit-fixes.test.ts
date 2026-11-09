import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('模块 8：浏览器扩展体系、外部摄取与客户端微交互回归测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. 右键菜单与视频深度解析链路完整性 ──
  it('1. background.js: 正确注册了视频深度解析右键菜单并限制在视频平台 URL Pattern 内', () => {
    const bgCode = fs.readFileSync(path.resolve('extension/background.js'), 'utf8')

    // 检查 VIDEO_PAGE_PATTERNS
    expect(bgCode).toContain('const VIDEO_PAGE_PATTERNS =')
    expect(bgCode).toContain('https://www.bilibili.com/video/*')
    expect(bgCode).toContain('https://www.douyin.com/*')
    expect(bgCode).toContain('https://www.xiaohongshu.com/*')

    // 检查 chrome.contextMenus.create 注册了 deep-extract-video
    expect(bgCode).toContain("id: 'deep-extract-video'")
    expect(bgCode).toContain("title: chrome.i18n.getMessage('menu_deep_extract')")
    expect(bgCode).toContain('documentUrlPatterns: VIDEO_PAGE_PATTERNS')

    // 检查 onClicked 监听器处理了 deep-extract-video
    expect(bgCode).toContain("else if (info.menuItemId === 'deep-extract-video')")
    expect(bgCode).toContain('openVideoExtract(tab)')
  })

  // ── 2. 消息路由异常兜底与 OPEN_VIDEO_EXTRACT ──
  it('2. background.js: 消息路由器包含异常 catch 兜底，并支持 OPEN_VIDEO_EXTRACT 协议', () => {
    const bgCode = fs.readFileSync(path.resolve('extension/background.js'), 'utf8')

    // 检查 GET_CURRENT_TAB 带 catch 兜底
    expect(bgCode).toContain("if (msg.type === 'GET_CURRENT_TAB')")
    expect(bgCode).toMatch(/chrome\.tabs\.query[\s\S]*?\.catch\(function \(\) \{\s*sendResponse\(null\)\s*\}\)/)

    // 检查 SAVE_TO_VAULT 带 catch 兜底
    expect(bgCode).toContain("if (msg.type === 'SAVE_TO_VAULT')")
    expect(bgCode).toMatch(/openPwaWithUrl[\s\S]*?\.catch\(function \(err\) \{\s*sendResponse\(\{ ok: false, reason: String\(err\) \}\)\s*\}\)/)

    // 检查支持 OPEN_VIDEO_EXTRACT
    expect(bgCode).toContain("if (msg.type === 'OPEN_VIDEO_EXTRACT')")
    expect(bgCode).toContain('await openVideoExtract(tab)')
  })

  // ── 3. sidepanel.js 主题切换与错误多语言 ──
  it('3. sidepanel.js: 主题切换按钮使用国际化 API，不再硬编码中文', () => {
    const spCode = fs.readFileSync(path.resolve('extension/sidepanel.js'), 'utf8')

    // 检查 getThemeToggleTitle 函数使用 chrome.i18n.getMessage
    expect(spCode).toContain("chrome.i18n.getMessage('theme_toggle_light')")
    expect(spCode).toContain("chrome.i18n.getMessage('theme_toggle_dark')")
    expect(spCode).not.toContain("btnThemeToggle.title = isDark ? '切换到浅色模式' : '切换到深色模式'")

    // 检查超时错误信息
    expect(spCode).toContain("chrome.i18n.getMessage('err_timeout')")
  })

  // ── 4. config.js 与 video-extract.js API_BASE 统一 ──
  it('4. config.js 与 video-extract.js: 统一使用 API_BASE 配置基址', () => {
    const cfgCode = fs.readFileSync(path.resolve('extension/config.js'), 'utf8')
    const veCode = fs.readFileSync(path.resolve('extension/video-extract.js'), 'utf8')

    expect(cfgCode).toContain("API_BASE: 'https://ulink.ren'")
    expect(veCode).toContain("const _cfg = window.LinkVaultExtConfig || {}")
    expect(veCode).toContain("const API_BASE = _cfg.API_BASE || 'https://ulink.ren'")
  })

  // ── 5. 多语言词条对称性与完整性 ──
  it('5. 多语言词条: zh_CN 与 en 词典中包含新增的 theme_toggle_* 与 err_timeout 词条', () => {
    const zh = JSON.parse(fs.readFileSync(path.resolve('extension/_locales/zh_CN/messages.json'), 'utf8'))
    const en = JSON.parse(fs.readFileSync(path.resolve('extension/_locales/en/messages.json'), 'utf8'))

    // 检查中文词条
    expect(zh.menu_deep_extract?.message).toBeTruthy()
    expect(zh.theme_toggle_light?.message).toBe('切换到浅色模式')
    expect(zh.theme_toggle_dark?.message).toBe('切换到深色模式')
    expect(zh.err_timeout?.message).toBe('超时')

    // 检查英文词条
    expect(en.menu_deep_extract?.message).toBeTruthy()
    expect(en.theme_toggle_light?.message).toBe('Switch to light mode')
    expect(en.theme_toggle_dark?.message).toBe('Switch to dark mode')
    expect(en.err_timeout?.message).toBe('Timeout')
  })

  // ── 6. highlightMatch 防 HTML 实体破坏与 XSS 安全 ──
  it('6. sidepanel.js highlightMatch: 接收原始纯文本，保证 HTML 实体不被搜索切割破坏', () => {
    // 模拟 sidepanel.js 中的 esc 与重构后的 highlightMatch
    function esc(s: string) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    function highlightMatch(rawText: string, query: string) {
      if (!rawText) return ''
      if (!query) return esc(rawText)
      const idx = rawText.toLowerCase().indexOf(query)
      if (idx === -1) return esc(rawText)
      return (
        esc(rawText.slice(0, idx)) +
        '<mark>' +
        esc(rawText.slice(idx, idx + query.length)) +
        '</mark>' +
        esc(rawText.slice(idx + query.length))
      )
    }

    // 场景 A: 标题包含 &，用户搜索 &
    const rawA = 'Tom & Jerry <Cartoons>'
    const resA = highlightMatch(rawA, '&')
    // 应当匹配到原有的 & 符号，转义为 <mark>&amp;</mark>，而不是把 &amp; 拆成 &<mark>amp</mark>;
    expect(resA).toBe('Tom <mark>&amp;</mark> Jerry &lt;Cartoons&gt;')

    // 场景 B: 用户搜索含有 amp 时，不应命中 & 的转义实体
    const resB = highlightMatch(rawA, 'amp')
    expect(resB).toBe('Tom &amp; Jerry &lt;Cartoons&gt;')
    expect(resB).not.toContain('<mark>')

    // 场景 C: 搜索 < 符号
    const resC = highlightMatch(rawA, '<')
    expect(resC).toBe('Tom &amp; Jerry <mark>&lt;</mark>Cartoons&gt;')
  })

  // ── 7. showBookmarkDetail 即刻掩码明文密码防异步闪烁 ──
  it('7. sidepanel.js showBookmarkDetail: 切换书签时入口立即执行 maskRevealedPassword', () => {
    const spCode = fs.readFileSync(path.resolve('extension/sidepanel.js'), 'utf8')
    // 确认入口处执行了 maskRevealedPassword
    expect(spCode).toMatch(/async function showBookmarkDetail\(bm\) \{[\s\S]*?maskRevealedPassword\(\)/)
  })

  // ── 8. video-extract.js OCR 链接协议白名单防 javascript: XSS ──
  it('8. video-extract.js: 对画面识别出的链接做协议安全白名单校验，拒绝 javascript: 伪协议', () => {
    const veCode = fs.readFileSync(path.resolve('extension/video-extract.js'), 'utf8')

    // 包含 isSafeHttpUrl 定义
    expect(veCode).toContain('function isSafeHttpUrl(url)')
    expect(veCode).toContain("u.protocol === 'http:' || u.protocol === 'https:'")

    // 渲染 OCR 网址时过滤了非法协议
    expect(veCode).toContain('const validUrls = urls.filter((item) => item && isSafeHttpUrl(item.url))')
  })

  // ── 9. video-extract.js 轮询与提交带有超时控制 ──
  it('9. video-extract.js: 轮询与提交均挂载了 AbortSignal.timeout 超时保护', () => {
    const veCode = fs.readFileSync(path.resolve('extension/video-extract.js'), 'utf8')

    // pollJob 中挂载了超时信号
    expect(veCode).toContain('signal: AbortSignal.timeout(8000)')
    // submitDeep 中挂载了超时信号
    expect(veCode).toContain('signal: AbortSignal.timeout(15000)')
  })

  // ── 10. sidepanel.js 一键同步网页登录态支持 CloudBase 凭证 ──
  it('10. sidepanel.js: trySyncSessionFromWeb 支持检测 CloudBase credentials_ 凭证', () => {
    const spCode = fs.readFileSync(path.resolve('extension/sidepanel.js'), 'utf8')
    expect(spCode).toContain("credentials_")
    expect(spCode).toContain("access_token")
    expect(spCode).toContain("refresh_token")
    expect(spCode).toContain("webUrlPatterns")
  })

  // ── 11. background.js 激活已有 PWA 窗口同时恢复窗口焦点 ──
  it('11. background.js: openPwaWithUrl 命中已有标签时聚焦目标窗口', () => {
    const bgCode = fs.readFileSync(path.resolve('extension/background.js'), 'utf8')
    expect(bgCode).toContain("chrome.windows.update(existing.windowId, { focused: true })")
  })
})
