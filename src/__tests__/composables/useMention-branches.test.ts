/**
 * 行为契约护栏：useMention 未覆盖分支补测——showNear / onTrigger / onInput / onKeydown + _insertHTML select 路径
 *
 * 覆盖 useMention.ts 行 32.45%→≥85% 的未覆盖区：
 *   - showNear（47-68）：bm/group 两模式过滤 + !matches 早退 + subItems 映射 + pos 定位（getClientRects 有/无两路）
 *   - onTrigger（131-140）：@/# 触发键 + 非 group-body / 非 editable 早退 + 设 gid/active/type/query
 *   - onInput（142-160）：!active / 非 group-body / 无 selection / 非文本节点 早退 + 匹配 trigger → setQuery+showNear / 不匹配 → hide
 *   - onKeydown（162-175）：!isVisible / 非 group-body 早退 + ArrowDown/Up 循环 + Escape + Enter 分派 selectBookmark/selectGroupRef
 *   - _insertHTML（80-104，经 selectBookmark 间接）：focusNode 文本节点+trigger 命中 → deleteRange+insertContent；trigger 不命中 → _mentionRange/兜底 insertContent
 *
 * 桩策略（沿用 useMention-select.test.ts 骨架）：
 *   - jsdom window.getSelection() 可真实 addRange 让 rangeCount>0（探测确认），唯一缺 getClientRects —— 对 showNear pos 行桩 Range.prototype.getClientRects
 *   - TipTap ed.view.posAtDOM 不可在 jsdom 达 → 经 makeStubEditor 的 ed.view 注入桩返回数字
 *   - 复用真 Pinia useMentionStore（gid/active/type/setQuery/hide 真联动）
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock data store（沿用 useMention-select.test.ts 口径）----
const mockData = {
  siblingGroups: [] as any[],
  bookmarks: [] as any[],
  groupMap: {} as Record<string, any>,
  bookmarkMap: {} as Record<string, any>,
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
}

vi.mock('../../stores/data.js', () => ({
  useDataStore: vi.fn(() => mockData),
}))

vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: vi.fn(() => null),
    deleteNode: vi.fn(),
    getContentHTML: vi.fn(() => null),
  },
}))

vi.mock('../../composables/domain/useGroup.js', () => ({
  saveGroupBody: vi.fn(),
}))

vi.mock('../../composables/useInlineCard.js', () => ({
  inlineCardHTML: vi.fn(() => '<div class="inline-card-bm"></div>'),
  groupRefCardHTML: vi.fn(() => '<div class="ref-card-grp"></div>'),
}))

vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../../composables/ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))

import { useMention } from '../../composables/domain/useMention.js'
import { useMentionStore } from '../../stores/overlay.js'
import { saveAppData } from '../../stores/app.js'
import { saveGroupBody } from '../../composables/domain/useGroup.js'
import { EditorManager } from '../../lib/editor.js'
import { inlineCardHTML, groupRefCardHTML } from '../../composables/useInlineCard.js'

const inlineMock = inlineCardHTML as unknown as ReturnType<typeof vi.fn>
const refMock = groupRefCardHTML as unknown as ReturnType<typeof vi.fn>
const saveAppDataMock = saveAppData as unknown as ReturnType<typeof vi.fn>
const saveGroupBodyMock = saveGroupBody as unknown as ReturnType<typeof vi.fn>

// jsdom 不实现 HTMLElement.isContentEditable（IDL 反射返回 undefined），onTrigger/onInput 的
// `!isContentEditable` 守门在 jsdom 永远早退绕过生产逻辑——用原型 getter 读 contenteditable 属性
// 模拟浏览器语义（'true'/'plaintext-only' → true，否则 false），对非 editable 元素返 false 不误伤。
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
  configurable: true,
  get(this: HTMLElement) {
    const ce = this.getAttribute('contenteditable')
    return ce === 'true' || ce === 'plaintext-only'
  },
})

// jsdom 不实现 Range.getClientRects（showNear line 64 / pos 定位依赖），原型桩返回可控矩形供 clamp 断言。
// 默认空数组让「无定位矩形」分支可走；个别测需有值时 vi.spyOn(prototype,'getClientRects').mockReturnValue(...)。
// 制造一个满足 DOMRectList 结构（含 item 方法）的最小桩，避开 TS DOMRectList item 缺失报错。
function makeRectList(rects: DOMRect[]): DOMRectList {
  const arr = rects as any
  arr.item = (i: number) => rects[i] ?? null
  return arr as DOMRectList
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function (): DOMRectList { return makeRectList([]) }
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function (): DOMRect { return { x: 0, y: 0, left: 0, bottom: 0, width: 0, height: 0, top: 0, right: 0, toJSON() {} } as any }
}

/** 桩 editor：chain().deleteRange().insertContent().run() 链式 + ed.view.posAtDOM 注入 */
function makeStubEditor(posAtDOMFn?: (node: any, off: number) => number) {
  const chain: any = { insertContent: undefined, deleteRange: undefined, run: undefined }
  chain.insertContent = vi.fn(() => chain)
  chain.deleteRange = vi.fn(() => chain)
  chain.run = vi.fn(() => true)
  const ed: any = { chain: vi.fn(() => chain), _chain: chain }
  ed.view = {
    posAtDOM: posAtDOMFn ?? vi.fn(() => 0),
  }
  return ed
}

function resetMocks() {
  mockData.siblingGroups = []
  mockData.bookmarks = []
  mockData.groupMap = {}
  mockData.bookmarkMap = {}
  mockData.updateGroup.mockClear()
  saveAppDataMock.mockClear()
  saveGroupBodyMock.mockClear()
  inlineMock.mockClear()
  refMock.mockClear()
  const EM = EditorManager as any
  EM.get.mockReset()
}

/** 构造真实 Selection 选区落在文本节点 trigger 处，让 _insertHTML 走 posAtDOM 分支 */
function placeSelectionInEditable(text: string, focusOffset?: number, grep?: string) {
  const card = document.createElement('div')
  card.className = 'group-card'
  card.setAttribute('data-group-id', 'g1')
  const body = document.createElement('div')
  body.className = 'group-body'
  body.setAttribute('contenteditable', 'true')
  card.appendChild(body)
  document.body.appendChild(card)
  const txt = document.createTextNode(text)
  body.appendChild(txt)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  const r = document.createRange()
  // 选区覆盖 trigger 到词尾，focusOffset 落指定位置
  const off = focusOffset ?? text.length
  r.setStart(txt, 0)
  r.setEnd(txt, off)
  sel.addRange(r)
  return { card, body, txt }
}

const triggerKeys = (key: string) =>
  key === '@' ? { label: '@ 书签模式', expectedType: 'bm' as const } : { label: '# 组模式', expectedType: 'group' as const }

describe('useMention.showNear 过滤与定位契约', () => {
  let mentionStore: ReturnType<typeof useMentionStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
    mentionStore = useMentionStore()
  })
  afterEach(() => { vi.restoreAllMocks() })

  /**
   * showNear 是 useMention 内部闭包（未在 return 中导出），无法直接触达——
   * 经 onInput 间接覆盖其过滤/映射/早退/pos 定位分支：onInput 命中 trigger 后调
   * mentionStore.setQuery(slice)+showNear(query)。构造 .group-body[data-group-id=g1] 选区触发。
   */
  function driveOnInput(gid: string, text: string, focusOffset: number, type: 'bm' | 'group' = 'bm') {
    mentionStore.open(gid)
    mentionStore.type = type
    mentionStore.active = true
    const card = document.createElement('div')
    card.className = 'group-card'
    card.setAttribute('data-group-id', gid)
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    card.appendChild(body)
    document.body.appendChild(card)
    const txt = document.createTextNode(text)
    body.appendChild(txt)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    const r = document.createRange()
    r.setStart(txt, 0)
    r.setEnd(txt, focusOffset)
    sel.addRange(r)
    return { body, r, evt: { target: body } as unknown as Event }
  }

  it('bm 模式：title/url 含 query 且无 parentId 过滤（经 onInput 触发 showNear 过滤）', () => {
    mockData.bookmarks = [
      { id: 'b1', title: 'GitHub', url: 'https://github.com', parentId: null },
      { id: 'b2', title: 'hub', url: 'https://hub.com', parentId: null },
      { id: 'b3', title: 'unrelated', url: 'x', parentId: 'p1' }, // 有 parentId 排除
      { id: 'b4', title: 'other', url: 'z', parentId: null }, // 不含 hub 排除
    ]
    const { evt } = driveOnInput('g1', '@hub', 4) // trigger @ 在 0，query=slice(1,4)='hub'
    const { onInput, candidates, isVisible } = useMention()
    onInput(evt)
    expect(mentionStore.query).toBe('hub')
    // 命中 b1(title 含)+b2(url 含)；b3 有 parentId 排除；b4 不含排除
    expect(candidates.value.map((c: any) => c.id)).toEqual(['b1', 'b2'])
    expect(candidates.value.every((c: any) => c.type === 'bookmark')).toBe(true)
    expect(isVisible.value).toBe(true)
  })

  it('bm 模式：候选含 subItems（父书签的子书签数组，经 onInput 触发）', () => {
    mockData.bookmarks = [
      { id: 'p1', title: 'parent', url: 'p', parentId: null },
      { id: 'c1', title: 'child1', url: 'c1', parentId: 'p1' },
      { id: 'c2', title: 'child2', url: 'c2', parentId: 'p1' },
    ]
    const { evt } = driveOnInput('g1', '@parent', 7) // query=slice(1,7)='parent'
    const { onInput, candidates } = useMention()
    onInput(evt)
    expect(candidates.value).toHaveLength(1)
    const sub = (candidates.value[0] as any).subItems
    expect(sub.map((s: any) => s.id)).toEqual(['c1', 'c2'])
  })

  it('group 模式：name 含 query 且排除当前 gid（经 onInput 触发）', () => {
    mockData.siblingGroups = [
      { id: 'g-cur', name: 'current grp' },
      { id: 'g2', name: 'target group' },
      { id: 'g3', name: 'other' },
    ]
    const { evt } = driveOnInput('g-cur', '#group', 6, 'group') // trigger # 在 0，query='group'
    const { onInput, candidates } = useMention()
    onInput(evt)
    expect(mentionStore.query).toBe('group')
    // g-cur 排除（当前编辑组），g2 命中，g3 不含排除
    expect(candidates.value.map((c: any) => c.id)).toEqual(['g2'])
    expect(candidates.value.every((c: any) => c.type === 'group')).toBe(true)
  })

  it('!matches.length → showNear 早退 isVisible=false（无候选不弹下拉，经 onInput）', () => {
    mockData.bookmarks = [{ id: 'b1', title: 'only', url: 'o', parentId: null }]
    const { evt } = driveOnInput('g1', '@zzz-no-match', 13) // query='zzz-no-match' 无命中
    const { onInput, isVisible } = useMention()
    isVisible.value = true // 预置可见
    onInput(evt)
    // showNear 无匹配 → isVisible=false 早退
    expect(isVisible.value).toBe(false)
  })

  it('无 selection（rangeCount=0）→ onInput hide 早退（showNear 不被调）', () => {
    mentionStore.open('g1')
    mentionStore.type = 'bm'
    mentionStore.active = true
    const card = document.createElement('div')
    card.className = 'group-card'
    card.setAttribute('data-group-id', 'g1')
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    body.appendChild(document.createTextNode('x'))
    document.body.appendChild(card)
    window.getSelection()?.removeAllRanges() // 无选区
    const { onInput, isVisible } = useMention()
    isVisible.value = true
    onInput({ target: body } as unknown as Event)
    expect(isVisible.value).toBe(false)
  })

  it('pos 定位：getClientRects 有值 → clamp 到视口内（不超 innerWidth-310 / innerHeight-220）', () => {
    mockData.bookmarks = [{ id: 'b1', title: 'hit', url: 'h', parentId: null }]
    window.innerWidth = 1000
    window.innerHeight = 1000
    const { evt, r } = driveOnInput('g1', '@hit', 4) // query='hit' 命中 b1 → candidates 非空 → showNear 跑 pos 块
    // 桩本次 showNear 内 getRangeAt(0).getClientRects() 返回越界矩形验 clamp（makeRectList 带 item 满足 DOMRectList 类型）
    vi.spyOn(r, 'getClientRects').mockReturnValue(makeRectList([{ left: 5000, bottom: 5000 } as any]))
    const { onInput, pos } = useMention()
    onInput(evt)
    // x: min(5000, 1000-310=690)=690; y: min(5000+4=5004, 1000-220=780)=780
    expect(pos.value).toEqual({ x: 690, y: 780 })
  })
})

describe('useMention.onTrigger 触发键契约', () => {
  let mentionStore: ReturnType<typeof useMentionStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
    mentionStore = useMentionStore()
  })
  afterEach(() => { vi.restoreAllMocks() })

  function setupEditable() {
    const card = document.createElement('div')
    card.className = 'group-card'
    card.setAttribute('data-group-id', 'g-trigger')
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    card.appendChild(body)
    document.body.appendChild(card) // 挂 card（body 父），让 body.closest('.group-card') 命中取 data-group-id
    const evt = { key: '', target: body } as unknown as KeyboardEvent
    return { body, evt }
  }

  for (const [key, { label, expectedType }] of Object.entries({ '@': triggerKeys('@'), '#': triggerKeys('#') })) {
    it(`${label}：有效 group-body+editable → 设 gid/active=true/type=${expectedType}/query='' `, () => {
      mentionStore.active = false
      const { evt } = setupEditable()
      ;(evt as any).key = key
      const { onTrigger } = useMention()
      onTrigger(evt)
      expect(mentionStore.gid).toBe('g-trigger')
      expect(mentionStore.active).toBe(true)
      expect(mentionStore.type).toBe(expectedType)
      expect(mentionStore.query).toBe('')
    })
  }

  it('非 @/# 键 → 早退（不设 gid 不激活）', () => {
    mentionStore.active = false
    const { evt } = setupEditable()
    ;(evt as any).key = 'a'
    const { onTrigger } = useMention()
    onTrigger(evt)
    expect(mentionStore.active).toBe(false)
    expect(mentionStore.gid).toBe(null)
  })

  it('非 .group-body → 早退', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    document.body.appendChild(div)
    const evt = { key: '@', target: div } as unknown as KeyboardEvent
    const { onTrigger } = useMention()
    onTrigger(evt)
    expect(mentionStore.active).toBe(false)
  })

  it('非 contentEditable → 早退', () => {
    const body = document.createElement('div')
    body.className = 'group-body'
    document.body.appendChild(body)
    const evt = { key: '@', target: body } as unknown as KeyboardEvent
    const { onTrigger } = useMention()
    onTrigger(evt)
    expect(mentionStore.active).toBe(false)
  })

  it('group-body 无父 group-card[data-group-id] → gid=null（closest 取不到回退 null）', () => {
    // group-body 但不在 group-card 内
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    document.body.appendChild(body)
    const evt = { key: '@', target: body } as unknown as KeyboardEvent
    const { onTrigger } = useMention()
    onTrigger(evt)
    expect(mentionStore.active).toBe(true)
    expect(mentionStore.gid).toBe(null)
  })
})

describe('useMention.onInput 输入过滤契约', () => {
  let mentionStore: ReturnType<typeof useMentionStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
    mentionStore = useMentionStore()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('!active → 早退（不查选区不过滤）', () => {
    mentionStore.active = false
    const evt = { target: document.body } as unknown as Event
    const { onInput, isVisible } = useMention()
    isVisible.value = true
    onInput(evt)
    // !active 直接 return，isVisible 不被改（未调 hide）
    expect(isVisible.value).toBe(true)
  })

  it('active 但 gid=null → 早退', () => {
    mentionStore.active = true
    mentionStore.gid = null
    const evt = { target: document.body } as unknown as Event
    const { onInput, isVisible } = useMention()
    isVisible.value = true
    onInput(evt)
    expect(isVisible.value).toBe(true) // !active||!gid 早退在 hide 之前
  })

  it('group-body gid 不匹配当前 gid → hide（切换了编辑组）', () => {
    mentionStore.active = true
    mentionStore.open('g-current')
    const card = document.createElement('div')
    card.className = 'group-card'
    card.setAttribute('data-group-id', 'g-other')
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    card.appendChild(body)
    document.body.appendChild(body)
    const evt = { target: body } as unknown as Event
    const { onInput, isVisible } = useMention()
    isVisible.value = true
    onInput(evt)
    expect(isVisible.value).toBe(false) // gid 不匹配 → hide
  })

  it('非文本节点（focusNode 非 nodeType=3）→ hide', () => {
    mentionStore.active = true
    mentionStore.open('g1')
    const card = document.createElement('div')
    card.className = 'group-card'
    card.setAttribute('data-group-id', 'g1')
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    card.appendChild(body)
    document.body.appendChild(body)
    // 选区落在 body（元素节点 nodeType=1）而非文本
    const sel = window.getSelection()!
    sel.removeAllRanges()
    const r = document.createRange()
    r.setStart(body, 0)
    r.setEnd(body, 0)
    sel.addRange(r)
    const evt = { target: body } as unknown as Event
    const { onInput, isVisible } = useMention()
    isVisible.value = true
    onInput(evt)
    expect(isVisible.value).toBe(false)
  })

  it('无 selection（rangeCount=0）→ hide', () => {
    mentionStore.active = true
    mentionStore.open('g1')
    const card = document.createElement('div')
    card.className = 'group-card'
    card.setAttribute('data-group-id', 'g1')
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    card.appendChild(body)
    document.body.appendChild(body)
    body.appendChild(document.createTextNode('x'))
    window.getSelection()?.removeAllRanges()
    const evt = { target: body } as unknown as Event
    const { onInput, isVisible } = useMention()
    isVisible.value = true
    onInput(evt)
    expect(isVisible.value).toBe(false)
  })

  it('匹配 trigger (@) → setQuery 触发词 + showNear（候选非空渲染下拉）', () => {
    mentionStore.active = true
    mentionStore.open('g1')
    mentionStore.type = 'bm'
    mockData.bookmarks = [
      { id: 'b1', title: 'github', url: 'g', parentId: null },
      { id: 'b2', title: 'gitlab', url: 'gl', parentId: null },
    ]
    const { body } = placeSelectionInEditable('@git', 4) // 文本 '@git'，focusOffset=4
    const evt = { target: body } as unknown as Event
    const { onInput, candidates, isVisible } = useMention()
    onInput(evt)
    // trigger @ at index 0, slice(1,4)='git'; query='git' 命中 b1/b2
    expect(mentionStore.query).toBe('git')
    expect(candidates.value.map((c: any) => c.id)).toEqual(['b1', 'b2'])
    expect(isVisible.value).toBe(true)
  })

  it('无 trigger 匹配（文本无 @）→ hide', () => {
    mentionStore.active = true
    mentionStore.open('g1')
    mentionStore.type = 'bm'
    const { body } = placeSelectionInEditable('plain text', 10) // 无 @
    const evt = { target: body } as unknown as Event
    const { onInput, isVisible } = useMention()
    isVisible.value = true
    onInput(evt)
    expect(isVisible.value).toBe(false)
  })
})

describe('useMention.onKeydown 键盘导航契约', () => {
  let mentionStore: ReturnType<typeof useMentionStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
    mentionStore = useMentionStore()
    // onKeydown 依赖 document.activeElement.closest('.group-body')；jsdom contentEditable focus 不设置 activeElement，
    // 用 getter 注入可控句柄让其指向 .group-body（源码读 activeElement?.closest?.('.group-body')）
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    document.body.appendChild(body)
    body.focus()
    let _activeEl: Element | null = body
    // 占用属性名供本 describe 内测试切换 activeElement（恢复在 afterEach）
    ;(globalThis as any).__activeEl = () => _activeEl
    ;(globalThis as any).__setActiveEl = (el: Element | null) => { _activeEl = el }
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => _activeEl,
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  function key(key: string) {
    return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent
  }

  it('!isVisible → 早退（不校验 activeElement 不分派）', () => {
    const { onKeydown } = useMention()
    // isVisible 默认 false
    const e = key('ArrowDown')
    onKeydown(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('activeElement 非 group-body → hide + return（不在编辑区不导航）', () => {
    // 切 activeElement 指向非 .group-body 元素（jsdom getter 已注入，改句柄值即可）
    const other = document.createElement('input')
    document.body.appendChild(other)
    ;((globalThis as any).__setActiveEl as (e: Element | null) => void)(other)
    const { onKeydown, isVisible } = useMention()
    isVisible.value = true
    onKeydown(key('ArrowDown'))
    expect(isVisible.value).toBe(false)
  })

  it('ArrowDown 循环：末项 → 首项（% len）', () => {
    const { onKeydown, isVisible, activeIdx, candidates } = useMention()
    isVisible.value = true
    candidates.value = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any
    activeIdx.value = 2 // 末项
    onKeydown(key('ArrowDown'))
    expect(activeIdx.value).toBe(0) // (2+1)%3 = 0 回首
  })

  it('ArrowUp 循环：首项 → 末项（+len 取模）', () => {
    const { onKeydown, isVisible, activeIdx, candidates } = useMention()
    isVisible.value = true
    candidates.value = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any
    activeIdx.value = 0 // 首项
    onKeydown(key('ArrowUp'))
    expect(activeIdx.value).toBe(2) // (0-1+3)%3 = 2 到末项
  })

  it('ArrowDown 中间项递增', () => {
    const { onKeydown, isVisible, activeIdx, candidates } = useMention()
    isVisible.value = true
    candidates.value = [{ id: 'a' }, { id: 'b' }] as any
    activeIdx.value = 0
    onKeydown(key('ArrowDown'))
    expect(activeIdx.value).toBe(1)
  })

  it('Escape → hide', () => {
    const { onKeydown, isVisible } = useMention()
    isVisible.value = true
    onKeydown(key('Escape'))
    expect(isVisible.value).toBe(false)
  })

  it('Enter + mentionType=bm → 分派 selectBookmark（按 activeIdx 候选 id）', () => {
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    mentionStore.open('g1')
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.bookmarks.push({ id: 'bm-2', title: 'B', url: 'b', parentId: null })
    mockData.bookmarkMap['bm-2'] = { id: 'bm-2', title: 'B' }
    // 一次解构：onKeydown 内读 activeIdx/candidates/mentionType 必须是同一实例的 ref
    const um = useMention()
    um.isVisible.value = true
    um.mentionType.value = 'bm'
    um.candidates.value = [{ id: 'bm-1' }, { id: 'bm-2' }] as any
    um.activeIdx.value = 1 // 选 bm-2
    um.onKeydown(key('Enter'))
    expect(inlineMock).toHaveBeenCalledWith(mockData.bookmarkMap['bm-2'])
    expect(saveGroupBodyMock).toHaveBeenCalledWith('g1')
    expect(um.isVisible.value).toBe(false) // selectBookmark 末调 hide
  })

  it('Enter + mentionType=group → 分派 selectGroupRef', () => {
    mentionStore.open('g1')
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.groupMap['g-other'] = { id: 'g-other', bookmarkIds: [] }
    const ed = makeStubEditor()
    ;(EditorManager as any).get.mockReturnValue(ed)
    const um = useMention()
    ;(um as any).activeIdx.value = 0
    ;(um as any).candidates.value = [{ id: 'g-other' }] as any
    ;(um as any).isVisible.value = true
    ;(um as any).mentionType.value = 'group'
    um.onKeydown(key('Enter'))
    expect(refMock).toHaveBeenCalledTimes(1)
    expect(saveGroupBodyMock).toHaveBeenCalledWith('g1')
  })

  it('Enter 候选为空（activeIdx 越界）→ s=undefined 不崩不分派', () => {
    const um = useMention()
    ;(um as any).isVisible.value = true
    ;(um as any).candidates.value = [] as any
    ;(um as any).activeIdx.value = 0
    ;(um as any).mentionType.value = 'bm'
    expect(() => um.onKeydown(key('Enter'))).not.toThrow()
    expect(inlineMock).not.toHaveBeenCalled()
    expect(refMock).not.toHaveBeenCalled()
  })
})

describe('useMention _insertHTML 选区插入分支（经 selectBookmark 间接覆盖）', () => {
  let mentionStore: ReturnType<typeof useMentionStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    resetMocks()
    mentionStore = useMentionStore()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('focusNode 文本节点 + trigger @ 命中 → ed.chain().deleteRange().insertContent().run()', () => {
    mentionStore.open('g1')
    mentionStore.type = 'bm'
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.bookmarkMap['bm-a'] = { id: 'bm-a', title: 'BM-A' }
    const ed = makeStubEditor((node: any, off: number) => off) // posAtDOM 返回 offset 作位置
    ;(EditorManager as any).get.mockReturnValue(ed)
    // 文本 '@bm-a'，选区从 0 到 length，trigger @ 在 index 0
    placeSelectionInEditable('@bm-a', 5)
    const { selectBookmark } = useMention()
    selectBookmark('bm-a')
    // _insertHTML: trigger='@', atIdx=lastIndexOf('@',4)=0, 0<5 → posAtDOM(node,0)+posAtDOM(node,5) → deleteRange+insertContent
    expect(ed.chain().deleteRange).toHaveBeenCalled()
    expect(ed.chain().insertContent).toHaveBeenCalled()
    expect(ed.chain().run).toHaveBeenCalled()
  })

  it('focusNode 文本节点 + trigger 不命中（无 @）→ 走 _mentionRange 或兜底 insertContent', () => {
    mentionStore.open('g1')
    mentionStore.type = 'bm'
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.bookmarkMap['bm-a'] = { id: 'bm-a', title: 'BM-A' }
    const ed = makeStubEditor(() => 0)
    ;(EditorManager as any).get.mockReturnValue(ed)
    // 文本 'plain' 无 @，选区到末尾
    placeSelectionInEditable('plain', 5)
    const { selectBookmark } = useMention()
    selectBookmark('bm-a')
    // trigger 不命中 → 跳过第一个 if；无 _mentionRange → 走兜底 ed.chain().insertContent().run()
    expect(ed.chain().insertContent).toHaveBeenCalled()
    expect(ed.chain().deleteRange).not.toHaveBeenCalled() // 兜底无 deleteRange
  })

  it('!ed（EditorManager.get 返回 null）→ _insertHTML 早退不崩，仍完成 updateGroup+save 编排', () => {
    mentionStore.open('g1')
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.bookmarkMap['bm-a'] = { id: 'bm-a', title: 'BM-A' }
    ;(EditorManager as any).get.mockReturnValue(null)
    const { selectBookmark } = useMention()
    selectBookmark('bm-a')
    // _insertHTML(!ed) 早退，后续编排仍执行
    expect(mockData.updateGroup).toHaveBeenCalledWith('g1', { bookmarkIds: ['bm-a'] })
    expect(saveGroupBodyMock).toHaveBeenCalledWith('g1')
    expect(saveAppDataMock).toHaveBeenCalled()
  })

  it('_mentionRange 路径：选区落非文本节点 + 预置 _mentionRange → _insertHTML 走 _toPMRange deleteRange+insertContent', () => {
    // 同一 useMention 实例：先 onInput 设 _mentionRange（trigger 命中），再把选区移到非文本节点，
    // 让 selectBookmark 的 _insertHTML 跳过 line 86 文本块 → 落 line 99 _mentionRange → _toPMRange
    mentionStore.open('g1')
    mentionStore.type = 'bm'
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.bookmarks = [{ id: 'bm-a', title: 'BM-A', url: 'bm', parentId: null }]
    mockData.bookmarkMap['bm-a'] = { id: 'bm-a', title: 'BM-A' }
    const ed = makeStubEditor((_node: any, off: number) => off * 2) // posAtDOM 返回 off*2 作位置
    ;(EditorManager as any).get.mockReturnValue(ed)
    const um = useMention()
    // 步骤1：onInput 设 _mentionRange（文本 '@bm' trigger @ 命中 → line 155 createRange+setStart/setEnd）
    const card = document.createElement('div')
    card.className = 'group-card'
    card.setAttribute('data-group-id', 'g1')
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    card.appendChild(body)
    document.body.appendChild(card)
    const txt = document.createTextNode('@bm')
    body.appendChild(txt)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    const r1 = document.createRange()
    r1.setStart(txt, 0)
    r1.setEnd(txt, 3) // '@bm'
    sel.addRange(r1)
    um.onInput({ target: body } as unknown as Event)
    expect(um.candidates.value.length).toBeGreaterThan(0) // showNear 命中 bm-a（证明 _mentionRange 已设 + onInput 完整跑路）
    // 步骤2：把选区移到 body 元素节点（nodeType=1，非文本），让 _insertHTML 跳过 line 86 文本块
    sel.removeAllRanges()
    const r2 = document.createRange()
    r2.setStart(body, 0)
    r2.setEnd(body, 0)
    sel.addRange(r2)
    // 步骤3：selectBookmark 触发 _insertHTML → focusNode 是 body（nodeType=1 非 3）→ line 86 假 →
    //   line 99 _mentionRange 非空 → _toPMRange(ed, _mentionRange) 返回 {from:0, to:6}（posAtDOM off*2）→
    //   ed.chain().deleteRange(pmRange).insertContent(html).run()
    um.selectBookmark('bm-a')
    expect(ed.chain().deleteRange).toHaveBeenCalled()
    expect(ed.chain().insertContent).toHaveBeenCalled()
    expect(ed.chain().run).toHaveBeenCalled()
  })

  it('_toPMRange 边界：posAtDOM 抛错 → 返回 null → _insertHTML _mentionRange 块降级 _mentionRange.deleteContents', () => {
    mentionStore.open('g1')
    mentionStore.type = 'bm'
    mockData.groupMap['g1'] = { id: 'g1', bookmarkIds: [] }
    mockData.bookmarks = [{ id: 'bm-a', title: 'BM-A', url: 'bm', parentId: null }]
    mockData.bookmarkMap['bm-a'] = { id: 'bm-a', title: 'BM-A' }
    // posAtDOM 抛错让 _toPMRange try/catch 返 null（line 76-77）
    const ed = makeStubEditor(() => { throw new Error('bad range') })
    ;(EditorManager as any).get.mockReturnValue(ed)
    const um = useMention()
    const card = document.createElement('div')
    card.className = 'group-card'
    card.setAttribute('data-group-id', 'g1')
    const body = document.createElement('div')
    body.className = 'group-body'
    body.setAttribute('contenteditable', 'true')
    card.appendChild(body)
    document.body.appendChild(card)
    const txt = document.createTextNode('@bm')
    body.appendChild(txt)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    const r1 = document.createRange()
    r1.setStart(txt, 0)
    r1.setEnd(txt, 3)
    sel.addRange(r1)
    um.onInput({ target: body } as unknown as Event) // 设 _mentionRange
    sel.removeAllRanges() // 清选区让 _insertHTML 不走 line 83 rangeCount 分支（force _mentionRange）
    const r2 = document.createRange()
    r2.setStart(body, 0)
    r2.setEnd(body, 0)
    sel.addRange(r2)
    // posAtDOM 抛 → _toPMRange 返 null → line 100 if(pmRange) 假 → line 102 _mentionRange.deleteContents()
    // 执行后不 return → 落 line 104 兜底 ed.chain().insertContent().run()
    expect(() => um.selectBookmark('bm-a')).not.toThrow()
    // null 降级路径：走 line 102 deleteContents（原生 Range 方法）后仍走 line 104 兜底 insertContent，
    // deleteRange（TipTap）未被调——证明 _toPMRange 返 null 跳过 line 100 deleteRange+insertContent 分支
    expect(ed.chain().deleteRange).not.toHaveBeenCalled()
    expect(ed.chain().insertContent).toHaveBeenCalled()
  })
})
