import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- 模块级可改 mock store 实例（沿用 removeFromSrcGroup.test.ts:1-54 口径）----
// searchInFocusedGroup 仅消费 useDataStore().{groupMap,bookmarkMap} + useUIStore().{searchQuery,focusedGroupId}
// 其余 useGroup.ts 顶部 import 链（saveAppData/toast/EditorManager/pushNavState/previewIconUrl/inlineCardHTML 等）
// 函数本身不调，但模块 import 期会触发，须一并 mock 避免 import 期初始化报错。
const mockData = {
  groupMap: {} as Record<string, any>,
  bookmarkMap: {} as Record<string, any>,
}

const mockUI = {
  searchQuery: '' as string | undefined,
  focusedGroupId: '' as string | undefined,
}

vi.mock('../../stores/data.js', () => ({
  useDataStore: vi.fn(() => mockData),
}))

vi.mock('../../stores/ui.js', () => ({
  useUIStore: vi.fn(() => mockUI),
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

vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../../composables/ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))

vi.mock('../../useInlineCard.js', () => ({
  inlineCardHTML: vi.fn(() => '<div class="inline-card"></div>'),
  groupRefCardHTML: vi.fn(() => '<div class="ref-card"></div>'),
}))

import { searchInFocusedGroup } from '../../composables/domain/useGroup.js'

/**
 * D1-63 聚焦组内搜索护栏：searchInFocusedGroup 是 useAppHandlers.ts:32
 * `onSearch() { if (ui.focusedGroupId) searchInFocusedGroup() }` 的唯一承载——
 * 用户在聚焦组内输入搜索词时，遍历 sgBody_<gid> 容器内所有 .group-inline-card，
 * 按 q（trim+toLowerCase 归一）匹配每个内联卡的 ref 组名 / 书签 title+url，
 * 决定其 style.display 显隐。此前零直接测试，分支契约靠实现口头维护。
 */
describe('searchInFocusedGroup — 聚焦组内搜索过滤护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockData.groupMap = {}
    mockData.bookmarkMap = {}
    mockUI.searchQuery = ''
    mockUI.focusedGroupId = ''
    document.body.innerHTML = ''
  })

  /**
   * 构造聚焦组容器（sgBody_<gid>）+ 若干内联卡，返回 body 元素便于断言。
   * 每张卡通过 data-bm-id 标识（ref:<gid> 表示组引用卡，普通串表示书签卡）。
   */
  function buildGroupBody(gid: string, cards: Array<{ bmId?: string }>) {
    const body = document.createElement('div')
    body.id = 'sgBody_' + gid
    for (const c of cards) {
      const el = document.createElement('div')
      el.className = 'group-inline-card'
      if (c.bmId !== undefined) el.setAttribute('data-bm-id', c.bmId)
      body.appendChild(el)
    }
    document.body.appendChild(body)
    return body
  }

  function displays(body: HTMLElement): string[] {
    return Array.from(body.querySelectorAll('.group-inline-card')).map(
      el => (el as HTMLElement).style.display
    )
  }

  it('!body 短路：focusedGroupId 对应容器不存在时直接 return，无任何查询/写操作', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'foo'
    // 不建 sgBody_g1
    expect(() => searchInFocusedGroup()).not.toThrow()
    // 既无容器也无卡，验证函数静默退出
    expect(document.getElementById('sgBody_g1')).toBeNull()
  })

  it('!q 重置全部 display=空串：清空搜索词时所有内联卡恢复全显', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = '' // 空查询
    const body = buildGroupBody('g1', [{ bmId: 'b1' }, { bmId: 'ref:r1' }, { bmId: 'b2' }])
    // 预置卡片为 none（模拟之前搜索被隐藏过），验证 !q 重置回 ''
    Array.from(body.querySelectorAll('.group-inline-card')).forEach(
      el => ((el as HTMLElement).style.display = 'none')
    )
    searchInFocusedGroup()
    expect(displays(body)).toEqual(['', '', ''])
  })

  it('!q 走 trim 后空路径：searchQuery 含纯空白字符时 trim 后空也走重置全显分支', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = '   \t  ' // 纯空白 trim 后空
    const body = buildGroupBody('g1', [{ bmId: 'b1' }, { bmId: 'ref:r1' }])
    Array.from(body.querySelectorAll('.group-inline-card')).forEach(
      el => ((el as HTMLElement).style.display = 'none')
    )
    searchInFocusedGroup()
    expect(displays(body)).toEqual(['', ''])
  })

  it('q 规范化大小写不敏感 + trim：含前导空格与混合大小写的 q 仍按归一后串匹配', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = '  VueDoc  '
    mockData.bookmarkMap = { b1: { title: 'My VueDoc Guide', url: 'https://v.io' } }
    const body = buildGroupBody('g1', [{ bmId: 'b1' }])
    searchInFocusedGroup()
    // q 经 trim+toLowerCase → 'vuedoc'，title 'my vuedoc guide' toLowerCase 含 'vuedoc' → 显
    expect(displays(body)).toEqual([''])
  })

  it('ref: 分支命中：组引用卡的 ref 组名含 q 时显', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = '工具'
    mockData.groupMap = { r1: { id: 'r1', name: '常用工具集' } }
    const body = buildGroupBody('g1', [{ bmId: 'ref:r1' }])
    searchInFocusedGroup()
    expect(displays(body)).toEqual([''])
  })

  it('ref: 分支不命中：ref 组名不含 q 时隐', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = '不存在'
    mockData.groupMap = { r1: { id: 'r1', name: '常用工具集' } }
    const body = buildGroupBody('g1', [{ bmId: 'ref:r1' }])
    searchInFocusedGroup()
    expect(displays(body)).toEqual(['none'])
  })

  it('ref: 分支 groupMap 无该 ref id 时 falsy 短路隐（不抛 TypeError，防止悬空引用卡访问未定义组）', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'foo'
    mockData.groupMap = {} // 无 r1
    const body = buildGroupBody('g1', [{ bmId: 'ref:r1' }])
    searchInFocusedGroup()
    // rg === undefined → (rg && ...) falsy 短路 → 'none'
    expect(displays(body)).toEqual(['none'])
  })

  it('ref: 分支 rg 存在但 name 空（null/缺失）走 ||\'\' 归一 indexOf 不命中 → 隐（兜底不抛）', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'foo'
    mockData.groupMap = { r1: { id: 'r1', name: '' } } // 空名
    const body = buildGroupBody('g1', [{ bmId: 'ref:r1' }])
    searchInFocusedGroup()
    // (rg.name || '').toLowerCase() === '' ， indexOf('foo') === -1 → 'none'
    expect(displays(body)).toEqual(['none'])
  })

  it('普通分支 title 命中：书签卡 title 含 q 时显', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'github'
    mockData.bookmarkMap = { b1: { title: 'GitHub Repo', url: 'https://example.com' } }
    const body = buildGroupBody('g1', [{ bmId: 'b1' }])
    searchInFocusedGroup()
    expect(displays(body)).toEqual([''])
  })

  it('普通分支 url 命中：title 不含但 url 含 q 时显（双通道或关系）', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'news'
    mockData.bookmarkMap = { b1: { title: '某门户首页', url: 'https://news.site.com/feed' } }
    const body = buildGroupBody('g1', [{ bmId: 'b1' }])
    searchInFocusedGroup()
    expect(displays(body)).toEqual([''])
  })

  it('普通分支 title+url 均不命中时隐', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'zzz'
    mockData.bookmarkMap = { b1: { title: 'GitHub Repo', url: 'https://example.com' } }
    const body = buildGroupBody('g1', [{ bmId: 'b1' }])
    searchInFocusedGroup()
    expect(displays(body)).toEqual(['none'])
  })

  it('子串匹配非词边界（indexOf 隐特性）：q="match" 命中 url 含 "no match" / "matched" 等 q 为子串的卡（非整词匹配）—— 护栏抓出的真实行为直锁防未来误改为词边界匹配', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'match'
    // b1: title 含 'matched'（q 作子串）→ 命中显
    // b2: url 含 'nomatch'（q 作子串）→ 命中显
    // b3: title/url 均不含 'match' 作子串 → 隐
    mockData.bookmarkMap = {
      b1: { title: 'prematched post', url: 'https://a.io' },
      b2: { title: '其他', url: 'https://nomatch.com' },
      b3: { title: '其他', url: 'https://abc.io' },
    }
    const body = buildGroupBody('g1', [{ bmId: 'b1' }, { bmId: 'b2' }, { bmId: 'b3' }])
    searchInFocusedGroup()
    // indexOf(q) 子串语义：'prematched'.indexOf('match') !== -1、'nomatch'.indexOf('match') !== -1
    expect(displays(body)).toEqual(['', '', 'none'])
  })

  it('普通分支 bookmarkMap 无该 bmId 时 falsy 短路隐（不抛 TypeError，防止悬空书签卡访问未定义对象）', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'foo'
    mockData.bookmarkMap = {} // 无 b1
    const body = buildGroupBody('g1', [{ bmId: 'b1' }])
    searchInFocusedGroup()
    // bm === undefined → (bm && ...) falsy 短路 → 'none'
    expect(displays(body)).toEqual(['none'])
  })

  it('bmId 缺失（无 data-bm-id 属性）的卡两分支均不进，display 保持不动（真实隐特性）', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'foo'
    mockData.groupMap = {}
    mockData.bookmarkMap = {}
    const body = buildGroupBody('g1', [{ bmId: undefined }]) // 无 data-bm-id
    // 预置 display 为 'inherit'（非 ''/非 'none'），验证函数不触碰它
    const card = body.querySelector('.group-inline-card') as HTMLElement
    card.style.display = 'inherit'
    searchInFocusedGroup()
    // bmId === null → if (bmId.startsWith) 不进，else if (bmId) 不进 → display 不被重写
    expect(displays(body)).toEqual(['inherit'])
  })

  it('ref 前缀判定用 startsWith：bmId="refactor:abc" 不被误判为 ref 卡（startsWith("ref:") 严格匹配）', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'abc'
    // "refactor:abc" 走普通分支（不当 ref 卡），bookmarkMap 无它 → falsy 短路隐
    mockData.bookmarkMap = {}
    const body = buildGroupBody('g1', [{ bmId: 'refactor:abc' }])
    searchInFocusedGroup()
    expect(displays(body)).toEqual(['none'])
  })

  it('混合多卡场景：ref 卡命中显 / 普通卡命中显 / 普通卡不命中隐 / 悬空 ref 隐 / 无 bmId 不动一次', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'match'
    mockData.groupMap = {
      r1: { id: 'r1', name: 'Match 工具集' }, // 命中
      rX: { id: 'rX', name: '无关组' },        // 不命中（ref:rX）
      // ref:ghost 组不存在 → 悬空 ref
    }
    mockData.bookmarkMap = {
      b1: { title: 'Match link', url: 'https://x.io' }, // title 命中
      b2: { title: '其他', url: 'https://abc.io' },      // url/title 均不含 q（注意 q='match'，'nomatch' 含 'match' 子串会误命中 → 此处用不含 'match' 的 url）
      // bookid "bghost" bookmarkMap 无 → 悬空普通
    }
    const body = buildGroupBody('g1', [
      { bmId: 'ref:r1' },    // 命中 显 ''
      { bmId: 'b1' },        // title 命中 显 ''
      { bmId: 'ref:rX' },    // 不命中 隐 'none'
      { bmId: 'b2' },        // 不命中 隐 'none'
      { bmId: 'ref:ghost' }, // 悬空 ref 隐 'none'
      { bmId: 'bghost' },    // 悬空普通 隐 'none'
      { bmId: undefined },   // 无 bmId 不动：预置 'inherit'
    ])
    ;(body.querySelector('.group-inline-card:nth-last-child(1)') as HTMLElement).style.display = 'inherit'
    searchInFocusedGroup()
    expect(displays(body)).toEqual(['', '', 'none', 'none', 'none', 'none', 'inherit'])
  })

  it('searchQuery 为 undefined：走 ||"" 归一 → trim+toLowerCase → 空 → !q 重置全显分支（兜底不抛）', () => {
    mockUI.focusedGroupId = 'g1'
    ;(mockUI as any).searchQuery = undefined
    const body = buildGroupBody('g1', [{ bmId: 'b1' }, { bmId: 'ref:r1' }])
    Array.from(body.querySelectorAll('.group-inline-card')).forEach(
      el => ((el as HTMLElement).style.display = 'none')
    )
    searchInFocusedGroup()
    expect(displays(body)).toEqual(['', ''])
  })

  it('unchanged display for card with bmId null（setAttribute 不调 → getAttribute 返 null）：两分支均不进保持原值', () => {
    mockUI.focusedGroupId = 'g1'
    mockUI.searchQuery = 'foo'
    mockData.groupMap = { r1: { name: 'Match' } }
    mockData.bookmarkMap = { b1: { title: 'Match', url: 'x' } }
    // 这里测的是 bmId 为 null 的情况：buildGroupBody 不 setAttribute 时 getAttribute 返 null
    const body = buildGroupBody('g1', [{}]) // {} 无 bmId 键
    const card = body.querySelector('.group-inline-card') as HTMLElement
    card.style.display = 'inline-block'
    searchInFocusedGroup()
    expect(displays(body)).toEqual(['inline-block'])
  })
})
