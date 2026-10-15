import {
  dispatchSiteCommand,
  mergeDuplicateBookmarks,
  applyInboxZeroClustering,
  createTopicWorkspace,
  healDeadlink,
  clearUndoStack,
} from '../lib/ai/siteCommander.js'
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
    clearUndoStack()

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
        b2: { id: 'b2', title: 'React', url: 'https://react.dev', categoryId: 'uncategorized' },
        b3: { id: 'b3', title: 'Vite', url: 'https://vitejs.dev' },
      },
      groupMap: {
        g1: { id: 'g1', name: '学习组', bookmarkIds: ['b1'] },
      },
      customAttributes: [],
      nextBookmarkOrder: vi.fn(() => 10),
      addBookmark: vi.fn((bm: any) => {
        mockDs.bookmarks.push(bm)
        mockDs.bookmarkMap[bm.id] = bm
      }),
      deleteBookmark: vi.fn((id: string) => {
        const idx = mockDs.bookmarks.findIndex((b: any) => b.id === id)
        if (idx >= 0) mockDs.bookmarks.splice(idx, 1)
        delete mockDs.bookmarkMap[id]
      }),
      addGroup: vi.fn((g: any) => {
        mockDs.siblingGroups.push(g)
        mockDs.groupMap[g.id] = g
      }),
      deleteGroup: vi.fn((id: string) => {
        const idx = mockDs.siblingGroups.findIndex((g: any) => g.id === id)
        if (idx >= 0) mockDs.siblingGroups.splice(idx, 1)
        delete mockDs.groupMap[id]
      }),
      deleteCategory: vi.fn((id: string) => {
        const idx = mockDs.categories.findIndex((c: any) => c.id === id)
        if (idx >= 0) mockDs.categories.splice(idx, 1)
      }),
      updateBookmark: vi.fn((id: string, changes: any) => {
        const bm = mockDs.bookmarkMap[id]
        if (bm) Object.assign(bm, changes)
      }),
      updateGroup: vi.fn(),
      emptyTrash: vi.fn(),
    }

    mockUi = {
      curCat: 'all',
      focusedGroupId: null,
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

  // ── 13. 对话式撤销 (/undo, 撤销刚才的操作) ──
  it('支持 /undo 与对话式撤销回退', async () => {
    // 先执行一次可撤销的批量归类
    await dispatchSiteCommand('把所有未分类移到 前端开发', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })

    // 执行撤销
    const resUndo = await dispatchSiteCommand('/undo', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resUndo.handled).toBe(true)
    expect(resUndo.action).toBe('undo')
    expect(resUndo.reply).toContain('已撤销批量移动')
    expect(mockDs.updateBookmark).toHaveBeenCalledWith('b2', { categoryId: 'uncategorized' })
    expect(mockDs.updateBookmark).toHaveBeenCalledWith('b3', { categoryId: undefined })

    // 再次撤销时无操作可撤销
    const resUndoEmpty = await dispatchSiteCommand('撤销', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resUndoEmpty.handled).toBe(true)
    expect(resUndoEmpty.reply).toContain('没有可撤销的站内操作')
  })

  // ── 14. 上下文感知：批量多选直接移动 ──
  it('感知 batchMode 勾选的书签并批量移动', async () => {
    mockUi.batchMode = true
    mockUi.batchSelected = ['b1']
    const resBatchMove = await dispatchSiteCommand('把选中的书签移动到 设计资源', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resBatchMove.handled).toBe(true)
    expect(resBatchMove.action).toBe('batch_move')
    expect(mockDs.updateBookmark).toHaveBeenCalledWith('b1', { categoryId: 'c2' })
    expect(mockUi.batchMode).toBe(false)
    expect(mockUi.batchSelected).toEqual([])
    expect(resBatchMove.reply).toContain('移入「设计资源」分类')
  })

  // ── 15. 上下文感知：当前分类查询 ──
  it('感知当前分类并汇报状态', async () => {
    mockUi.curCat = 'c1'
    const resCat = await dispatchSiteCommand('当前在看什么分类', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resCat.handled).toBe(true)
    expect(resCat.action).toBe('current_cat')
    expect(resCat.reply).toContain('前端开发')
  })

  // ── 16. mergeDuplicateBookmarks 查重合并与撤销 ──
  it('mergeDuplicateBookmarks 成功合并重复副本并可撤销', async () => {
    mockDs.deleteBookmark = vi.fn()
    mockDs.restoreBookmark = vi.fn()
    mockDs.bookmarks.push({ id: 'b_dup', title: 'Vue Dup', url: 'https://vuejs.org/' })

    const res = await mergeDuplicateBookmarks({ ds: mockDs, ui: mockUi, app: mockApp })
    expect(res.mergedCount).toBe(1)
    expect(mockDs.deleteBookmark).toHaveBeenCalledWith('b_dup')
  })

  it('mergeDuplicateBookmarks HITL：用户拒绝确认时不合并任何书签', async () => {
    const { showConfirm } = await import('../lib/toast.js')
    ;(showConfirm as any).mockResolvedValueOnce(false)
    mockDs.deleteBookmark = vi.fn()
    mockDs.bookmarks.push({ id: 'b_dup', title: 'Vue Dup', url: 'https://vuejs.org/' })

    const res = await mergeDuplicateBookmarks({ ds: mockDs, ui: mockUi, app: mockApp })
    expect(res.mergedCount).toBe(0)
    expect(res.message).toContain('已取消')
    expect(mockDs.deleteBookmark).not.toHaveBeenCalled()
  })

  // ── 17. /health 全库资产体检 ──
  it('/health 生成健康指数与诊断建议行动卡片', async () => {
    const res = await dispatchSiteCommand('/health', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(res.handled).toBe(true)
    expect(res.action).toBe('health')
    expect(res.reply).toContain('综合健康指数')
    expect(res.reply).toContain('待整理未分类')
    expect(res.actionCard).toBeDefined()
    expect(res.actionCard?.actionName).toBe('inbox_zero')
  })

  // ── 18. /inbox 智能归拢未分类预案 ──
  it('/inbox 识别待整理未分类书签并出具归类方案', async () => {
    const res = await dispatchSiteCommand('/inbox', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(res.handled).toBe(true)
    expect(res.action).toBe('inbox_zero')
    expect(res.reply).toContain('智能归拢分析完成')
    expect(res.actionCard?.actionName).toBe('apply_inbox_zero')
  })

  // ── 19. applyInboxZeroClustering 执行归拢与撤销 ──
  it('applyInboxZeroClustering 执行批量归类并登记可撤销记录', async () => {
    const res = await applyInboxZeroClustering({
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(res.movedCount).toBeGreaterThan(0)
    expect(mockDs.updateBookmark).toHaveBeenCalled()
    expect(mockApp.save).toHaveBeenCalled()

    // 撤销测试
    const resUndo = await dispatchSiteCommand('/undo', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resUndo.handled).toBe(true)
    expect(resUndo.reply).toContain('已撤销智能归类')
  })

  it('applyInboxZeroClustering HITL：用户拒绝确认时不移动任何书签', async () => {
    const { showConfirm } = await import('../lib/toast.js')
    vi.mocked(showConfirm).mockResolvedValueOnce(false)
    mockDs.updateBookmark = vi.fn()
    ;(mockApp.save as any).mockClear()

    const res = await applyInboxZeroClustering({
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(res.movedCount).toBe(0)
    expect(res.message).toContain('已取消')
    expect(mockDs.updateBookmark).not.toHaveBeenCalled()
    expect(mockApp.save).not.toHaveBeenCalled()
  })

  // ── 20. /pack 指令用法提示 ──
  it('/pack 无参数时返回主题工作台指令用法提示', async () => {
    const res = await dispatchSiteCommand('/pack', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(res.handled).toBe(true)
    expect(res.action).toBe('pack_workspace')
    expect(res.reply).toContain('主题工作台一键生成器')
    expect(res.reply).toContain('/pack <主题名称>')
  })

  // ── 21. /pack <主题名> 与自然语言建工作台意图 ──
  it('/pack <主题名> 与自然语言意图返回候选工具清单与工作台装配行动卡片', async () => {
    const resSlash = await dispatchSiteCommand('/pack 前端开发', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resSlash.handled).toBe(true)
    expect(resSlash.action).toBe('pack_workspace')
    expect(resSlash.reply).toContain('已为您规划「前端开发」主题工作台')
    expect(resSlash.actionCard).toBeDefined()
    expect(resSlash.actionCard?.actionName).toBe('create_topic_workspace')
    expect(resSlash.actionCard?.payload?.topic).toBe('前端开发 工作台')

    const resNl = await dispatchSiteCommand('帮我搭建一套独立开发者工具箱', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resNl.handled).toBe(true)
    expect(resNl.action).toBe('pack_workspace')
    expect(resNl.actionCard?.actionName).toBe('create_topic_workspace')
    expect(resNl.actionCard?.payload?.topic).toContain('独立开发者')
  })

  // ── 22. createTopicWorkspace 建组、存入书签、生成内嵌笔记与撤销 ──
  it('createTopicWorkspace 正确建组、存入书签、聚焦视图并支持 /undo 撤销', async () => {
    const candidates = [
      { title: 'Zeabur', url: 'https://zeabur.com', notes: '极速部署平台' },
      { title: 'Excalidraw', url: 'https://excalidraw.com', notes: '在线白板' },
    ]

    const res = await createTopicWorkspace('全栈开发', candidates, 'c1', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })

    expect(res.success).toBe(true)
    expect(res.group).not.toBeNull()
    expect(res.totalBookmarks).toBe(2)
    expect(mockDs.addBookmark).toHaveBeenCalledTimes(2)
    expect(mockDs.addGroup).toHaveBeenCalledTimes(1)
    expect(mockApp.save).toHaveBeenCalled()
    expect(mockUi.curCat).toBe('c1')
    expect(mockUi.focusedGroupId).toBe(res.group!.id)
    expect(res.group!.notes).toContain('group-inline-card')

    // 测试 /undo 撤销创建工作台
    const resUndo = await dispatchSiteCommand('/undo', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resUndo.handled).toBe(true)
    expect(resUndo.reply).toContain('已撤销创建主题工作台')
    expect(mockDs.deleteGroup).toHaveBeenCalledWith(res.group!.id)
    expect(mockUi.focusedGroupId).toBeNull()
  })

  // ── 23. /deadlink 包含失效链接时出具 Wayback 历史镜像与平替行动卡片 ──
  it('/deadlink 发现死链时输出 Wayback 历史快照链接与平替推荐 ActionCard', async () => {
    // 制造一个死链书签
    mockDs.bookmarks.push({
      id: 'b-dead',
      title: '旧版 Figma',
      url: 'https://figma.com/old-dead-page',
      categoryId: 'c2',
      attributes: { 'dead-link': true },
    } as unknown as Bookmark)
    mockDs.bookmarkMap['b-dead'] = mockDs.bookmarks[mockDs.bookmarks.length - 1]

    const res = await dispatchSiteCommand('/deadlink', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })

    expect(res.handled).toBe(true)
    expect(res.action).toBe('deadlinks')
    expect(res.reply).toContain('死链巡检报告')
    expect(res.reply).toContain('web.archive.org/web/*/')
    expect(res.actionCard).toBeDefined()
    expect(res.actionCard?.actionName).toBe('heal_deadlink')
    expect(res.actionCard?.payload?.deadBmId).toBe('b-dead')
  })

  // ── 24. healDeadlink 自愈失效书签并支持撤销 ──
  it('healDeadlink 将失效书签无缝替换为现役平替并支持 /undo 还原', async () => {
    mockDs.bookmarks.push({
      id: 'b-dead-2',
      title: '失效白板',
      url: 'https://dead-board.org',
      icon: '',
      notes: '旧白板',
      attributes: { 'dead-link': true },
    } as unknown as Bookmark)
    const deadBm = mockDs.bookmarks[mockDs.bookmarks.length - 1]
    mockDs.bookmarkMap['b-dead-2'] = deadBm

    const replacement = {
      title: 'Excalidraw',
      url: 'https://excalidraw.com',
      notes: '开源白板平替',
    }

    const res = await healDeadlink('b-dead-2', replacement, {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })

    expect(res.success).toBe(true)
    expect(mockDs.updateBookmark).toHaveBeenCalledWith(
      'b-dead-2',
      expect.objectContaining({
        title: 'Excalidraw',
        url: 'https://excalidraw.com',
        attributes: expect.objectContaining({
          'dead-link-healed': true,
        }),
      }),
    )
    expect(deadBm.attributes['dead-link']).toBeUndefined()

    // 撤销自愈
    const resUndo = await dispatchSiteCommand('/undo', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resUndo.handled).toBe(true)
    expect(resUndo.reply).toContain('已撤销平替自愈')
    expect(mockDs.updateBookmark).toHaveBeenCalledWith(
      'b-dead-2',
      expect.objectContaining({
        title: '失效白板',
        url: 'https://dead-board.org',
        attributes: expect.objectContaining({
          'dead-link': true,
        }),
      }),
    )
  })

  it('多级事务撤销栈：支持连续 /undo 多步回退并反馈剩余步数', async () => {
    // 动作 1：创建分类 A
    await dispatchSiteCommand('/cat add 音乐推荐', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })

    // 动作 2：创建分类 B
    await dispatchSiteCommand('/cat add 播客精选', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })

    // 第一次撤销（回退动作 2：播客精选）
    const undo1 = await dispatchSiteCommand('/undo', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(undo1.handled).toBe(true)
    expect(undo1.reply).toContain('播客精选')
    expect(undo1.reply).toContain('还可撤销 1 步操作')

    // 第二次撤销（回退动作 1：音乐推荐）
    const undo2 = await dispatchSiteCommand('/undo', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(undo2.handled).toBe(true)
    expect(undo2.reply).toContain('音乐推荐')
    expect(undo2.reply).not.toContain('还可撤销')

    // 第三次撤销：空栈
    const undo3 = await dispatchSiteCommand('/undo', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(undo3.reply).toContain('当前没有可撤销的站内操作')
  })

  it('双语自然语言：英文日常指令正常调度', async () => {
    // switch to dark mode
    const resTheme = await dispatchSiteCommand('switch to dark mode', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resTheme.handled).toBe(true)
    expect(mockUi.setThemeColor).toHaveBeenCalledWith('dark')

    // switch to list view
    const resView = await dispatchSiteCommand('switch to list view', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resView.handled).toBe(true)
    expect(mockUi.layoutMode).toBe('list')

    // health check
    const resHealth = await dispatchSiteCommand('health check', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resHealth.handled).toBe(true)
    expect(resHealth.action).toBe('health')

    // inbox zero
    const resInbox = await dispatchSiteCommand('inbox zero', {
      ds: mockDs,
      ui: mockUi,
      app: mockApp,
    })
    expect(resInbox.handled).toBe(true)
    expect(resInbox.action).toBe('inbox_zero')
  })
})
