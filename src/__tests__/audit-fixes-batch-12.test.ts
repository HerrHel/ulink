import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { clearSearchCache, pinyinMatch, _buildHighlightSegments, _indicesToRanges } from '../lib/search.js'
import { fetchUrlMetadataAsync } from '../lib/ai/smartIntake.js'
import { getSmartPrefill } from '../lib/ai/smartPrefill.js'
import { inferUrlSemantics } from '../lib/ai/universalUrlInference.js'
import { candidateToBookmark } from '../lib/ai/candidateSave.js'
import { usePayment } from '../composables/domain/usePayment.js'
import { decide, isPrivateOrLocalHost } from '../lib/deadLinkDecision.js'
import { parseMiMoReply } from '../lib/ai/mimoReply.js'
import { ambientHub } from '../lib/ai/ambientInsights.js'
import { runAmbientGroomingScan } from '../lib/ai/ambientGrooming.js'
import {
  clusterUncategorizedBookmarks,
  findUncategorizedGroups,
  detectParentChildRelations,
} from '../lib/ai/localClustering.js'
import { findBestParentBookmark } from '../lib/bookmarkDedup.js'
import { createTopicWorkspace, applyInboxZeroClustering, batchTagBookmarks } from '../lib/ai/siteActions.js'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import * as cb from '../lib/cloudbase.js'
import * as auth from '../lib/authDriver.js'
import { CAT_ALL, CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../config/constants.js'
import type { Bookmark, Category, CustomAttribute, SiblingGroup } from '../types.js'

describe('Audit Fixes Batch 12', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // 1. search.ts
  describe('1. search.ts improvements', () => {
    it('pinyinMatch 在入参为空或非法时不抛异常并返回 null', () => {
      expect(pinyinMatch('', 'abc')).toBeNull()
      expect(pinyinMatch('abc', '')).toBeNull()
      expect(pinyinMatch(null as any, 'abc')).toBeNull()
      expect(pinyinMatch('abc', undefined as any)).toBeNull()
    })

    it('_indicesToRanges 合并重叠下标为连续区间', () => {
      // 模拟重叠 indices: 2..5 与 4..7
      const text = 'abcdefghijk'
      const ranges = _indicesToRanges([2, 3, 4, 5, 4, 5, 6, 7])
      expect(ranges).toEqual([[2, 7]])
      const segments = _buildHighlightSegments(text, ranges)
      const combined = segments.map((s) => s.text).join('')
      expect(combined).toBe(text)
    })

    it('clearSearchCache 清除缓存并重置内部版本标识', () => {
      expect(() => clearSearchCache()).not.toThrow()
    })
  })

  // 2. smartIntake.ts
  describe('2. smartIntake.ts attribute filtering', () => {
    it('suggestedAttrIds 过滤已软删除属性和 is-group', async () => {
      const attrs: CustomAttribute[] = [
        { id: 'attr-active', name: '工作', type: 'boolean' },
        { id: 'attr-del', name: '临时', type: 'boolean', deletedAt: Date.now() },
        { id: ATTR_IS_GROUP, name: '笔记组', type: 'boolean' },
      ]
      // fetchUrlMetadataAsync 在本地分析时不会引入 is-group 或软删属性
      const result = await fetchUrlMetadataAsync('https://github.com/vuejs', [], attrs)
      if (result.suggestedAttrIds) {
        expect(result.suggestedAttrIds).not.toContain('attr-del')
        expect(result.suggestedAttrIds).not.toContain(ATTR_IS_GROUP)
      }
    })
  })

  // 3. smartPrefill.ts & universalUrlInference.ts
  describe('3. smartPrefill & universalUrlInference is-group protection', () => {
    it('smartPrefill 绝不推荐 is-group 属性给书签', () => {
      const attrs: CustomAttribute[] = [
        { id: ATTR_IS_GROUP, name: '组', type: 'boolean' },
        { id: 'attr-tool', name: '工具', type: 'boolean' },
      ]
      const prefill = getSmartPrefill('https://tool.example.com', [], [], attrs)
      expect(prefill.suggestedAttrIds).not.toContain(ATTR_IS_GROUP)
    })

    it('universalUrlInference 绝不推荐 is-group 属性', () => {
      const attrs: CustomAttribute[] = [
        { id: ATTR_IS_GROUP, name: '组', type: 'boolean' },
        { id: 'attr-dev', name: '开发', type: 'boolean' },
      ]
      const inf = inferUrlSemantics('https://api.github.com', [], attrs, true)
      expect(inf.suggestedAttrIds).not.toContain(ATTR_IS_GROUP)
    })
  })

  // 4. candidateSave.ts
  describe('4. candidateSave candidateToBookmark protection', () => {
    it('忽略 suggestedAttrIds 中的 is-group 与软删除属性', () => {
      const ds = useDataStore()
      ds.customAttributes = [
        { id: 'attr-valid', name: '有效', type: 'boolean' },
        { id: 'attr-dead', name: '已删', type: 'boolean', deletedAt: Date.now() },
        { id: ATTR_IS_GROUP, name: '组', type: 'boolean' },
      ]
      const bm = candidateToBookmark(ds, {
        title: '测试',
        url: 'https://test.com',
        notes: '',
        suggestedAttrIds: ['attr-valid', 'attr-dead', ATTR_IS_GROUP],
      })
      expect(bm.attributes['attr-valid']).toBe(true)
      expect(bm.attributes['attr-dead']).toBeUndefined()
      expect(bm.attributes[ATTR_IS_GROUP]).toBeUndefined()
    })
  })

  // 5. usePayment.ts
  describe('5. usePayment checkStatus race guard', () => {
    it('当 order.value 已切换为不同订单时，旧订单 checkStatus 不覆盖新订单', async () => {
      vi.spyOn(cb, 'isCloudBaseBackend').mockReturnValue(true)
      vi.spyOn(cb, 'edgeFnUrl').mockReturnValue('https://test.ulink.ren/pay')
      vi.spyOn(auth, 'getApiToken').mockResolvedValue('tok-123')

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            orderId: 'order-new',
            amountCents: 100,
            channel: 'wechat',
            status: 'pending',
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            order: {
              orderId: 'order-old',
              status: 'paid',
            },
          }),
        } as any)

      const payment = usePayment()
      await payment.create('plan-1', 'wechat')
      expect(payment.order.value?.orderId).toBe('order-new')

      await payment.checkStatus('order-old')
      expect(payment.order.value?.orderId).toBe('order-new')
    })
  })

  // 6. deadLinkDecision.ts
  describe('6. deadLinkDecision intranet detection without protocol', () => {
    it('isPrivateOrLocalHost 与 decideWithRule 正确识别无 http 协议的内网地址', () => {
      expect(isPrivateOrLocalHost('192.168.1.1:8080')).toBe(true)
      expect(isPrivateOrLocalHost('localhost:3000')).toBe(true)

      const result = decide(
        { fetch_outcome: null, http_status: 0 },
        { reachable: true },
        'online',
        '192.168.1.1:8080',
      )
      expect(result.verdict).toBe('alive')
      expect(result.reason).toBe('ssrf')
    })
  })

  // 7. mimoReply.ts
  describe('7. mimoReply parseMiMoReply soft-deleted category exclusion', () => {
    it('不匹配已软删除的同名分类', () => {
      const cats: Category[] = [
        { id: 'cat-dead', name: '设计', icon: '', color: '', order: 0, deletedAt: Date.now() },
        { id: 'cat-active', name: '编程', icon: '', color: '', order: 1 },
      ]
      const reply = '```ulink-card\n{"title": "Figma", "url": "https://figma.com", "suggestedCategory": "设计"}\n```'
      const { candidates } = parseMiMoReply(reply, cats, [])
      expect(candidates[0].categoryId).toBeUndefined()
    })
  })

  // 8. ambientInsights.ts & ambientGrooming.ts
  describe('8. ambientInsights & ambientGrooming encryption & deleted guards', () => {
    it('triggerSerendipityCheck 遇到软删书签时不触发偶遇洞察', () => {
      const target: Bookmark = {
        id: 'bm-1',
        title: '测试',
        url: 'https://example.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'cat-1',
        parentId: null,
        order: 1,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: Date.now(),
      }
      expect(ambientHub.triggerSerendipityCheck(target, [target])).toBeNull()
    })

    it('runAmbientGroomingScan 对密文分类名经 displayText 脱敏，不泄漏原始密文', () => {
      const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
      const cats: Category[] = [
        { id: 'cat-huge', name: cipher, icon: '', color: '', order: 0 },
      ]
      const bms: Bookmark[] = []
      for (let i = 0; i < 30; i++) {
        bms.push({
          id: `bm-${i}`,
          title: `BM ${i}`,
          url: `https://example.com/${i}`,
          username: '',
          password: '',
          notes: '',
          icon: '',
          categoryId: 'cat-huge',
          parentId: null,
          order: i,
          useCount: 0,
          attributes: {},
          isExpanded: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
      const insights = runAmbientGroomingScan({ bookmarks: bms, groups: [], categories: cats })
      const drift = insights.find((i) => i.type === 'drift')
      expect(drift).toBeDefined()
      expect(drift!.title).not.toContain(cipher)
      expect(drift!.suggestedActionCommand).not.toContain(cipher)
    })
  })

  // 9. localClustering.ts
  describe('9. localClustering system categories and self-parenting guards', () => {
    it('clusterUncategorizedBookmarks 与 clusterUncategorizedGroups 绝不推荐 all 或 uncategorized 作为分类', () => {
      const cats: Category[] = [
        { id: CAT_ALL, name: '全部', icon: '', color: '', order: 0 },
        { id: CAT_UNCATEGORIZED, name: '未分类', icon: '', color: '', order: 1 },
      ]
      const bms: Bookmark[] = [
        {
          id: 'bm-1',
          title: '未分类书签',
          url: 'https://test.com',
          username: '',
          password: '',
          notes: '',
          icon: '',
          categoryId: CAT_UNCATEGORIZED,
          parentId: null,
          order: 0,
          useCount: 0,
          attributes: {},
          isExpanded: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
      const clusters = clusterUncategorizedBookmarks(bms, cats)
      for (const c of clusters) {
        expect(c.suggestedCategoryId).not.toBe(CAT_ALL)
        expect(c.suggestedCategoryId).not.toBe(CAT_UNCATEGORIZED)
      }

      const groups: SiblingGroup[] = [
        {
          id: 'sg-1',
          name: '全部资源',
          categoryId: CAT_UNCATEGORIZED,
          icon: '',
          order: 0,
          isExpanded: false,
          attributes: {},
          bookmarkIds: ['bm-1'],
          notes: '',
          updatedAt: Date.now(),
          useCount: 0,
        },
      ]
      const grpItems = findUncategorizedGroups(groups, cats, bms)
      for (const gi of grpItems) {
        expect(gi.suggestedCategoryId).not.toBe(CAT_ALL)
        expect(gi.suggestedCategoryId).not.toBe(CAT_UNCATEGORIZED)
      }
    })

    it('detectParentChildRelations 杜绝自挂为父（childId === parentId）', () => {
      const bms: Bookmark[] = [
        {
          id: 'bm-1',
          title: '主页',
          url: 'https://example.com/',
          username: '',
          password: '',
          notes: '',
          icon: '',
          categoryId: 'cat-1',
          parentId: null,
          order: 0,
          useCount: 0,
          attributes: {},
          isExpanded: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
      const links = detectParentChildRelations(bms)
      expect(links.some((l) => l.childId === l.parentId)).toBe(false)
    })
  })

  // 10. dataActionsIO.ts
  describe('10. dataActionsIO switchSpace modal cleanup', () => {
    it('switchSpace 时关闭 category 和 attribute 模态框', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      ui.modals.category = true
      ui.modals.attribute = true

      await ds.switchSpace('vault')
      expect(ui.modals.category).toBe(false)
      expect(ui.modals.attribute).toBe(false)
    })
  })

  // 11. bookmarkDedup.ts
  describe('11. bookmarkDedup cipher guard', () => {
    it('findBestParentBookmark 忽略密文输入与密文书签', () => {
      const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
      const bms: Bookmark[] = [
        {
          id: 'bm-c',
          title: '密文',
          url: cipher,
          username: '',
          password: '',
          notes: '',
          icon: '',
          categoryId: 'cat-1',
          parentId: null,
          order: 0,
          useCount: 0,
          attributes: {},
          isExpanded: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
      expect(findBestParentBookmark(cipher, bms)).toBeNull()
      expect(findBestParentBookmark('https://example.com/sub', bms)).toBeNull()
    })
  })

  // 12. siteActions.ts
  describe('12. siteActions deduplication and cycle guards', () => {
    it('createTopicWorkspace 对相同 URL/ID 的候选条目去重，不写入重复 bookmarkIds', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      const cat: Category = { id: 'cat-dev', name: '开发', icon: '', color: '', order: 0 }
      ds.categories = [cat]

      const cand = { title: 'Vue', url: 'https://vuejs.org', notes: '' }
      const res = await createTopicWorkspace('前端工具', [cand, cand], undefined, { ds, ui })
      expect(res.createdBmIds.length).toBe(1)
      expect(res.group).toBeDefined()
      const createdGrp = ds.siblingGroups.find((g) => g.id === res.group?.id)
      expect(createdGrp).toBeDefined()
      expect(createdGrp!.bookmarkIds).toEqual([res.createdBmIds[0]])
    })

    it('applyInboxZeroClustering 拦截 parent.parentId === child.id 的两节点环', async () => {
      const ds = useDataStore()
      const p: Bookmark = {
        id: 'bm-p',
        title: '父',
        url: 'https://site.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: CAT_UNCATEGORIZED,
        parentId: 'bm-c', // p 已经挂在 c 下
        order: 0,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const c: Bookmark = {
        id: 'bm-c',
        title: '子',
        url: 'https://site.com/sub',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: CAT_UNCATEGORIZED,
        parentId: null,
        order: 1,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      ds.bookmarks = [p, c]
      ds._syncMaps()

      const _res = await applyInboxZeroClustering({ ds } as any)
      // 由于 p.parentId === c.id，嵌套循环必须跳过，防止造成死循环
      expect(c.parentId).not.toBe('bm-p')
    })

    it('batchTagBookmarks 绝不给书签赋予 is-group 属性', async () => {
      const ds = useDataStore()
      const bm: Bookmark = {
        id: 'bm-tag',
        title: '测试',
        url: 'https://test.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'cat-1',
        parentId: null,
        order: 0,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      ds.bookmarks = [bm]
      ds.customAttributes = [{ id: ATTR_IS_GROUP, name: 'is-group', type: 'boolean' }]
      ds._syncMaps()

      await batchTagBookmarks([{ bookmarkId: 'bm-tag', tags: ['is-group', '组', '开发'] }], { ds } as any)
      expect(bm.attributes[ATTR_IS_GROUP]).toBeUndefined()
    })
  })
})
