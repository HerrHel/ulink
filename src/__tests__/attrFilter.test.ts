import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../stores/app.js'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { toggleAttrFilter, toggleAttrExclude, addAttrQuick } from '../composables/domain/useAttrFilter.js'

describe('useAttrFilter', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  describe('toggleAttrFilter', () => {
    it('should add attr to activeAttrs', () => {
      const uiStore = useUIStore()
      toggleAttrFilter('login')
      expect(uiStore.activeAttrs).toContain('login')
    })

    it('should remove attr from activeAttrs on second toggle', () => {
      const uiStore = useUIStore()
      toggleAttrFilter('login')
      toggleAttrFilter('login')
      expect(uiStore.activeAttrs).not.toContain('login')
    })

    it('should remove from excludedAttrs when adding to activeAttrs', () => {
      const uiStore = useUIStore()
      uiStore.excludedAttrs = ['login']
      toggleAttrFilter('login')
      expect(uiStore.activeAttrs).toContain('login')
      expect(uiStore.excludedAttrs).not.toContain('login')
    })
  })

  describe('toggleAttrExclude', () => {
    it('should add attr to excludedAttrs', () => {
      const uiStore = useUIStore()
      toggleAttrExclude('login')
      expect(uiStore.excludedAttrs).toContain('login')
    })

    it('should remove from activeAttrs when excluding', () => {
      const uiStore = useUIStore()
      uiStore.activeAttrs = ['login']
      toggleAttrExclude('login')
      expect(uiStore.excludedAttrs).toContain('login')
      expect(uiStore.activeAttrs).not.toContain('login')
    })
  })

  describe('addAttrQuick', () => {
    it('should add new attribute', () => {
      const dataStore = useDataStore()
      const appStore = useAppStore()
      appStore.save = async () => true
      const result = addAttrQuick('new-tag')
      expect(result).toBe(true)
      expect(dataStore.customAttributes.some(a => a.id === 'new-tag')).toBe(true)
    })

    it('should reject empty name', () => {
      expect(addAttrQuick('')).toBe(false)
    })

    it('should reject duplicate name', () => {
      const dataStore = useDataStore()
      const appStore = useAppStore()
      appStore.save = async () => true
      dataStore.customAttributes = [{ id: 'test', name: 'Test', type: 'boolean' }]
      expect(addAttrQuick('Test')).toBe(false)
    })

    it('should sanitize id from name', () => {
      const dataStore = useDataStore()
      const appStore = useAppStore()
      appStore.save = async () => true
      addAttrQuick('My Tag!')
      expect(dataStore.customAttributes.some(a => a.id === 'my-tag')).toBe(true)
    })

    // ── 护栏：dsId 规范化管道各分支（七轮后 attrFilter 仅覆盖单事例，此处补齐 8 分支中的其余 7）──

    it('should collapse multiple whitespace runs into single dash', () => {
      const dataStore = useDataStore()
      useAppStore().save = async () => true
      addAttrQuick('My   Tag')
      expect(dataStore.customAttributes.some(a => a.id === 'my-tag')).toBe(true)
    })

    it('should strip non-alphanumeric chars and lowercase', () => {
      const dataStore = useDataStore()
      useAppStore().save = async () => true
      // 含中文 + 标点，规范化后只剩 ASCII 字母数字
      addAttrQuick('中文Tag!!201')
      expect(dataStore.customAttributes.some(a => a.id === 'tag201')).toBe(true)
    })

    it('should collapse consecutive dashes', () => {
      const dataStore = useDataStore()
      useAppStore().save = async () => true
      addAttrQuick('a---b')
      expect(dataStore.customAttributes.some(a => a.id === 'a-b')).toBe(true)
    })

    it('should trim leading and trailing dashes', () => {
      const dataStore = useDataStore()
      useAppStore().save = async () => true
      addAttrQuick('   tag   ')
      expect(dataStore.customAttributes.some(a => a.id === 'tag')).toBe(true)
    })

    it('should fall back to gid() when sanitization yields empty string', () => {
      const dataStore = useDataStore()
      useAppStore().save = async () => true
      // 全是非字母数字 + 空格 → 规范化得空串 → 回退 gid() 生成非空随机 id
      const result = addAttrQuick('！@# ￥%……&*')
      expect(result).toBe(true)
      const added = dataStore.customAttributes.find(a => a.name === '！@# ￥%……&*')
      expect(added).toBeTruthy()
      expect(typeof added!.id).toBe('string')
      expect(added!.id.length).toBeGreaterThan(0)
    })

    it('should short-circuit on duplicate id (attributeMap[dsId] hit)', () => {
      const dataStore = useDataStore()
      useAppStore().save = async () => true
      // 已有 id='my-tag' 的属性，再以会规范化为同一 id 的名字新建 → 应拒
      dataStore.customAttributes = [{ id: 'my-tag', name: 'Different Display Name', type: 'boolean' }]
      expect(addAttrQuick('My Tag!')).toBe(false)
    })

    it('should short-circuit on duplicate name (attributeByName[name] exact-string hit)', () => {
      const dataStore = useDataStore()
      useAppStore().save = async () => true
      // attributeByName 按 name 字符串精确匹配（不规范化），故原始 name 全等才判重。
      // 既有 id 不同但 name='old' 的属性，再用同全等 name 新建 → name 重复应拒。
      // 关键：传入原始 name='old'（dsId 也是 'old'，故 attributeMap['old'] 也会先命中），
      //   所以此用例同时命中 id 路径；下方独立用例隔离 name 精确匹配特性。
      dataStore.customAttributes = [{ id: 'alias-a', name: 'old', type: 'boolean' }]
      expect(addAttrQuick('old')).toBe(false)
    })

    it('should NOT short-circuit when existing name differs by trailing punctuation (exact-string semantics)', () => {
      const dataStore = useDataStore()
      useAppStore().save = async () => true
      // 既有 name='My Tag'（id='alias-a'），新建用 'My Tag!'：
      //   dsId 规范化新名得 'my-tag' ≠ 'alias-a' → attributeMap 不命中；
      //   attributeByName['My Tag!'] ≠ 'My Tag'（精确串匹配，标点算差异）→ 不命中；
      // → 不短路，应新建成功。锁定 attributeByName 精确串语义（标点不等不算重）。
      dataStore.customAttributes = [{ id: 'alias-a', name: 'My Tag', type: 'boolean' }]
      const result = addAttrQuick('My Tag!')
      expect(result).toBe(true)
      expect(dataStore.customAttributes.some(a => a.id === 'my-tag' && a.name === 'My Tag!')).toBe(true)
    })
  })
})
