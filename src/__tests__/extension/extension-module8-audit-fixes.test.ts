/**
 * 浏览器扩展结构护栏（2.0：侧边栏 = 主站 iframe 壳）
 *
 * 1.x 的侧边栏是自带 CloudBase SDK 的独立书签客户端；2.0 起改为嵌入 /app?mode=panel，
 * 扩展不再直连数据库。这里锁住：旧客户端不回流、权限不扩张、协议与主站一致、消息来源校验不丢。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import * as bridge from '../../../extension/panel-bridge.js'
import { EXT_MSG_NS, EXT_MSG_VERSION } from '../../lib/extPanel'

const read = (f: string) => fs.readFileSync(path.resolve('extension', f), 'utf8')

describe('扩展 2.0 结构护栏', () => {
  it('1. 旧的独立书签客户端与视频深度解析均已删除', () => {
    for (const f of [
      'lib', 'config.js', 'crypto.js', 'auth-flow.js', 'notes-update.js', 'keypress.js',
      'sidepanel-match.js', 'icons.js', 'save-payload.js',
      'video-extract.html', 'video-extract.js', 'video-extract.css', 'douyin-hook.js',
    ]) {
      expect(fs.existsSync(path.resolve('extension', f)), f + ' 应已删除').toBe(false)
    }
    const all = ['background.js', 'sidepanel.js', 'sidepanel.html', 'panel-bridge.js'].map(read).join('\n')
    // 扩展内不得再出现直连数据库 / 认证的代码
    expect(all).not.toMatch(/cloudbase|supabase|createClient|\.from\(['"]bookmarks['"]\)|signInWithOtp|setSession/i)
    expect(all).not.toContain('deep-extract-video')
  })

  it('2. 权限不扩张：无 tabs / storage / 内容脚本，host 只有主站', () => {
    const m = JSON.parse(read('manifest.json'))
    expect(m.version).toBe('2.0.0')
    expect([...m.permissions].sort()).toEqual(['activeTab', 'contextMenus', 'scripting', 'sidePanel'])
    expect(m.host_permissions).toEqual(['https://ulink.ren/*'])
    expect(m.content_scripts).toBeUndefined()
    expect(m.side_panel.default_path).toBe('sidepanel.html')
    expect(m.sidebar_action.default_panel).toBe('sidepanel.html')
  })

  it('3. 协议命名空间 / 版本与主站 src/lib/extPanel.ts 一致', () => {
    expect(bridge.MSG_NS).toBe(EXT_MSG_NS)
    expect(bridge.MSG_VERSION).toBe(EXT_MSG_VERSION)
  })

  it('4. 侧边栏只认 iframe 自身发来的消息，并按主站 origin 定向发送', () => {
    const sp = read('sidepanel.js')
    expect(sp).toContain('if (e.source !== frame.contentWindow) return')
    expect(sp).toContain('parseAppMessage(e.origin, e.data, APP_ORIGIN)')
    expect(sp).toContain('frame.contentWindow.postMessage(message, APP_ORIGIN)')
    expect(sp).not.toMatch(/postMessage\([^)]*'\*'\)/)
  })

  it('5. 后台与侧边栏都只接受本扩展自身的 runtime 消息', () => {
    expect(read('background.js')).toContain('sender.id !== chrome.runtime.id')
    expect(read('sidepanel.js')).toContain('sender.id !== chrome.runtime.id')
  })

  it('6. 快捷键 / 右键在手势内同步打开侧边栏，打不开时退回新标签保存', () => {
    const bg = read('background.js')
    expect(bg).toMatch(/function saveViaPanel\(tab, override\) \{\s*const opened = openPanel\(tab\)/)
    expect(bg).toContain('openPwaWithUrl(payload.url')
    expect(bg).toContain("chrome.runtime.sendMessage({ type: 'PANEL_SAVE', save })")
    expect(bg).toContain("msg.type === 'PANEL_READY'")
  })

  it('7. 词条两种语言同构，且每个被引用的键都存在', () => {
    const zh = JSON.parse(read('_locales/zh_CN/messages.json'))
    const en = JSON.parse(read('_locales/en/messages.json'))
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    const src = ['manifest.json', 'background.js', 'sidepanel.js', 'sidepanel.html'].map(read).join('\n')
    const keys = new Set<string>([
      ...[...src.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]),
      ...[...src.matchAll(/getMessage\('(\w+)'\)/g)].map((m) => m[1]),
      ...[...src.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/msg\('(\w+)'\)/g)].map((m) => m[1]),
    ])
    keys.delete('@@ui_locale')
    for (const k of keys) {
      expect(zh[k]?.message, 'zh 缺 ' + k).toBeTruthy()
      expect(en[k]?.message, 'en 缺 ' + k).toBeTruthy()
    }
  })

  it('8. 侧边栏页面无内联脚本（MV3 CSP）', () => {
    const html = read('sidepanel.html')
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    expect(html).not.toMatch(/\son[a-z]+=/i)
  })
})
