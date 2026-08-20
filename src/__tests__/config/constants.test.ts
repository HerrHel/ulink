/**
 * config/constants.ts — 应用层常量快照护栏（精简版）。
 *
 * 原 file 44 例逐常量逐字段镜像(存储键 string typeof 双断、魔法数 typeof number、ACTIONS
 * 全键循环+值不重复+非空 string+camelCase 形态、DEFAULTS 每结构层级各立一例)。pure const
 * 模块无分支逻辑,多数断言是计数/类型/互不重复镜像,表驱动压缩即等价覆盖。保留真实安全契约:
 *
 * outward-facing 锚点(存储键/内置分类 id/ACTIONS.DELETE)直锁——错改致旧用户数据失访或默认分类
 * 识别塌陷 + d1-89 右键 action 同源失配;D2-007 安全契约(示例书签全 password===""防伪密码)单独
 * 一例守 ——见 DEFAULTS.bookmarks 段。余结构层级合并为表驱动结构契约一例。
 *
 * 口径:constants.ts 是 ESM 命名 export,测试 import 即触发顶层 const 求值,零源文件改动。
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

describe('config/constants.ts — 应用层常量快照护栏（精简版）', () => {
  // 存储键与魔法数是 outward-facing 锚点 + UI 边界,错改有真实回归后果(旧用户数据失访/UI 行为
  // 边界漂移),但逐键 typeof 双断是冗余镜像——表驱动锁键值即等价。
  it('存储键 + 拖拽/标识 + 内置分类 id 直锁值（防误改致旧用户数据失访 + 默认分类识别塌陷）', () => {
    expect(STORAGE_KEY).toBe('linkvault_v2')
    expect(STORAGE_KEY_VAULT).toBe('linkvault_vault_v1')
    expect(STORAGE_KEY_VAULT).not.toBe(STORAGE_KEY) // 私密空间键与主键不同防回退串台
    expect(UI_STATE_KEY).toBe('lv_uiState')
    expect(PAYLOAD_KEY).toBe('application/x-linkvault')
    expect(DRAG_SRC_DETAIL).toBe('__detail__')
    expect(CAT_ALL).toBe('all')
    expect(CAT_UNCATEGORIZED).toBe('uncategorized')
    expect(CAT_UNCATEGORIZED).not.toBe(CAT_ALL)
    expect(ATTR_IS_GROUP).toBe('is-group')
  })

  it('行为边界魔法数 + 配对关系（TOAST_FADE<REMOVE 保证淡出完成才移除）', () => {
    expect(MAX_SUGGESTIONS).toBe(8)
    expect(TOAST_FADE_MS).toBe(2200)
    expect(TOAST_REMOVE_MS).toBe(2600)
    expect(TOAST_FADE_MS).toBeLessThan(TOAST_REMOVE_MS)
    expect(MAX_UNDO).toBe(20)
    expect(UNDO_WINDOW).toBe(500)
    expect(MAX_UNDO_BYTES).toBe(512 * 1024)
  })

  it('ACTIONS 17 键存在互不重复 + 全值非空 string + DELETE 同源锚点直锁（ContextMenu 右键 action 匹配）', () => {
    const keys = Object.keys(ACTIONS)
    expect(keys.length).toBe(17)
    const EXPECTED_KEYS = [
      'VISIT', 'EDIT', 'DELETE', 'MOVE_TO_CAT', 'MOVE_TO_SPACE', 'SHARE_GROUP',
      'ADD_BOOKMARK', 'ADD_GROUP', 'ADD_CAT', 'MULTI_SELECT', 'HISTORY',
      'RENAME_ATTR', 'DETAIL', 'PIN', 'COPY_URL', 'EXPAND', 'FOCUS',
    ] as const
    for (const k of EXPECTED_KEYS) expect(ACTIONS[k], `ACTIONS.${k} 应存在`).toBeDefined()
    const values = Object.values(ACTIONS)
    expect(new Set(values).size).toBe(values.length) // 值互不重复防右键 action 失配
    for (const [k, v] of Object.entries(ACTIONS)) {
      expect(typeof v, `ACTIONS.${k} 应为 string`).toBe('string')
      expect((v as string).length, `ACTIONS.${k} 应非空`).toBeGreaterThan(0)
    }
    expect(ACTIONS.DELETE).toBe('delete') // d1-89 ContextMenu 右键删除 action 同源锚点
    expect(ACTIONS.VISIT).toBe('visit')
    expect(ACTIONS.EDIT).toBe('edit')
  })

  it('DEFAULTS 顶层 6 字段 + _schemaVersion/_dataVersion 双 2（迁移门控版本锚点）', () => {
    const keys = Object.keys(DEFAULTS).sort()
    expect(keys).toEqual(
      ['_dataVersion', '_schemaVersion', 'bookmarks', 'categories', 'customAttributes', 'siblingGroups'].sort()
    )
    expect(DEFAULTS._schemaVersion).toBe(2)
    expect(DEFAULTS._dataVersion).toBe(2)
  })

  it('DEFAULTS.categories 7 项 + id 全唯一含双内置 + order 互异 + 每项 5 字段', () => {
    const cats = DEFAULTS.categories
    expect(cats.length).toBe(7)
    const ids = cats.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(CAT_ALL)
    expect(ids).toContain(CAT_UNCATEGORIZED)
    const orders = cats.map((c) => c.order)
    expect(orders.every((o) => o >= 0)).toBe(true)
    expect(new Set(orders).size).toBe(orders.length)
    for (const c of cats) {
      expect(c).toHaveProperty('id')
      expect(c).toHaveProperty('name')
      expect(c).toHaveProperty('icon')
      expect(c).toHaveProperty('color')
      expect(c).toHaveProperty('order')
    }
  })

  it('DEFAULTS.bookmarks 7 项 id 唯一 + 父子结构(parentId=null 顶层, sb1/sb2→b3) + categoryId 无悬空', () => {
    const bms = DEFAULTS.bookmarks
    expect(bms.length).toBe(7)
    const ids = bms.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    const top = bms.filter((b) => b.parentId === null).map((b) => b.id).sort()
    const sub = bms.filter((b) => b.parentId !== null)
    expect(top).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'])
    expect(sub.map((b) => b.parentId)).toEqual(['b3', 'b3'])
    expect(sub.map((b) => b.id).sort()).toEqual(['sb1', 'sb2'])
    const catIds = new Set(DEFAULTS.categories.map((c) => c.id))
    for (const b of bms) {
      expect(catIds.has(b.categoryId), `bookmark ${b.id} categoryId "${b.categoryId}" 应在 categories 内`).toBe(true)
    }
  })

  it('★DEFAULTS.bookmarks D2-007 安全契约：全 password === ""（示例数据零伪密码，防误导/误用）', () => {
    for (const b of DEFAULTS.bookmarks) {
      expect(b.password, `bookmark ${b.id} password 应为空串非伪密码`).toBe('')
    }
  })

  it('DEFAULTS.customAttributes 3 项含 ATTR_IS_GROUP + 全 type boolean', () => {
    const attrs = DEFAULTS.customAttributes
    expect(attrs.length).toBe(3)
    const ids = attrs.map((a) => a.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toContain(ATTR_IS_GROUP)
    for (const a of attrs) expect(a.type).toBe('boolean')
  })

  it('DEFAULTS.siblingGroups 2 项(sg_welcome/sg_tips) 全 attributes[is-group]:true + categoryId 无悬空', () => {
    const groups = DEFAULTS.siblingGroups
    expect(groups.length).toBe(2)
    const ids = groups.map((g) => g.id)
    expect(ids).toContain('sg_welcome')
    expect(ids).toContain('sg_tips')
    expect(new Set(ids).size).toBe(2)
    for (const g of groups) {
      expect(g.attributes[ATTR_IS_GROUP], `group ${g.id} attributes 应含 is-group:true`).toBe(true)
    }
    const catIds = new Set(DEFAULTS.categories.map((c) => c.id))
    for (const g of groups) {
      expect(catIds.has(g.categoryId), `group ${g.id} categoryId "${g.categoryId}" 应在 categories 内`).toBe(true)
    }
  })

  it('DEFAULTS 组默认 notes 引用同一性 + sg_welcome.bookmarkIds 无悬空（防组默认笔记失锚）', () => {
    const welcome = DEFAULTS.siblingGroups.find((g) => g.id === 'sg_welcome')
    const tips = DEFAULTS.siblingGroups.find((g) => g.id === 'sg_tips')
    expect(welcome?.notes).toBe(WELCOME_NOTES) // 引用同一性,防组默认笔记失锚
    expect(tips?.notes).toBe(TIPS_NOTES)
    expect(welcome).toBeDefined()
    const bmIds = new Set(DEFAULTS.bookmarks.map((b) => b.id))
    for (const id of welcome!.bookmarkIds) {
      expect(bmIds.has(id), `sg_welcome.bookmarkIds 含悬空 ${id}`).toBe(true)
    }
  })
})
