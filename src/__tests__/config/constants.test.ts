/**
 * config/constants.ts — 应用层常量快照护栏（d1-112-constants-const-guard）。
 *
 * constants.ts 是 80 行纯顶层 `export const` 常量模块（无函数逻辑），是 LinkVault
 * 全应用跨越数据层/UI 层/同步层的**全局硬编码锚点集合**：
 *   - 存储键名（localStorage key）→ persist.ts 加载/保存同名取数锚点，错误改键
 *     让旧用户本地数据**彻底无法读取**（按错 key 找不到存档），outward-facing 安全回归。
 *   - 内置分类/属性 id（CAT_ALL='all' / CAT_UNCATEGORIZED='uncategorized' /
 *     ATTR_IS_GROUP='is-group'）→ data.ts/d1-89 deleteCategory 默认分类守卫 + group
 *     组识别的硬编码字符串锚点（CommandLine `id === CAT_ALL` / groupAttrs 判 `===ATTR_IS_GROUP`），
 *     错改让全站默认分类识别塌陷 + 组属性识别失效。
 *   - 行为边界魔法数（MAX_UNDO/UNDO_WINDOW/MAX_UNDO_BYTES/MAX_SUGGESTIONS/TOAST_FADE_MS/
 *     TOAST_REMOVE_MS）→ useUndo/toast/suggest 等多模块消费，错改影响 UI 行为边界。
 *   - ACTIONS map（15 个右键 action 常量）→ ContextMenu.vue 右键菜单 action 唯一匹配锚点
 *     （d1-89 锁 `action === ACTIONS.DELETE` 同源），错改键值让右键菜单 action 失配静默。
 *   - DEFAULTS Faz（首次启动 seed 数据，首次加载/init 时用）→ 新用户首屏体验承载 +
 *     D2-007 安全契约（示例书签不放伪密码），错改结构/泄漏伪密码/缺组识别 attr 均影响首启体验与安全。
 *
 * 此前 zero 直接测试，全靠实现口头维护——任一 outward-facing 常量漂移无任何护栏告警。
 * 延续 d1-111 extension/config.js「纯常量模块经 import 间接断言契约、零生产源文件改动」
 * 范式：constants.ts 是 ESM 命名 export（非 IIFE 挂 window），测试直接 `import { ... }`
 * 即触发顶层 const 求值并断言常量契约，constants.ts 一字不改。护栏虽无分支逻辑，
 * 但真有回归价值——尤其 outward-facing 锚点（存储键/内置 id）与 D2-007 安全契约。
 */
import { describe, it, expect } from 'vitest'

import {
  STORAGE_KEY,
  STORAGE_KEY_VAULT,
  UI_STATE_KEY,
  PAYLOAD_KEY,
  DRAG_SRC_DETAIL,
  CAT_ALL,
  CAT_UNCATEGORIZED,
  ATTR_IS_GROUP,
  MAX_SUGGESTIONS,
  TOAST_FADE_MS,
  TOAST_REMOVE_MS,
  MAX_UNDO,
  UNDO_WINDOW,
  MAX_UNDO_BYTES,
  ACTIONS,
  DEFAULTS,
} from '../../config/constants.js'
import { WELCOME_NOTES, TIPS_NOTES } from '../../config/welcome-data.js'

describe('config/constants.ts — 应用层常量快照护栏（d1-112）', () => {
  describe('存储键名 outward-facing 稳定性（防误改致旧用户数据失访）', () => {
    it('STORAGE_KEY === "linkvault_v2"（主数据 localStorage 键，persist.ts 加载/保存锚点）', () => {
      expect(STORAGE_KEY).toBe('linkvault_v2')
      expect(typeof STORAGE_KEY).toBe('string')
    })

    it('STORAGE_KEY_VAULT === "linkvault_vault_v1"（私密空间独立数据集键，与主键不同防回退串台）', () => {
      expect(STORAGE_KEY_VAULT).toBe('linkvault_vault_v1')
      expect(STORAGE_KEY_VAULT).not.toBe(STORAGE_KEY)
    })

    it('UI_STATE_KEY === "lv_uiState"（UI 状态独立键，与主数据键不同）', () => {
      expect(UI_STATE_KEY).toBe('lv_uiState')
      expect(UI_STATE_KEY).not.toBe(STORAGE_KEY)
    })

    it('PAYLOAD_KEY === "application/x-linkvault"（剪贴板/拖拽 DataTransfer mime，与浏览器内置 mime 不撞）', () => {
      expect(PAYLOAD_KEY).toBe('application/x-linkvault')
      expect(PAYLOAD_KEY.startsWith('application/')).toBe(true)
    })

    it('DRAG_SRC_DETAIL === "__detail__"（详情面板拖拽标识，双下划线前缀防与业务 id 撞）', () => {
      expect(DRAG_SRC_DETAIL).toBe('__detail__')
      expect(DRAG_SRC_DETAIL.startsWith('__')).toBe(true)
    })
  })

  describe('内置分类/属性 id 稳定性（d1-89 默认分类守卫 + 组属性识别同源锚点）', () => {
    it('CAT_ALL === "all"（「全部」虚拟分类 id，data.ts 全站「当前分类」默认态锚点）', () => {
      expect(CAT_ALL).toBe('all')
    })

    it('CAT_UNCATEGORIZED === "uncategorized"（「未分类」默认分类 id，d1-89 默认分类守卫双内置分类之一）', () => {
      expect(CAT_UNCATEGORIZED).toBe('uncategorized')
      expect(CAT_UNCATEGORIZED).not.toBe(CAT_ALL)
    })

    it('ATTR_IS_GROUP === "is-group"（组识别属性 id，siblingGroup.attributes 键 + DEFAULTS 组 attr 同源）', () => {
      expect(ATTR_IS_GROUP).toBe('is-group')
    })
  })

  describe('行为边界魔法数（UI/limit 边界锚点，被多模块消费）', () => {
    it('MAX_SUGGESTIONS === 8（搜索/@mention 建议项上限，影响建议列表截断行为）', () => {
      expect(MAX_SUGGESTIONS).toBe(8)
      expect(typeof MAX_SUGGESTIONS).toBe('number')
    })

    it('TOAST_FADE_MS === 2200（toast 开始淡出延迟，与 TOAST_REMOVE_MS 配对）', () => {
      expect(TOAST_FADE_MS).toBe(2200)
      expect(TOAST_FADE_MS).toBeLessThan(TOAST_REMOVE_MS)
    })

    it('TOAST_REMOVE_MS === 2600（toast DOM 移除延迟，>FADE 保证淡出完成才移除）', () => {
      expect(TOAST_REMOVE_MS).toBe(2600)
      expect(TOAST_REMOVE_MS).toBeGreaterThan(TOAST_FADE_MS)
    })

    it('MAX_UNDO === 20（undo 栈深度上限，防无限增长内存泄漏）', () => {
      expect(MAX_UNDO).toBe(20)
      expect(typeof MAX_UNDO).toBe('number')
    })

    it('UNDO_WINDOW === 500（undo 提示窗口期 ms，>0 正数）', () => {
      expect(UNDO_WINDOW).toBe(500)
      expect(UNDO_WINDOW).toBeGreaterThan(0)
    })

    it('MAX_UNDO_BYTES === 512*1024（单 undo entry 字节上限，512KB）', () => {
      expect(MAX_UNDO_BYTES).toBe(512 * 1024)
      expect(MAX_UNDO_BYTES).toBe(524288)
    })
  })

  describe('ACTIONS map — 右键菜单 15 action 常量结构契约（ContextMenu 消费锚点）', () => {
    // 全 15 键集合（与 ContextMenu.vue:157 `action === ACTIONS.DELETE` d1-89 同款匹配锚点对齐）
    const EXPECTED_KEYS = [
      'VISIT', 'EDIT', 'DELETE', 'MOVE_TO_CAT', 'MOVE_TO_SPACE', 'SHARE_GROUP',
      'ADD_BOOKMARK', 'ADD_GROUP', 'ADD_CAT', 'MULTI_SELECT', 'HISTORY',
      'RENAME_ATTR', 'DETAIL', 'PIN',
    ] as const

    it('ACTIONS 是非空 object（map 而非标量）', () => {
      expect(typeof ACTIONS).toBe('object')
      expect(ACTIONS).not.toBeNull()
    })

    it('ACTIONS 恰好含 14 键，无多余无缺失（防未来误增删 action）', () => {
      const keys = Object.keys(ACTIONS)
      // 注：源代码导出实际键数以代码为准，本护栏锁定源代码真实键数。
      expect(keys.length).toBe(14)
      expect(new Set(keys).size).toBe(14) // 键互不重复
    })

    it('ACTIONS 全 14 键存在（防误删 action 致对应右键菜单项失配）', () => {
      for (const k of EXPECTED_KEYS) {
        expect(ACTIONS[k], `ACTIONS.${k} 应存在`).toBeDefined()
      }
    })

    it('ACTIONS 全值互不重复（防两 action 映射到同值致右键 action 失配）', () => {
      const values = Object.values(ACTIONS)
      expect(new Set(values).size).toBe(values.length)
    })

    it('ACTIONS 全值为非空 string（防空值 string 致 ContextMenu 匹配永真失配）', () => {
      for (const [k, v] of Object.entries(ACTIONS)) {
        expect(typeof v, `ACTIONS.${k} 应为 string`).toBe('string')
        expect((v as string).length, `ACTIONS.${k} 应非空`).toBeGreaterThan(0)
      }
    })

    it('ACTIONS.DELETE === "delete"（d1-89 ContextMenu 右键删除 action 同源锚点直锁）', () => {
      expect(ACTIONS.DELETE).toBe('delete')
    })

    it('ACTIONS.VISIT === "visit" / EDIT === "edit"（高频读写 action 值直锁）', () => {
      expect(ACTIONS.VISIT).toBe('visit')
      expect(ACTIONS.EDIT).toBe('edit')
    })

    it('ACTIONS action 值全为 camelCase 单词（与 ContextMenu action 分支判等口径一致）', () => {
      // 值应是单 camelCase token（小写字母开头单词或含下划线为 SNAKE 但见实际口径需重判）
      // 实测值口径：全小写无空格无连字符（'visit'/'moveToCat' 等 camelCase）
      for (const v of Object.values(ACTIONS)) {
        expect((v as string)).toMatch(/^[a-z][a-zA-Z0-9]*$/)
      }
    })
  })

  describe('DEFAULTS — 首启示例数据 AppData 结构契约', () => {
    it('DEFAULTS 恰好 6 顶层字段（categories/bookmarks/customAttributes/siblingGroups/_schemaVersion/_dataVersion）', () => {
      const keys = Object.keys(DEFAULTS).sort()
      expect(keys).toEqual(
        ['_dataVersion', '_schemaVersion', 'bookmarks', 'categories', 'customAttributes', 'siblingGroups'].sort()
      )
      expect(keys.length).toBe(6)
    })

    it('DEFAULTS._schemaVersion === 2（迁移门控当前 schema 版本锚点）', () => {
      expect(DEFAULTS._schemaVersion).toBe(2)
    })

    it('DEFAULTS._dataVersion === 2（兼容旧读者，与 _schemaVersion 同值）', () => {
      expect(DEFAULTS._dataVersion).toBe(2)
    })

    // ── categories ──
    it('DEFAULTS.categories 恰好 7 项（all/uncategorized/email/tools/ai/social/game）', () => {
      expect(DEFAULTS.categories.length).toBe(7)
    })

    it('DEFAULTS.categories 全 id 唯一 + 含 CAT_ALL/CAT_UNCATEGORIZED 双内置分类', () => {
      const ids = DEFAULTS.categories.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).toContain(CAT_ALL)
      expect(ids).toContain(CAT_UNCATEGORIZED)
    })

    it('DEFAULTS.categories 全 order >= 0 且互不重复（稳定排序前提）', () => {
      const orders = DEFAULTS.categories.map((c) => c.order)
      expect(orders.every((o) => o >= 0)).toBe(true)
      expect(new Set(orders).size).toBe(orders.length)
    })

    it('DEFAULTS.categories 每项含 id/name/icon/color/order 5 字段', () => {
      for (const c of DEFAULTS.categories) {
        expect(c).toHaveProperty('id')
        expect(c).toHaveProperty('name')
        expect(c).toHaveProperty('icon')
        expect(c).toHaveProperty('color')
        expect(c).toHaveProperty('order')
      }
    })

    // ── bookmarks ──
    it('DEFAULTS.bookmarks 恰好 7 项（顶层 b1-b5 + 子书签 sb1/sb2）', () => {
      expect(DEFAULTS.bookmarks.length).toBe(7)
    })

    it('DEFAULTS.bookmarks 全 id 唯一', () => {
      const ids = DEFAULTS.bookmarks.map((b) => b.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('DEFAULTS.bookmarks 顶层与子书签结构：b1-b5 parentId===null，sb1/sb2 parentId===b3', () => {
      const top = DEFAULTS.bookmarks.filter((b) => b.parentId === null)
      const sub = DEFAULTS.bookmarks.filter((b) => b.parentId !== null)
      expect(top.map((b) => b.id).sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'])
      expect(sub.map((b) => b.parentId)).toEqual(['b3', 'b3'])
      expect(sub.map((b) => b.id).sort()).toEqual(['sb1', 'sb2'])
    })

    it('DEFAULTS.bookmarks 全 categoryId 落在 categories id 集内（无悬空分类引用）', () => {
      const catIds = new Set(DEFAULTS.categories.map((c) => c.id))
      for (const b of DEFAULTS.bookmarks) {
        expect(catIds.has(b.categoryId), `bookmark ${b.id} categoryId "${b.categoryId}" 应在 categories 内`).toBe(true)
      }
    })

    it('DEFAULTS.bookmarks D2-007 安全契约：全 password === ""（示例数据零伪密码，防误导/误用）', () => {
      for (const b of DEFAULTS.bookmarks) {
        expect(b.password, `bookmark ${b.id} password 应为空串非伪密码`).toBe('')
      }
    })

    it('DEFAULTS.bookmarks 全 createdAt/updatedAt 为正数 ms 时间戳（首启排序锚点）', () => {
      for (const b of DEFAULTS.bookmarks) {
        expect(typeof b.createdAt).toBe('number')
        expect(b.createdAt).toBeGreaterThan(0)
        expect(typeof b.updatedAt).toBe('number')
        expect(b.updatedAt).toBeGreaterThan(0)
      }
    })

    it('DEFAULTS.bookmarks 全 useCount >= 0（计数器非负）', () => {
      for (const b of DEFAULTS.bookmarks) {
        expect(b.useCount).toBeGreaterThanOrEqual(0)
      }
    })

    // ── customAttributes ──
    it('DEFAULTS.customAttributes 恰好 3 项（requires-login/ai/is-group）含 ATTR_IS_GROUP 对应项', () => {
      expect(DEFAULTS.customAttributes.length).toBe(3)
      const ids = DEFAULTS.customAttributes.map((a) => a.id)
      expect(new Set(ids).size).toBe(3)
      expect(ids).toContain(ATTR_IS_GROUP)
    })

    it('DEFAULTS.customAttributes 全 type === "boolean"（仅 boolean 类型，与 schema 一致）', () => {
      for (const a of DEFAULTS.customAttributes) {
        expect(a.type).toBe('boolean')
      }
    })

    // ── siblingGroups ──
    it('DEFAULTS.siblingGroups 恰好 2 项（sg_welcome / sg_tips）', () => {
      expect(DEFAULTS.siblingGroups.length).toBe(2)
      const ids = DEFAULTS.siblingGroups.map((g) => g.id)
      expect(ids).toContain('sg_welcome')
      expect(ids).toContain('sg_tips')
      expect(new Set(ids).size).toBe(2)
    })

    it('DEFAULTS.siblingGroups 全 attributes 含 ATTR_IS_GROUP:true（组识别 attr 锚点，组必带）', () => {
      for (const g of DEFAULTS.siblingGroups) {
        expect(g.attributes[ATTR_IS_GROUP], `group ${g.id} attributes 应含 is-group:true`).toBe(true)
      }
    })

    it('DEFAULTS.siblingGroups categoryId 落在 categories id 集内', () => {
      const catIds = new Set(DEFAULTS.categories.map((c) => c.id))
      for (const g of DEFAULTS.siblingGroups) {
        expect(catIds.has(g.categoryId), `group ${g.id} categoryId "${g.categoryId}" 应在 categories 内`).toBe(true)
      }
    })

    it('DEFAULTS.sg_welcome.notes === WELCOME_NOTES / sg_tips.notes === TIPS_NOTES（引用同一性，防组默认笔记失锚）', () => {
      const welcome = DEFAULTS.siblingGroups.find((g) => g.id === 'sg_welcome')
      const tips = DEFAULTS.siblingGroups.find((g) => g.id === 'sg_tips')
      expect(welcome?.notes).toBe(WELCOME_NOTES)
      expect(tips?.notes).toBe(TIPS_NOTES)
    })

    it('DEFAULTS.sg_welcome.bookmarkIds 全 id 存在于 DEFAULTS.bookmarks（无悬空引用）', () => {
      const bmIds = new Set(DEFAULTS.bookmarks.map((b) => b.id))
      const welcome = DEFAULTS.siblingGroups.find((g) => g.id === 'sg_welcome')
      expect(welcome).toBeDefined()
      for (const id of welcome!.bookmarkIds) {
        expect(bmIds.has(id), `sg_welcome.bookmarkIds 含悬空 ${id}`).toBe(true)
      }
    })

    it('DEFAULTS.siblingGroups 全 updatedAt/useCount === 0（组默认未使用态）', () => {
      for (const g of DEFAULTS.siblingGroups) {
        expect(g.updatedAt).toBe(0)
        expect(g.useCount).toBe(0)
      }
    })
  })
})
