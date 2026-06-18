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
      appStore.save = () => {}
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
      appStore.save = () => {}
      dataStore.customAttributes = [{ id: 'test', name: 'Test', type: 'boolean' }]
      expect(addAttrQuick('Test')).toBe(false)
    })

    it('should sanitize id from name', () => {
      const dataStore = useDataStore()
      const appStore = useAppStore()
      appStore.save = () => {}
      addAttrQuick('My Tag!')
      expect(dataStore.customAttributes.some(a => a.id === 'my-tag')).toBe(true)
    })
  })
})
