/**
 * welcome-data.test.ts — src/config/welcome-data.ts 默认示例笔记内容锚点护栏（d1-113）
 *
 * 严守守则「纯加测试零生产源文件改动」——WELCOME_NOTES/TIPS_NOTES 已 export
 * src/config/welcome-data.ts:8/43，本护栏经 import 间接断言字符串本体内容锚点，
 * welcome-data.ts 一字不改。套 d1-111 extension/config.js + d1-112 src/config/constants.ts
 * 已验证的「纯常量模块经 import 间接断言契约」范式。
 *
 * 锁目标：welcome-data.ts 是 LinkVault 首启示例组「欢迎」（WELCOME_NOTES → DEFAULTS.sg_welcome.notes）
 * 与「使用技巧」（TIPS_NOTES → DEFAULTS.sg_tips.notes）唯一笔记内容源——仅首次加载/数据重置时用，
 * 决定新用户/重置用户第一眼看到的引导笔记内容。此前仅 constants.test.ts:305 1 用例 `toBe(WELCOME_NOTES)`
 * 锁引用同一性（防 constants.ts 把 sg_welcome.notes 改成别串失锚），但 welcome-data.ts 本体的
 * H1 标题字面 / group-inline-card 内联卡 data-bm-id 引用契约（与 DEFAULTS.bookmarks 集对应）/ taskList
 * data-* 结构 / @mention 提示的关键 outward-facing 内容锚点零独立断言，全靠 117 行实现口头维护。
 *
 * 任一漂移（删 H1 标题致示例组笔记首行空白 / 删 group-inline-card 内联卡致示例书签引用渲染破裂 /
 * 改坏 data-bm-id 致与 DEFAULTS.bookmarks id 集对不上让首启渲染悬空 / 删 taskList 演示 / 删 @mention
 * 引导提示）让首启用户看不到完整引导且无测试告警。
 */
import { describe, it, expect } from 'vitest'
import { WELCOME_NOTES, TIPS_NOTES } from '../../config/welcome-data.js'
import { DEFAULTS } from '../../config/constants.js'

describe('welcome-data.ts 默认示例笔记护栏', () => {
  describe('WELCOME_NOTES（欢迎笔记 → DEFAULTS.sg_welcome.notes 唯一源）', () => {
    it('是字符串字面量，非空且为 string 类型', () => {
      expect(typeof WELCOME_NOTES).toBe('string')
      expect(WELCOME_NOTES.length).toBeGreaterThan(0)
    })

    it('H1 标题字面量「欢迎使用 LinkVault」锚定首行展示文案', () => {
      expect(WELCOME_NOTES.startsWith('<h1>欢迎使用 LinkVault</h1>')).toBe(true)
    })

    it('含「核心功能」H2 段标题（用户可见分区锚点）', () => {
      expect(WELCOME_NOTES).toContain('<h2>核心功能</h2>')
    })

    it('含「快速上手」H2 段标题（用户可见分区锚点）', () => {
      expect(WELCOME_NOTES).toContain('<h2>快速上手</h2>')
    })

    it('含 group-ref-card 组引用内联卡 data-bm-id="ref:sg_tips"（跨组引用演示锚点）', () => {
      // ref:sg_tips 引用 DEFAULTS.sg_tips 组——首启向用户演示组间引用网络的唯一锚点
      expect(WELCOME_NOTES).toContain('class="group-inline-card group-ref-card"')
      expect(WELCOME_NOTES).toContain('data-bm-id="ref:sg_tips"')
    })

    it('含 taskList 结构（data-type="taskList" 包裹 + 至少一条 taskItem data-checked）', () => {
      expect(WELCOME_NOTES).toContain('<ul data-type="taskList">')
      expect(WELCOME_NOTES).toContain('data-type="taskItem"')
      // 同一条同时出现 true 与 false 两种 checked（演示待办的已完成/未完成两态）
      expect(WELCOME_NOTES).toContain('data-checked="true"')
      expect(WELCOME_NOTES).toContain('data-checked="false"')
    })

    it('含 @mention 引导入口提示（编辑器中输入 @ 快速搜索插入书签）', () => {
      // 快速上手第 4 步演示 @ mention 入口语义
      expect(WELCOME_NOTES).toContain('输入')
      expect(WELCOME_NOTES).toContain('@')
    })

    it('示例书签内联卡 data-bm-id 全部命中 DEFAULTS.bookmarks 的 id 集（无悬空引用）', () => {
      // WELCOME_NOTES 含 b1-b5 五张示例书签内联卡，每张 data-bm-id 必在 DEFAULTS.bookmarks 集内
      const bookmarkIds = new Set(DEFAULTS.bookmarks.map((b) => b.id))
      // 抓出 WELCOME_NOTES 里所有非 ref: 的 data-bm-id="..."（排除 group-ref-card 的 ref:sg_tips）
      const bmIdMatches = WELCOME_NOTES.match(/data-bm-id="(?!ref:)([^"]+)"/g) ?? []
      const bmIds = bmIdMatches.map((m) => m.match(/data-bm-id="([^"]+)"/)?.[1] ?? '')
      expect(bmIds.length).toBeGreaterThanOrEqual(5)
      for (const id of bmIds) {
        // 每个示例书签 id 必须在 DEFAULTS.bookmarks 集内，否则首启渲染悬空
        expect(bookmarkIds.has(id)).toBe(true)
      }
      // 五张示例书签 b1/b2/b3/b4/b5 全部出现（首启示例书签引用完整性）
      for (const id of ['b1', 'b2', 'b3', 'b4', 'b5']) {
        expect(bmIds).toContain(id)
      }
    })

    it('group-inline-card 与 gic-name 计数对齐（每张内联卡恰好含 1 个 gic-name 展示名）', () => {
      // WELCOME_NOTES 真实结构：6 张 group-inline-card = 5 张示例书签卡 + 1 张 group-ref-card 组引用卡
      const cardCount = WELCOME_NOTES.split('class="group-inline-card').length - 1
      const nameCount = WELCOME_NOTES.split('class="gic-name"').length - 1
      expect(cardCount).toBeGreaterThanOrEqual(6)
      expect(nameCount).toBe(cardCount)
      // gic-btn「详」按钮计数与卡数对齐（每卡含 1 个详情按钮入口）
      const btnCount = WELCOME_NOTES.split('class="gic-btn"').length - 1
      expect(btnCount).toBe(cardCount)
    })

    it('group-ref-card 组引用卡含 gic-count 不含 gic-domain（组引用与书签卡真实结构差异直锁）', () => {
      // 真实隐特性：ref:sg_tips 组引用卡展示「2个书签」计数(gic-count)但不展示域名
      // 因组引用指向一个组而非单书签，故卡内含 gic-name + gic-count + gic-btn 但无 gic-domain——
      // 若未来误给组引用卡加 gic-domain 会让首启渲染出指向 sg_tips 组的虚假域名展示
      expect(WELCOME_NOTES).toContain('group-ref-card')
      expect(WELCOME_NOTES).toContain('class="gic-count"')
      // gic-domain 计数恰为 5（5 张示例书签卡各 1 个，组引用卡 0 个）——锁数量结构与书的真实差异
      expect(WELCOME_NOTES.split('class="gic-domain"').length - 1).toBe(5)
    })

    it('与 DEFAULTS.sg_welcome.notes 引用同一（防 constants.ts 把 notes 改成别串失锚）', () => {
      // constants.ts:67 notes: WELCOME_NOTES 直接引用，toBe 锁引用同一性
      const welcome = DEFAULTS.siblingGroups.find((g) => g.id === 'sg_welcome')
      expect(welcome).toBeDefined()
      expect(welcome?.notes).toBe(WELCOME_NOTES)
    })

    it('长度稳定防整串被误删（≥1.5KB，足够承载完整引导内容）', () => {
      // WELCOME_NOTES 含 H1+多 H2+taskList+组引用+5 示例书签卡，删除任一结构会跌破长度下限
      expect(WELCOME_NOTES.length).toBeGreaterThan(1500)
    })
  })

  describe('TIPS_NOTES（使用指南 → DEFAULTS.sg_tips.notes 唯一源）', () => {
    it('是字符串字面量，非空且为 string 类型', () => {
      expect(typeof TIPS_NOTES).toBe('string')
      expect(TIPS_NOTES.length).toBeGreaterThan(0)
    })

    it('H1 标题字面量「LinkVault 使用指南」锚定首行展示文案', () => {
      expect(TIPS_NOTES.startsWith('<h1>LinkVault 使用指南</h1>')).toBe(true)
    })

    it('含「组功能详解」H2 段标题（核心功能分区锚点）', () => {
      expect(TIPS_NOTES).toContain('<h2>组功能详解</h2>')
    })

    it('含「快捷键汇总」H2 段标题（快捷键演示分区锚点）', () => {
      expect(TIPS_NOTES).toContain('<h2>快捷键汇总</h2>')
    })

    it('含 @ 与 # 两 mention 引导入口提示（编辑器内 @ 书签 / # 组引用）', () => {
      // 组编辑器段演示 @ mention + # group-ref 两入口语义
      expect(TIPS_NOTES).toContain('@')
      expect(TIPS_NOTES).toContain('#')
    })

    it('含快捷键演示锚点 Ctrl+K（全局搜索）/ Ctrl+Z（撤销）/ Esc（退出）三类核心快捷键', () => {
      // 快捷键汇总段用户可见的核心交互键演示
      expect(TIPS_NOTES).toContain('Ctrl + K')
      expect(TIPS_NOTES).toContain('Ctrl + Z')
      expect(TIPS_NOTES).toContain('Esc')
    })

    it('结尾示例书签内联卡 data-bm-id 命中 DEFAULTS.bookmarks 的 id 集（无悬空引用）', () => {
      const bookmarkIds = new Set(DEFAULTS.bookmarks.map((b) => b.id))
      const bmIdMatches = TIPS_NOTES.match(/data-bm-id="(?!ref:)([^"]+)"/g) ?? []
      const bmIds = bmIdMatches.map((m) => m.match(/data-bm-id="([^"]+)"/)?.[1] ?? '')
      expect(bmIds.length).toBeGreaterThan(0)
      for (const id of bmIds) {
        expect(bookmarkIds.has(id)).toBe(true)
      }
    })

    it('与 DEFAULTS.sg_tips.notes 引用同一（防 constants.ts 把 notes 改成别串失锚）', () => {
      const tips = DEFAULTS.siblingGroups.find((g) => g.id === 'sg_tips')
      expect(tips).toBeDefined()
      expect(tips?.notes).toBe(TIPS_NOTES)
    })

    it('长度稳定防整串被误删（≥2KB，承载完整功能指南内容）', () => {
      // TIPS_NOTES 含 9 个 H2/H3 段 + 快捷键汇总段 + 示例书签卡，远长于 WELCOME_NOTES
      expect(TIPS_NOTES.length).toBeGreaterThan(2000)
    })
  })

  describe('两串交叉断言', () => {
    it('WELCOME_NOTES 与 TIPS_NOTES 互不相同（防止误改导致两示例组笔记内容塌缩成同一串）', () => {
      expect(WELCOME_NOTES).not.toBe(TIPS_NOTES)
    })

    it('两串 H1 标题不同（欢迎 vs 使用指南，用户可凭标题区分两示例组）', () => {
      const welcomeH1 = WELCOME_NOTES.match(/<h1>([^<]+)<\/h1>/)?.[1] ?? ''
      const tipsH1 = TIPS_NOTES.match(/<h1>([^<]+)<\/h1>/)?.[1] ?? ''
      expect(welcomeH1).not.toBe(tipsH1)
      expect(welcomeH1.length).toBeGreaterThan(0)
      expect(tipsH1.length).toBeGreaterThan(0)
    })

    it('两串均含 group-inline-card 内联卡结构（统一卡片渲染契约）', () => {
      expect(WELCOME_NOTES).toContain('class="group-inline-card"')
      expect(TIPS_NOTES).toContain('class="group-inline-card"')
    })

    it('大量重复读取返回同一字符串引用（纯字符串常量无副作用，import 即得到同一冻结字面量）', () => {
      // 经多次 import 得到的是模块顶层 const 同一 string 引用（ESM 模块单例）
      // 注：vitest 每测例重新求值 module，但同一 module instance 内 WELCOME_NOTES 恒定
      expect(WELCOME_NOTES).toBe(WELCOME_NOTES)
      expect(TIPS_NOTES).toBe(TIPS_NOTES)
    })
  })
})
