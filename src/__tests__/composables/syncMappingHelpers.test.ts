/**
 * syncMappingHelpers.test.ts — useSyncMapping 辅助纯函数护栏
 *
 * 锁定两个被生产写路径依赖、但此前从未直接单测的纯函数：
 * - camelToSnake：本地 camelCase 字段名 → 远端 snake_case 列名。被 syncPush
 *   序列化时逐字段调用，SPECIAL_SNAKE 表里 createdAt/updatedAt 映射成
 *   created_at_num/updated_at_num（带 _num 后缀，与默认正则输出不一致），
 *   这是远端 BIGINT 列名契约——任何一处映射漂移都会让 push 写错列 / pull 读错列。
 * - parseTimestamp：远端时间戳回程解析。number 透传、合法 ISO/日期串解析成
 *   毫秒、非法串/非 number-or-string 兜底 0。fromRemote* 的 deletedAt 等字段
 *   全依赖它把远端值归一成 number；非法输入返 0 而非 NaN 是数据完整性护栏。
 *
 * 两个函数此前仅在 syncMapping.test.ts:273 行注释里间接触达 ISO→number 一条路径，
 * 从未直接覆盖全部分支；补独立单测锁契约，零逻辑改动。
 */
import { describe, it, expect } from 'vitest'
import { camelToSnake, parseTimestamp } from '../../composables/domain/useSyncMapping.js'

describe('camelToSnake — 字段名映射契约', () => {
  // SPECIAL_SNAKE 表：与默认正则输出有偏差或需固化的特殊映射
  describe('SPECIAL_SNAKE 特殊映射表', () => {
    it('createdAt → created_at_num（带 _num 后缀，特别要锁——默认正则只会输出 created_at）', () => {
      expect(camelToSnake('createdAt')).toBe('created_at_num')
    })
    it('updatedAt → updated_at_num（同 createdAt，_num 后缀是远端 BIGINT 列名契约）', () => {
      expect(camelToSnake('updatedAt')).toBe('updated_at_num')
    })
    it('deletedAt → deleted_at', () => {
      expect(camelToSnake('deletedAt')).toBe('deleted_at')
    })
    it('categoryId → category_id', () => {
      expect(camelToSnake('categoryId')).toBe('category_id')
    })
    it('parentId → parent_id', () => {
      expect(camelToSnake('parentId')).toBe('parent_id')
    })
    it('useCount → use_count', () => {
      expect(camelToSnake('useCount')).toBe('use_count')
    })
    it('isExpanded → is_expanded', () => {
      expect(camelToSnake('isExpanded')).toBe('is_expanded')
    })
    it('bookmarkIds → bookmark_ids', () => {
      expect(camelToSnake('bookmarkIds')).toBe('bookmark_ids')
    })
    it('isPublic → is_public', () => {
      expect(camelToSnake('isPublic')).toBe('is_public')
    })
    it('groupIds → group_ids', () => {
      expect(camelToSnake('groupIds')).toBe('group_ids')
    })
  })

  describe('通用正则分支（camelCase → snake_case）', () => {
    it('单驼峰: myField → my_field', () => {
      expect(camelToSnake('myField')).toBe('my_field')
    })
    it('多驼峰: myFieldName → my_field_name', () => {
      expect(camelToSnake('myFieldName')).toBe('my_field_name')
    })
    it('title → title（无大写原样透传）', () => {
      expect(camelToSnake('title')).toBe('title')
    })
    it('url → url（无大写原样透传）', () => {
      expect(camelToSnake('url')).toBe('url')
    })
    it('id → id（无大写原样透传）', () => {
      expect(camelToSnake('id')).toBe('id')
    })
    it('连续大写首字母也被加下划线: AField → a_field（正则逐字符匹配）', () => {
      // 正则 /([A-Z])/g 对每个大写无差别插下划线再 toLowerCase
      expect(camelToSnake('AField')).toBe('_a_field')
    })
  })
})

describe('parseTimestamp — 时间戳回程解析', () => {
  it('number 原样透传', () => {
    expect(parseTimestamp(1234567890)).toBe(1234567890)
    expect(parseTimestamp(0)).toBe(0)
    expect(parseTimestamp(-1)).toBe(-1)
  })
  it('合法 ISO 字符串 → Date.parse 毫秒数', () => {
    expect(parseTimestamp('2024-01-01T00:00:00Z')).toBe(Date.parse('2024-01-01T00:00:00Z'))
  })
  it('合法日期串 → 毫秒数', () => {
    expect(parseTimestamp('2024-01-01')).toBe(Date.parse('2024-01-01'))
  })
  it('非法字符串 → 0（兜底，不返 NaN）', () => {
    expect(parseTimestamp('not a date')).toBe(0)
    expect(parseTimestamp('')).toBe(0)
  })
  it('null → 0（非 number/string 兜底）', () => {
    expect(parseTimestamp(null)).toBe(0)
  })
  it('undefined → 0（非 number/string 兜底）', () => {
    expect(parseTimestamp(undefined)).toBe(0)
  })
  it('对象 → 0（非 number/string 兜底）', () => {
    expect(parseTimestamp({})).toBe(0)
    expect(parseTimestamp({ t: 123 })).toBe(0)
  })
  it('数组 → 0（非 number/string 兜底）', () => {
    expect(parseTimestamp([1, 2, 3])).toBe(0)
  })
})
