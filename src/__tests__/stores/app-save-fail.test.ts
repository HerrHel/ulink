/**
 * 行为契约护栏：useAppStore.save() 存储失败节流 toast + Zod 校验失败编排
 *
 * Explore agentId a24b8b3c64e00e66a 逐函数覆盖率深度核出真缺口 #2：
 * save() 在 saveData 返 false（隐私模式/IDB 配额满）时走 G1-004 节流分支——
 * 首次失败必 toast，持续失败每 STORAGE_FAIL_REMIND_MS（5min）再提醒，禁「只 toast 一次后
 * 静默丢写」；成功恢复清 _storageFailWarned 旗标（H11）；AppDataSchema.safeParse 失败
 * 分支返 false 阻止损坏数据落盘。现有 app.test.ts/app-fingerprint.test.ts 全程
 * vi.spyOn(persist,'saveData').mockResolvedValue(true)，错误分支从未触发。
 *
 * 纯加测试零源文件改动：save()/safeParse 分支全经 useAppStore() return 暴露，不改 app.ts。
 * _storageFailWarned/_lastStorageFailToastAt 是 setup 闭包级 let（无对外暴露），不断旗标
 * 直读，断可观察副作用：useToastStore().toasts 出现「存储不可用」+ persist.saveData 调用
 * 次数 + save 返回值（编排契约口径）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { useToastStore } from '../../stores/toast.js'
import * as persist from '../../stores/persist.js'
import { preloadSearchLibs } from '../../lib/search.js'

beforeAll(async () => {
  await preloadSearchLibs()
})

describe('useAppStore.save() 存储失败节流 + Zod 校验护栏', () => {
  let saveSpy: ReturnType<typeof vi.spyOn>
  let showSpy: ReturnType<typeof vi.spyOn>
  let app: ReturnType<typeof useAppStore>

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    app = useAppStore()
    // 监 useToastStore().show 调用次数（免疫 toast 自动 dismiss setTimeout 移除，
    // 累计统计比 toasts.value 快照更稳）。
    showSpy = vi.spyOn(useToastStore(), 'show')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** 统计「存储不可用」toast 调用次数 */
  function storageFailToastCalls(): number {
    return showSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('存储不可用')).length
  }

  /**
   * 辅助：让 store 产生「指纹变化」避免被 fp===_lastSavedFp 早退跳过。
   * 加一个真实 bookmark 让 _dataSnapshot 与初始空 fp("0|0|0|0|0|") 不同。
   */
  function makeDirty() {
    const ds = useDataStore()
    ds.addBookmark({ id: 'bm1', title: 'a', url: 'https://a.com' } as any)
  }

  it('saveData 返 false 且首次失败：toast「存储不可用」(ok=false) + save 返 false', async () => {
    makeDirty()
    saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(false)
    const toastStore = useToastStore()
    expect(toastStore.toasts).toHaveLength(0)

    const ok = await app.save()

    expect(ok).toBe(false)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(storageFailToastCalls()).toBe(1)
    // 首次同步快照：toasts[0] 直接锁内容（fake timers 下 dismiss setTimeout 尚未触发）
    expect(toastStore.toasts[0].msg).toContain('存储不可用')
    expect(toastStore.toasts[0].ok).toBe(false) // toast(msg, false)
  })

  it('持续失败 5min 内：不重复 toast（杜绝静默丢写 UX 但防刷屏）', async () => {
    makeDirty()
    saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(false)

    await app.save()
    expect(storageFailToastCalls()).toBe(1)

    // 加第二个 bookmark 让指纹变（saveData 返 false 时 _lastSavedFp 不更新故不被早退，
    // 但同指纹仍可能早退——保险起见使指纹再变），再 save 一次仍失败
    useDataStore().addBookmark({ id: 'bm2', title: 'b', url: 'https://b.com' } as any)
    await app.save()

    expect(storageFailToastCalls()).toBe(1) // 5min 内不重复 toast
    expect(saveSpy).toHaveBeenCalledTimes(2)
  })

  it('持续失败 >5min：再次 toast（STORAGE_FAIL_REMIND_MS 周期重提醒）', async () => {
    makeDirty()
    saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(false)

    await app.save()
    expect(storageFailToastCalls()).toBe(1)

    // 推进超过 5min（STORAGE_FAIL_REMIND_MS = 5*60*1000）
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    useDataStore().addBookmark({ id: 'bm2', title: 'b', url: 'https://b.com' } as any)
    await app.save()

    expect(storageFailToastCalls()).toBe(2)
  })

  it('saveData 恢复 true 后再失败：H11 清旗标，再次失败不必等 5min 即重新 toast', async () => {
    makeDirty()
    saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(false)

    await app.save()
    expect(storageFailToastCalls()).toBe(1)

    // 恢复成功：清 _storageFailWarned 旗标 + _lastStorageFailToastAt 归零（H11）
    useDataStore().addBookmark({ id: 'bm2', title: 'b', url: 'https://b.com' } as any)
    saveSpy.mockResolvedValue(true)
    await app.save()

    // 再次失败（无需推进 5min，因 H11 清了旗标 → due=true 首次提示逻辑）
    useDataStore().addBookmark({ id: 'bm3', title: 'c', url: 'https://c.com' } as any)
    saveSpy.mockResolvedValue(false)
    await app.save()

    expect(storageFailToastCalls()).toBe(2)
  })

  it('AppDataSchema.safeParse 失败分支：返 false + console.error + 不调 saveData', async () => {
    makeDirty()
    saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(true)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 构造 invalid AppData：往 bookmarks 数组塞一个非 schema 兼容的对象。
    // Bookmark 要求必要字段——塞个 number 进数组致 schema 报 issue。用 dataStore 内部数组直写。
    const ds = useDataStore()
    ds.bookmarks.push({ notABookmark: true } as any)

    const ok = await app.save()

    expect(ok).toBe(false)
    expect(saveSpy).not.toHaveBeenCalled() // safeParse 失败早返回，不落盘
    expect(errSpy).toHaveBeenCalled()
    expect(storageFailToastCalls()).toBe(0) // 校验失败走 console.error 不走 toast
  })

  it('saveData 返 true 成功路径：不 toast「存储不可用」+ save 返 true', async () => {
    makeDirty()
    saveSpy = vi.spyOn(persist, 'saveData').mockResolvedValue(true)

    const ok = await app.save()

    expect(ok).toBe(true)
    expect(storageFailToastCalls()).toBe(0)
  })
})
