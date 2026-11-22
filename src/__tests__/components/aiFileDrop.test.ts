/**
 * 从系统拖入文件到 AI 对话：
 * - 右侧 AI 栏：拖到输入框上只添加一次（回归：输入框与外层面板曾各解析一遍，同一文件出现两次）；
 * - AI 页：拖入文件作为附件引用（回归：原先只认站内卡片，文件松手后无反应）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useUIStore } from '../../stores/ui.js'
import DetailPanel from '../../components/shell/DetailPanel.vue'
import AiWorkspace from '../../components/chat/AiWorkspace.vue'

const { processMock } = vi.hoisted(() => ({ processMock: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  showConfirm: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../lib/ai/attachmentHelper.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/ai/attachmentHelper.js')>()
  return { ...mod, processFileForAi: processMock }
})

const flush = () => new Promise((r) => setTimeout(r, 0))

function fileDropInit(files: File[]) {
  return {
    dataTransfer: {
      types: ['Files'],
      files,
      getData: () => '',
    },
  }
}

describe('拖入文件到 AI 对话', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    let seq = 0
    processMock.mockImplementation(async (f: File) => ({
      id: 'file_' + ++seq, name: f.name, type: 'file', mimeType: 'text/plain', size: f.size, sizeFormatted: '1 B',
    }))
  })

  it('右侧 AI 栏：拖到输入框上，同一文件只添加一次', async () => {
    const ui = useUIStore()
    ui.panels.detail = true
    const wrapper = mount(DetailPanel, { attachTo: document.body })
    const dock = wrapper.find('.chat-input-dock')
    expect(dock.exists()).toBe(true)

    await dock.trigger('drop', fileDropInit([new File(['x'], 'notes.txt')]))
    await flush()

    expect(processMock).toHaveBeenCalledTimes(1)
    expect(ui.aiAttachedFiles.map((f) => f.name)).toEqual(['notes.txt'])
    wrapper.unmount()
  })

  it('右侧 AI 栏：拖到对话区同样添加', async () => {
    const ui = useUIStore()
    ui.panels.detail = true
    const wrapper = mount(DetailPanel, { attachTo: document.body })
    await wrapper.find('#detailInner').trigger('drop', fileDropInit([new File(['x'], 'a.pdf'), new File(['y'], 'b.png')]))
    await flush()
    expect(ui.aiAttachedFiles.map((f) => f.name)).toEqual(['a.pdf', 'b.png'])
    wrapper.unmount()
  })

  it('AI 页：拖入文件作为附件引用', async () => {
    const ui = useUIStore()
    ui.activeView = 'ai'
    const wrapper = mount(AiWorkspace, { attachTo: document.body })
    await wrapper.find('.ai-workspace').trigger('drop', fileDropInit([new File(['x'], 'report.pdf')]))
    await flush()
    expect(processMock).toHaveBeenCalledTimes(1)
    expect(ui.aiAttachedFiles.map((f) => f.name)).toEqual(['report.pdf'])
    expect(wrapper.find('.ai-attach-pill.file').text()).toContain('report.pdf')
    wrapper.unmount()
  })
})
