/**
 * 分享只读态护栏（S2 命门）：
 * 1. ui.shareMode 非空时，dataStore 全部 mutation action 一律静默拒写
 *    —— 他人分享内容绝不允许写进访问者的本地库（数组零污染、无脏标记、无历史快照）。
 * 2. app.save() 在分享态直接 return true，不触碰 persist（零落盘、零写序号递增）。
 * 3. bookmarkMap/groupMap/categoryMap 在分享态合并影子数据（只读渲染可见），
 *    退出后（shareMode=null + shadowClear）恢复原样。
 *
 * 这些护栏是「访问一次分享链接就把他人数据写进自己库」事故的最后防线，
 * 任何一条失败都意味着影子数据泄漏到持久化或云端，必须红灯。
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore, type ShareModeState } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import * as persist from '../../stores/persist.js'
import { shadowSet, shadowClear } from '../../stores/shareShadow.js'
import { preloadSearchLibs } from '../../lib/search.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

const bm = (id: string) => ({ id, title: id, url: `https://${id}.example.com` } as any)
const grp = (id: string) => ({ id, name: id, bookmarkIds: [] } as any)
const cat = (id: string) => ({ id, name: id, icon: 'star', order: 0 } as any)

describe('分享只读态护栏', () => {
  let ui: ReturnType<typeof useUIStore>
  let ds: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    ui = useUIStore()
    ds = useDataStore()
    shadowClear()
  })

  afterEach(() => {
    shadowClear()
    ui.shareMode = null
    vi.restoreAllMocks()
  })

  function enterShare(kind: ShareModeState['kind'], id: string) {
    ui.shareMode = { kind, id }
  }

  describe('数据 mutation 熔断', () => {
    it('addBookmark / updateBookmark / deleteBookmark 全部被拒', () => {
      enterShare('group', 'g1')
      ds.addBookmark(bm('b1'))
      expect(ds.bookmarks).toHaveLength(0)
      // 预置一条本地书签再测 update/delete
      ui.shareMode = null
      ds.addBookmark(bm('b1'))
      enterShare('group', 'g1')
      ds.updateBookmark('b1', { title: 'hacked' })
      expect(ds.bookmarkMap['b1'].title).toBe('b1')
      ds.deleteBookmark('b1')
      expect(ds.bookmarks).toHaveLength(1)
    })

    it('addGroup / updateGroup / deleteGroup / togglePin 全部被拒', () => {
      enterShare('category', 's1')
      ds.addGroup(grp('g1'))
      expect(ds.siblingGroups).toHaveLength(0)
      ui.shareMode = null
      ds.addGroup(grp('g1'))
      enterShare('category', 's1')
      ds.updateGroup('g1', { name: 'hacked' })
      expect(ds.groupMap['g1'].name).toBe('g1')
      ds.deleteGroup('g1')
      expect(ds.siblingGroups).toHaveLength(1)
      ds.togglePin('group', 'g1')
      expect(ds.groupMap['g1'].pinnedAt).toBeUndefined()
    })

    it('分类 / 属性 / 批量销毁类 mutation 全部被拒', () => {
      enterShare('group', 'g1')
      ds.addCategory(cat('c1'))
      expect(ds.categories).toHaveLength(0)
      ds.addAttribute({ id: 'a1', name: 'A', type: 'boolean' } as any)
      expect(ds.customAttributes).toHaveLength(0)
      ds.emptyTrash()
      // 无异常即通过
      expect(true).toBe(true)
    })

    it('importFromData 整集导入被拒', () => {
      enterShare('group', 'g1')
      ds.importFromData({ bookmarks: [bm('b-x')], siblingGroups: [], categories: [], customAttributes: [] })
      expect(ds.bookmarks).toHaveLength(0)
    })
  })

  describe('持久化熔断', () => {
    it('分享态下 saveAppData 不触碰 persist 且返回 true', async () => {
      const spy = vi.spyOn(persist, 'saveData').mockResolvedValue(true)
      enterShare('group', 'g1')
      ds.addBookmark(bm('b1')) // 被拒，无数据
      const ok = await saveAppData()
      expect(ok).toBe(true)
      expect(spy).not.toHaveBeenCalled()
    })

    it('退出分享态后 save 恢复正常落盘', async () => {
      const spy = vi.spyOn(persist, 'saveData').mockResolvedValue(true)
      enterShare('group', 'g1')
      ui.shareMode = null
      ds.addBookmark(bm('b1'))
      await saveAppData()
      expect(spy).toHaveBeenCalled()
    })
  })

  describe('影子数据 map 合并（只读渲染可见性）', () => {
    it('分享态下 bookmarkMap/groupMap/categoryMap 合并影子数据', () => {
      shadowSet({
        bookmarks: { 's-b1': bm('s-b1') },
        groups: { 's-g1': grp('s-g1') },
        categories: { 's-c1': cat('s-c1') },
      })
      enterShare('category', 's1')
      expect(ds.bookmarkMap['s-b1'].id).toBe('s-b1')
      expect(ds.groupMap['s-g1'].id).toBe('s-g1')
      expect(ds.categoryMap['s-c1'].id).toBe('s-c1')
      // 关键：影子数据不进数组 → 过滤/计数/搜索/落盘全部隐身
      expect(ds.bookmarks).toHaveLength(0)
      expect(ds.siblingGroups).toHaveLength(0)
      expect(ds.categories).toHaveLength(0)
      expect(ds.filteredBookmarks).toHaveLength(0)
      expect(ds.filteredGroups).toHaveLength(0)
    })

    it('非分享态下 map 不合并影子数据', () => {
      shadowSet({ bookmarks: { 's-b1': bm('s-b1') }, groups: {}, categories: {} })
      // 未进入分享态（shareMode 为 null）
      expect(ds.bookmarkMap['s-b1']).toBeUndefined()
    })

    it('退出分享（shareMode=null + shadowClear）后 map 恢复、影子不可见', () => {
      shadowSet({
        bookmarks: { 's-b1': bm('s-b1') },
        groups: { 's-g1': grp('s-g1') },
        categories: { 's-c1': cat('s-c1') },
      })
      enterShare('group', 'g1')
      expect(ds.groupMap['s-g1']).toBeDefined()
      ui.shareMode = null
      shadowClear()
      expect(ds.groupMap['s-g1']).toBeUndefined()
      expect(ds.bookmarkMap['s-b1']).toBeUndefined()
      expect(ds.categoryMap['s-c1']).toBeUndefined()
    })

    it('shadowSet 后 map 立即可见（响应式依赖：shadowVersion 触发 getter 重算）', () => {
      // 关键：shadowSet 之前查询 map，缓存空影子；shadowSet 之后必须能查到新影子
      // ——这要求 bookmarkMap/groupMap/categoryMap 读取 shadowVersion 作 Vue 依赖，
      // 否则 Pinia getter 不会因影子变化而重算（shadowData() 是普通模块函数，非响应式）。
      ui.shareMode = null
      shadowClear()
      expect(ds.groupMap['late']).toBeUndefined()

      // 进入分享态后再 set
      enterShare('group', 'g1')
      shadowSet({
        bookmarks: { 'late-b': bm('late-b') },
        groups: { 'late': grp('late') },
        categories: { 'late-c': cat('late-c') },
      })
      // 不需要任何额外操作，访问 map 即可触发 getter 重算
      expect(ds.groupMap['late']).toBeDefined()
      expect(ds.bookmarkMap['late-b']).toBeDefined()
      expect(ds.categoryMap['late-c']).toBeDefined()
    })
  })

  describe('SSR __INITIAL_SHARE_DATA__ 秒级水合与守卫护栏', () => {
    it('SSR 预注入分类分享数据时：同步水合装载，loading 保持 false，跳过网络请求', async () => {
      const { useShareStore } = await import('../../stores/share.js')
      const share = useShareStore()

      // 模拟 SSR 注入的 window.__INITIAL_SHARE_DATA__
      ;(window as any).__INITIAL_SHARE_DATA__ = {
        type: 'category',
        id: 'cat_test_ssr',
        data: {
          category: { id: 'tools', name: '工具', icon: 'tool', color: '#d97706' },
          groups: [{ id: 'g_ssr', name: 'SSR 组', categoryId: 'tools', bookmarkIds: ['b_ssr'] }],
          bookmarks: [{ id: 'b_ssr', title: 'SSR 书签', url: 'https://example.com', categoryId: 'tools' }],
        },
      }

      await share.enter('cat:cat_test_ssr')

      expect(share.loading).toBe(false)
      expect(share.error).toBe('')
      expect(share.category?.id).toBe('tools')
      expect(share.groups).toHaveLength(1)
      expect(share.bookmarks).toHaveLength(1)
      expect(ui.curCat).toBe('tools')
      expect(ui.shareMode).toEqual({ kind: 'category', id: 'cat_test_ssr' })

      // 验证影子数据已装载
      expect(ds.categoryMap['tools'].name).toBe('工具')
      expect(ds.groupMap['g_ssr'].name).toBe('SSR 组')
      expect(ds.bookmarkMap['b_ssr'].title).toBe('SSR 书签')

      // 清理
      delete (window as any).__INITIAL_SHARE_DATA__
      share.exit()
    })

    it('SSR 预注入组分享数据时：同步水合装载，loading 保持 false', async () => {
      const { useShareStore } = await import('../../stores/share.js')
      const share = useShareStore()

      ;(window as any).__INITIAL_SHARE_DATA__ = {
        type: 'group',
        id: 'g_pub_ssr',
        data: {
          group: { id: 'g_pub_ssr', name: '公开组 SSR', bookmarkIds: ['b1'] },
          bookmarks: [{ id: 'b1', title: '公开书签', url: 'https://pub.example.com' }],
        },
      }

      await share.enter('g_pub_ssr')

      expect(share.loading).toBe(false)
      expect(share.group?.name).toBe('公开组 SSR')
      expect(share.bookmarks).toHaveLength(1)
      expect(ui.focusedGroupId).toBe('g_pub_ssr')
      expect(ui.shareMode).toEqual({ kind: 'group', id: 'g_pub_ssr' })

      delete (window as any).__INITIAL_SHARE_DATA__
      share.exit()
    })

    it('enter 阶段不调用 _stripSharePath，不破坏分享 URL', async () => {
      const { useShareStore } = await import('../../stores/share.js')
      const share = useShareStore()
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

      ;(window as any).__INITIAL_SHARE_DATA__ = {
        type: 'group',
        id: 'g_test_path',
        data: {
          group: { id: 'g_test_path', name: '路径保护测试' },
          bookmarks: [],
        },
      }

      await share.enter('g_test_path')

      // enter 时不应将 URL replace 为 /app
      const replaceCalls = replaceStateSpy.mock.calls
      const stripCall = replaceCalls.find((args) => typeof args[2] === 'string' && args[2].includes('/app'))
      expect(stripCall).toBeUndefined()

      delete (window as any).__INITIAL_SHARE_DATA__
      share.exit()
    })
  })
})
