/** 上手指南迁移：用户没动过的旧版官方指南换成新版，改过的不碰 */
import { describe, it, expect } from 'vitest'
import { isUneditedOldGuide } from '../../stores/migrations.js'
import { getWelcomeNotes } from '../../config/welcome-data.js'

// 上一版（eb264055）与当前版的差异只在这几处措辞，倒推即可复原旧版原文
const prevZh = () => getWelcomeNotes('zh-CN')
  .replace('「设置 → 数据与维护」', '「设置 → 数据管理」')
  .replace('主题外观与数据加密', '主题外观与端到端加密')
const prevEn = () => getWelcomeNotes('en-US')
  .replace('Settings → Data &amp; Maintenance', 'Settings → Data')
  .replace('theme appearance, and encryption', 'theme appearance, and E2E encryption')

describe('isUneditedOldGuide', () => {
  it('上一版中英文原文识别为未编辑旧版', () => {
    expect(isUneditedOldGuide(prevZh())).toBe(true)
    expect(isUneditedOldGuide(prevEn())).toBe(true)
  })

  it('只认文字：标签/属性被编辑器重排不影响识别', () => {
    const reserialized = prevZh().replace(/<span class="gic-btn">/g, '<span data-x="1" class="gic-btn">')
    expect(isUneditedOldGuide(reserialized)).toBe(true)
  })

  it('用户改过一个字就不替换', () => {
    expect(isUneditedOldGuide(prevZh().replace('欢迎使用', '欢迎来到'))).toBe(false)
  })

  it('当前版本不算旧版（避免每次加载都重写）', () => {
    expect(isUneditedOldGuide(getWelcomeNotes('zh-CN'))).toBe(false)
    expect(isUneditedOldGuide(getWelcomeNotes('en-US'))).toBe(false)
  })
})
