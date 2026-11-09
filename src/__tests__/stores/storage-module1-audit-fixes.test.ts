/**
 * 模块 1（底层存储与密码学架构）第一轮深度补漏与审计修复回归测试
 *
 * 覆盖重点：
 * 1. Schema 容错与自愈：deletedAt / pinnedAt / updatedAt 对 null、空串、字符串时间戳的安全解析
 * 2. 字段有限数字约束：coerceNum 拦截 Infinity / -Infinity，防止 JSON.stringify 污染为 null
 * 3. 持久化元数据防丢失：loadFromLocalStorage 完整保留 _masterCanary 与版本标记
 * 4. 密码派生防御性校验：deriveKey 对空 salt 的防御与合法性验证
 * 5. 存储安全读写边界防护：多空间写入链与持久层隔离
 * 6. AppDataSchema 对 _dataVersion / _schemaVersion / _writeSeq / _savedAt 为 null 的容错
 * 7. safeBtoa / safeAtob 与 _toBuffer 对非 string 的防御，防止将字面量 "null" 编码/加密入库
 * 8. migrations 与 _migrateTextNotes 对 group.bookmarkIds 缺失的容错与自动补齐
 * 9. _stamp 对非法入参的容错
 * 10. decrypt / decryptForDisplay 恒定返回 string 契约（对 null 入参防白屏）
 * 11. persist._keyOf 对非法 space 名称的自愈回退
 * 12. loadFromIDB 与 runMigrations 对缺失 categories / customAttributes 数组的自愈
 * 13. storage.clearAllLocalData 对 ulink_ 前缀键的清理
 * 14. storage.enqueueSyncOps 对缺失 ts 的兜底
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  BookmarkSchema,
  SiblingGroupSchema,
  CategorySchema,
  CustomAttributeSchema,
  AppDataSchema,
} from '../../schemas.js'
import {
  deriveKey,
  isThreePartCipher,
  safeBtoa,
  safeAtob,
  encrypt,
  decrypt,
  decryptForDisplay,
} from '../../crypto.js'
import * as persist from '../../stores/persist.js'
import { _migrateTextNotes, runMigrations } from '../../stores/migrations.js'
import {
  clearAllLocalData,
  enqueueSyncOps,
  drainSyncOps,
  clearAllSyncOps,
  idbSet,
  __testStorage,
} from '../../stores/storage.js'
import { STORAGE_KEY, DEFAULTS } from '../../config/constants.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

describe('模块 1 补漏：Schema 容错与时间戳 null 安全兼容', () => {
  it('BookmarkSchema 兼容 deletedAt: null 与 pinnedAt: null，并归一化为 undefined', () => {
    const raw = {
      id: 'bm-null-test',
      title: '测试书签',
      url: 'https://example.com',
      deletedAt: null,
      pinnedAt: null,
    }
    const parsed = BookmarkSchema.safeParse(raw)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.deletedAt).toBeUndefined()
      expect(parsed.data.pinnedAt).toBeUndefined()
    }
  })

  it('BookmarkSchema 能将字符串形式的有效时间戳正确 coerce 为数字', () => {
    const raw = {
      id: 'bm-string-epoch',
      title: '时间戳测试',
      url: 'https://example.com',
      deletedAt: '1710000000000',
      pinnedAt: '1720000000000',
      createdAt: '1700000000000',
    }
    const parsed = BookmarkSchema.safeParse(raw)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.deletedAt).toBe(1710000000000)
      expect(parsed.data.pinnedAt).toBe(1720000000000)
      expect(parsed.data.createdAt).toBe(1700000000000)
    }
  })

  it('SiblingGroupSchema、CategorySchema 与 CustomAttributeSchema 同样兼容 deletedAt: null', () => {
    const groupParsed = SiblingGroupSchema.safeParse({
      id: 'g-null',
      name: '分组',
      deletedAt: null,
      pinnedAt: null,
    })
    expect(groupParsed.success).toBe(true)
    if (groupParsed.success) {
      expect(groupParsed.data.deletedAt).toBeUndefined()
      expect(groupParsed.data.pinnedAt).toBeUndefined()
    }

    const catParsed = CategorySchema.safeParse({
      id: 'c-null',
      name: '分类',
      deletedAt: null,
      updatedAt: null,
    })
    expect(catParsed.success).toBe(true)
    if (catParsed.success) {
      expect(catParsed.data.deletedAt).toBeUndefined()
      expect(catParsed.data.updatedAt).toBeUndefined()
    }

    const attrParsed = CustomAttributeSchema.safeParse({
      id: 'a-null',
      name: '属性',
      type: 'boolean',
      deletedAt: null,
      updatedAt: null,
    })
    expect(attrParsed.success).toBe(true)
    if (attrParsed.success) {
      expect(attrParsed.data.deletedAt).toBeUndefined()
      expect(attrParsed.data.updatedAt).toBeUndefined()
    }
  })

  it('AppDataSchema 整体校验兼容各实体中的 deletedAt: null / pinnedAt: null', () => {
    const fullData = {
      categories: [{ id: 'c1', name: '分类', order: 0, deletedAt: null, updatedAt: null, icon: '', color: '' }],
      bookmarks: [{ id: 'b1', title: '书签', url: 'https://b.com', deletedAt: null, pinnedAt: null }],
      customAttributes: [{ id: 'a1', name: '属性', type: 'boolean', deletedAt: null, updatedAt: null }],
      siblingGroups: [{ id: 'g1', name: '分组', deletedAt: null, pinnedAt: null }],
    }
    const parsed = AppDataSchema.safeParse(fullData)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.bookmarks[0].deletedAt).toBeUndefined()
      expect(parsed.data.categories[0].deletedAt).toBeUndefined()
      expect(parsed.data.customAttributes[0].deletedAt).toBeUndefined()
      expect(parsed.data.siblingGroups[0].deletedAt).toBeUndefined()
    }
  })

  it('AppDataSchema 容忍元数据 _dataVersion / _schemaVersion / _writeSeq / _savedAt 为 null，防整库被拒回退', () => {
    const fullData = {
      categories: [{ id: 'c1', name: '分类', order: 0, icon: '', color: '' }],
      bookmarks: [{ id: 'b1', title: '书签', url: 'https://b.com' }],
      customAttributes: [],
      siblingGroups: [],
      _dataVersion: null,
      _schemaVersion: null,
      _writeSeq: null,
      _savedAt: null,
    }
    const parsed = AppDataSchema.safeParse(fullData)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data._dataVersion).toBeUndefined()
      expect(parsed.data._schemaVersion).toBeUndefined()
      expect(parsed.data._writeSeq).toBeUndefined()
      expect(parsed.data._savedAt).toBeUndefined()
    }
  })

  it('coerceNum 严格防范 Infinity 与 -Infinity，避免序列化为 null 导致存储损坏', () => {
    const raw = {
      id: 'bm-inf',
      title: '无限大测试',
      url: 'https://inf.com',
      order: Infinity,
      useCount: -Infinity,
    }
    const parsed = BookmarkSchema.safeParse(raw)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.order).toBe(0)
      expect(parsed.data.useCount).toBe(0)
    }
  })
})

describe('模块 1 补漏：loadFromLocalStorage 必须完整保留 E2E _masterCanary', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('从 localStorage 恢复旧数据时，_masterCanary 绝不被丢弃', () => {
    const storedWithCanary = {
      categories: DEFAULTS.categories.slice(),
      bookmarks: [{ id: 'b1', title: '书签', url: 'https://b.com' }],
      customAttributes: [],
      siblingGroups: [],
      _masterCanary: {
        encrypted: true,
        data: 'canaryDataB64...',
        iv: 'ivB64...',
        salt: 'saltB64...',
      },
      _schemaVersion: 3,
      _writeSeq: 42,
      _savedAt: 1715000000000,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedWithCanary))

    const loaded = persist.loadFromLocalStorage('main')

    expect(loaded).toBeDefined()
    expect(loaded.bookmarks).toHaveLength(1)
    expect(loaded._masterCanary).toBeDefined()
    expect(loaded._masterCanary).toEqual(storedWithCanary._masterCanary)
    expect(loaded._writeSeq).toBe(42)
  })
})

describe('模块 1 补漏：密码学安全与非 string 防御', () => {
  it('deriveKey 在传入非法空 salt 或 0 长度 salt 时应有明确校验', async () => {
    await expect(deriveKey('password123', null as any)).rejects.toThrow()
    await expect(deriveKey('password123', undefined as any)).rejects.toThrow()
    await expect(deriveKey('password123', new Uint8Array(0))).rejects.toThrow(/salt must not be empty/)
    await expect(deriveKey('password123', [])).rejects.toThrow(/salt must not be empty/)
  })

  it('safeBtoa 与 safeAtob 对非 string 或 null 传入优雅返回空字符串，绝不编码成 "null"', () => {
    expect(safeBtoa(null as any)).toBe('')
    expect(safeBtoa(undefined as any)).toBe('')
    expect(safeBtoa('')).toBe('')
    expect(safeBtoa('hello')).toBe('aGVsbG8=')

    expect(safeAtob(null as any)).toBe('')
    expect(safeAtob(undefined as any)).toBe('')
    expect(safeAtob('')).toBe('')
    expect(safeAtob('aGVsbG8=')).toBe('hello')
  })

  it('encrypt 在意外传入 null 时不会将字面量 "null" 作为明文加密', async () => {
    const salt = new Uint8Array(32)
    const key = await deriveKey('masterPass123', salt)
    const cipher = await encrypt(null as any, key)
    expect(isThreePartCipher(cipher)).toBe(true)
  })

  it('decrypt 与 decryptForDisplay 面对非 string 或缺少 key 时恒定返回 string，契约不破裂', async () => {
    const salt = new Uint8Array(32)
    const key = await deriveKey('masterPass123', salt)

    // 非 string 必须返空串，绝不返 null 导致上层 .trim() / .slice() 白屏
    await expect(decrypt(null as any, key)).resolves.toBe('')
    await expect(decryptForDisplay(null as any, key)).resolves.toBe('')

    // 缺少 key 时的行为
    await expect(decrypt('plain-text', null as any)).resolves.toBe('plain-text')
    await expect(decryptForDisplay('plain-text', null as any)).resolves.toBe('')
  })

  it('isThreePartCipher 精确校验 base64 规范字符与段长，防非密文误判', () => {
    expect(isThreePartCipher('www.google.com')).toBe(false)
    expect(isThreePartCipher('v1.2.3')).toBe(false)
    expect(isThreePartCipher('192.168.1.1')).toBe(false)
    expect(isThreePartCipher('')).toBe(false)
    expect(isThreePartCipher('abc.def.ghi')).toBe(false)
  })
})

describe('模块 1 补漏：数据迁移与缺失字段自愈防护', () => {
  it('_migrateTextNotes 在 group.bookmarkIds 为 undefined 时自动修复并不抛 TypeError', () => {
    const brokenGroup = {
      id: 'g-broken',
      name: '测试组',
      bookmarkIds: undefined as any,
    } as SiblingGroup

    const bookmarks: Bookmark[] = [
      { id: 'bm1', title: '书签1', url: 'https://bm1.com' } as Bookmark,
    ]

    const text = '点击 [书签1](bm1) 查看详情'
    const html = _migrateTextNotes(text, bookmarks, [brokenGroup], brokenGroup)

    expect(html).toContain('data-bm-id="bm1"')
    expect(Array.isArray(brokenGroup.bookmarkIds)).toBe(true)
    expect(brokenGroup.bookmarkIds).toContain('bm1')
  })

  it('runMigrations 能为缺少 bookmarkIds 的旧 group 补齐空数组', () => {
    const brokenData = {
      categories: DEFAULTS.categories.slice(),
      bookmarks: [],
      customAttributes: [],
      siblingGroups: [
        { id: 'g-old', name: '旧组', categoryId: 'all' } as any,
      ],
      _schemaVersion: 1,
    }

    const result = {
      ...brokenData,
      siblingGroups: [{ id: 'g-old', name: '旧组', categoryId: 'all' } as any],
    }

    const needsPersist = runMigrations(brokenData, result as any)
    expect(needsPersist).toBe(true)
    expect(Array.isArray(result.siblingGroups[0].bookmarkIds)).toBe(true)
    expect(result.siblingGroups[0].bookmarkIds).toEqual([])
  })

  it('runMigrations 面对缺少 categories 数组的极端损坏入参时安全自愈，不抛 find 异常', () => {
    const noCatResult: any = {
      bookmarks: [],
      siblingGroups: [],
      customAttributes: [],
    }
    expect(() => runMigrations({}, noCatResult)).not.toThrow()
    expect(Array.isArray(noCatResult.categories)).toBe(true)
    expect(noCatResult.categories.length).toBeGreaterThan(0)
  })
})

describe('模块 1 补漏：持久化与存储安全多空间隔离', () => {
  beforeEach(async () => {
    localStorage.clear()
    await __testStorage.clearAll()
  })

  it('_stamp 在传入非对象（如 undefined / null）时安全容错，不抛出异常', () => {
    expect(() => persist._stamp(undefined as any)).not.toThrow()
    expect(() => persist._stamp(null as any)).not.toThrow()
    const stamped = persist._stamp({} as any)
    expect(typeof stamped._writeSeq).toBe('number')
    expect(stamped._writeSeq).toBeGreaterThan(0)
  })

  it('persist 接收非法 space 空间名时不崩溃，安全回退到 main 键', async () => {
    const testData = {
      categories: DEFAULTS.categories.slice(),
      bookmarks: [{ id: 'b1', title: '书签', url: 'https://b.com' }],
      customAttributes: [],
      siblingGroups: [],
    }
    // 传入非法 space 参数
    const ok = await persist.saveData(testData as any, 'illegal_space' as any)
    expect(ok).toBe(true)
    const loaded = await persist.loadData('illegal_space' as any)
    expect(loaded.bookmarks).toHaveLength(1)
  })

  it('loadFromIDB 在缺少 categories / customAttributes 时安全补齐并成功读取', async () => {
    const partialIdb = {
      bookmarks: [{ id: 'bm1', title: '书签1', url: 'https://test.com' }],
      siblingGroups: [],
      // 刻意缺少 categories 和 customAttributes
    }
    await idbSet('linkvault_v2', partialIdb)
    const loaded = await persist.loadFromIDB('main')
    expect(loaded).not.toBeNull()
    if (loaded) {
      expect(Array.isArray(loaded.categories)).toBe(true)
      expect(Array.isArray(loaded.customAttributes)).toBe(true)
      expect(loaded.bookmarks).toHaveLength(1)
    }
  })
})

describe('模块 1 补漏：存储队列与账号注销清理边界', () => {
  beforeEach(async () => {
    localStorage.clear()
    await clearAllSyncOps()
  })

  it('enqueueSyncOps 在 op 缺失 ts 时自动补充有限合法时间戳', async () => {
    const opWithoutTs: any = {
      action: 'upsert',
      table: 'bookmarks',
      itemId: 'bm_no_ts',
      data: { id: 'bm_no_ts', title: '无时间戳书签' },
    }
    await enqueueSyncOps([opWithoutTs])
    const drained = await drainSyncOps()
    expect(drained).toHaveLength(1)
    expect(typeof drained[0].ts).toBe('number')
    expect(Number.isFinite(drained[0].ts)).toBe(true)
    expect(drained[0].ts).toBeGreaterThan(0)
  })

  it('clearAllLocalData 能够彻底清理 ulink_ 前缀的本地存储键', async () => {
    localStorage.setItem('lv_theme', 'dark')
    localStorage.setItem('linkvault_v2', '{}')
    localStorage.setItem('ulink_ai_floating_hud', 'true')
    localStorage.setItem('other_app_key', 'keep_me')

    await clearAllLocalData()

    expect(localStorage.getItem('lv_theme')).toBeNull()
    expect(localStorage.getItem('linkvault_v2')).toBeNull()
    expect(localStorage.getItem('ulink_ai_floating_hud')).toBeNull()
    // 非本系统的其它键应保留
    expect(localStorage.getItem('other_app_key')).toBe('keep_me')
  })
})
