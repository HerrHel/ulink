import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dispatchSiteCommand } from '../lib/ai/siteCommander.js'
import type { Bookmark, Category, SiblingGroup } from '../types.js'

// Mock 外部导出模块与 utils
vi.mock('../composables/domain/useDataIO.js', () => ({
  exportData: vi.fn(),
}))

vi.mock('../lib/toast.js', () => ({
  showConfirm: vi.fn(() => Promise.resolve(true)),
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
}))

vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>()
  return {
    ...actual,
    addNewCategory: vi.fn((name: string, app: any) => {
      const cat = { id: 'cat_' + name, name, icon: 'folder', color: '#122E8A', order: 1 }
      app.categories?.push(cat)
      return cat
    }),
  }
})

describe('siteCommander — 站内指令调度器 (In-App Agent CLI)', () => {
  let mockDs: any
  let mockUi: any
  let mockApp: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockDs = {
      bookmarks: [
        { id: 'b1', title: 'Vue', url: 'https://vuejs.org', categoryId: 'c1' },
        { id: 'b2', title: 'React', url: 'https://react.dev', categoryId: 'uncategorized' },
        { id: 'b3', title: 'Vite', url: 'https://vitejs.dev' }, // 无 categoryId 即未分类
      ] as Bookmark[],
      categories: [
        { id: 'c1', name: '前端开发', icon: 'code', color: '#3b82f6', order: 0 },
        { id: 'c2', name: '设计资源', icon: 'palette', color: '#10b981', order: 1 },
      ] as Category[],
      siblingGroups: [
        { id: 'g1', name: '学习组', bookmarkIds: ['b1'] },
      ] as SiblingGroup[],
      bookmarkMap: {
        b1: { id: 'b1', title: 'Vue', url: 'https://vuejs.org', categoryId: 'c1' },
      },
      updateBookmark: vi.fn(),
      updateGroup: vi.fn(),
      emptyTrash: vi.fn(),
    }

    mockUi = {
      layoutMode: 'grid',
      themeMode: 'manual',
      themeColor: 'light',
      panels: {
        trash: false,
        settings: false,
      },
      overlays: {
        deadLinks: false,
      },
      setThemeColor: vi.fn((color: 'light' | 'dark') => {
        mockUi.themeColor = color
      }),
      toggleTheme: vi.fn(() => {
        mockUi.themeColor = mockUi.themeColor === 'dark' ? 'light' : 'dark'
      }),
      toggleAutoTheme: vi.fn(() => {
        mockUi.themeMode = 'auto'
      }),
      saveUIState: vi.fn(),
    }

    mockApp = {
      categories: mockDs.categories,
      save: vi.fn(),
    }
  })

  // ── 1. 帮助 ──
  it('支持 /help 与帮助指令', async () => {
    const res1 = await dispatchSiteCommand('/help', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(res1.handled).toBe(true)
    expect(res1.action).toBe('help')
    expect(res1.reply).toContain('站内操控指令')

    const res2 = await dispatchSiteCommand('帮助', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(res2.handled).toBe(true)
    expect(res2.reply).toContain('站内操控指令')
  })

  // ── 2. 主题 ──
  it('支持 /theme 切换深色、浅色与自动主题', async () => {
    const resDark = await dispatchSiteCommand('/theme dark', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resDark.handled).toBe(true)
    expect(mockUi.setThemeColor).toHaveBeenCalledWith('dark')
    expect(resDark.reply).toContain('深色模式')

    const resLight = await dispatchSiteCommand('切换浅色模式', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resLight.handled).toBe(true)
    expect(mockUi.setThemeColor).toHaveBeenCalledWith('light')
    expect(resLight.reply).toContain('浅色模式')

    const resAuto = await dispatchSiteCommand('跟随系统主题', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resAuto.handled).toBe(true)
    expect(mockUi.toggleAutoTheme).toHaveBeenCalled()
    expect(resAuto.reply).toContain('跟随系统')

    const resToggle = await dispatchSiteCommand('/theme', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resToggle.handled).toBe(true)
    expect(mockUi.toggleTheme).toHaveBeenCalled()
  })

  // ── 3. 视图 ──
  it('支持 /view 切换列表、宫格与紧凑视图', async () => {
    const resList = await dispatchSiteCommand('/view list', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resList.handled).toBe(true)
    expect(mockUi.layoutMode).toBe('list')
    expect(mockUi.saveUIState).toHaveBeenCalled()

    const resCompact = await dispatchSiteCommand('切换小宫格', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resCompact.handled).toBe(true)
    expect(mockUi.layoutMode).toBe('mini-grid')

    const resGrid = await dispatchSiteCommand('网格视图', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resGrid.handled).toBe(true)
    expect(mockUi.layoutMode).toBe('grid')
  })

  // ── 4. 分类 ──
  it('支持 /cat list 与新建分类', async () => {
    const resList = await dispatchSiteCommand('/cat list', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resList.handled).toBe(true)
    expect(resList.reply).toContain('前端开发')
    expect(resList.reply).toContain('未分类')

    // 新建分类
    const resAdd = await dispatchSiteCommand('/cat add 工具库', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resAdd.handled).toBe(true)
    expect(resAdd.success).toBe(true)
    expect(resAdd.reply).toContain('分类「工具库」创建成功')

    // 重名新建
    const resDup = await dispatchSiteCommand('新建分类: 前端开发', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resDup.handled).toBe(true)
    expect(resDup.reply).toContain('已存在')
  })

  // ── 5. 回收站 ──
  it('支持 /trash 打开与清空回收站', async () => {
    const resOpen = await dispatchSiteCommand('/trash', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resOpen.handled).toBe(true)
    expect(mockUi.panels.trash).toBe(true)

    // 回收站为空时
    const resClearEmpty = await dispatchSiteCommand('/trash clear', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resClearEmpty.handled).toBe(true)
    expect(resClearEmpty.reply).toContain('回收站当前为空')

    // 回收站有软删除数据时：用户点击确认
    mockDs.bookmarks.push({ id: 'b_del', title: 'Deleted', url: 'https://x.com', deletedAt: Date.now() })
    const resClearFull = await dispatchSiteCommand('清空回收站', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resClearFull.handled).toBe(true)
    expect(mockDs.emptyTrash).toHaveBeenCalled()
    expect(mockApp.save).toHaveBeenCalled()
    expect(resClearFull.reply).toContain('已彻底清空回收站')

    // 用户点击取消：危险操作被拦截，不执行 emptyTrash
    const { showConfirm } = await import('../lib/toast.js')
    vi.mocked(showConfirm).mockResolvedValueOnce(false)
    mockDs.emptyTrash.mockClear()
    const resCancel = await dispatchSiteCommand('/trash clear', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resCancel.handled).toBe(true)
    expect(resCancel.success).toBe(false)
    expect(mockDs.emptyTrash).not.toHaveBeenCalled()
    expect(resCancel.reply).toContain('已取消清空回收站')
  })

  // ── 6. 查重 ──
  it('支持 /dedup 查重巡检', async () => {
    const resDedupClean = await dispatchSiteCommand('/dedup', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resDedupClean.handled).toBe(true)
    expect(resDedupClean.reply).toContain('未发现重复链接')

    // 制造重复链接
    mockDs.bookmarks.push({ id: 'b_dup', title: 'Vue Copy', url: 'https://vuejs.org/' })
    const resDedupFound = await dispatchSiteCommand('查找重复书签', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resDedupFound.handled).toBe(true)
    expect(resDedupFound.reply).toContain('查重检测：发现 1 组重复链接')
  })

  // ── 7. 死链与导出 ──
  it('支持 /deadlink 与 /export', async () => {
    const resDead = await dispatchSiteCommand('检查死链', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resDead.handled).toBe(true)
    expect(mockUi.overlays.deadLinks).toBe(true)

    const { exportData } = await import('../composables/domain/useDataIO.js')
    const resExport = await dispatchSiteCommand('/export', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resExport.handled).toBe(true)
    expect(exportData).toHaveBeenCalled()
  })

  // ── 8. 统计报表 ──
  it('支持 /stats 全库统计', async () => {
    const resStats = await dispatchSiteCommand('/stats', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resStats.handled).toBe(true)
    expect(resStats.reply).toContain('书签库运行状态报表')
    expect(resStats.reply).toContain('活跃顶层书签')
  })

  // ── 9. 批量移动未分类 ──
  it('支持 /move uncategorized 移动未分类书签', async () => {
    // 目标分类不存在
    const resNotFound = await dispatchSiteCommand('/move uncategorized 不存在的分类', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resNotFound.handled).toBe(true)
    expect(resNotFound.reply).toContain('未找到分类')

    // 成功移入
    const resMove = await dispatchSiteCommand('把所有未分类移到 前端开发', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resMove.handled).toBe(true)
    expect(mockDs.updateBookmark).toHaveBeenCalledWith('b2', { categoryId: 'c1' })
    expect(mockDs.updateBookmark).toHaveBeenCalledWith('b3', { categoryId: 'c1' })
    expect(mockApp.save).toHaveBeenCalled()
    expect(resMove.reply).toContain('已成功将 2 个未分类书签移入「前端开发」分类')
  })

  // ── 10. 孤儿清理与自检 ──
  it('支持 /clean 数据自检与孤立引用清理', async () => {
    // 构造失效 group bookmarkIds
    mockDs.siblingGroups[0].bookmarkIds = ['b1', 'b_ghost']
    const resClean = await dispatchSiteCommand('/clean', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resClean.handled).toBe(true)
    expect(mockDs.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['b1'] })
    expect(mockApp.save).toHaveBeenCalled()
    expect(resClean.reply).toContain('数据自检修复完成')
  })

  // ── 11. 打开设置 ──
  it('支持 /settings 打开设置面板', async () => {
    const resSettings = await dispatchSiteCommand('打开设置', { ds: mockDs, ui: mockUi, app: mockApp })
    expect(resSettings.handled).toBe(true)
    expect(mockUi.panels.settings).toBe(true)
  })

  // ── 12. 非站内命令无缝穿透回退 ──
  it('非站内命令时返回 handled: false', async () => {
    const queries = [
      '推荐几个好用的思维导图工具',
      'https://github.com/vuejs/core',
      'https://www.bilibili.com/video/BV1xx411c7mD',
      '找一些设计灵感网站',
    ]
    for (const q of queries) {
      const res = await dispatchSiteCommand(q, { ds: mockDs, ui: mockUi, app: mockApp })
      expect(res.handled).toBe(false)
    }
  })
})
