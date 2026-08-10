/**
 * 真 bug 复现：ChildBookmarkEditModal 跨 childId 竞态——明文密码视觉泄漏 + 数据损坏
 *
 * 触发链：ChildBookmarkEditModal 的 modal 由 BookmarkModal.vue:99
 *   <ChildBookmarkEditModal v-if="childModalOpen" :child-id="childModalId" .../>
 * 驱动。用户点子书签 edit（onEditChild）= `childModalId.value = id; childModalOpen.value = true`。
 * modal 已开（v-if 已真）后再点另一子书签 edit 只换 :child-id prop —— Vue 复用组件实例不
 * re-mount，仅触发 watch childId 跑新 loadFromStore。
 *
 * 旧 loadFromStore 内 `await new Promise(resolve => e2eStore.pendingUnlock.push(resolve))`
 * 挂起等用户解锁（App.vue:210-223 弹 E2E 解锁 modal，秒级手动窗口）。挂起期间若 user 在
 * BookmarkModal 主窗口点另一子书签的 edit → watch childId 跑新 loadFromStore → _loadGen 前进。
 * App.vue:151 解锁后 `drainPendingUnlock` 把队列全 resolve(true)：旧 await 用闭包锁定的
 * `bm = ds.bookmarkMap[旧 childId A]` 解密 → 写 form.password —— 此时 form 已属 childId B
 * → A 的明文密码显示在 B 的密码框（视觉泄漏）。若 user 直接保存 → doSave 用 B.childId +
 * A 明文密码加密写回 → B.password 被覆盖（数据损坏）。
 *
 * 修复（代际 token 对齐 HistoryPanel `_gen` / bdPwShow `_detailGen` 模式）：模块级 _loadGen，
 * loadFromStore 开头 `const localGen = ++_loadGen`，每个 await 后写 form.password 前判
 * `if (localGen !== _loadGen) return` 让旧 await 写入短路。
 *
 * 此测锁定 race 复现：A 挂在 pendingUnlock await → 切 childId B 让 _loadGen 前进 → 解锁 A
 * 的 await → 断言最终 form.password（DOM `.pw-input` value）是 B 的明文而非 A 的明文。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick, h, defineComponent } from 'vue'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

// mock crypto：decrypt 按 cipher 内容映射到不同明文，区分 A/B 的密码解密结果
const decryptMock = vi.hoisted(() => vi.fn())
const safeDecodePasswordMock = vi.hoisted(() => vi.fn())
vi.mock('../../crypto.js', () => ({
  decrypt: decryptMock,
  safeDecodePassword: safeDecodePasswordMock,
  encrypt: vi.fn(),
  isThreePartCipher: (s: unknown) => typeof s === 'string' && s.split('.').length === 3,
}))

// mock toast / saveAppData：本测不验证加密/保存副作用，避免拉真实依赖
vi.mock('../../lib/toast.js', () => ({ toast: vi.fn() }))
vi.mock('../../stores/app.js', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../stores/app.js')>()
  return { ...a, saveAppData: vi.fn() }
})

// displayText 简化：非密文字段直接当明文返，便于断言
vi.mock('../../utils.js', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../utils.js')>()
  return { ...a, displayText: (s: unknown) => (typeof s === 'string' ? s : '') }
})

// useE2E（composable）与 useE2EStore 都要用：composable 给模板 e2eFieldsOpen computed 等，
// 这里返固定 false（isUnlocked=false）让走 pendingUnlock 分支
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    isE2EEnabled: { value: true },
    isUnlocked: { value: false },
  }),
}))

vi.mock('../../config/icons.js', () => ({ I: { close: '<svg/>', eye: '<svg/>', eyeOff: '<svg/>' } }))

// E2ELockOverlay 子组件 stub：透传 slot 内容（input + pw-toggle），使密码框正常渲染
const E2ELockOverlayStub = defineComponent({
  name: 'E2ELockOverlayStub',
  setup(_: unknown, { slots }: { slots: Record<string, any> }) {
    return () => h('div', { class: 'e2estub' }, slots.default?.())
  },
})

import { useDataStore } from '../../stores/data.js'
import ChildBookmarkEditModal from '../../components/modals/ChildBookmarkEditModal.vue'

const cryptoKeyMock = {} as CryptoKey

function mkEncryptedPw(cipher: string) {
  return { encrypted: true as const, salt: 'salt', iv: 'iv', data: cipher }
}

function seedBm(ds: ReturnType<typeof useDataStore>, id: string, cipher: string, title: string) {
  ds.addBookmark({
    id, title, url: `https://${id}.example.com`, username: '', password: mkEncryptedPw(cipher),
    notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: 'parent-root', order: 0,
    useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 2,
  } as any)
}

function mountComp(childId: string) {
  return mount(ChildBookmarkEditModal, {
    props: { childId },
    global: { stubs: { E2ELockOverlay: E2ELockOverlayStub } },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  decryptMock.mockReset()
  safeDecodePasswordMock.mockReset()
  // decrypt 按 cipher 内容映射到不同明文——A_CIPHER→A_PLAINTEXT, B_CIPHER→B_PLAINTEXT
  decryptMock.mockImplementation(async (raw: string) => {
    if (raw.endsWith('.A_CIPHER')) return 'A_PLAINTEXT'
    if (raw.endsWith('.B_CIPHER')) return 'B_PLAINTEXT'
    return 'UNKNOWN_PLAINTEXT'
  })
  safeDecodePasswordMock.mockReturnValue('')
})

describe('ChildBookmarkEditModal 跨 childId 竞态——代际 token 防旧 await 写入错表单', () => {
  it('A 挂在 pendingUnlock await 期间切 childId B → 解锁后 form.password 是 B 的明文而非 A 的', async () => {
    const ds = useDataStore()
    seedBm(ds, 'parent-root', '', '父')
    seedBm(ds, 'child-A', 'A_CIPHER', '子A')
    seedBm(ds, 'child-B', 'B_CIPHER', '子B')

    const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
    e2eStore.setEnabled(true)
    e2eStore.setUnlocked(false)
    e2eStore.setKey(null)

    const w = mountComp('child-A')
    await nextTick()
    await nextTick()
    // immediate watch 跑首 loadFromStore(A)：未解锁 → push 一个 resolve 到 pendingUnlock 队列，挂起 await
    expect(e2eStore.pendingUnlock.length).toBe(1)
    const resolveA = e2eStore.pendingUnlock[0] // 保留 A 的 await（不解）

    // 切 childId 到 B（不关 modal，仅换 prop —— Vue 复用组件实例，触发 watch childId）
    // 这是真实的 race 触发路径：BookmarkModal 主窗口的子书签列表 edit 切换 onEditChild
    await w.setProps({ childId: 'child-B' })
    await nextTick()
    await nextTick()
    // 新 loadFromStore(B) 也未解锁走 pendingUnlock 分支，再 push 一个 resolve，队列 2
    // 关键：++_loadGen 让 A 的 localGen 已失效
    expect(e2eStore.pendingUnlock.length).toBe(2)
    const resolveB = e2eStore.pendingUnlock[1] // B 的 await

    // 解锁：e2eStore.isUnlocked=true + cryptoKey 入内存（模拟用户输主密码解锁成功）
    e2eStore.setUnlocked(true)
    e2eStore.setKey(cryptoKeyMock)

    // 真实 race 时序：B 的 await 先被 drainPendingUnlock 解掉——B 写入 B_PLAINTEXT；
    // 然后 A 的 await 后被解掉——A 的旧 await 回过味来按闭包 bm=A 解密 A_PLAINTEXT，覆盖 B。
    // （splice(0) 顺序解的 microtask 时序也覆盖，但单独 resolve 控制得更精准。修复前：
    // 最终 form.password = A_PLAINTEXT（被旧 await 覆盖），视觉泄漏。修复后：orney)
    resolveB(true)
    await nextTick()
    await nextTick()
    resolveA(true)
    await nextTick()
    await nextTick()
    await nextTick()

    // 关键断言：form.password 是 B 的明文（B_PLAINTEXT），不是 A 的明文（A_PLAINTEXT）。
    // 修复前：A 的旧 await 解锁后仍按闭包锁定的 bm=A 解密 → 写 A_PLAINTEXT 到 form.password
    //         → A 的明文显示在 B 的密码框（视觉泄漏）。
    // 修复后：A 的旧 await 写入前 `if (localGen !== _loadGen) return` 短路，B 的 await 写入 B_PLAINTEXT。
    const pwInput = w.element.querySelector('.pw-input') as HTMLInputElement | null
    expect(pwInput, '密码框应存在').toBeTruthy()
    expect(pwInput!.value).toBe('B_PLAINTEXT')
    expect(pwInput!.value).not.toBe('A_PLAINTEXT')

    w.unmount()
  })

  it('未切 childId 时（无 race）正常解密当前书签的密码', async () => {
    const ds = useDataStore()
    seedBm(ds, 'parent-root', '', '父')
    seedBm(ds, 'child-X', 'A_CIPHER', '子X')

    const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
    e2eStore.setEnabled(true)
    e2eStore.setUnlocked(false)
    e2eStore.setKey(null)

    const w = mountComp('child-X')
    await nextTick()
    await nextTick()
    expect(e2eStore.pendingUnlock.length).toBe(1)

    // 解锁：单 resolve 解掉，无 race，form.password 应正常解出 X（A_CIPHER→A_PLAINTEXT）
    e2eStore.setUnlocked(true)
    e2eStore.setKey(cryptoKeyMock)
    const [resolve] = e2eStore.pendingUnlock.splice(0)
    resolve(true)
    await nextTick()
    await nextTick()
    await nextTick()

    const pwInput = w.element.querySelector('.pw-input') as HTMLInputElement | null
    expect(pwInput, '密码框应存在').toBeTruthy()
    expect(pwInput!.value).toBe('A_PLAINTEXT')

    w.unmount()
  })

  it('基线：切 childId 但旧 await 被 resolve(false) 取消 → 旧表单密码不变（不泄漏 A 明文）', async () => {
    const ds = useDataStore()
    seedBm(ds, 'parent-root', '', '父')
    seedBm(ds, 'child-A', 'A_CIPHER', '子A')
    seedBm(ds, 'child-B', 'B_CIPHER', '子B')

    const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
    e2eStore.setEnabled(true)
    e2eStore.setUnlocked(false)
    e2eStore.setKey(null)

    const w = mountComp('child-A')
    await nextTick()
    await nextTick()
    expect(e2eStore.pendingUnlock.length).toBe(1)

    await w.setProps({ childId: 'child-B' })
    await nextTick()
    await nextTick()
    expect(e2eStore.pendingUnlock.length).toBe(2)

    // 用户取消解锁（失败/取消分支，不走解密）—— 队列全 resolve(false)
    // 此时 A 的旧 await 与 B 的 await 都走 else 分支 form.password = '' （但只有当前 gen 写入生效）
    const resolvers = e2eStore.pendingUnlock.splice(0)
    for (const resolve of resolvers) resolve(false)
    await nextTick()
    await nextTick()
    await nextTick()

    const pwInput = w.element.querySelector('.pw-input') as HTMLInputElement | null
    expect(pwInput, '密码框应存在').toBeTruthy()
    // 取消解锁 → 密码框空，绝不显示 A 的明文
    expect(pwInput!.value).toBe('')
    expect(pwInput!.value).not.toBe('A_PLAINTEXT')

    w.unmount()
  })
})
