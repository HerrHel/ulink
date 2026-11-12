import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ChatConvHeader from '../../components/chat/ChatConvHeader.vue'

function mountHeader(title = '帮我为我的书签补打标签', sessionId = 's1') {
  return mount(ChatConvHeader, {
    props: { title, sessionCount: 7, sessionId },
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

  it('Enter 提交：压缩空白后 emit rename（带编辑开始时的会话 id）', async () => {
    const w = mountHeader()
    await startEdit(w)
    const input = w.find('.conv-title-input')
    await input.setValue('  书签   整理  ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('rename')).toEqual([['s1', '书签 整理']])
    expect(w.find('.conv-title-input').exists()).toBe(false)
  })

  it('失焦同样提交（点走即保存）', async () => {
    const w = mountHeader()
    await startEdit(w)
    const input = w.find('.conv-title-input')
    await input.setValue('新标题')
    await input.trigger('blur')
    expect(w.emitted('rename')).toEqual([['s1', '新标题']])
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
    expect(w.emitted('rename')).toEqual([['s1', '']])
  })

  it('标题没有变化时不产生多余的持久化写入', async () => {
    const w = mountHeader('同一个标题')
    await startEdit(w)
    await w.find('.conv-title-input').setValue('同一个标题')
    await w.find('.conv-title-input').trigger('blur')
    expect(w.emitted('rename')).toBeUndefined()
  })

  it('中文输入法组合态按 Enter 选词不提交（isComposing / keyCode 229）', async () => {
    const w = mountHeader()
    await startEdit(w)
    const el = w.find('.conv-title-input').element as HTMLInputElement
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
    const ime229 = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(ime229, 'keyCode', { value: 229 })
    el.dispatchEvent(ime229)
    await nextTick()
    expect(w.emitted('rename')).toBeUndefined()
    expect(w.find('.conv-title-input').exists()).toBe(true)
    // 组合结束后正常 Enter 才提交
    await w.find('.conv-title-input').setValue('组合结束后的标题')
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(w.emitted('rename')).toHaveLength(1)
  })

  it('编辑中会话切换：取消编辑，不把旧草稿写进新会话', async () => {
    const w = mountHeader('旧会话标题', 's1')
    await startEdit(w)
    await w.find('.conv-title-input').setValue('旧会话的草稿')
    await w.setProps({ sessionId: 's2', title: '新会话标题' })
    await nextTick()
    expect(w.find('.conv-title-input').exists()).toBe(false)
    expect(w.emitted('rename')).toBeUndefined()
  })

  it('编辑中仅标题变化（同会话）：仍按捕获的会话 id 提交，且不拿旧标题当新标题', async () => {
    const w = mountHeader('自动标题', 's1')
    await startEdit(w)
    await w.find('.conv-title-input').setValue('我的标题')
    await w.setProps({ title: '流式生成出的新标题' })
    await nextTick()
    await w.find('.conv-title-input').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('rename')).toEqual([['s1', '我的标题']])
  })

  it('组件被卸载时兜底提交草稿，不静默丢失', async () => {
    const w = mountHeader('标题', 's7')
    await startEdit(w)
    await w.find('.conv-title-input').setValue('未提交的标题')
    w.unmount()
    expect(w.emitted('rename')).toEqual([['s7', '未提交的标题']])
  })

  it('60 字截断按码点，不切出半个 emoji', async () => {
    const w = mountHeader()
    await startEdit(w)
    const input = w.find('.conv-title-input')
    await input.setValue('😀'.repeat(70))
    await input.trigger('keydown', { key: 'Enter' })
    const title = (w.emitted('rename')?.[0] as [string, string])[1]
    expect(Array.from(title)).toHaveLength(60)
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})
