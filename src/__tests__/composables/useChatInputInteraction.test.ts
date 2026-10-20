/**
 * useChatInputInteraction 单测：DetailPanel 输入框交互抽取后的回归锁
 * 覆盖：斜杠联想显示条件与前缀过滤、高亮索引复位、键盘调度（IME 守卫 / Esc 清空 /
 * 菜单导航选中 / Tab 前缀补全 / ↑↓ 历史回溯含 tempInput 保存恢复 / Enter 提交）、quickFill。
 * 断言全部走真实分支（mock 被调用 / defaultPrevented / 状态值变化），防假绿。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'
import { useChatInputInteraction, type SlashCommandItem } from '../../composables/ui/useChatInputInteraction.js'

const SLASH: SlashCommandItem[] = [
  { cmd: '/help', titleKey: 'ai.slashHelpTitle', descKey: 'ai.slashHelpDesc' },
  { cmd: '/health', titleKey: 'ai.slashHealthTitle', descKey: 'ai.slashHealthDesc' },
  { cmd: '/inbox', titleKey: 'ai.slashInboxTitle', descKey: 'ai.slashInboxDesc' },
]

interface Harness {
  api: ReturnType<typeof useChatInputInteraction>
  aiQuery: Ref<string>
  ta: HTMLTextAreaElement
  applySlashCommand: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
  adjustTextareaHeight: ReturnType<typeof vi.fn>
  inputHistory: Ref<string[]>
  historyCursor: Ref<number>
  tempInput: Ref<string>
}

function makeHarness(over: { query?: string; history?: string[]; cursor?: number } = {}): Harness {
  const aiQuery = ref(over.query ?? '')
  const ta = document.createElement('textarea')
  const inputHistory = ref<string[]>(over.history ?? [])
  const historyCursor = ref(over.cursor ?? inputHistory.value.length)
  const tempInput = ref('')
  const applySlashCommand = vi.fn()
  const submit = vi.fn()
  const adjustTextareaHeight = vi.fn()
  const api = useChatInputInteraction({
    aiQuery,
    textareaRef: ref(ta),
    slashCommands: SLASH,
    applySlashCommand,
    submit,
    adjustTextareaHeight,
    inputHistory,
    historyCursor,
    tempInput,
  })
  return { api, aiQuery, ta, applySlashCommand, submit, adjustTextareaHeight, inputHistory, historyCursor, tempInput }
}

/** 构造 KeyboardEvent；jsdom 不支持 isComposing 初始化，用 defineProperty 注入 */
function key(e: Partial<KeyboardEventInit> & { key: string; isComposing?: boolean }): KeyboardEvent {
  const { isComposing, ...init } = e
  const ev = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  if (isComposing !== undefined) {
    Object.defineProperty(ev, 'isComposing', { value: isComposing })
  }
  return ev
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useChatInputInteraction 斜杠联想', () => {
  it('showSlashSuggest：仅「/ 前缀且无空格」时显示', () => {
    const { api, aiQuery } = makeHarness()
    expect(api.showSlashSuggest.value).toBe(false)
    aiQuery.value = '/he'
    expect(api.showSlashSuggest.value).toBe(true)
    aiQuery.value = '/he x'
    expect(api.showSlashSuggest.value).toBe(false)
    aiQuery.value = 'hello'
    expect(api.showSlashSuggest.value).toBe(false)
  })

  it('filteredSlashCommands：前缀过滤，title/desc 经 i18n 渲染非空', () => {
    const { api } = makeHarness({ query: '/he' })
    expect(api.filteredSlashCommands.value.map((c) => c.cmd)).toEqual(['/help', '/health'])
    for (const c of api.filteredSlashCommands.value) {
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.desc.length).toBeGreaterThan(0)
    }
  })

  it('过滤结果变化时 activeSlashIndex 复位为 0', async () => {
    const { api, aiQuery } = makeHarness({ query: '/h' })
    api.activeSlashIndex.value = 1
    aiQuery.value = '/inbox'
    await nextTick()
    expect(api.activeSlashIndex.value).toBe(0)
  })
})

describe('useChatInputInteraction 键盘调度', () => {
  it('IME 组合中 Enter 不提交', () => {
    const { api, submit } = makeHarness()
    api.handleKeyDown(key({ key: 'Enter', isComposing: true }))
    expect(submit).not.toHaveBeenCalled()
  })

  it('Esc：有输入时清空并拦截（preventDefault + stopPropagation）', () => {
    const { api, aiQuery, adjustTextareaHeight } = makeHarness({ query: 'abc' })
    const ev = key({ key: 'Escape' })
    const stopSpy = vi.spyOn(ev, 'stopPropagation')
    api.handleKeyDown(ev)
    expect(aiQuery.value).toBe('')
    expect(ev.defaultPrevented).toBe(true)
    expect(stopSpy).toHaveBeenCalled()
    expect(adjustTextareaHeight).toHaveBeenCalledTimes(1)
  })

  it('Esc：空输入放行全局（不拦截）', () => {
    const { api, adjustTextareaHeight } = makeHarness()
    const ev = key({ key: 'Escape' })
    api.handleKeyDown(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(adjustTextareaHeight).not.toHaveBeenCalled()
  })

  it('补全菜单 ArrowUp/ArrowDown 环形导航并 preventDefault', () => {
    const { api } = makeHarness({ query: '/h' })
    // 命中 /help /health 两条
    expect(api.filteredSlashCommands.value.length).toBe(2)
    api.activeSlashIndex.value = 0
    const up = key({ key: 'ArrowUp' })
    api.handleKeyDown(up)
    expect(api.activeSlashIndex.value).toBe(1)
    expect(up.defaultPrevented).toBe(true)
    const down = key({ key: 'ArrowDown' })
    api.handleKeyDown(down)
    expect(api.activeSlashIndex.value).toBe(0)
    expect(down.defaultPrevented).toBe(true)
  })

  it('补全菜单 Enter/Tab 选中高亮项调用 applySlashCommand', () => {
    const { api, applySlashCommand, submit } = makeHarness({ query: '/h' })
    api.activeSlashIndex.value = 1
    api.handleKeyDown(key({ key: 'Enter' }))
    expect(applySlashCommand).toHaveBeenCalledWith('/health')
    expect(submit).not.toHaveBeenCalled()
    api.handleKeyDown(key({ key: 'Tab' }))
    expect(applySlashCommand).toHaveBeenCalledWith('/health')
  })

  it('Tab 前缀补全：无空格斜杠前缀命中；带空格或无命中不补全', () => {
    const { api, applySlashCommand } = makeHarness({ query: '/hel' })
    api.handleKeyDown(key({ key: 'Tab' }))
    expect(applySlashCommand).toHaveBeenCalledWith('/help')
    applySlashCommand.mockClear()
    // 带空格后 Tab 不补全
    const h2 = makeHarness({ query: '/hel x' })
    h2.api.handleKeyDown(key({ key: 'Tab' }))
    expect(h2.applySlashCommand).not.toHaveBeenCalled()
    // 无命中指令的斜杠前缀 → 不补全
    const h3 = makeHarness({ query: '/zz' })
    h3.api.handleKeyDown(key({ key: 'Tab' }))
    expect(h3.applySlashCommand).not.toHaveBeenCalled()
  })

  it('↑ 历史回溯：保存 tempInput、逐条回翻、到顶不再动', async () => {
    const { api, aiQuery, ta, historyCursor, tempInput, adjustTextareaHeight } = makeHarness({
      query: 'draft',
      history: ['first', 'second'],
      cursor: 2,
    })
    ta.selectionStart = 0
    ta.selectionEnd = 0
    api.handleKeyDown(key({ key: 'ArrowUp' }))
    await nextTick()
    expect(tempInput.value).toBe('draft')
    expect(historyCursor.value).toBe(1)
    expect(aiQuery.value).toBe('second')
    expect(adjustTextareaHeight).toHaveBeenCalledTimes(1)

    api.handleKeyDown(key({ key: 'ArrowUp' }))
    await nextTick()
    expect(historyCursor.value).toBe(0)
    expect(aiQuery.value).toBe('first')

    // 到顶后不再回翻（真实分支：状态不变）
    api.handleKeyDown(key({ key: 'ArrowUp' }))
    await nextTick()
    expect(aiQuery.value).toBe('first')
    expect(historyCursor.value).toBe(0)
  })

  it('↓ 前进：逐条前进到底后恢复 tempInput', async () => {
    const { api, aiQuery, ta, historyCursor, tempInput } = makeHarness({
      query: 'first',
      history: ['first', 'second'],
      cursor: 0,
    })
    tempInput.value = 'draft'
    ta.selectionStart = 10
    ta.selectionEnd = 10
    api.handleKeyDown(key({ key: 'ArrowDown' }))
    await nextTick()
    expect(historyCursor.value).toBe(1)
    expect(aiQuery.value).toBe('second')

    api.handleKeyDown(key({ key: 'ArrowDown' }))
    await nextTick()
    expect(historyCursor.value).toBe(2)
    expect(aiQuery.value).toBe('draft')
  })

  it('↑ 多行输入且光标不在行首时不翻历史（守卫真实生效）', () => {
    const { api, aiQuery, ta, historyCursor } = makeHarness({
      query: 'line1\nline2',
      history: ['first'],
      cursor: 1,
    })
    // jsdom 空 textarea 的 selectionStart 会被钳到 0，需先赋值再定位光标
    ta.value = aiQuery.value
    ta.selectionStart = 3
    ta.selectionEnd = 3
    api.handleKeyDown(key({ key: 'ArrowUp' }))
    expect(aiQuery.value).toBe('line1\nline2')
    expect(historyCursor.value).toBe(1)
  })

  it('Enter 提交、Shift+Enter 换行不提交', () => {
    const { api, submit } = makeHarness({ query: 'hi' })
    api.handleKeyDown(key({ key: 'Enter', shiftKey: true }))
    expect(submit).not.toHaveBeenCalled()
    api.handleKeyDown(key({ key: 'Enter' }))
    expect(submit).toHaveBeenCalledTimes(1)
  })
})

describe('useChatInputInteraction quickFill', () => {
  it('填充文本并提交', () => {
    const { api, aiQuery, submit } = makeHarness()
    api.quickFill('/health')
    expect(aiQuery.value).toBe('/health')
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
