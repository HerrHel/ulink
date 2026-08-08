/**
 * cardTagsOverflow.test.ts — useUI card-tags 横向滚动 + 溢出 class 判定护栏（精简版）
 *
 * 原 file 17 例逐分支镜像 _onCardTagsWheel 正负 deltaY / 严格> 边界差 1px / init/destroy 配对
 / passive 三态 / updateCardTagsOverflow 溢出与否 / 批量混合 / 选择器隔离等纯 UI 视觉行为。
 * 卡片 tag 横滚 + 右侧渐隐遮罩是纯交互细节,阈值微偏或 listener 漏清无数据/安全后果,用户几乎
 * 无感。此前 actionSheet/contextMenu 等已覆盖 wheel 拦截的同类契约。此精简版留 5 例守核心:
 * 拦竖滚 + scrollLeft 累积主行为、未溢出/null 守卫、init/destroy 配对 + passive:false、
 * 溢出↔未溢出 toggle 回切语义。
 *
 * 删去:负向 deltaY 对称、clientWidth 严格大于镜像、差 1px 严格> 边界、passive 三态冗余、
 * 无 init 直 destroy 生命周期、重复 init 双挂、溢出单加 / 未加单例、批量混合、非 card-tags 隔离。
 *
 * 口径:纯加测试零逻辑改动,_onCardTagsWheel 仅由本轮增 export 关键字供直测,逻辑一字未动。
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import {
  _onCardTagsWheel,
  initCardTags,
  destroyCardTags,
  updateCardTagsOverflow,
} from '../../composables/ui/useUI.js'

// jsdom 默认 scrollWidth/clientWidth/scrollLeft 均为 0,需 defineProperty 钉死真实尺寸。
function setDims(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth })
  let _scrollLeft = 0
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => _scrollLeft,
    set: (v: number) => { _scrollLeft = v },
  })
}

function makeWheelEvent(deltaY: number, tagsEl: HTMLElement | null): {
  event: WheelEvent
  preventDefault: ReturnType<typeof vi.fn>
} {
  const preventDefault = vi.fn()
  const fakeTarget = { closest: (sel: string) => (sel === '.card-tags' ? tagsEl : null) }
  const event = { deltaY, target: fakeTarget, preventDefault } as unknown as WheelEvent
  return { event, preventDefault }
}

describe('_onCardTagsWheel card-tags 横向滚动拦截核心契约', () => {
  it('溢出 .card-tags( scrollWidth>clientWidth ) 上滚 wheel → preventDefault + scrollLeft += deltaY 防竖滚吞', () => {
    const tags = document.createElement('div')
    tags.classList.add('card-tags')
    setDims(tags, 200, 120) // 溢出真分支
    const { event, preventDefault } = makeWheelEvent(15, tags)

    _onCardTagsWheel(event)

    expect(preventDefault).toHaveBeenCalledTimes(1) // 拦默认竖滚,让横滚生效
    expect(tags.scrollLeft).toBe(15) // deltaY 折进 scrollLeft
  })

  it('未溢出 .card-tags( scrollWidth<=clientWidth ) → 不 preventDefault 不改 scrollLeft（竖滚穿透）', () => {
    const tags = document.createElement('div')
    tags.classList.add('card-tags')
    setDims(tags, 120, 120) // 恰等不满足 >
    const { event, preventDefault } = makeWheelEvent(20, tags)

    _onCardTagsWheel(event)

    expect(preventDefault).not.toHaveBeenCalled() // tag 行没溢出,竖滚应正常
    expect(tags.scrollLeft).toBe(0)
  })

  it('closest(.card-tags) 返 null → 不拦不滚不抛（守卫挡 null 入参防影响全局竖滚）', () => {
    const { event, preventDefault } = makeWheelEvent(25, null) // tags=null → closest 返 null

    expect(() => _onCardTagsWheel(event)).not.toThrow() // `if (tags && ...)` 守卫挡 null
    expect(preventDefault).not.toHaveBeenCalled()
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
    destroyCardTags() // 防残留 listener 泄漏跨用例
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('init 挂 { passive:false } 单次 / destroy 配对 remove 同引用（防泄漏 + preventDefault 生效前提）', () => {
    initCardTags()
    expect(addSpy).toHaveBeenCalledTimes(1)
    const [addType, addHandler, opts] = addSpy.mock.calls[0] as [string, EventListener, AddEventListenerOptions]
    expect(addType).toBe('wheel')
    expect(addHandler).toBe(_onCardTagsWheel)
    expect(opts).toEqual({ passive: false }) // passive:false 是 preventDefault 生效前提,缺失会被忽略

    destroyCardTags()
    expect(removeSpy).toHaveBeenCalledTimes(1)
    const [rmType, rmHandler] = removeSpy.mock.calls[0] as [string, EventListener]
    expect(rmType).toBe('wheel')
    expect(rmHandler).toBe(_onCardTagsWheel) // removeEventListener 靠引用匹配
  })
})

describe('updateCardTagsOverflow 批量溢出 class 切换核心契约', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('溢出↔未溢出 toggle 回切：加 tags-overflow 后尺寸变小 → 再调 update 移除（classList.toggle 第二参 bool 真实移除语义）', () => {
    const a = document.createElement('div')
    a.classList.add('card-tags')
    document.body.appendChild(a)

    setDims(a, 300, 100) // 先溢出
    updateCardTagsOverflow()
    expect(a.classList.contains('tags-overflow')).toBe(true)

    setDims(a, 100, 100) // 窗口缩放 / tag 删减后变未溢出
    updateCardTagsOverflow()
    expect(a.classList.contains('tags-overflow')).toBe(false) // toggle(cls,false) 真移除非仅不清加
  })

  it('无 .card-tags 元素时空跑不抛（DOM 尚无卡片的生命周期边界）', () => {
    expect(() => updateCardTagsOverflow()).not.toThrow() // querySelectorAll 返空,forEach 空跑
  })
})
