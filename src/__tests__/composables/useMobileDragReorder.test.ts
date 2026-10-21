/* eslint-disable vue/one-component-per-file */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { applyIntervalOrder, hasGroupsOnTopCross, useMobileDragReorder } from '../../composables/interaction/useMobileDragReorder.js'
import { useUIStore } from '../../stores/ui.js'
import * as toastModule from '../../lib/toast.js'

function makeItems(orders: number[]) {
  return orders.map((order, i) => ({ data: { id: `id${i}`, order } }))
}

describe('applyIntervalOrder (H12)', () => {
  it('向下拖到末尾：区间 order 唯一且相对序正确', () => {
    // A1 B2 C3 D4 E5，from=0 toIdx=4 → [B,C,D,E,A]
    const items = makeItems([1, 2, 3, 4, 5])
    // 模拟 splice：先从 0 删 A，再插入末尾
    const a = items[0]
    const arr = items.slice()
    arr.splice(0, 1)
    arr.splice(4, 0, a)
    const dirty: string[] = []
    applyIntervalOrder(arr, 0, 4, (id) => dirty.push(id))
    // B1 C2 D3 E4 A5
    expect(arr.map(x => x.data.order)).toEqual([1, 2, 3, 4, 5])
    expect(arr.map(x => x.data.id)).toEqual(['id1', 'id2', 'id3', 'id4', 'id0'])
    // 无重复
    expect(new Set(arr.map(x => x.data.order)).size).toBe(5)
  })

  it('向下拖到中间：不与邻项 order 重复', () => {
    // A1 B2 C3 D4，from=0 toIdx=2 → [B,C,A,D]
    const items = makeItems([1, 2, 3, 4])
    const a = items[0]
    const arr = items.slice()
    arr.splice(0, 1)
    arr.splice(2, 0, a)
    applyIntervalOrder(arr, 0, 2, () => {})
    // B1 C2 A3 D4
    expect(arr.map(x => x.data.order)).toEqual([1, 2, 3, 4])
    expect(arr.map(x => x.data.id)).toEqual(['id1', 'id2', 'id0', 'id3'])
    expect(new Set(arr.map(x => x.data.order)).size).toBe(4)
  })

  it('向上拖到开头', () => {
    // A1 B2 C3 D4，from=3 toIdx=0 → [D,A,B,C]
    const items = makeItems([1, 2, 3, 4])
    const d = items[3]
    const arr = items.slice()
    arr.splice(3, 1)
    arr.splice(0, 0, d)
    applyIntervalOrder(arr, 3, 0, () => {})
    // D1 A2 B3 C4
    expect(arr.map(x => x.data.order)).toEqual([1, 2, 3, 4])
    expect(arr.map(x => x.data.id)).toEqual(['id3', 'id0', 'id1', 'id2'])
    expect(new Set(arr.map(x => x.data.order)).size).toBe(4)
  })

  it('from===toIdx 时 no-op', () => {
    const items = makeItems([1, 2, 3])
    applyIntervalOrder(items, 1, 1, () => { throw new Error('should not mark dirty') })
    expect(items.map(x => x.data.order)).toEqual([1, 2, 3])
  })
})

describe('hasGroupsOnTopCross (置顶跨越检测)', () => {
  it('空列表与单元素返回 false', () => {
    expect(hasGroupsOnTopCross([])).toBe(false)
    expect(hasGroupsOnTopCross([{ type: 'group' }])).toBe(false)
    expect(hasGroupsOnTopCross([{ type: 'bm' }])).toBe(false)
  })

  it('纯笔记列表或纯书签列表返回 false', () => {
    expect(hasGroupsOnTopCross([{ type: 'group' }, { type: 'group' }])).toBe(false)
    expect(hasGroupsOnTopCross([{ type: 'bm' }, { type: 'bm' }])).toBe(false)
  })

  it('合法的置顶排列（笔记全在书签前）返回 false', () => {
    const items = [{ type: 'group' }, { type: 'group' }, { type: 'bm' }, { type: 'bm' }]
    expect(hasGroupsOnTopCross(items)).toBe(false)
  })

  it('笔记被拖到书签之后/之间返回 true', () => {
    // 笔记在书签之后
    expect(hasGroupsOnTopCross([{ type: 'bm' }, { type: 'group' }])).toBe(true)
    // 笔记插在书签之间
    expect(hasGroupsOnTopCross([{ type: 'group' }, { type: 'bm' }, { type: 'group' }, { type: 'bm' }])).toBe(true)
  })

  it('书签被拖到笔记之前/之间返回 true', () => {
    // 书签在最前
    expect(hasGroupsOnTopCross([{ type: 'bm' }, { type: 'group' }, { type: 'group' }])).toBe(true)
    // 书签插在笔记之间
    expect(hasGroupsOnTopCross([{ type: 'group' }, { type: 'bm' }, { type: 'group' }])).toBe(true)
  })
})

describe('useMobileDragReorder 跨越置顶 toast 提示', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
  })

  afterEach(() => {
    delete (HTMLElement.prototype as any).setPointerCapture
    delete (HTMLElement.prototype as any).releasePointerCapture
  })

  it('混排且开启 groupsOnTop 时，拖拽跨越触发红色置顶提示', async () => {
    const toastSpy = vi.spyOn(toastModule, 'toast')
    const ui = useUIStore()
    ui.groupsOnTop = true

    const list = ref([
      { type: 'group', data: { id: 'g1', order: 0 } },
      { type: 'bm', data: { id: 'b1', order: 1 } },
    ])

    const Comp = defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null)
        useMobileDragReorder(container, list, { enabled: ref(true) })
        return { container }
      },
      template: `
        <div ref="container" class="card-grid">
          <div class="card" data-id="g1"><div class="batch-drag-handle">handle0</div></div>
          <div class="card" data-id="b1"><div class="batch-drag-handle">handle1</div></div>
        </div>
      `,
    })

    const w = mount(Comp, { attachTo: document.body })
    const container = w.find('.card-grid').element as HTMLElement
    const card0 = container.children[0] as HTMLElement
    const card1 = container.children[1] as HTMLElement
    const handle0 = card0.querySelector('.batch-drag-handle') as HTMLElement

    handle0.getBoundingClientRect = () => ({ top: 100, left: 10, width: 200, height: 50, bottom: 150, right: 210 } as any)
    card0.getBoundingClientRect = () => ({ top: 100, left: 10, width: 200, height: 50, bottom: 150, right: 210 } as any)
    card1.getBoundingClientRect = () => ({ top: 160, left: 10, width: 200, height: 50, bottom: 210, right: 210 } as any)

    handle0.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientY: 100, bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: 200, bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: 200, bubbles: true }))

    expect(toastSpy).toHaveBeenCalledWith('已开启笔记置顶', false)

    w.unmount()
    toastSpy.mockRestore()
  })

  it('混排且开启 groupsOnTop 时，纯同类拖拽提示正常的「排序已更新」', async () => {
    const toastSpy = vi.spyOn(toastModule, 'toast')
    const ui = useUIStore()
    ui.groupsOnTop = true

    const list = ref([
      { type: 'group', data: { id: 'g1', order: 0 } },
      { type: 'bm', data: { id: 'b1', order: 1 } },
      { type: 'bm', data: { id: 'b2', order: 2 } },
    ])

    const Comp = defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null)
        useMobileDragReorder(container, list, { enabled: ref(true) })
        return { container }
      },
      template: `
        <div ref="container" class="card-grid">
          <div class="card" data-id="g1"><div class="batch-drag-handle">h0</div></div>
          <div class="card" data-id="b1"><div class="batch-drag-handle">h1</div></div>
          <div class="card" data-id="b2"><div class="batch-drag-handle">h2</div></div>
        </div>
      `,
    })

    const w = mount(Comp, { attachTo: document.body })
    const container = w.find('.card-grid').element as HTMLElement
    const card0 = container.children[0] as HTMLElement
    const card1 = container.children[1] as HTMLElement
    const card2 = container.children[2] as HTMLElement
    const handle2 = card2.querySelector('.batch-drag-handle') as HTMLElement

    card0.getBoundingClientRect = () => ({ top: 100, left: 10, width: 200, height: 50, bottom: 150, right: 210 } as any)
    card1.getBoundingClientRect = () => ({ top: 160, left: 10, width: 200, height: 50, bottom: 210, right: 210 } as any)
    card2.getBoundingClientRect = () => ({ top: 220, left: 10, width: 200, height: 50, bottom: 270, right: 210 } as any)
    handle2.getBoundingClientRect = () => ({ top: 220, left: 10, width: 200, height: 50, bottom: 270, right: 210 } as any)

    handle2.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, button: 0, clientY: 220, bubbles: true }))
    // 向上拖到 b1 前面（即 index 1），但未跨过 g1（index 0）
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientY: 155, bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientY: 155, bubbles: true }))

    expect(toastSpy).toHaveBeenCalledWith('排序已更新')

    w.unmount()
    toastSpy.mockRestore()
  })

  it('关闭 groupsOnTop 时，拖拽跨越仍然提示正常的「排序已更新」', async () => {
    const toastSpy = vi.spyOn(toastModule, 'toast')
    const ui = useUIStore()
    ui.groupsOnTop = false

    const list = ref([
      { type: 'group', data: { id: 'g1', order: 0 } },
      { type: 'bm', data: { id: 'b1', order: 1 } },
    ])

    const Comp = defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null)
        useMobileDragReorder(container, list, { enabled: ref(true) })
        return { container }
      },
      template: `
        <div ref="container" class="card-grid">
          <div class="card" data-id="g1"><div class="batch-drag-handle">handle0</div></div>
          <div class="card" data-id="b1"><div class="batch-drag-handle">handle1</div></div>
        </div>
      `,
    })

    const w = mount(Comp, { attachTo: document.body })
    const container = w.find('.card-grid').element as HTMLElement
    const card0 = container.children[0] as HTMLElement
    const card1 = container.children[1] as HTMLElement
    const handle0 = card0.querySelector('.batch-drag-handle') as HTMLElement

    handle0.getBoundingClientRect = () => ({ top: 100, left: 10, width: 200, height: 50, bottom: 150, right: 210 } as any)
    card0.getBoundingClientRect = () => ({ top: 100, left: 10, width: 200, height: 50, bottom: 150, right: 210 } as any)
    card1.getBoundingClientRect = () => ({ top: 160, left: 10, width: 200, height: 50, bottom: 210, right: 210 } as any)

    handle0.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, button: 0, clientY: 100, bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientY: 200, bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, clientY: 200, bubbles: true }))

    expect(toastSpy).toHaveBeenCalledWith('排序已更新')

    w.unmount()
    toastSpy.mockRestore()
  })
})
