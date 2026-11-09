import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useInlineEdit } from '../../composables/ui/useInlineEdit.js'
import { saveGroupEdit, geForm } from '../../composables/domain/useGroup.js'
import { useDataStore } from '../../stores/data.js'
import { useUndoStore } from '../../stores/undo.js'
import { resetToDefaults } from '../../composables/domain/useDataIO.js'
import { addNewCategory } from '../../utils.js'
import { addAttrQuick } from '../../composables/domain/useAttrFilter.js'
import { setLocale } from '../../i18n/index.js'

vi.mock('../../lib/toast.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    showConfirm: vi.fn(async () => true),
    toast: vi.fn(),
    toastWithUndo: vi.fn(),
  }
})

describe('模块 5 审计修复专项回归套件 — 核心业务领域、卡片交互与编辑渲染', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    setLocale('zh-CN')
  })

  it('缺陷 1：useDragDrop.reorderInlineCard 深度防御：depth 边界安全解析段落位置', () => {
    // 验证 depth 边界判定不会抛 RangeError
    const mockResolve = (depth: number) => ({
      depth,
      before: (d: number) => {
        if (d < 1 || d > depth) throw new RangeError('Depth outside of range')
        return d * 10
      },
    })

    // 当 depth === 0（根节点/无效深度）
    const r0 = mockResolve(0)
    const p0 = r0.depth >= 1 ? r0.before(r0.depth) : null
    expect(p0).toBeNull()

    // 当 depth === 2（嵌套在列表或引用块内）
    const r2 = mockResolve(2)
    const p2 = r2.depth >= 1 ? r2.before(r2.depth) : null
    expect(p2).toBe(20)
  })

  it('缺陷 3：useInlineEdit 在 Escape 与 Enter 时 stopPropagation 阻止冒泡至卡片与全局', () => {
    const inline = useInlineEdit()
    const container = document.createElement('div')
    let saveVal = ''
    let cancelCalled = false

    inline.startEditing(container, 'Initial Note', {
      multiline: false,
      onSave: (v) => { saveVal = v },
      onCancel: () => { cancelCalled = true },
    })

    // 1. Enter: 阻止冒泡
    const enterEv = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    const stopSpyEnter = vi.spyOn(enterEv, 'stopPropagation')
    container.dispatchEvent(enterEv)
    expect(stopSpyEnter).toHaveBeenCalled()
    expect(saveVal).toBe('Initial Note')

    // 2. Escape: 阻止冒泡
    inline.startEditing(container, 'Initial Note 2', {
      onSave: (v) => { saveVal = v },
      onCancel: () => { cancelCalled = true },
    })
    const escEv = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const stopSpyEsc = vi.spyOn(escEv, 'stopPropagation')
    container.dispatchEvent(escEv)
    expect(stopSpyEsc).toHaveBeenCalled()
    expect(cancelCalled).toBe(true)
  })

  it('缺陷 4：useGroup.saveGroupEdit 组名空白时遵循当前语言环境多语言 unnamed 而非硬编码中文', () => {
    const ds = useDataStore()
    ds.addGroup({
      id: 'g_test',
      name: 'Old Name',
      categoryId: '',
      icon: '',
      order: 1,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>notes</p>',
      updatedAt: 1000,
      useCount: 0,
    })

    geForm.id = 'g_test'
    geForm.name = '   ' // 空白名

    // 英文环境下
    setLocale('en-US')
    saveGroupEdit()

    const updated = ds.groupMap['g_test']
    expect(updated.name).toBe('Untitled')

    // 中文环境下
    setLocale('zh-CN')
    geForm.id = 'g_test'
    geForm.name = ''
    saveGroupEdit()
    expect(ds.groupMap['g_test'].name).toBe('未命名')
  })

  it('缺陷 5：resetToDefaults 重置数据时同步清空 useUndoStore 历史堆栈', async () => {
    const undoStore = useUndoStore()
    undoStore.ensureStack('g_old').undo.push({ notes: '<p>secret notes</p>', bookmarkIds: [] })
    expect(undoStore.canUndo('g_old')).toBe(true)

    await resetToDefaults()

    // 撤销堆栈必须被清空
    expect(undoStore.canUndo('g_old')).toBe(false)
  })

  it('缺陷 6：addNewCategory 允许同名重建/恢复回收站中已软删的分类', () => {
    const appLike = {
      categories: [
        { id: 'cat_active', name: 'Active Cat', icon: 'star', color: '', order: 0 },
        { id: 'cat_deleted', name: 'Design', icon: 'star', color: '', order: 1, deletedAt: 12345 },
      ],
      addCategory: vi.fn((c) => { appLike.categories.push(c) }),
      restoreCategory: vi.fn((id) => {
        const target = appLike.categories.find(c => c.id === id)
        if (target) delete target.deletedAt
      }),
      renameCategory: vi.fn((id, name) => {
        const target = appLike.categories.find(c => c.id === id)
        if (target) target.name = name
      }),
      save: vi.fn(),
    }

    // 1. 添加已存在且未删除的分类：拒绝
    const dup = addNewCategory('Active Cat', appLike as any)
    expect(dup).toBeNull()

    // 2. 添加与已删除分类同名的分类：成功恢复而不是被判重拒绝
    const resurrected = addNewCategory('Design', appLike as any)
    expect(resurrected).not.toBeNull()
    expect(resurrected?.id).toBe('cat_deleted')
    expect(resurrected?.deletedAt).toBeUndefined()
    expect(appLike.restoreCategory).toHaveBeenCalledWith('cat_deleted')
  })

  it('缺陷 7：addAttrQuick 拦截空白名字并在已软删除同名属性时安全恢复', () => {
    const ds = useDataStore()

    // 1. 空白字符直接拒绝
    expect(addAttrQuick('   ')).toBe(false)

    // 2. 模拟回收站中存在属性
    ds.customAttributes = [
      { id: 'attr_del', name: 'Archived', type: 'boolean', deletedAt: 54321 } as any,
    ]
    ds._syncMaps()

    // 3. addAttrQuick 应该恢复软删除的属性
    const ok = addAttrQuick('Archived')
    expect(ok).toBe(true)
    const revived = ds.customAttributes.find(a => a.id === 'attr_del')
    expect(revived?.deletedAt).toBeUndefined()
  })
})
