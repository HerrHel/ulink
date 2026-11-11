import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ChatConvHeader from '../../components/chat/ChatConvHeader.vue'

function mountHeader(title = '帮我为我的书签补打标签') {
  return mount(ChatConvHeader, {
    props: { title, sessionCount: 7 },
  })
}

async function startEdit(w: ReturnType<typeof mountHeader>) {
  await w.find('.conv-title').trigger('click')
  await nextTick()
}

describe('ChatConvHeader — 常驻会话顶栏（历史 / 标题 / 新对话）', () => {
  it('同时呈现历史入口、会话标题与新对话按钮', () => {
    const w = mountHeader()
    expect(w.find('.conv-history-btn').exists()).toBe(true)
    expect(w.find('.conv-history-count').text()).toBe('7')
    expect(w.find('.conv-title-text').text()).toBe('帮我为我的书签补打标签')
    expect(w.find('.conv-new-btn').text()).toContain('新对话')
  })

  it('点击历史 / 新对话分别 emit openHistory、newChat', async () => {
    const w = mountHeader()
    await w.find('.conv-history-btn').trigger('click')
    await w.find('.conv-new-btn').trigger('click')
    expect(w.emitted('openHistory')).toHaveLength(1)
    expect(w.emitted('newChat')).toHaveLength(1)
  })

  it('点击标题就地进入编辑，输入框预填当前标题', async () => {
    const w = mountHeader('当前这个标题')
    await startEdit(w)
    const input = w.find('.conv-title-input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('当前这个标题')
    expect(w.find('.conv-title').exists()).toBe(false)
  })

  it('Enter 提交：压缩空白后 emit rename', async () => {
    const w = mountHeader()
    await startEdit(w)
    const input = w.find('.conv-title-input')
    await input.setValue('  书签   整理  ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('rename')).toEqual([['书签 整理']])
    expect(w.find('.conv-title-input').exists()).toBe(false)
  })

  it('失焦同样提交（点走即保存）', async () => {
    const w = mountHeader()
    await startEdit(w)
    const input = w.find('.conv-title-input')
    await input.setValue('新标题')
    await input.trigger('blur')
    expect(w.emitted('rename')).toEqual([['新标题']])
  })

  it('Esc 取消：不 emit，回到展示态', async () => {
    const w = mountHeader()
    await startEdit(w)
    const input = w.find('.conv-title-input')
    await input.setValue('不要保存')
    await input.trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(w.emitted('rename')).toBeUndefined()
    expect(w.find('.conv-title-input').exists()).toBe(false)
    expect(w.find('.conv-title-text').text()).toBe('帮我为我的书签补打标签')
  })

  it('清空标题 emit 空串（交给上层恢复自动命名）', async () => {
    const w = mountHeader()
    await startEdit(w)
    const input = w.find('.conv-title-input')
    await input.setValue('   ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('rename')).toEqual([['']])
  })

  it('标题没有变化时不产生多余的持久化写入', async () => {
    const w = mountHeader('同一个标题')
    await startEdit(w)
    const input = w.find('.conv-title-input')
    await input.setValue('同一个标题')
    await input.trigger('blur')
    expect(w.emitted('rename')).toBeUndefined()
  })
})
