import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import CommandPalette from '../../components/overlays/CommandPalette.vue'

describe('CommandPalette — AI 智能中枢与斜杠指令流转 (Omnibox Integration)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('键入斜杠指令 /health 时展示 AI 行动项并支持点击流转至 AI 助手', async () => {
    const ui = useUIStore()
    vi.spyOn(ui, 'openAiAssistant')

    const wrapper = mount(CommandPalette)
    // 模拟快捷键打开
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await nextTick()

    const input = wrapper.find('input.cmd-input')
    await input.setValue('/health')
    await nextTick()

    const aiItems = wrapper.findAll('.cmd-item')
    expect(aiItems.length).toBeGreaterThan(0)

    const healthItem = aiItems.find(i => i.text().includes('/health'))
    expect(healthItem).toBeDefined()
    await healthItem!.trigger('click')

    expect(ui.openAiAssistant).toHaveBeenCalledWith('/health')
    wrapper.unmount()
  })

  it('键入自然语言需求时提供「让 AI 助手甄选」入口', async () => {
    const ui = useUIStore()
    vi.spyOn(ui, 'openAiAssistant')

    const wrapper = mount(CommandPalette)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await nextTick()

    const input = wrapper.find('input.cmd-input')
    await input.setValue('帮我找原型设计工具')
    await nextTick()

    const aiAskItem = wrapper.findAll('.cmd-item').find(i => i.text().includes('帮我找原型设计工具'))
    expect(aiAskItem).toBeDefined()
    await aiAskItem!.trigger('click')

    expect(ui.openAiAssistant).toHaveBeenCalledWith('帮我找原型设计工具')
    wrapper.unmount()
  })
})
