import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { EditorManager } from '../../lib/editor.js'
import {
  convertAiContentToNoteHtml,
  appendAiContentToGroup,
  replaceAiContentToGroup,
  createNoteFromAiContent,
} from '../../lib/ai/noteWriteback.js'
import * as toastModule from '../../lib/toast.js'
import type { SiblingGroup } from '../../types.js'

describe('noteWriteback — AI 对话产物反向沉淀与写回笔记引擎', () => {
  let ui: ReturnType<typeof useUIStore>
  let ds: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    ui = useUIStore()
    ds = useDataStore()
    vi.clearAllMocks()
  })

  it('1. convertAiContentToNoteHtml：规范化 Markdown 并将随文卡片代码块转为优雅笔记链接', () => {
    const rawAiText = `
# 推荐工具链
以下是精选的画图与设计工具：
- 极客手绘白板

\`\`\`ulink-card
{
  "title": "Excalidraw",
  "url": "https://excalidraw.com",
  "notes": "手绘风白板工具"
}
\`\`\`

总结：适合快速架构梳理。
`
    const html = convertAiContentToNoteHtml(rawAiText)
    expect(html).toContain('Excalidraw')
    expect(html).toContain('https://excalidraw.com')
    expect(html).toContain('手绘风白板工具')
    // 原有的 raw json 块已被替换，不直接呈现 ```ulink-card 原始符号
    expect(html).not.toContain('```ulink-card')
  })

  it('2. appendAiContentToGroup：追加到原笔记，同步 TipTap 编辑器并支持撤销恢复', () => {
    const grp: SiblingGroup = {
      id: 'sg-demo',
      name: '研发笔记',
      categoryId: 'cat-dev',
      icon: '',
      order: 1,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>原始内容</p>',
      updatedAt: 100,
      useCount: 0,
    }
    ds.addGroup(grp)

    let lastUndoFn: (() => void) | null = null
    vi.spyOn(toastModule, 'toastWithUndo').mockImplementation((_msg, undoFn) => {
      lastUndoFn = undoFn
    })

    const silentSetContentSpy = vi.spyOn(EditorManager, 'silentSetContent')

    const res = appendAiContentToGroup('sg-demo', '## 新增建议\n使用 TypeScript 严格模式')
    expect(res.success).toBe(true)

    // 验证内容已追加并带有时间注记
    const updated = ds.groupMap['sg-demo']
    expect(updated.notes).toContain('原始内容')
    expect(updated.notes).toContain('AI 补充记录')
    expect(updated.notes).toContain('使用 TypeScript 严格模式')

    // 验证 TipTap 同步
    expect(silentSetContentSpy).toHaveBeenCalledWith('sg-demo', updated.notes)

    // 执行撤销
    expect(lastUndoFn).not.toBeNull()
    lastUndoFn!()

    const reverted = ds.groupMap['sg-demo']
    expect(reverted.notes).toBe('<p>原始内容</p>')
  })

  it('3. replaceAiContentToGroup：替换原笔记内容并提供一键撤销回滚', () => {
    const grp: SiblingGroup = {
      id: 'sg-replace',
      name: '临时笔记',
      categoryId: 'cat-dev',
      icon: '',
      order: 2,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>旧有待重构内容</p>',
      updatedAt: 100,
      useCount: 0,
    }
    ds.addGroup(grp)

    let lastUndoFn: (() => void) | null = null
    vi.spyOn(toastModule, 'toastWithUndo').mockImplementation((_msg, undoFn) => {
      lastUndoFn = undoFn
    })

    const res = replaceAiContentToGroup('sg-replace', '全新重构方案')
    expect(res.success).toBe(true)

    const updated = ds.groupMap['sg-replace']
    expect(updated.notes).toContain('全新重构方案')
    expect(updated.notes).not.toContain('旧有待重构内容')

    // 触发撤销
    expect(lastUndoFn).not.toBeNull()
    lastUndoFn!()

    const reverted = ds.groupMap['sg-replace']
    expect(reverted.notes).toBe('<p>旧有待重构内容</p>')
  })

  it('4. createNoteFromAiContent：自动提取标题并保存为新笔记组，支持撤销删除', () => {
    let lastUndoFn: (() => void) | null = null
    vi.spyOn(toastModule, 'toastWithUndo').mockImplementation((_msg, undoFn) => {
      lastUndoFn = undoFn
    })

    ui.curCat = 'cat-ai'

    const res = createNoteFromAiContent({
      aiText: '# 独立开发全栈技术选型\n推荐使用 Cloudflare Pages + Supabase 架构。',
    })

    expect(res.success).toBe(true)
    expect(res.groupId).toBeDefined()

    const newGroup = ds.groupMap[res.groupId!]
    expect(newGroup).toBeDefined()
    expect(newGroup.name).toBe('独立开发全栈技术选型')
    expect(newGroup.categoryId).toBe('cat-ai')
    expect(newGroup.notes).toContain('Cloudflare Pages')

    // 撤销该新建笔记组（软删除进回收站）
    expect(lastUndoFn).not.toBeNull()
    lastUndoFn!()

    expect(ds.groupMap[res.groupId!].deletedAt).toBeDefined()
    expect(ds.filteredGroups.some((g) => g.id === res.groupId)).toBe(false)
  })
})
