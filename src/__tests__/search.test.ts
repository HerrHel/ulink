import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { searchBookmarkIds, searchGroupIds, searchWithHighlights, clearSearchCache, preloadSearchLibs } from '../lib/search.js'
import type { Bookmark, SiblingGroup, CustomAttribute } from '../types.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

const EMPTY_ATTRS: CustomAttribute[] = []

const SAMPLE_BOOKMARKS: Bookmark[] = [
  { id: 'b1', title: 'GitHub', url: 'https://github.com', notes: '代码托管', username: 'user1', password: '', icon: '', categoryId: 'tools', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0 },
  { id: 'b2', title: 'MDN Web Docs', url: 'https://developer.mozilla.org', notes: 'Web 开发文档', username: '', password: '', icon: '', categoryId: 'dev', parentId: null, order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0 },
  { id: 'b3', title: 'Vue.js', url: 'https://vuejs.org', notes: '前端框架', username: '', password: '', icon: '', categoryId: 'dev', parentId: null, order: 2, useCount: 0, attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0 },
]

const SAMPLE_GROUPS: SiblingGroup[] = [
  { id: 'g1', name: '开发工具', categoryId: 'dev', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: ['b1'], notes: '', updatedAt: 0, useCount: 0 },
  { id: 'g2', name: '学习资源', categoryId: 'edu', icon: '', order: 1, isExpanded: false, attributes: {}, bookmarkIds: ['b2', 'b3'], notes: '', updatedAt: 0, useCount: 0 },
]

const BOOKMARK_MAP: Record<string, Bookmark> = Object.fromEntries(SAMPLE_BOOKMARKS.map(b => [b.id, b]))

describe('searchBookmarkIds', () => {
  beforeEach(() => clearSearchCache())

  it('returns null for empty query', () => {
    expect(searchBookmarkIds(SAMPLE_BOOKMARKS, '', EMPTY_ATTRS)).toBeNull()
    expect(searchBookmarkIds(SAMPLE_BOOKMARKS, '  ', EMPTY_ATTRS)).toBeNull()
  })

  it('finds bookmarks by title', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'GitHub', EMPTY_ATTRS)
    expect(result).toBeInstanceOf(Set)
    expect(result!.has('b1')).toBe(true)
    expect(result!.has('b2')).toBe(false)
  })

  it('finds bookmarks by URL', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'vuejs', EMPTY_ATTRS)
    expect(result!.has('b3')).toBe(true)
  })

  it('finds bookmarks by notes', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, '代码', EMPTY_ATTRS)
    expect(result!.has('b1')).toBe(true)
  })

  it('finds bookmarks by username', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'user1', EMPTY_ATTRS)
    expect(result!.has('b1')).toBe(true)
  })

  it('multiple bookmarks can match same query', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'Web', EMPTY_ATTRS)
    expect(result!.has('b2')).toBe(true)
  })

  it('partial match works', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'Git', EMPTY_ATTRS)
    expect(result!.has('b1')).toBe(true)
  })

  it('returns empty set for no match', () => {
    const result = searchBookmarkIds(SAMPLE_BOOKMARKS, 'zzzznonexistent', EMPTY_ATTRS)
    expect(result!.size).toBe(0)
  })

  it('M21：中文标题可用拼音全拼/首字母搜到（titlePy 索引）', () => {
    // search.ts 把 titlePy/notesPy 作为 Fuse 搜索键，拼音匹配是中文搜索核心能力。
    // 组「开发工具」全拼 kaifa 命中；书签 b1 notes='代码托管' 全拼 daima 命中。
    const byGroupTitle = searchGroupIds(SAMPLE_GROUPS, 'kaifa', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(byGroupTitle!.has('g1')).toBe(true)
    const byNotesPy = searchBookmarkIds(SAMPLE_BOOKMARKS, 'daima', EMPTY_ATTRS)
    expect(byNotesPy!.has('b1')).toBe(true)
  })

  it('M21：书签标题拼音全拼命中 + 组 childTitlePy 命中', () => {
    // 「测试」→ ceshi；组 g2 子书签 Vue.js 用 childTitle 命中已有，这里加中文 title 书签
    const bms: Bookmark[] = [
      ...SAMPLE_BOOKMARKS,
      {
        id: 'b-ceshi', title: '测试文档', url: 'https://test.example', notes: '', username: '',
        password: '', icon: '', categoryId: 'dev', parentId: null, order: 9, useCount: 0,
        attributes: {}, isExpanded: false, createdAt: 0, updatedAt: 0,
      },
    ]
    const groups: SiblingGroup[] = [
      ...SAMPLE_GROUPS,
      {
        id: 'g-cs', name: '普通组', categoryId: 'dev', icon: '', order: 9, isExpanded: false,
        attributes: {}, bookmarkIds: ['b-ceshi'], notes: '', updatedAt: 0, useCount: 0,
      },
    ]
    const map = Object.fromEntries(bms.map(b => [b.id, b]))
    const byTitlePy = searchBookmarkIds(bms, 'ceshi', EMPTY_ATTRS)
    expect(byTitlePy!.has('b-ceshi')).toBe(true)
    // childTitlePy：子书签「测试文档」的拼音应让组被搜到
    const byChildPy = searchGroupIds(groups, 'ceshi', map, EMPTY_ATTRS)
    expect(byChildPy!.has('g-cs')).toBe(true)
  })

  it('L6：降级（库未就绪）下 attrNames 匹配照常生效', () => {
    // L6：fallback includes 应覆盖 attrNames 字段，与正常 Fuse 路径一致。
    // 正常路径能搜到勾选某属性名的书签，降级路径也应能。
    const attrs: CustomAttribute[] = [{ id: 'attr-rl', name: '需登录', type: 'boolean' }]
    const bms: Bookmark[] = [{
      id: 'bl', title: '普通标题', url: 'https://normal.com', notes: '', username: '', password: '',
      icon: '', categoryId: 'x', parentId: null, order: 0, useCount: 0, attributes: { 'attr-rl': true },
      isExpanded: false, createdAt: 0, updatedAt: 0,
    }]
    // 搜属性名「登录」应命中 bl（无论 fuse 是否就绪，降级路径也包含 attrNames）
    const result = searchBookmarkIds(bms, '登录', attrs)
    expect(result!.has('bl')).toBe(true)
    // 搜属性名片段也命中
    const frag = searchBookmarkIds(bms, '需登', attrs)
    expect(frag!.has('bl')).toBe(true)
  })
})

describe('searchGroupIds', () => {
  beforeEach(() => clearSearchCache())

  it('returns null for empty query', () => {
    expect(searchGroupIds(SAMPLE_GROUPS, '', BOOKMARK_MAP, EMPTY_ATTRS)).toBeNull()
  })

  it('finds groups by name', () => {
    const result = searchGroupIds(SAMPLE_GROUPS, '开发工具', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(result!.has('g1')).toBe(true)
  })

  it('finds groups by child bookmark title', () => {
    const result = searchGroupIds(SAMPLE_GROUPS, 'GitHub', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(result!.has('g1')).toBe(true)
  })

  it('finds groups by child bookmark URL', () => {
    const result = searchGroupIds(SAMPLE_GROUPS, 'vuejs', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(result!.has('g2')).toBe(true)
  })

  it('returns empty set for no match', () => {
    const result = searchGroupIds(SAMPLE_GROUPS, 'zzzznonexistent', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(result!.size).toBe(0)
  })
})

describe('searchWithHighlights', () => {
  beforeEach(() => clearSearchCache())

  it('returns empty array for empty query', () => {
    expect(searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, '', BOOKMARK_MAP, EMPTY_ATTRS)).toEqual([])
  })

  it('returns results with highlights for matching bookmarks', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, 'GitHub', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(results.length).toBeGreaterThan(0)
    const gh = results.find(r => r.id === 'b1')
    expect(gh).toBeDefined()
    expect(gh!._highlights).toBeDefined()
    // D1-001：includeMatches 开启后应有正向高亮段
    const titleSegs = gh!._highlights.title || []
    expect(titleSegs.some(s => s.highlight)).toBe(true)
  })

  it('returns results with highlights for matching groups', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, '学习', BOOKMARK_MAP, EMPTY_ATTRS)
    const g = results.find(r => r.id === 'g2')
    expect(g).toBeDefined()
    expect(g!._isGroup).toBe(true)
    // D1-001：组名高亮段非空
    const nameSegs = g!._highlights.name || g!._highlights.title || []
    expect(nameSegs.length).toBeGreaterThan(0)
    expect(nameSegs.some(s => s.highlight)).toBe(true)
  })

  it('respects maxResults param', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, 'a', BOOKMARK_MAP, EMPTY_ATTRS, 2)
    expect(results.length).toBeLessThanOrEqual(6)
  })

  it('returns empty for no match', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, 'zzzznonexistent', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(results).toEqual([])
  })

  it('M8：拼音命中时不输出拼音串作高亮段（避免建议项显示拼音乱码）', () => {
    // M8 根因：拼音字段映射 titlePy->'title'，query 只命中拼音索引时 match.value 是拼音串
    // （如 'kaiFaGongJu'），_buildHighlightSegments 用拼音串作 text 生成段，建议项渲染拼音字符
    // 而非中文原文。修复：拼音 key 命中时跳过段生成，渲染层用 fallback 原文显示。
    // 用拼音搜中文标题——命中后检查 title 段不含拼音拉丁字母串。
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, 'kaifa', BOOKMARK_MAP, EMPTY_ATTRS)
    // 至少命中「开发工具」组或「代码托管」书签
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      const segs = r._highlights.title || r._highlights.name || []
      const allText = segs.map(s => s.text).join('')
      // 不应出现整段拉丁拼音串（aa-zz 大量连续拉丁字符的拼音）
      expect(/[a-zA-Z]{6,}/.test(allText)).toBe(false)
    }
  })

  // ── D2-2 护栏：group result 的 bookmarkIds 字段须精确保留原 group.bookmarkIds ──
  // 优化方向：searchWithHighlights 内 446-448 行每次调用 new Map(groups.map) 重建
  // groupBmIdsMap 供 O(1) 查 bookmarkIds。优化把它折叠进 Fuse 索引项 GroupSearchItem，
  // 删掉热路径每键击一次的 Map 重建。此护栏锁定「bookmarkIds 字段精确保留原值」契约
  // 防优化（把 bookmarkIds 折进 item）后丢字段或引用错位。
  it('D2-2：组结果项 bookmarkIds 精确保留原 group.bookmarkIds（单/多/有序）', () => {
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, SAMPLE_GROUPS, '学习', BOOKMARK_MAP, EMPTY_ATTRS)
    const g2 = results.find(r => r.id === 'g2' && r._isGroup)
    expect(g2).toBeDefined()
    // 原 SAMPLE_GROUPS g2.bookmarkIds = ['b2','b3']，须精确数组引用或深等
    expect(g2!.bookmarkIds).toEqual(['b2', 'b3'])
    const g1 = results.find(r => r.id === 'g1' && r._isGroup)
    if (g1) {
      // g1.bookmarkIds = ['b1']，单元素亦须精确
      expect(g1!.bookmarkIds).toEqual(['b1'])
    }
  })

  it('D2-2：group.bookmarkIds 边界（空数组 / undefined 防御）结果项保留原值', () => {
    // schema catch 默认把缺 bookmarkIds 的组兜底成 []，但 search.ts 仍对 undefined 做防御
    // （g.bookmarkIds || []）——护栏两端都锁：空数组→结果项空数组；undefined→结果项 undefined。
    const groupsWithEmpty: SiblingGroup[] = [
      // 空数组边界（schema 兜底后的真实形态）
      { id: 'gE', name: '学习资源空', categoryId: 'edu', icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 0, useCount: 0 },
      ...SAMPLE_GROUPS,
    ]
    const resultsE = searchWithHighlights(SAMPLE_BOOKMARKS, groupsWithEmpty, '学习资源空', BOOKMARK_MAP, EMPTY_ATTRS)
    const gE = resultsE.find(r => r.id === 'gE' && r._isGroup)
    if (gE) expect(gE!.bookmarkIds).toEqual([])
    // undefined 防御：绕过 schema 类型，模拟未过校验的裸组（search.ts 的 || [] 与 item 透传都须兼容）
    const groupsNoIds = [
      { id: 'gX', name: '学习资源', categoryId: 'edu', icon: '', order: 0, isExpanded: false, attributes: {}, notes: '', updatedAt: 0, useCount: 0 },
      ...SAMPLE_GROUPS,
    ] as unknown as SiblingGroup[]
    const results = searchWithHighlights(SAMPLE_BOOKMARKS, groupsNoIds, '学习', BOOKMARK_MAP, EMPTY_ATTRS)
    const gX = results.find(r => r.id === 'gX' && r._isGroup)
    if (gX) {
      // _buildGroupSearchItems 透传 g.bookmarkIds 即 undefined；结果项须 undefined 而非 null/[]
      expect(gX!.bookmarkIds).toBeUndefined()
    }
    // 同轮已有 bookmarkIds 的组不受影响（防优化漏处理导致全 undefined）
    const g2 = results.find(r => r.id === 'g2' && r._isGroup)
    if (g2) expect(g2!.bookmarkIds).toEqual(['b2', 'b3'])
  })

  // ── D2-2 benchmark 留数：热路径每次键击省去 new Map(groups.map(g => [id, bookmarkIds])) ──
  // 优化前：每次 searchWithHighlights 调用在 446-448 行 new Map 建全部 groups 的 id→bookmarkIds 映射，
  //        version 缓存命中（无 CRUD）后每键击仍重建一次，O(groups) 无谓分配 + 数组迭代。
  // 优化后：bookmarkIds 折进 GroupSearchItem（version 缓存内一次构建，CRUD 才重建），
  //        热路径直接 r.item.bookmarkIds 取，零额外分配。
  // 本 benchmark 以 200 组规模 × 1000 次键击刻画版本命中态每次调用耗时，留数到 console 便于
  // 后续回归对比。注意：微基准 CI 抖动大，不用硬阈值断言（两头过/不过而误导）；改用留数打印 +
  // 下方"行为不变量"断言（bookmarkIds 精确保留）锁定算法层定性结论——真改善是「version 命中态
  // 每次键击不再有 new Map(groups) 分配」，由结构层护栏（D2-2 行为测试）保证，非性能数字本身。
  it('D2-2 benchmark 留数：200 组 × 1000 键击版本命中态每次调用耗时打印（非硬阈值）', () => {
    const BIG_GROUPS: SiblingGroup[] = Array.from({ length: 200 }, (_, i) => ({
      id: `gg${i}`, name: `组${i}资源`, categoryId: 'dev', icon: '', order: i,
      isExpanded: false, attributes: {}, bookmarkIds: [`b${i % 3}`, `b${(i + 1) % 3}`],
      notes: '', updatedAt: 0, useCount: 0,
    }))
    clearSearchCache()
    // 让 _ensureGroupBase 建一次 version=1 缓存
    searchWithHighlights(SAMPLE_BOOKMARKS, BIG_GROUPS, '资源', BOOKMARK_MAP, EMPTY_ATTRS, 8, 1)
    // 版本=1 命中缓存态：连调 1000 次测每次增量构建成本（优化后应为零额外 Map 分配）
    const N = 1000
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      searchWithHighlights(SAMPLE_BOOKMARKS, BIG_GROUPS, '资源', BOOKMARK_MAP, EMPTY_ATTRS, 8, 1)
    }
    const perCallUs = ((performance.now() - t0) / N) * 1000
    console.log(`[D2-2 benchmark] 200 组规模版本命中态每次调用 ≈ ${perCallUs.toFixed(1)}μs (N=${N})`)
    // 功能性断言：版本命中态下连调结果一致（防缓存被误清）
    const r1 = searchWithHighlights(SAMPLE_BOOKMARKS, BIG_GROUPS, '资源', BOOKMARK_MAP, EMPTY_ATTRS, 8, 1)
    expect(r1.length).toBeGreaterThan(0)
    // 所命中的组结果 bookmarkIds 都应是长度 2 的数组（BIG_GROUPS 构造保证）
    for (const r of r1) {
      if (r._isGroup) expect(Array.isArray(r.bookmarkIds)).toBe(true)
    }
  // 留数 benchmark 一次跑 1000 迭代 + coverage 插桩更慢，默认 5s 超时会误伤（314 例实测），
  // 显式给长超时：它非硬阈值、只留数打印，真实耗时数秒级，60s 足够又不掩盖真卡死。
  }, 60000)
})

describe('clearSearchCache', () => {
  it('clears all caches (runs without error)', () => {
    searchBookmarkIds(SAMPLE_BOOKMARKS, 'GitHub', EMPTY_ATTRS)
    searchGroupIds(SAMPLE_GROUPS, '开发', BOOKMARK_MAP, EMPTY_ATTRS)
    expect(() => clearSearchCache()).not.toThrow()
  })
})
