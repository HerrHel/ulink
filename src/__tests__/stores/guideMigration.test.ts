/** 上手指南迁移：用户没动过的旧版官方指南换成新版，改过的不碰 */
import { describe, it, expect } from 'vitest'
import { isUneditedOldGuide } from '../../stores/migrations.js'
import { getWelcomeNotes, LANDING_CARD_BM_ID } from '../../config/welcome-data.js'
import { OFFICIAL_SITE_LANDING_ID } from '../../stores/dataActionsBookmarks.js'

// 上一版 = 当前版去掉「看看宣传页」那一段（2026-11-25 新增）
const dropLanding = (html: string) => html.replace(/<p>[^<]*<span class="group-inline-card"[^>]*data-bm-id="bm_ulink_landing"[\s\S]*?<\/span><\/span><\/p>/, '')
const prevZh = () => dropLanding(getWelcomeNotes('zh-CN'))
// 英文版另有一步：导入按钮改名「Import」（2026-11-25，带宣传页卡片那版之后）
const enBeforeImportRename = () => getWelcomeNotes('en-US').replace('click "Import" on this card', 'click "Import Bookmarks" on this card')
const prevEn = () => dropLanding(enBeforeImportRename())
// 再上一版（eb264055）与上一版的差异只在这几处措辞，倒推即可复原
const prev2Zh = () => prevZh()
  .replace('「设置 → 数据与维护」', '「设置 → 数据管理」')
  .replace('主题外观与数据加密', '主题外观与端到端加密')
const prev2En = () => prevEn()
  .replace('Settings → Data &amp; Maintenance', 'Settings → Data')
  .replace('theme appearance, and encryption', 'theme appearance, and E2E encryption')

describe('isUneditedOldGuide', () => {
  it('上一版中英文原文识别为未编辑旧版', () => {
    expect(isUneditedOldGuide(prevZh())).toBe(true)
    expect(isUneditedOldGuide(prevEn())).toBe(true)
    expect(isUneditedOldGuide(prev2Zh())).toBe(true)
    expect(isUneditedOldGuide(prev2En())).toBe(true)
    expect(isUneditedOldGuide(enBeforeImportRename())).toBe(true)
  })

  it('当前版本带「宣传页」内联卡片，引用的 id 与官网书签常量一致', () => {
    for (const html of [getWelcomeNotes('zh-CN'), getWelcomeNotes('en-US')]) {
      expect(html).toContain('data-bm-id="' + OFFICIAL_SITE_LANDING_ID + '"')
      expect(prevZh()).not.toContain(OFFICIAL_SITE_LANDING_ID)
    }
    expect(LANDING_CARD_BM_ID).toBe(OFFICIAL_SITE_LANDING_ID)
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
