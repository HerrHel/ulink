import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'

// 护栏目标：useUI.ts 的 card-tags 横向滚动 + 溢出 class 判定四件套
//   _onCardTagsWheel(event)      — module-private，本轮增 export 供直测
//   initCardTags()               — 全局挂 wheel listener（{ passive: false }）
//   destroyCardTags()            — 配对卸载 listener（防泄漏）
//   updateCardTagsOverflow()     — 批量给 .card-tags 加/移 tags-overflow class
// 严守纯加测试零逻辑改动：_onCardTagsWheel 仅由本轮增 export 关键字，逻辑一字未动。
import {
  _onCardTagsWheel,
  initCardTags,
  destroyCardTags,
  updateCardTagsOverflow,
} from '../../composables/ui/useUI.js'

// sentiment: jsdom 默认 scrollWidth/clientWidth/scrollLeft 均为 0，需通过 defineProperty
// 钉死真实尺寸以触发「溢出 scrollWidth>clientWidth」与「未溢出」两分支。
function setDims(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth })
  // scrollLeft 起始 0，赋值时由 setter 持久（jsdom 默认 setter 只更新不持久，这里用变量模拟真实行为）
  let _scrollLeft = 0
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => _scrollLeft,
    set: (v: number) => {
      _scrollLeft = v
    },
  })
}

// 构造假 WheelEvent：可控 deltaY / preventDefault spy / target.closest('.card-tags')
function makeWheelEvent(deltaY: number, tagsEl: HTMLElement | null): {
  event: WheelEvent
  preventDefault: ReturnType<typeof vi.fn>
} {
  const preventDefault = vi.fn()
  const fakeTarget = {
    closest: (sel: string) => (sel === '.card-tags' ? tagsEl : null),
  }
  //jsdom WheelEvent 可派发但要自定义 closest/preventDefault：构造后再贴方法，TS 需断言类型
  const event = {
    deltaY,
    target: fakeTarget,
    preventDefault,
  } as unknown as WheelEvent
  return { event, preventDefault }
}

describe('_onCardTagsWheel card-tags 横向滚动拦截', () => {
  it('溢出 .card-tags( scrollWidth>clientWidth ) 上滚 wheel → preventDefault + scrollLeft += deltaY 改横滚防被竖滚吞', () => {
    const tags = document.createElement('div')
    tags.classList.add('card-tags')
    setDims(tags, 200, 120) // scrollWidth(200) > clientWidth(120) → 溢出真分支
    const { event, preventDefault } = makeWheelEvent(15, tags)

    _onCardTagsWheel(event)

    expect(preventDefault).toHaveBeenCalledTimes(1) // 拦默认竖滚，让横滚生效
    expect(tags.scrollLeft).toBe(15) // deltaY 折进 scrollLeft 横向翻 tag
  })

  it('负向 deltaY(down 返 top 方向) → scrollLeft -= 向左翻（负值真实行为直锁）', () => {
    const tags = document.createElement('div')
    tags.classList.add('card-tags')
    setDims(tags, 200, 120)
    const { event, preventDefault } = makeWheelEvent(-10, tags)

    _onCardTagsWheel(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(tags.scrollLeft).toBe(-10) // 负 deltaY 真实 -= 行为（向上滚翻到右侧之前的 tag）
  })

  it('未溢出 .card-tags( scrollWidth<=clientWidth ) → 不 preventDefault 不改 scrollLeft（让竖滚正常穿透）', () => {
    const tags = document.createElement('div')
    tags.classList.add('card-tags')
    setDims(tags, 120, 120) // 恰等：scrollWidth==clientWidth 不满足 >，未溢出
    const { event, preventDefault } = makeWheelEvent(20, tags)

    _onCardTagsWheel(event)

    expect(preventDefault).not.toHaveBeenCalled() // 不拦竖滚（tag 行没溢出，竖滚应正常工作）
    expect(tags.scrollLeft).toBe(0) // 未触 scrollLeft 改动
  })

  it('clientWidth 严格大于 scrollWidth( scroll<client ) → 同样不拦不滚（未溢出兜底分支）', () => {
    const tags = document.createElement('div')
    tags.classList.add('card-tags')
    setDims(tags, 80, 120) // scrollWidth(80) < clientWidth(120)，未溢出
    const { event, preventDefault } = makeWheelEvent(30, tags)

    _onCardTagsWheel(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(tags.scrollLeft).toBe(0)
  })

  it('closest(.card-tags) 返 null(滚 wheel 时 target 不在 .card-tags 内) → 不拦不滚防影响全局竖滚', () => {
    const { event, preventDefault } = makeWheelEvent(25, null) // tags=null → closest 返 null

    // 不抛 TypeError 即证：源码 `if (tags && ...)` 守卫挡住 null 入参
    expect(() => _onCardTagsWheel(event)).not.toThrow()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('边界严格 >：scrollWidth=120 clientWidth=119 仅差 1 仍判溢出（> 严格，非 >=）', () => {
    const tags = document.createElement('div')
    tags.classList.add('card-tags')
    setDims(tags, 120, 119) // 仅 1px 差，严格 > 仍走溢出分支
    const { event, preventDefault } = makeWheelEvent(5, tags)

    _onCardTagsWheel(event)

    expect(preventDefault).toHaveBeenCalledTimes(1) // 严格 >：差 1 仍拦
    expect(tags.scrollLeft).toBe(5)
  })
})

describe('initCardTags / destroyCardTags 全局 wheel listener 配对', () => {
  let addSpy: MockInstance
  let removeSpy: MockInstance

  beforeEach(() => {
    addSpy = vi.spyOn(document, 'addEventListener')
    removeSpy = vi.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    // 防残留 listener 泄漏到后续 describe / 跨用例污染
    destroyCardTags()
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('initCardTags → document.addEventListener("wheel", _onCardTagsWheel, { passive:false }) 单次挂载', () => {
    initCardTags()

    expect(addSpy).toHaveBeenCalledTimes(1)
    const [type, handler, opts] = addSpy.mock.calls[0] as [string, EventListener, AddEventListenerOptions]
    expect(type).toBe('wheel')
    expect(handler).toBe(_onCardTagsWheel) // 挂的真实处理函数引用（同名同体）
    expect(opts).toEqual({ passive: false }) // passive:false 是 preventDefault 生效前提
  })

  it('initCardTags → passive:false 必须显式（passive:true/缺省会让 preventDefault 被浏览器忽略）', () => {
    initCardTags()
    const opts = addSpy.mock.calls[0][2] as AddEventListenerOptions
    // 直锁 passive:false 而非缺失/falsey：三态有别
    expect(opts.passive).toBe(false)
    expect(opts).not.toEqual({}) // 防 opts 误删成空对象
  })

  it('destroyCardTags → document.removeEventListener("wheel", _onCardTagsWheel) 配对卸载防泄漏', () => {
    initCardTags()
    destroyCardTags()

    expect(removeSpy).toHaveBeenCalledTimes(1)
    const [type, handler] = removeSpy.mock.calls[0] as [string, EventListener]
    expect(type).toBe('wheel')
    expect(handler).toBe(_onCardTagsWheel) // 必须移除同一函数引用（removeEventListener 靠引用匹配）
  })

  it('无 init 直 destroy 不抛（生命周期边界：组件 unmount 时 init 可能未跑过）', () => {
    expect(() => destroyCardTags()).not.toThrow() // removeEventListener 对未注册回调安全无副作用
  })

  it('init 后再 init 重复挂载：两 listener 同引用共存（jsdom 行为直锁防真实双滚）', () => {
    initCardTags()
    initCardTags()
    expect(addSpy).toHaveBeenCalledTimes(2) // 防泄漏核心契约：未配对 init 会重复挂 listener
    // 真实浏览器中两虚指同函数重复 addEventListener 会被去重，但 jsdom 不去重——
    // 本用例锁「initCardTags 不自带幂等守卫，重复调用会重复挂，须由调用方 useAppLifecycle 配对」
  })
})

describe('updateCardTagsOverflow 批量 .card-tags 溢出 class 判定', () => {
  beforeEach(() => {
    // 清 DOM 防跨用例残留 .card-tags 元素
    document.body.innerHTML = ''
  })

  it('溢出容器( scrollWidth>clientWidth ) → 加 tags-overflow class 让右侧渐隐遮罩显形', () => {
    const a = document.createElement('div')
    a.classList.add('card-tags')
    setDims(a, 300, 100)
    document.body.appendChild(a)

    updateCardTagsOverflow()

    expect(a.classList.contains('tags-overflow')).toBe(true)
  })

  it('未溢出容器( scrollWidth<=clientWidth ) → 不加 tags-overflow（避免非溢出也显示遮罩误导）', () => {
    const a = document.createElement('div')
    a.classList.add('card-tags')
    setDims(a, 100, 100)
    document.body.appendChild(a)

    updateCardTagsOverflow()

    expect(a.classList.contains('tags-overflow')).toBe(false)
  })

  it('已加 tags-overflow 后变未溢出 → 调 update 移除 class（classList.toggle 第二参 bool 真实移除语义）', () => {
    const a = document.createElement('div')
    a.classList.add('card-tags')
    setDims(a, 300, 100) // 先溢出
    document.body.appendChild(a)
    updateCardTagsOverflow()
    expect(a.classList.contains('tags-overflow')).toBe(true)

    // 尺寸变化后变未溢出（窗口缩放 / tag 删减真实场景）
    setDims(a, 100, 100)
    updateCardTagsOverflow()

    expect(a.classList.contains('tags-overflow')).toBe(false) // toggle(cls,false) 真移除非仅不清加
  })

  it('无 .card-tags 元素时空跑不抛（生命周期边界：DOM 尚无卡片）', () => {
    expect(() => updateCardTagsOverflow()).not.toThrow()
    // querySelectorAll 返空 NodeList，forEach 空跑——防未来误改成 [0] 直访致空 DOM 抛 TypeError
  })

  it('混合多容器：溢出加 / 未溢出不加，批量 forEach 各自独立判定不串味', () => {
    const a = document.createElement('div')
    a.classList.add('card-tags')
    setDims(a, 500, 100) // 溢出
    document.body.appendChild(a)
    const b = document.createElement('div')
    b.classList.add('card-tags')
    setDims(b, 80, 100) // 未溢出
    document.body.appendChild(b)
    const c = document.createElement('div')
    c.classList.add('card-tags')
    setDims(c, 150, 100) // 溢出
    document.body.appendChild(c)

    updateCardTagsOverflow()

    expect(a.classList.contains('tags-overflow')).toBe(true)
    expect(b.classList.contains('tags-overflow')).toBe(false)
    expect(c.classList.contains('tags-overflow')).toBe(true)
  })

  it('非 .card-tags 容器不受影响（querySelectorAll 选择器范围真实隔离）', () => {
    const other = document.createElement('div')
    other.classList.add('tag-list') // 非 .card-tags
    setDims(other, 999, 1) // 哪怕极端溢出
    document.body.appendChild(other)

    updateCardTagsOverflow()

    expect(other.classList.contains('tags-overflow')).toBe(false) // 选择器范围真实隔离防误改 querySelectorAll('.card-tags')→'all'
  })
})
