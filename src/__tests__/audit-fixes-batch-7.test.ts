import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { useCombinedList } from '../composables/useCombinedList.js'
import { formatLightMarkdown } from '../lib/ai/chatStreamParser.js'
import { getSmartPrefill } from '../lib/ai/smartPrefill.js'
import { enrichBookmarkMetadata } from '../lib/ai/bookmarkEnrich.js'
import { isPrivateOrLocalHost } from '../lib/deadLinkDecision.js'
import { useSpaceMove } from '../composables/domain/useSpaceMove.js'
import type { Bookmark, Category } from '../types.js'

function makeBm(overrides: Partial<Bookmark> & { id: string; title: string; url: string }): Bookmark {
  return {
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: 'uncategorized',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('audit-fixes-batch-7: 6项深层隐患修复验证', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('1. 软删父书签未级联时存活子书签解孤儿与视图保活', () => {
    it('_syncMaps 面对软删父级屏蔽子索引保全层级，指向不存在父级时置 null 并标脏', () => {
      const ds = useDataStore()
      ds.categories = [{ id: 'cat-1', name: '默认', icon: '', color: '', order: 0 }]
      const parent = makeBm({
        id: 'parent-bm',
        title: '父书签',
        url: 'https://parent.com',
        categoryId: 'cat-1',
        deletedAt: Date.now(),
      })
      const child = makeBm({
        id: 'child-bm',
        title: '存活子书签',
        url: 'https://child.com',
        categoryId: 'cat-1',
        parentId: 'parent-bm',
      })
      const orphan = makeBm({
        id: 'orphan-bm',
        title: '完全不存在父级的书签',
        url: 'https://orphan.com',
        categoryId: 'cat-1',
        parentId: 'totally-missing-parent',
      })
      ds.bookmarks = [parent, child, orphan]
      ds._syncMaps()

      // 软删父级的子节点保持 parentId 供恢复，但不进入 _childrenIdx
      expect(ds._childrenIdx['parent-bm']).toBeUndefined()
      // 彻底不存在父级的孤儿书签，_syncMaps 必须清洗其 parentId 为 null 并标脏
      const updatedOrphan = ds.bookmarkMap['orphan-bm']
      expect(updatedOrphan).toBeDefined()
      expect(updatedOrphan.parentId).toBeNull()
      expect(ds._dirtyIds.has('orphan-bm')).toBe(true)
    })

    it('useCombinedList 即使在 _syncMaps 执行前，对父级已软删的孤儿书签也作为顶层卡片呈现，绝不静默丢失', () => {
      const ds = useDataStore()
      const ui = useUIStore()
      ui.curCat = 'all'
      ui.searchQuery = ''
      ui.sortMode = 'order'

      const parent = makeBm({
        id: 'p-deleted',
        title: '已删父',
        url: 'https://p.com',
        deletedAt: Date.now(),
      })
      const orphanChild = makeBm({
        id: 'c-orphan',
        title: '孤儿存活子书签',
        url: 'https://c.com',
        parentId: 'p-deleted',
      })
      ds.bookmarks = [parent, orphanChild]
      ds._bmMap = { 'p-deleted': parent, 'c-orphan': orphanChild }

      const { combinedList } = useCombinedList()
      const ids = combinedList.value.map(item => item.data.id)
      expect(ids).toContain('c-orphan')
      expect(ids).not.toContain('p-deleted')
    })
  })

  describe('2. addBookmark / updateBookmark 虚假 parentId 与间接成环修复', () => {
    it('addBookmark 传入已软删的 parentId 时自动置 null 并正确落库', () => {
      const ds = useDataStore()
      ds.bookmarks = [makeBm({ id: 'parent-deleted', title: '已删父', url: 'https://p.com', deletedAt: Date.now() })]
      ds._syncMaps()
      ds.addBookmark(makeBm({
        id: 'bm-ghost-parent',
        title: '挂在已删父级上的书签',
        url: 'https://ghost.com',
        parentId: 'parent-deleted',
      }))
      const saved = ds.bookmarkMap['bm-ghost-parent']
      expect(saved).toBeDefined()
      expect(saved.parentId).toBeNull()
      expect(ds._childrenIdx['parent-deleted']).toBeUndefined()
    })

    it('updateBookmark 传入已软删的 parentId 时自动置 null', () => {
      const ds = useDataStore()
      ds.bookmarks = [
        makeBm({ id: 'bm-target', title: '普通书签', url: 'https://target.com' }),
        makeBm({ id: 'phantom-id', title: '已删父', url: 'https://p.com', deletedAt: Date.now() }),
      ]
      ds._syncMaps()
      ds.updateBookmark('bm-target', { parentId: 'phantom-id' })
      expect(ds.bookmarkMap['bm-target'].parentId).toBeNull()
    })

    it('updateBookmark 传入间接成环祖先时阻断并置 null', () => {
      const ds = useDataStore()
      // A -> B -> C -> A
      ds.bookmarks = [
        makeBm({ id: 'bm-a', title: 'A', url: 'https://a.com', parentId: null }),
        makeBm({ id: 'bm-b', title: 'B', url: 'https://b.com', parentId: 'bm-a' }),
        makeBm({ id: 'bm-c', title: 'C', url: 'https://c.com', parentId: 'bm-b' }),
      ]
      ds._syncMaps()
      // 把 A 的 parentId 改为 C，形成 A -> C -> B -> A 间接环
      ds.updateBookmark('bm-a', { parentId: 'bm-c' })
      expect(ds.bookmarkMap['bm-a'].parentId).toBeNull()
    })
  })

  describe('3. chatStreamParser 链接双重包裹与代码块格式化', () => {
    it('formatLightMarkdown: [URL](URL) 格式不应生成嵌套 <a> 标签', () => {
      const md = '欢迎访问 [https://github.com](https://github.com) 查看源码'
      const html = formatLightMarkdown(md)
      // 检查不能含有嵌套的 <a><a
      expect(html).not.toMatch(/<a[^>]*>\s*<a/i)
      expect(html).toContain('href="https://github.com"')
      expect(html).toContain('>https://github.com</a>')
    })

    it('formatLightMarkdown: 纯文本中的多代码块按 <pre><code ...> 格式化', () => {
      const md = '以下是示例代码：\n```javascript\nconst a = 1;\nconsole.log(a);\n```\n结束说明。'
      const html = formatLightMarkdown(md)
      expect(html).toContain('<pre class="chat-flow-pre"><code class="chat-flow-code">const a = 1;\nconsole.log(a);</code></pre>')
      expect(html).toContain('结束说明。')
    })
  })

  describe('4. AI 模块中过滤已软删除与虚拟分类', () => {
    it('getSmartPrefill 不继承同域历史书签中的已软删除分类', () => {
      const cats: Category[] = [
        { id: 'cat-active', name: '常用工具', icon: '', color: '', order: 0 },
        { id: 'cat-deleted', name: '旧已删分类', icon: '', color: '', order: 1, deletedAt: Date.now() },
      ]
      const existingBms: Bookmark[] = [
        makeBm({
          id: 'b-old',
          title: '老条目',
          url: 'https://example-test.com/login',
          categoryId: 'cat-deleted',
          useCount: 10,
        }),
      ]
      const result = getSmartPrefill('https://example-test.com/dashboard', existingBms, cats, [])
      expect(result.categoryId).not.toBe('cat-deleted')
    })

    it('enrichBookmarkMetadata 不向用户建议已软删除分类', async () => {
      const cats: Category[] = [
        { id: 'cat-live', name: '日常', icon: '', color: '', order: 0 },
        { id: 'cat-dead', name: '已删除', icon: '', color: '', order: 1, deletedAt: Date.now() },
      ]
      const bm = makeBm({
        id: 'bm-test',
        title: '测试书签',
        url: 'https://github.com',
        categoryId: 'cat-live',
      })
      const diff = await enrichBookmarkMetadata(bm, cats, [])
      expect(diff.suggestedCategoryId).not.toBe('cat-dead')
    })
  })

  describe('5. useSpaceMove moveCategoryToVault 保留同迁子书签层级', () => {
    it('同迁子书签当父级也在迁入集合时保留其 parentId', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      ui.curSpace = 'main'

      const cat: Category = { id: 'cat-move', name: '移动分类', icon: '', color: '', order: 0 }
      const parentBm = makeBm({
        id: 'p-vault',
        title: '父书签',
        url: 'https://p.vault.com',
        categoryId: 'cat-move',
      })
      const childBm = makeBm({
        id: 'c-vault',
        title: '子书签',
        url: 'https://c.vault.com',
        categoryId: 'cat-move',
        parentId: 'p-vault',
      })
      ds.categories = [cat]
      ds.bookmarks = [parentBm, childBm]
      ds._syncMaps()

      const { moveCategoryToVault } = useSpaceMove()
      await moveCategoryToVault('cat-move')

      const vaultSnap = await ds.getSpaceSnapshot('vault')
      expect(vaultSnap).not.toBeNull()
      const vaultChild = vaultSnap!.bookmarks.find(b => b.id === 'c-vault')
      expect(vaultChild).toBeDefined()
      expect(vaultChild!.parentId).toBe('p-vault')
    })
  })

  describe('6. isPrivateOrLocalHost 完整识别 IPv6 与特殊私有域', () => {
    it('正确将 IPv6 localhost [::1] 识别为私有主机', () => {
      expect(isPrivateOrLocalHost('[::1]')).toBe(true)
      expect(isPrivateOrLocalHost('[::1]:8080')).toBe(true)
      expect(isPrivateOrLocalHost('::1')).toBe(true)
    })

    it('正确将 0.0.0.0 与 .home.arpa / .corp 识别为私有主机', () => {
      expect(isPrivateOrLocalHost('0.0.0.0')).toBe(true)
      expect(isPrivateOrLocalHost('0.0.0.0:3000')).toBe(true)
      expect(isPrivateOrLocalHost('nas.home.arpa')).toBe(true)
      expect(isPrivateOrLocalHost('internal.corp')).toBe(true)
    })

    it('公网网址不误判为私有主机', () => {
      expect(isPrivateOrLocalHost('github.com')).toBe(false)
      expect(isPrivateOrLocalHost('1.1.1.1')).toBe(false)
      expect(isPrivateOrLocalHost('8.8.8.8:53')).toBe(false)
    })
  })
})
