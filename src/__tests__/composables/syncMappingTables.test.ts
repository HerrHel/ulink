/**
 * syncMappingTables.test.ts — 实体类型 ↔ 表名映射常量护栏
 *
 * 锁定三个被生产写路径 / 锁定态防推密文判定 / push 加密路径查表依赖、
 * 但此前从未直接单测的常量映射表（见 D1-8 syncMappingHelpers 同口径姐妹表）：
 * - tableToEntityType：record='bookmarks'|'sibling_groups'|'categories'|
 *   'custom_attributes' → EntityType='bookmark'|'group'|'category'|'attribute'。
 *   被 syncPush._opNeedsUnlock（锁定态判定该 upsert 是否需等解密——选错 EntityType
 *   会误查 ENCRYPT_FIELDS 表把仍加密的敏感字段静默明文推云）+ pushFromQueue
 *   （选 EntityType 决定 push 加密路径）读取。任一表项漂移会让 push 加密选错路径。
 * - entityTypeToTable：反向映射。被 enqueue 选目标表时查表，漂移会让 op enqueue 进错表。
 * - SYNC_ENTITY_ORDER：reconcile/push 实体顺序 ['category','bookmark','group','attribute']。
 *   漂移会让 dependent 实体（属性依赖书签、组依赖成员）处理顺序错乱。
 *
 * 三表此前仅经 syncPush/syncPull 端到端间接调 tableToEntityType，表项本身零直测；
 * 表名↔实体类型双向查表的「对称性 + 全覆盖」这一核心契约靠口头维护——
 * 未来若有人改 EntityType 联合类型却忘了同步 record 初始化、或漏写一项，
 *   tableToEntityType[漏写表] 会是 undefined → _opNeedsUnlock 把所有敏感字段误判为
 *   无需加密 → 静默明文推云（同 D1-8 camelToSnake 字段名漂移导致"写错列"的同源安全语义）。
 * 补独立单测锁表项对称性 + 完整性，零逻辑改动（仅 import 已 export 常量）。
 */
import { describe, it, expect } from 'vitest'
import {
  tableToEntityType,
  entityTypeToTable,
  SYNC_ENTITY_ORDER,
} from '../../composables/domain/syncMappingTables.js'

describe('tableToEntityType — 表名 → 实体类型映射契约', () => {
  it('四表各自映射到正确单数 EntityType', () => {
    expect(tableToEntityType.bookmarks).toBe('bookmark')
    expect(tableToEntityType.sibling_groups).toBe('group')
    expect(tableToEntityType.categories).toBe('category')
    expect(tableToEntityType.custom_attributes).toBe('attribute')
  })

  it('覆盖全部四种 TableName 联合类型，无遗漏表项（防新增/改名 EntityType 后漏同步 record）', () => {
    // 与 src/types.ts EntityType 联合类型对齐的全表清单——任一表项漏写会让查表得 undefined
    const allTables = ['bookmarks', 'sibling_groups', 'categories', 'custom_attributes'] as const
    for (const t of allTables) {
      expect(tableToEntityType[t]).toBeDefined()
      expect(typeof tableToEntityType[t]).toBe('string')
    }
  })
})

describe('entityTypeToTable — 实体类型 → 表名反向映射契约', () => {
  it('四 EntityType 各自映射到正确的复数 TableName', () => {
    expect(entityTypeToTable.bookmark).toBe('bookmarks')
    expect(entityTypeToTable.group).toBe('sibling_groups')
    expect(entityTypeToTable.category).toBe('categories')
    expect(entityTypeToTable.attribute).toBe('custom_attributes')
  })

  it('覆盖全部四种 EntityType 联合类型，无遗漏（防 reverse 查表得 undefined 选错目标表）', () => {
    const allTypes = ['bookmark', 'group', 'category', 'attribute'] as const
    for (const t of allTypes) {
      expect(entityTypeToTable[t]).toBeDefined()
      expect(typeof entityTypeToTable[t]).toBe('string')
    }
  })
})

describe('table↔entity 双向映射对称性 — 核心契约（防两表各自漂移致双向查表不一致）', () => {
  it('tableToEntityType[表] = 类型 ⟺ entityTypeToTable[类型] = 表（全四对双向自洽）', () => {
    const allTables = ['bookmarks', 'sibling_groups', 'categories', 'custom_attributes'] as const
    for (const table of allTables) {
      const entity = tableToEntityType[table]
      expect(entityTypeToTable[entity]).toBe(table)
    }
  })

  it('反向同样自洽：entityTypeToTable[类型] = 表 ⟺ tableToEntityType[表] = 类型', () => {
    const allTypes = ['bookmark', 'group', 'category', 'attribute'] as const
    for (const entity of allTypes) {
      const table = entityTypeToTable[entity]
      expect(tableToEntityType[table]).toBe(entity)
    }
  })

  it('两 record 占用空间等大（键数一致，防单向增删表/entity 后两表行数漂移）', () => {
    expect(Object.keys(tableToEntityType).length).toBe(Object.keys(entityTypeToTable).length)
    expect(Object.keys(tableToEntityType).length).toBe(4)
    expect(Object.keys(entityTypeToTable).length).toBe(4)
  })
})

describe('SYNC_ENTITY_ORDER — reconcile/push 实体处理顺序契约', () => {
  it('包含全部四种 EntityType（无遗漏成员，顺序错乱会让 dependent 实体处理时序不对）', () => {
    const order = SYNC_ENTITY_ORDER
    const set = new Set(order)
    expect(set.size).toBe(4)
    expect(set.has('bookmark')).toBe(true)
    expect(set.has('group')).toBe(true)
    expect(set.has('category')).toBe(true)
    expect(set.has('attribute')).toBe(true)
  })

  it('每个成员是合法 EntityType（防漂入未声明 EntityType 的脏值）', () => {
    const validEntities = new Set(['bookmark', 'group', 'category', 'attribute'])
    for (const e of SYNC_ENTITY_ORDER) {
      expect(validEntities.has(e)).toBe(true)
    }
  })

  it('category 排在 bookmark 之前（历史依赖顺序：分类先于书签/组对齐建表，注释明确无硬依赖但保持顺序）', () => {
    const catIdx = SYNC_ENTITY_ORDER.indexOf('category')
    const bmIdx = SYNC_ENTITY_ORDER.indexOf('bookmark')
    expect(catIdx).toBeLessThan(bmIdx)
  })

  it('无重复实体（防 reconcile 循环里同一实体被处理两次）', () => {
    expect(SYNC_ENTITY_ORDER.length).toBe(new Set(SYNC_ENTITY_ORDER).size)
  })
})

describe('tableToEntityType 与 ENCRYPT_FIELDS 协同面的表名契约（防未知表静默放行密文）', () => {
  // _opNeedsUnlock 实现里 `const type = tableToEntityType[op.table as TableName]` 后
  // `const sens = type ? ENCRYPT_FIELDS[type] : undefined`——若 table 名漂到 record
  // 之外，type 为 undefined → sens 为 undefined → `!sens` 提前 return false，
  // 即「未知表名静默放行不判定」。虽然 op.table 在生产限 TableName 联合类型不会漂，
  // 但 record 静态装配时类型系统是 TS-only，运行时未断言。这里用 record 的
  // 「全 4 表都有 type 映射」出面间接保证：只要 op.table ∈ 现有 4 表，type 永不 undefined，
  // 敏感字段判定必经 ENCRYPT_FIELDS 真实路径而非静默 false 短路。
  it('全部四种 TableName 在 tableToEntityType 都有非空 EntityType 映射（防 push 端静默放行）', () => {
    const allTables = ['bookmarks', 'sibling_groups', 'categories', 'custom_attributes'] as const
    for (const t of allTables) {
      const type = tableToEntityType[t]
      // type 既已断言 defined 且为非空字符串，确保 push 路径会进入 ENCRYPT_FIELDS[type] 真实判定
      expect(type).toBeTruthy()
      expect(type).not.toBe('')
    }
  })
})
