import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- d1-106 addNewCategory 护栏 ----
// addNewCategory(src/utils.ts:210) 是「用户新增分类」唯一 store mutation 承载逻辑，被 3 处生产消费：
//   CategoryModal.vue:116（创建分类弹窗确认）/ ActionSheet.vue:55（移动端快捷面板新建）/
//   BatchPopover.vue:60（批量面板新建）。此前零直接护栏（仅随组件黑盒间接运行），
//   其「空名/重名大小写不敏感去重前哨 + toast 反馈 + 编排顺序（前哨先于 createCategory/createStore mutation）」
//   契约全靠实现口头维护，任一漂移（如未来误把大小写敏感去重、或重名时仍 addCategory 致重复入 store、
//   或漏 save() 致新分类不落盘）均无测试告警。本护栏直接锁这些可回归契约。
//
// 范式：utils.ts 的 `interface AppStore` 仅声明 3 面（categories addCategory save），addNewCategory 接收 store 入参，
// 故不 vi.mock 整个 pinia store（避免真实 store save() 真触发 IDB/localStorage 写盘副作用与初始化复杂态），
// 直接构造满足 3 面的最小 mock 对象 cast as unknown as AppStore 传入——同 d1-79~d1-91 已验证的 cast mock 思路。
// toast 经模块级 vi.mock 桩（utils.ts 顶层 `import { toast } from './lib/toast.js'`，测试在 src/__tests__/ 相对 '../../lib/toast.js'）。

vi.mock('../lib/toast.js', () => ({
  toast: vi.fn(),
}))

import { addNewCategory } from '../utils.js'
import { toast } from '../lib/toast.js'
import { CATEGORY_COLORS } from '../utils.js'
import type { Category } from '../types.js'

// AppStore 是 utils.ts 内部未导出 interface（仅声明 categories/addCategory/save 3 面），
// 测试不依赖其完整类型——cast 满足 3 面的结构 mock 即可（addNewCategory 运行时只用这 3 面）。
type AppStoreLike = { categories: Category[]; addCategory: (c: Category) => void; save: () => void }

const toastMock = vi.mocked(toast)

interface MockStore {
  categories: Category[]
  addCategory: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
}

function makeMockStore(initialCats: Category[] = []): MockStore {
  const cats = [...initialCats]
  return {
    categories: cats,
    // 模拟 data store.addCategory 真 push 进数组的行为（生产 data.ts addCategory: categories=[...categories,cat]）
    addCategory: vi.fn((cat: Category) => { cats.push(cat) }),
    save: vi.fn(),
  }
}

// 最小 cast：仅 3 面（categories/addCategory/save）满足即可
function asAppStore(s: MockStore): AppStoreLike {
  return s as unknown as AppStoreLike
}

describe('d1-106 addNewCategory — 新增分类 store mutation 前哨编排护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ── 守卫分支：空名 ──
  it('空名 → 早退 toast「请输入分类名称」标记 false + 返 null + 不 addCategory + 不 save', () => {
    const store = makeMockStore()
    const result = addNewCategory('', asAppStore(store))
    expect(result).toBeNull()
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('请输入分类名称', false)
    expect(store.addCategory).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
    // 早退不污染 store 数组
    expect(store.categories).toHaveLength(0)
  })

  it('纯空格名（"   "）→ trim 成空 → 同空名早退分支', () => {
    const store = makeMockStore()
    const result = addNewCategory('   ', asAppStore(store))
    expect(result).toBeNull()
    expect(toastMock).toHaveBeenCalledWith('请输入分类名称', false)
    expect(store.addCategory).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('tab/换行混入空格名（"\\t \\n"）→ trim 成空 → 早退', () => {
    const store = makeMockStore()
    const result = addNewCategory('\t \n', asAppStore(store))
    expect(result).toBeNull()
    expect(toastMock).toHaveBeenCalledWith('请输入分类名称', false)
    expect(store.addCategory).not.toHaveBeenCalled()
  })

  // ── 守卫分支：重名大小写不敏感 ──
  it('重名大小写不敏感（已有 "Existing"，新 "existing"）→ toast「分类名称已存在」false + 返 null + 不 add + 不 save', () => {
    const existing: Category = {
      id: 'cat-1', name: 'Existing', icon: 'star', color: 'blue', order: 1,
    }
    const store = makeMockStore([existing])
    const result = addNewCategory('existing', asAppStore(store))
    expect(result).toBeNull()
    expect(toastMock).toHaveBeenCalledWith('分类名称已存在', false)
    expect(store.addCategory).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
    expect(store.categories).toHaveLength(1)
  })

  it('重名大小写不敏感反向（已有 "existing"，新 "EXISTING"）→ 早退', () => {
    const existing: Category = {
      id: 'cat-2', name: 'existing', icon: 'star', color: 'red', order: 2,
    }
    const store = makeMockStore([existing])
    const result = addNewCategory('EXISTING', asAppStore(store))
    expect(result).toBeNull()
    expect(store.addCategory).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('重名全大写已有（"WORK"），新小写（"work"）→ 早退', () => {
    const existing: Category = {
      id: 'cat-3', name: 'WORK', icon: 'star', color: 'green', order: 3,
    }
    const store = makeMockStore([existing])
    const result = addNewCategory('work', asAppStore(store))
    expect(result).toBeNull()
    expect(toastMock).toHaveBeenCalledWith('分类名称已存在', false)
    expect(store.addCategory).not.toHaveBeenCalled()
  })

  // ── 正路径分支：合法新名 ──
  it('合法新名 → toast「分类已添加」（默认成功标记）+ 返 Category + addCategory 调一次 + save 调一次', () => {
    const store = makeMockStore()
    const result = addNewCategory('我的新分类', asAppStore(store))
    expect(result).not.toBeNull()
    expect(toastMock).toHaveBeenCalledTimes(1)
    // 「分类已添加」单参调用（成功默认标记）
    expect(toastMock).toHaveBeenCalledWith('分类已添加')
    expect(store.addCategory).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it('返的对象经 createCategory 构造：name=trimmed 入参原值（非原未 trim 串）', () => {
    const store = makeMockStore()
    // 注意入参带首尾空格但合法（trim 后 'Work'），返 .name 应是 trim 后的 'Work'
    const result = addNewCategory('  Work  ', asAppStore(store))
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Work')
  })

  it('返 Category.id 非空（gid 生成）', () => {
    const store = makeMockStore()
    const result = addNewCategory('随便', asAppStore(store))
    expect(result).not.toBeNull()
    expect(typeof result!.id).toBe('string')
    expect(result!.id.length).toBeGreaterThan(0)
  })

  it('返 Category.icon 默认 star（createCategory 默认）', () => {
    const store = makeMockStore()
    const result = addNewCategory('新类', asAppStore(store))
    expect(result).not.toBeNull()
    expect(result!.icon).toBe('star')
  })

  it('返 Category.color 属 CATEGORY_COLORS 集合（防未来误改 color 源为单色/非集色）', () => {
    const store = makeMockStore()
    const result = addNewCategory('色类', asAppStore(store))
    expect(result).not.toBeNull()
    expect(CATEGORY_COLORS).toContain(result!.color)
  })

  it('返 Category.order 是 number（Date.now() 排序主键，防误删致 NaN 比较塌陷排序）', () => {
    const store = makeMockStore()
    const result = addNewCategory('排序类', asAppStore(store))
    expect(result).not.toBeNull()
    expect(typeof result!.order).toBe('number')
    expect(Number.isFinite(result!.order)).toBe(true)
  })

  it('传入 store.addCategory 收到的就是返回的同一个 Category 对象', () => {
    const store = makeMockStore()
    const result = addNewCategory('一致类', asAppStore(store))
    expect(result).not.toBeNull()
    expect(store.addCategory).toHaveBeenCalledWith(result)
  })

  // ── 编排顺序敏感：重名前哨先于 createCategory/addCategory ──
  it('重名时绝不调 addCategory（重名前哨先于 store mutation）——即使重名后理论上不应有任何 store 写动作', () => {
    const existing: Category = { id: 'x', name: 'dup', icon: 'star', color: 'blue', order: 1 }
    const store = makeMockStore([existing])
    // 多次不同大小写变体都应被前哨拦下
    for (const variant of ['dup', 'DUP', 'DuP', ' dup ', 'DUP ']) {
      const result = addNewCategory(variant, asAppStore(store))
      expect(result).toBeNull()
      // 注意 ' dup ' 经 trim → 'dup' 仍判重
    }
    // 四个变体全是重名，绝不应调 addCategory
    expect(store.addCategory).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
    expect(store.categories).toHaveLength(1)
    expect(toastMock).toHaveBeenCalledWith('分类名称已存在', false)
  })

  it('连续两次新增不同合法名 → 两次 addCategory + 两次 save + store 有两条（去重不误拦新名）', () => {
    const store = makeMockStore()
    const r1 = addNewCategory('类A', asAppStore(store))
    const r2 = addNewCategory('类B', asAppStore(store))
    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()
    expect(store.addCategory).toHaveBeenCalledTimes(2)
    expect(store.save).toHaveBeenCalledTimes(2)
    expect(store.categories).toHaveLength(2)
  })

  it('先加「类A」再加「类a」（重名大小写不敏感）→ 第二次被拦 + 仍只一条 + save 只一次', () => {
    const store = makeMockStore()
    addNewCategory('类A', asAppStore(store))
    const r2 = addNewCategory('类a', asAppStore(store))
    expect(r2).toBeNull()
    expect(store.addCategory).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenCalledTimes(1)
    expect(store.categories).toHaveLength(1)
    expect(toastMock).toHaveBeenCalledWith('分类名称已存在', false)
  })

  // ── toast 反馈标记契约 ──
  it('空名 toast 第二参是 false（失败标记，非默认成功）—— 防未来误改为成功 toast', () => {
    const store = makeMockStore()
    addNewCategory('', asAppStore(store))
    expect(toastMock).toHaveBeenCalledWith('请输入分类名称', false)
  })

  it('重名 toast 第二参是 false —— 防未来误改为成功 toast', () => {
    const existing: Category = { id: 'y', name: '重复', icon: 'star', color: 'blue', order: 1 }
    const store = makeMockStore([existing])
    addNewCategory('重复', asAppStore(store))
    expect(toastMock).toHaveBeenCalledWith('分类名称已存在', false)
  })

  it('成功 toast 无第二参（默认成功标记）—— 与失败 toast 双参契约区分', () => {
    const store = makeMockStore()
    addNewCategory('成功类', asAppStore(store))
    expect(toastMock).toHaveBeenCalledWith('分类已添加')
    // 严格核验：成功 toast 只传一个参
    const call = toastMock.mock.calls[0]
    expect(call).toHaveLength(1)
  })
})
