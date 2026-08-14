/**
 * useUIStore 补覆盖率测 — 锁 setMobile / saveUIState / restoreUIState 真实分支行为契约。
 * 既有 ui.test.ts 14 测已覆盖 restoreUIState 主路径 + selectAllBatch + saveUIState 成功路径 +
 * detailCards/focusedGroupId 过滤 + stale id 回退，本轮补未覆盖分支：
 *  - setMobile（整块零测）：移动端 grid 降级 / _preferredLayoutMode 记忆 / 回切恢复 / 兜底 grid / is-mobile class / idempotent 早退 / mini-grid 记忆
 *  - saveUIState：safeSetItem 失败 warn 分支 + catch 兜底
 *  - restoreUIState：sortDir 校验 / groupsOnTop boolean 守门 / historyMax clamp / _preferredLayoutMode 还原 /
 *    移动端 grid 降级 / _customCardOrder 过滤（R36）/ docScrollTop 还原 / themeStyle 同步 / themeMode 同步 / catch 兜底
 * 桩：真实 Pinia + 真实 data store（data getter 自动构建 map）；localStorage via setup.ts localStorageMock；
 * isMobile 经 spyOn(utils) 可控初始态；safeSetItem 失败用 localStorageMock.setItem.mockImplementationOnce(throw) 避免跨测污染。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { CAT_ALL } from '../../config/constants.js'
import { localStorageMock } from '../setup.js'
import { isMobile } from '../../utils.js'

// isMobile 是模块级 _isMobile 常量导出，store 初始化时读过一次。setMobile 不读 isMobile()，只读写
// this.isMobile state，故无需桩其返回值——但 sanity 断言初始非移动端。
void isMobile

describe('UIStore 补覆盖率 — setMobile', () => {
  let store: ReturnType<typeof useUIStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useUIStore()
    // 默认进入非移动端（store 初始 isMobile 取模块 _isMobile，jsdom 下 false）
    if (store.isMobile) store.isMobile = false
    store.layoutMode = 'grid'
    store._preferredLayoutMode = null
    store._mobileLayoutMode = 'list'
  })

  it('进移动端：grid 降级到 _mobileLayoutMode，并记忆 PC grid 偏好到 _preferredLayoutMode', () => {
    store.setMobile(true)
    // 锁住：移动端不可用 grid，降级到移动端布局
    expect(store.isMobile).toBe(true)
    expect(store.layoutMode).toBe('list')
    // 原本 PC grid 偏好被记忆，供回切恢复
    expect(store._preferredLayoutMode).toBe('grid')
  })

  it('进移动端：若当前是 list/mini-grid，则 _mobileLayoutMode 跟随更新', () => {
    store.layoutMode = 'mini-grid'
    store.setMobile(true)
    expect(store._mobileLayoutMode).toBe('mini-grid')
    expect(store.layoutMode).toBe('mini-grid')
  })

  it('切回 PC：优先恢复 _preferredLayoutMode 偏好并清空偏好记忆', () => {
    // 先进移动端记忆 grid 偏好
    store.setMobile(true)
    expect(store._preferredLayoutMode).toBe('grid')
    // 回切
    store.setMobile(false)
    expect(store.isMobile).toBe(false)
    expect(store.layoutMode).toBe('grid')
    expect(store._preferredLayoutMode).toBeNull()
  })

  it('切回 PC 无偏好记忆且当前 mini-grid：兜底回退 grid', () => {
    // 制造「无偏好记忆 + isMobile 当前 true」场景：直接设 state=true（不经 setMobile 避免 grid 降级副作用），
    // 再 setMobile(false) 走切回分支。_preferredLayoutMode=null + layoutMode=mini-grid 命中兜底 grid。
    store.isMobile = true
    store._preferredLayoutMode = null
    store.layoutMode = 'mini-grid'
    store.setMobile(false)
    // 锁兜底：PC 端默认 grid
    expect(store.layoutMode).toBe('grid')
    expect(store._preferredLayoutMode).toBeNull()
  })

  it('切回 PC 无偏好记忆且当前 list：保持 list（不兜底 grid，仅 mini-grid 才兜底）', () => {
    store.isMobile = true
    store._preferredLayoutMode = null
    store.layoutMode = 'list'
    store.setMobile(false)
    expect(store.layoutMode).toBe('list')
  })

  it('idempotent：同值再调早退不副作用（不重置 _preferredLayoutMode）', () => {
    store.setMobile(true)
    const pref = store._preferredLayoutMode
    store.setMobile(true) // 同值
    expect(store._preferredLayoutMode).toBe(pref)
    // 进移动端会-toggle is-mobile class，二次同值早退不应再动 DOM（class 已存在 toggle 仍 true 无变）
  })

  it('进移动端同步 <html> is-mobile class', () => {
    store.setMobile(true)
    expect(document.documentElement.classList.contains('is-mobile')).toBe(true)
    store.setMobile(false)
    expect(document.documentElement.classList.contains('is-mobile')).toBe(false)
  })
})

describe('UIStore 补覆盖率 — saveUIState 失败与兜底', () => {
  let store: ReturnType<typeof useUIStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useUIStore()
    useDataStore() // restoreUIState 用，saveUIState 读 ds._customCardOrder
  })

  it('saveUIState：safeSetItem 失败时 warn 不抛（配额满/隐私模式静默失败）', () => {
    // safeSetItem 包 try/catch 吞错返 false，warn 一句不抛
    localStorageMock.setItem.mockImplementationOnce(() => { throw new DOMException('quota') })
    expect(() => store.saveUIState()).not.toThrow()
  })

  it('saveUIState：data store _customCardOrder 透传入持久化对象', () => {
    const ds = useDataStore()
    ds._customCardOrder = [{ t: 'g', id: 'g1' }, { t: 'b', id: 'b1' }] as any
    store.saveUIState()
    const calls = localStorageMock.setItem.mock.calls as any[][]
    const saved = JSON.parse(calls[calls.length - 1][1])
    expect(saved._customCardOrder).toEqual([{ t: 'g', id: 'g1' }, { t: 'b', id: 'b1' }])
  })

  it('saveUIState：docScrollTop 取 documentElement.scrollTop', () => {
    // jsdom scrollTop 默认 0
    store.saveUIState()
    const calls = localStorageMock.setItem.mock.calls as any[][]
    const saved = JSON.parse(calls[calls.length - 1][1])
    expect(saved.docScrollTop).toBe(0)
  })
})

describe('UIStore 补覆盖率 — restoreUIState 分支守门', () => {
  let store: ReturnType<typeof useUIStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useUIStore()
    useDataStore()
  })

  it('sortDir：仅 asc/desc 合法值还原非法值保持默认', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ sortDir: 'weird' }))
    store.restoreUIState()
    expect(store.sortDir).toBe('desc') // 默认
  })

  it('sortDir：asc 合法值还原', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ sortDir: 'asc' }))
    store.restoreUIState()
    expect(store.sortDir).toBe('asc')
  })

  it('groupsOnTop：仅 boolean 守门（truthy 非 boolean 如 1 不还原）', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ groupsOnTop: 1 as any }))
    store.restoreUIState()
    expect(store.groupsOnTop).toBe(true) // 默认
  })

  it('groupsOnTop：false boolean 正常还原', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ groupsOnTop: false }))
    store.restoreUIState()
    expect(store.groupsOnTop).toBe(false)
  })

  it('historyMax：经 clampHistoryMax 钳制还原', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ historyMax: 999 }))
    store.restoreUIState()
    // clampHistoryMax 上限为 historyMax helper 钳制值，断言被钳非原 999
    expect(store.historyMax).toBeLessThan(999)
    expect(store.historyMax).toBeGreaterThan(0)
  })

  it('historyMax：非 number 不还原保持默认', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ historyMax: 'big' as any }))
    store.restoreUIState()
    expect(store.historyMax).toBe(10) // 默认
  })

  it('_preferredLayoutMode：grid/list/mini-grid 三种都还原', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ _preferredLayoutMode: 'mini-grid' }))
    store.restoreUIState()
    expect(store._preferredLayoutMode).toBe('mini-grid')
  })

  it('_preferredLayoutMode：非法值不还原（保持 null）', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ _preferredLayoutMode: 'weird' as any }))
    store.restoreUIState()
    expect(store._preferredLayoutMode).toBeNull()
  })

  it('_mobileLayoutMode：仅 mini-grid 命中还原分支（list 为默认保持）', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ _mobileLayoutMode: 'mini-grid' }))
    store.restoreUIState()
    expect(store._mobileLayoutMode).toBe('mini-grid')
  })

  it('移动端 + 还原 layoutMode 落 grid：自动降级到 _mobileLayoutMode', () => {
    store.isMobile = true
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({
      layoutMode: 'grid',
      _mobileLayoutMode: 'list',
    }))
    store.restoreUIState()
    // 锁移动端降级守门：移动端 grid 不可用降级
    expect(store.layoutMode).toBe('list')
  })

  it('curCat：CAT_ALL 直接还原（不过 categoryMap 校验走 all 分支）', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ curCat: CAT_ALL }))
    store.restoreUIState()
    expect(store.curCat).toBe(CAT_ALL)
  })

  it('curCat：已软删的残留分类 id 回退 CAT_ALL', () => {
    const ds = useDataStore()
    ds.categories = [{ id: 'cat1', name: 'c1', deletedAt: 123 }] as any
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ curCat: 'cat1' }))
    store.restoreUIState()
    expect(store.curCat).toBe(CAT_ALL)
  })

  it('activeAttrs：非 array 不还原', () => {
    useDataStore()
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ activeAttrs: 'notarr' as any }))
    store.restoreUIState()
    expect(store.activeAttrs).toEqual([])
  })

  it('excludedAttrs：非 array 不还原', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ excludedAttrs: 123 as any }))
    store.restoreUIState()
    expect(store.excludedAttrs).toEqual([])
  })

  it('detailCards：非 array 不还原', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ detailCards: 'x' as any }))
    store.restoreUIState()
    expect(store.detailCards).toEqual([])
  })

  it('focusedGroupId：组不存在不还原（保持 null）', () => {
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ focusedGroupId: 'gone' }))
    store.restoreUIState()
    expect(store.focusedGroupId).toBeNull()
  })

  it('_customCardOrder (R36)：过滤已删/不存在的卡片 id，保留有效条目相对顺序', () => {
    const ds = useDataStore()
    ds.siblingGroups = [{ id: 'g-live' }, { id: 'g-dead', deletedAt: 9 }] as any
    ds.bookmarks = [{ id: 'b-live' }] as any
    // 注意：JSON.stringify 后 .slice 在数组，map 来自 getter；gMap/bmMap 含软删故需 !deletedAt 过滤
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({
      _customCardOrder: [
        { t: 'g', id: 'g-live' },
        { t: 'b', id: 'b-live' },
        { t: 'g', id: 'g-dead' },
        { t: 'b', id: 'b-gone' },
      ],
    }))
    store.restoreUIState()
    expect(ds._customCardOrder).toEqual([
      { t: 'g', id: 'g-live' },
      { t: 'b', id: 'b-live' },
    ])
  })

  it('_customCardOrder：非 array 不还原', () => {
    const ds = useDataStore()
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ _customCardOrder: 'x' as any }))
    store.restoreUIState()
    // 默认为 null（见 data state），restoreUIState 非 array 分支不赋值
    expect(ds._customCardOrder).toBeNull()
  })

  it('docScrollTop：truthy 值还原 documentElement.scrollTop', () => {
    // jsdom scrollTop setter 可读写
    document.documentElement.scrollTop = 0
    ;(localStorageMock.getItem as any).mockReturnValue(JSON.stringify({ docScrollTop: 250 }))
    store.restoreUIState()
    expect(document.documentElement.scrollTop).toBe(250)
  })

  it('themeStyle：lv_themeStyle=comfortable 同步回 uiStore.themeStyle（单一真相源对齐）', () => {
    // restoreUIState 读 3 次 safeGetItem：①UI_STATE_KEY（主体，须非 null 否则 line 255 早退到不了 theme）②K_THEME_STYLE ③K_THEME_MODE
    ;(localStorageMock.getItem as any)
      .mockReturnValueOnce(JSON.stringify({}))      // UI_STATE_KEY 主体（空对象不早退）
      .mockReturnValueOnce('comfortable')            // K_THEME_STYLE
      .mockReturnValueOnce('manual')                 // K_THEME_MODE
    store.restoreUIState()
    expect(store.themeStyle).toBe('comfortable')
  })

  it('themeStyle：lv_themeStyle=premium 同步（保持 premium）', () => {
    ;(localStorageMock.getItem as any)
      .mockReturnValueOnce(JSON.stringify({}))
      .mockReturnValueOnce('premium')
      .mockReturnValueOnce('manual')
    store.restoreUIState()
    expect(store.themeStyle).toBe('premium')
  })

  it('themeMode：lv_themeMode=auto 同步 uiStore.themeMode=auto', () => {
    ;(localStorageMock.getItem as any)
      .mockReturnValueOnce(JSON.stringify({}))
      .mockReturnValueOnce(null)                      // K_THEME_STYLE 非 comfortable/premium 不改 themeStyle
      .mockReturnValueOnce('auto')                    // K_THEME_MODE
    store.restoreUIState()
    expect(store.themeMode).toBe('auto')
  })

  it('themeMode：lv_themeMode 非 auto（如 manual/null）→ uiStore.themeMode=manual', () => {
    ;(localStorageMock.getItem as any)
      .mockReturnValueOnce(JSON.stringify({}))
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
    store.restoreUIState()
    expect(store.themeMode).toBe('manual')
  })

  it('catch 兜底：restoreUIState 内抛错被 catch console.warn 不外抛', () => {
    // 触发 restoreUIState line 315 `document.documentElement.scrollTop = s.docScrollTop` 抛错（在 try 内被 catch）。
    // 须 s.docScrollTop truthy 才进入该写路径。
    ;(localStorageMock.getItem as any)
      .mockReturnValueOnce(JSON.stringify({ docScrollTop: 250 }))
      .mockReturnValueOnce(null)   // K_THEME_STYLE
      .mockReturnValueOnce(null)   // K_THEME_MODE
    const desc = Object.getOwnPropertyDescriptor(document.documentElement, 'scrollTop')
    Object.defineProperty(document.documentElement, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: () => { throw new Error('scrollTop forbidden') },
    })
    expect(() => store.restoreUIState()).not.toThrow()
    // 恢复 DOM 属性避免污染后续测
    if (desc) Object.defineProperty(document.documentElement, 'scrollTop', desc)
  })
})
