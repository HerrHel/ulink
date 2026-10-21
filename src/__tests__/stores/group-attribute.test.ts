import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { useAttrDropdownStore } from '../../stores/attrDropdown.js'
import { ATTR_IS_GROUP, DEFAULTS } from '../../config/constants.js'
import AttributeModal from '../../components/modals/AttributeModal.vue'
import ContextMenu from '../../components/overlays/ContextMenu.vue'
import AttrDropdown from '../../components/overlays/AttrDropdown.vue'
import { dispatchMenuAction } from '../../lib/menuConfig.js'
import type { SiblingGroup } from '../../types.js'

describe('笔记属性 (ATTR_IS_GROUP) 规范与不可变更契约', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('DEFAULTS 中初始属性含「笔记」且 id 为 ATTR_IS_GROUP', () => {
    const attr = DEFAULTS.customAttributes.find(a => a.id === ATTR_IS_GROUP)
    expect(attr).toBeDefined()
    expect(attr?.name).toBe('笔记')
  })

  it('deleteAttribute / permanentDeleteAttribute 对 ATTR_IS_GROUP 静默拦截，不可删除', () => {
    const ds = useDataStore()
    ds.customAttributes = [
      { id: 'custom-1', name: '自定义', type: 'boolean' },
      { id: ATTR_IS_GROUP, name: '笔记', type: 'boolean' }
    ]
    ds._syncMaps()

    // 尝试软删除
    ds.deleteAttribute(ATTR_IS_GROUP)
    const target = ds.customAttributes.find(a => a.id === ATTR_IS_GROUP)
    expect(target?.deletedAt).toBeUndefined()

    // 尝试永久删除
    ds.permanentDeleteAttribute(ATTR_IS_GROUP)
    expect(ds.customAttributes.some(a => a.id === ATTR_IS_GROUP)).toBe(true)

    // 尝试底层 _permanentDelete
    ds._permanentDelete('custom_attributes', ATTR_IS_GROUP)
    expect(ds.customAttributes.some(a => a.id === ATTR_IS_GROUP)).toBe(true)
  })

  it('renameAttribute 对 ATTR_IS_GROUP 静默拦截，不可重命名', () => {
    const ds = useDataStore()
    ds.customAttributes = [{ id: ATTR_IS_GROUP, name: '笔记', type: 'boolean' }]
    ds._syncMaps()

    ds.renameAttribute(ATTR_IS_GROUP, '已修改名称')
    expect(ds.customAttributes.find(a => a.id === ATTR_IS_GROUP)?.name).toBe('笔记')
  })

  it('ensureGroupAttribute: 缺失时自动补种，已软删时自动恢复，旧名「组」自动更名为「笔记」', () => {
    const ds = useDataStore()

    // 1. 缺失时补齐
    ds.customAttributes = [{ id: 'a1', name: '属性1', type: 'boolean' }]
    ds.siblingGroups = []
    expect(ds.ensureGroupAttribute()).toBe(true)
    const added = ds.customAttributes.find(a => a.id === ATTR_IS_GROUP)
    expect(added).toBeDefined()
    expect(added?.name).toBe('笔记')

    // 2. 软删时解删
    added!.deletedAt = Date.now()
    expect(ds.ensureGroupAttribute()).toBe(true)
    expect(added!.deletedAt).toBeUndefined()

    // 3. 旧名「组」更名
    added!.name = '组'
    expect(ds.ensureGroupAttribute()).toBe(true)
    expect(added!.name).toBe('笔记')

    // 4. 再次检查无变更返回 false
    expect(ds.ensureGroupAttribute()).toBe(false)
  })

  it('ensureGroupAttribute: 所有笔记自动自带 ATTR_IS_GROUP 属性且为 true', () => {
    const ds = useDataStore()
    ds.customAttributes = [{ id: ATTR_IS_GROUP, name: '笔记', type: 'boolean' }]
    const g1 = {
      id: 'g1',
      name: '笔记1',
      categoryId: 'cat1',
      icon: '',
      order: 0,
      isExpanded: false,
      bookmarkIds: [],
      notes: '',
      updatedAt: Date.now(),
      useCount: 0,
      isPublic: false,
    } as unknown as SiblingGroup
    const g2 = {
      ...g1,
      id: 'g2',
      attributes: { other: true },
    } as unknown as SiblingGroup

    ds.siblingGroups = [g1, g2]
    ds._syncMaps()

    const changed = ds.ensureGroupAttribute()
    expect(changed).toBe(true)
    expect(ds.siblingGroups[0].attributes).toEqual({ [ATTR_IS_GROUP]: true })
    expect(ds.siblingGroups[1].attributes).toEqual({ other: true, [ATTR_IS_GROUP]: true })
  })

  it('addGroup 与 updateGroup 强制保护 ATTR_IS_GROUP 属性不可被移除或修改为 false', () => {
    const ds = useDataStore()
    ds.customAttributes = [{ id: ATTR_IS_GROUP, name: '笔记', type: 'boolean' }]

    // 即使入参 attributes 不含 ATTR_IS_GROUP 或为 false，addGroup 强制补 true
    ds.addGroup({
      id: 'g_new',
      name: '测试组',
      categoryId: 'cat1',
      icon: '',
      order: 0,
      isExpanded: false,
      bookmarkIds: [],
      notes: '',
      updatedAt: Date.now(),
      useCount: 0,
      isPublic: false,
      attributes: { [ATTR_IS_GROUP]: false as unknown as boolean },
    })

    expect(ds.siblingGroups.find(g => g.id === 'g_new')?.attributes[ATTR_IS_GROUP]).toBe(true)

    // updateGroup 传入空 attributes 或显式 false，强制固化为 true
    ds.updateGroup('g_new', { attributes: { custom: true } as unknown as Record<string, boolean> })
    expect(ds.siblingGroups.find(g => g.id === 'g_new')?.attributes).toEqual({ custom: true, [ATTR_IS_GROUP]: true })

    ds.updateGroup('g_new', { attributes: { custom: false, [ATTR_IS_GROUP]: false } as unknown as Record<string, boolean> })
    expect(ds.siblingGroups.find(g => g.id === 'g_new')?.attributes[ATTR_IS_GROUP]).toBe(true)
  })

  it('AttributeModal 中 ATTR_IS_GROUP 渲染内置 badge 与专属图标，且不渲染编辑与删除按钮', () => {
    const ds = useDataStore()
    const app = useAppStore()
    ds.customAttributes = [
      { id: 'attr_user', name: '用户自定义', type: 'boolean' },
      { id: ATTR_IS_GROUP, name: '笔记', type: 'boolean' },
    ]
    ds._syncMaps()
    app.modals.attribute = true

    const wrapper = mount(AttributeModal)
    const items = wrapper.findAll('.list-item')
    expect(items.length).toBe(2)

    // 找到包含「笔记」的行
    const groupItem = items.find(it => it.text().includes('笔记'))
    expect(groupItem).toBeDefined()
    expect(groupItem?.find('.btn-danger').exists()).toBe(false)
    expect(groupItem?.find('button').exists()).toBe(false)
    // 视觉特化：专属图标与系统内置 badge
    expect(groupItem?.find('.attr-icon-system').exists()).toBe(true)
    expect(groupItem?.find('.attr-system-badge').text()).toBe('内置')

    // 用户自定义行应有编辑和删除按钮，且无内置 badge
    const userItem = items.find(it => it.text().includes('用户自定义'))
    expect(userItem?.find('.btn-danger').exists()).toBe(true)
    expect(userItem?.find('.attr-system-badge').exists()).toBe(false)
  })

  it('ContextMenu 与 dispatchMenuAction 对 ATTR_IS_GROUP 拦截菜单项与执行，且绝不弹出空白菜单条', () => {
    const ctx = useContextMenuStore()
    ctx.show({ clientX: 100, clientY: 100 } as MouseEvent, 'attr', ATTR_IS_GROUP)

    const wrapper = mount(ContextMenu)
    // 守卫：无菜单项时整个 ctx-menu 不展示（防白色空白条）
    expect(wrapper.find('#ctxMenu').isVisible()).toBe(false)

    // dispatchMenuAction 直接调用 DELETE 也应被早退拦截
    const ds = useDataStore()
    ds.customAttributes = [{ id: ATTR_IS_GROUP, name: '笔记', type: 'boolean' }]
    ds._syncMaps()

    dispatchMenuAction('attr', 'delete', ATTR_IS_GROUP)
    expect(ds.customAttributes.find(a => a.id === ATTR_IS_GROUP)?.deletedAt).toBeUndefined()
  })

  it('AttrDropdown 中 ATTR_IS_GROUP 渲染系统标签，且右键拦截不打开任何菜单', async () => {
    const ds = useDataStore()
    const drp = useAttrDropdownStore()
    const ctx = useContextMenuStore()
    drp.open = true

    ds.customAttributes = [
      { id: 'attr_user', name: '用户自定义', type: 'boolean' },
      { id: ATTR_IS_GROUP, name: '笔记', type: 'boolean' },
    ]
    ds._syncMaps()

    const wrapper = mount(AttrDropdown)
    const items = wrapper.findAll('.attr-drop-item')
    expect(items.length).toBe(2)

    const groupItem = items.find(it => it.text().includes('笔记'))
    expect(groupItem).toBeDefined()
    expect(groupItem?.classes()).toContain('is-system-attr')
    expect(groupItem?.find('.attr-system-tag').text()).toBe('内置')
    expect(groupItem?.find('.attr-icon-system').exists()).toBe(true)

    // 右键点击内置系统属性：应早退不呼出右键菜单
    expect(ctx.open).toBe(false)
    await groupItem?.trigger('contextmenu')
    expect(ctx.open).toBe(false)
  })
})
