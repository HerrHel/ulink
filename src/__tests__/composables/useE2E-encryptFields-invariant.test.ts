/**
 * 护栏：useE2E.ENCRYPT_FIELDS 字段集内容契约不变量。
 *
 * ENCRYPT_FIELDS（src/composables/domain/useE2E.ts:60）是 E2E 加密同步的安全契约核心：
 * syncPush `_opNeedsUnlock` 对 push 的每条 op 查 `ENCRYPT_FIELDS[type]` 判定敏感字段，
 * encryptItem（useE2E.ts:321）对命中的字段加密成三段密文串再推云。
 *
 * 加密范围已收窄为仅 username（真凭证字段），notes/name 移入 LEGACY_DECRYPT_FIELDS。
 * 此护栏同时锁 LEGACY_DECRYPT_FIELDS 的内容，确保 notes/name 在 legacy 补解通道中。
 *
 * 此前护栏覆盖面：syncMappingTables.test.ts:117 已锁「全 4 表名经 tableToEntityType 映射
 * 防未知表静默放行密文」（type 永不 undefined → sens 必经真路径），但 **ENCRYPT_FIELDS 自身的
 * 字段集内容零直接断言**——任何实体把字段加错/删错都不会让测试告警：
 *
 * - bookmark.username 是用户隐私字段，push 前加密推云；
 * - **password 故意不在 bookmark.ENCRYPT_FIELDS**——它是 EncryptedPassword 对象态走独立
 *   加密 path（encryptPassword 生成对象，非 encryptItem 三段串），BookmarkCard.vue:150 注释
 *   明确依赖「对象态不在 ENCRYPT_FIELDS、不会被补解密扫到」。若误把 password 加进表，
 *   syncPush 会对 EncryptedPassword 对象二次加密破坏展示链路，且无护栏告警；
 * - category/attribute 字段集为空——push 只 bump updatedAt 不加密分类名/属性名（useE2E.ts:457
 *   注释明确此语义）。若误加字段会改变分类同步契约让分类名变密文。
 *
 * 纯加测试零源改：ENCRYPT_FIELDS 已 export useE2E.ts:60，仅 import 断言内容。
 */
import { describe, expect, it } from 'vitest'
import type { EntityType } from '../../types.js'
import { ENCRYPT_FIELDS, LEGACY_DECRYPT_FIELDS } from '../../composables/domain/useE2E.js'

const ALL_ENTITIES: readonly EntityType[] = ['bookmark', 'group', 'category', 'attribute']

// ENCRYPT_FIELDS[t] 的字面类型并集为 readonly never[]（空 as const 推断），
// 直接 .includes/.toContain 会让 TS 把参数推断成 never 报 TS2345。
// 统一展开成 string[] 再调，绕开窄化并还原真实 string 元素约束。
const fieldsOf = (t: EntityType): readonly string[] => Array.from(ENCRYPT_FIELDS[t])
const legacyFieldsOf = (t: EntityType): readonly string[] => Array.from(LEGACY_DECRYPT_FIELDS[t])

describe('ENCRYPT_FIELDS 字段集内容契约（E2E 加密同步安全不变量）', () => {
  describe('全实体 key 存在性（防误删让 ENCRYPT_FIELDS[type] 返 undefined）', () => {
    it('四个 EntityType 各自有对应 key', () => {
      for (const t of ALL_ENTITIES) {
        expect(ENCRYPT_FIELDS).toHaveProperty(t)
      }
    })

    it('ENCRYPT_FIELDS 恰好含 4 个 EntityType key，无多余/缺失', () => {
      expect(Object.keys(ENCRYPT_FIELDS).sort()).toEqual(
        ['bookmark', 'group', 'category', 'attribute'].sort(),
      )
    })

    it('每个实体的字段值均为数组（防误改成非数组让 .some/isArray 检查塌陷）', () => {
      for (const t of ALL_ENTITIES) {
        expect(Array.isArray(fieldsOf(t))).toBe(true)
      }
    })
  })

  describe('bookmark 字段集恰好 [username]——password 不在表（核心安全不变量）', () => {
    it('bookmark ENCRYPT_FIELDS 内容为 [username] 顺序', () => {
      expect([...ENCRYPT_FIELDS.bookmark]).toEqual(['username'])
    })

    it('password 不在 bookmark ENCRYPT_FIELDS（EncryptedPassword 走独立 path）', () => {
      // BookmarkCard.vue:150 注释依赖此不变量：「对象态不在 ENCRYPT_FIELDS、不会被补解密扫到」。
      // 若误把 password 加进表，syncPush encryptItem 会对 EncryptedPassword 对象二次加密，
      // 破坏 unlock 后 BookmarkCard.decodePassword 的展示链路。直锁防回归。
      expect(fieldsOf('bookmark')).not.toContain('password')
    })

    it('bookmark ENCRYPT_FIELDS 不含 title/url/notes（它们属 legacy 解密、push 不再加密）', () => {
      // LEGACY_DECRYPT_FIELDS.bookmark = ['title','url','notes']（useE2E.ts:73）与 ENCRYPT_FIELDS 互斥：
      // 历史密文 pull 时补解密，但 push 不再加密让云端明文几轮覆盖。防误把 legacy 字段挪进 ENCRYPT_FIELDS。
      expect(fieldsOf('bookmark')).not.toContain('title')
      expect(fieldsOf('bookmark')).not.toContain('url')
      expect(fieldsOf('bookmark')).not.toContain('notes')
    })
  })

  describe('group 字段集为空（组名已移入 LEGACY_DECRYPT_FIELDS）', () => {
    it('group ENCRYPT_FIELDS 内容为空数组', () => {
      expect([...ENCRYPT_FIELDS.group]).toEqual([])
    })

    it('group ENCRYPT_FIELDS 不含 name/notes/bookmarkIds/order', () => {
      // name/notes 已移入 LEGACY_DECRYPT_FIELDS.group；bookmarkIds 是组关系数据 push 同步明文。
      expect(fieldsOf('group')).not.toContain('name')
      expect(fieldsOf('group')).not.toContain('notes')
      expect(fieldsOf('group')).not.toContain('bookmarkIds')
      expect(fieldsOf('group')).not.toContain('order')
    })
  })

  describe('category/attribute 字段集恰为空（push 只 bump updatedAt 不加密）', () => {
    it('category ENCRYPT_FIELDS 为空数组', () => {
      // useE2E.ts:457 注释：category/attribute 字段集空，仅 bump updatedAt。
      // 若误加 'name' 会让分类名加密改变同步契约。
      expect([...ENCRYPT_FIELDS.category]).toEqual([])
    })

    it('attribute ENCRYPT_FIELDS 为空数组', () => {
      expect([...ENCRYPT_FIELDS.attribute]).toEqual([])
    })

    it('category ENCRYPT_FIELDS 不含 name', () => {
      expect(fieldsOf('category')).not.toContain('name')
    })

    it('attribute ENCRYPT_FIELDS 不含 name', () => {
      expect(fieldsOf('attribute')).not.toContain('name')
    })
  })

  describe('跨实体安全不变量', () => {
    it('password 不出现在任何实体的 ENCRYPT_FIELDS（全局守卫）', () => {
      // BookmarkCard.vue:150 注释依赖：对象态 password 全局不入 ENCRYPT_FIELDS。
      // 任一实体（哪怕误加到 group/category）都会破坏 EncryptedPassword 展示语义。
      for (const t of ALL_ENTITIES) {
        expect(fieldsOf(t)).not.toContain('password')
      }
    })

    it('notes 不在任何实体的 ENCRYPT_FIELDS（已移入 LEGACY_DECRYPT_FIELDS）', () => {
      const withNotes = ALL_ENTITIES.filter(t => fieldsOf(t).includes('notes'))
      expect(withNotes).toEqual([])
    })

    it('字段集无重复元素（防误改加进重复字段让 encryptItem 跑两次）', () => {
      for (const t of ALL_ENTITIES) {
        const fields = fieldsOf(t)
        // toContain 重复仅靠集合去重会掩盖重复，逐字比较 length。
        expect(fields.length).toBe(new Set(fields).size)
      }
    })
  })

  describe('LEGACY_DECRYPT_FIELDS 字段集契约（单向迁移补解通道）', () => {
    it('四个 EntityType 各自有对应 key', () => {
      for (const t of ALL_ENTITIES) {
        expect(LEGACY_DECRYPT_FIELDS).toHaveProperty(t)
      }
    })

    it('bookmark LEGACY_DECRYPT_FIELDS 含 title/url/notes', () => {
      expect([...LEGACY_DECRYPT_FIELDS.bookmark]).toEqual(['title', 'url', 'notes'])
    })

    it('group LEGACY_DECRYPT_FIELDS 含 name/notes', () => {
      expect([...LEGACY_DECRYPT_FIELDS.group]).toEqual(['name', 'notes'])
    })

    it('category LEGACY_DECRYPT_FIELDS 含 name', () => {
      expect([...LEGACY_DECRYPT_FIELDS.category]).toEqual(['name'])
    })

    it('attribute LEGACY_DECRYPT_FIELDS 含 name', () => {
      expect([...LEGACY_DECRYPT_FIELDS.attribute]).toEqual(['name'])
    })

    it('username 不在任何 LEGACY_DECRYPT_FIELDS（仍属 ENCRYPT_FIELDS，不重复进 legacy）', () => {
      for (const t of ALL_ENTITIES) {
        expect(legacyFieldsOf(t)).not.toContain('username')
      }
    })

    it('字段集无重复元素', () => {
      for (const t of ALL_ENTITIES) {
        const fields = legacyFieldsOf(t)
        expect(fields.length).toBe(new Set(fields).size)
      }
    })
  })
})
