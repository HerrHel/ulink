/**
 * ChildBookmarkEditModal.vue 正文分支补测（race 测已锁代际守门竞态，本文件锁未触达的函数体）
 *
 * 锁 8 类真实行为契约：
 *  ① onClose 清 password + emit close
 *  ② onSave saving 重入守门（连点跳过第二次 doSave）
 *  ③ doSave 空 url 校验 toast 拒保存不副作用
 *  ④ doSave 密码处理 4 分支：非 E2E btoa / E2E 已解锁 encrypt 3-part 拆分 / 按需解锁未取消 toast /
 *     按需解锁成功重试 doSave
 *  ⑤ doSave encrypt 格式异常 toast + encrypt 抛错 catch toast 两降级
 *  ⑥ doSave E2E 密文保护（原书签含三段密文字段）toast 阻止保存
 *  ⑦ onE2EHintClick 3 分支：已解锁无操作 / enabled 未解锁→open e2eUnlock / 未 enabled→open e2eSetup
 *  ⑧ loadFromStore：bm 不存在 emit close / 非 E2E safeDecodePassword 明文 / 已解锁 decrypt 成功 /
 *     已解锁 decrypt 抛错 catch 空 / watch(isUnlocked) 解锁后重新加载
 *
 * 桩沿用 race 测骨架：vi.mock crypto（decrypt/encrypt/safeDecodePassword/isThreePartCipher 可控）
 *  + toast/app/useE2E/icons + E2ELockOverlayStub 透传 slot。
 * race 测用固定 {value:false}，本轮用可控 e2eState 对象切换 isE2EEnabled/isUnlocked 各分支。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick, h, defineComponent, ref } from 'vue'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

const decryptMock = vi.hoisted(() => vi.fn())
const encryptMock = vi.hoisted(() => vi.fn())
const safeDecodePasswordMock = vi.hoisted(() => vi.fn())
const isThreePartCipherMock = vi.hoisted(() => vi.fn())
vi.mock('../../crypto.js', () => ({
  decrypt: decryptMock,
  encrypt: encryptMock,
  safeDecodePassword: safeDecodePasswordMock,
  isThreePartCipher: isThreePartCipherMock,
}))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/toast.js', () => ({ toast: toastMock }))

// saveAppData 桩防真实落盘；保留 app 其余导出
const saveAppDataMock = vi.hoisted(() => vi.fn())
vi.mock('../../stores/app.js', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../stores/app.js')>()
  return { ...a, saveAppData: saveAppDataMock }
})

// displayText 简化：字符串原样返，非字符串返空
vi.mock('../../utils.js', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../utils.js')>()
  return {
    ...a,
    displayText: (s: unknown) => (typeof s === 'string' ? s : ''),
    fixUrl: a.fixUrl,
    domain: a.domain,
  }
})

// 可控 E2E 状态对象：vi.hoisted 内不能用 ref()（第四十七轮教训——hoisted 早于 import 求值），
// 持空容器，vi.mock 工厂内（import 解析时 ref 已可用）填充真 ref 返回单例，测内切 .value 各分支。
const e2eState = vi.hoisted(() => ({} as { enabled: ReturnType<typeof ref<boolean>>; unlocked: ReturnType<typeof ref<boolean>> }))
vi.mock('../../composables/domain/useE2E.js', () => {
  e2eState.enabled = ref(false)
  e2eState.unlocked = ref(false)
  return {
    useE2E: () => ({
      isE2EEnabled: e2eState.enabled,
      isUnlocked: e2eState.unlocked,
    }),
  }
})

vi.mock('../../config/icons.js', () => ({ I: { close: '<svg/>', eye: '<svg/>', eyeOff: '<svg/>' } }))

const E2ELockOverlayStub = defineComponent({
  name: 'E2ELockOverlayStub',
  setup(_: unknown, { slots }: { slots: Record<string, any> }) {
    return () => h('div', { class: 'e2estub' }, slots.default?.())
  },
})

import type { EncryptedPassword } from '../../types.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import ChildBookmarkEditModal from '../../components/modals/ChildBookmarkEditModal.vue'

const cryptoKeyMock = {} as CryptoKey

function mkEncryptedPw(cipher: string): EncryptedPassword {
  return { encrypted: true, salt: 's', iv: 'i', data: cipher }
}

function seedBm(
  ds: ReturnType<typeof useDataStore>,
  id: string,
  opts: { password?: string | EncryptedPassword; title?: string; url?: string; notes?: string; username?: string } = {},
) {
  ds.addBookmark({
    id,
    title: opts.title ?? id,
    url: opts.url ?? `https://${id}.example.com`,
    username: opts.username ?? '',
    password: opts.password ?? '',
    notes: opts.notes ?? '',
    icon: '',
    categoryId: CAT_UNCATEGORIZED,
    parentId: 'parent-root',
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1,
    updatedAt: 2,
  } as any)
}

function mountComp(childId = 'child-x') {
  return mount(ChildBookmarkEditModal, {
    props: { childId },
    global: { stubs: { E2ELockOverlay: E2ELockOverlayStub } },
    attachTo: document.body,
  })
}

/** 模拟已解锁 + cryptoKey 入内存 */
async function unlockOk(e2eStore: any) {
  e2eStore.setUnlocked(true)
  e2eStore.setKey(cryptoKeyMock)
  e2eState.unlocked.value = true
  await nextTick()
}

beforeEach(() => {
  setActivePinia(createPinia())
  decryptMock.mockReset()
  encryptMock.mockReset()
  safeDecodePasswordMock.mockReset().mockReturnValue('')
  isThreePartCipherMock.mockReset().mockReturnValue(false)
  toastMock.mockReset()
  saveAppDataMock.mockReset()
  e2eState.enabled.value = false
  e2eState.unlocked.value = false
  encryptMock.mockResolvedValue('salt.iv.data') // 默认 3-part 合法
  decryptMock.mockResolvedValue('DECRYPTED')
})

describe('ChildBookmarkEditModal 正文分支契约', () => {
  describe('① onClose', () => {
    it('清 form.password + emit close', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const w = mountComp('child-x')
      await nextTick()
      // 直接设 form.password 验 onClose 清空行为（不依赖解密入值）
      w.vm.$.setupState.form.password = 'set-before-close'
      w.vm.$.setupState.onClose()
      await nextTick()
      expect(w.vm.$.setupState.form.password).toBe('')
      expect(w.emitted('close')).toBeTruthy()
      w.unmount()
    })
  })

  describe('② onSave saving 重入守门', () => {
    it('saving=true 期间第二次 onSave 跳过 doSave（saving 不被反复改）', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const w = mountComp('child-x')
      await nextTick()
      w.vm.$.setupState.form.url = 'https://x.example.com'
      // 设 saving=true 模拟第一次 onSave 正进行中（doSave await 挂起），密码处理走 E2E 按需解锁挂起
      w.vm.$.setupState.saving = true
      // saving 期间第二次 onSave 应在入口 `if (saving.value) return` 跳过不改 saving
      await w.vm.$.setupState.onSave()
      expect(w.vm.$.setupState.saving).toBe(true) // 仍 true 跳过未动
      // 对照：saving=false 时 onSave 会进入 finally 复位 saving 为 false
      w.vm.$.setupState.form.password = '' // 空 password 走 btoa? 非 E2E 空→跳过 if(form.password)
      w.vm.$.setupState.saving = false
      await w.vm.$.setupState.onSave()
      expect(w.vm.$.setupState.saving).toBe(false) // 进 doSave 完成后 finally 复位
      w.unmount()
    })
  })

  describe('③ doSave 空 url 校验', () => {
    it('空 url toast 拒保存不 updateBookmark 不 emit', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const w = mountComp('child-x')
      await nextTick()
      w.vm.$.setupState.form.url = ''
      await w.vm.$.setupState.onSave()
      expect(toastMock).toHaveBeenCalledWith('请填写网址', false)
      expect(updateSpy).not.toHaveBeenCalled()
      expect(w.emitted('close')).toBeFalsy()
      expect(w.vm.$.setupState.saving).toBe(false) // finally 复位
      updateSpy.mockRestore()
      w.unmount()
    })
  })

  describe('④ doSave 密码处理 4 分支', () => {
    it('非 E2E：form.password 经 btoa 编码后存储', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const w = mountComp('child-x')
      await nextTick()
      w.vm.$.setupState.form.url = 'https://x.example.com'
      w.vm.$.setupState.form.password = 'plain-pw' // ASCII（btoa 不支持非 ASCII）
      await w.vm.$.setupState.onSave()
      expect(updateSpy).toHaveBeenCalledTimes(1)
      const [updId, changes] = updateSpy.mock.calls[0]
      expect(updId).toBe('child-x')
      // 非 E2E 走 btoa(form.password)
      expect(changes.password).toBe(btoa('plain-pw'))
      expect(saveAppDataMock).toHaveBeenCalled()
      expect(toastMock).toHaveBeenCalledWith('子书签已更新')
      expect(w.emitted('close')).toBeTruthy()
      updateSpy.mockRestore()
      w.unmount()
    })

    it('E2E 已解锁：encrypt 成功 3-part 拆分存储 {salt,iv,data}', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      await unlockOk(e2eStore)
      encryptMock.mockResolvedValue('mysalt.myiv.mydata')
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const w = mountComp('child-x')
      await nextTick()
      // 解密路径（已解锁）会进 loadFromStore decrypt；bm 非 E2E 密文 form.password 初始空，手动设
      w.vm.$.setupState.form.url = 'https://x.example.com'
      w.vm.$.setupState.form.password = 'plain'
      await w.vm.$.setupState.onSave()
      expect(encryptMock).toHaveBeenCalledWith('plain', cryptoKeyMock)
      const changes = updateSpy.mock.calls[0][1]
      expect(changes.password).toEqual({ encrypted: true, salt: 'mysalt', iv: 'myiv', data: 'mydata' })
      expect(w.emitted('close')).toBeTruthy()
      updateSpy.mockRestore()
      w.unmount()
    })

    it('E2E 未解锁按需解锁：unlock=false toast 保存已取消不 updateBookmark', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      e2eStore.setUnlocked(false)
      e2eStore.setKey(null)
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const w = mountComp('child-x')
      await nextTick()
      await nextTick()
      // loadFromStore 已挂 pendingUnlock（E2E 已 enabled 未解锁走按需解锁分支）
      w.vm.$.setupState.form.url = 'https://x.example.com'
      w.vm.$.setupState.form.password = '明文'
      const saveP = w.vm.$.setupState.onSave() // 挂起到 doSave 内 pendingUnlock
      // 触发 doSave 按需解锁分支 push 一个 resolve
      await nextTick()
      const resolver = e2eStore.pendingUnlock.pop()
      resolver!(false) // 取消解锁
      await saveP
      expect(toastMock).toHaveBeenCalledWith('保存已取消', false)
      expect(updateSpy).not.toHaveBeenCalled()
      expect(w.emitted('close')).toBeFalsy()
      updateSpy.mockRestore()
      w.unmount()
    })

    it('E2E 按需解锁成功后 unlocked 重试 doSave 走 encrypt 拆分', async () => {
      const ds = useDataStore()
      // bm 含 E2E 密文 password：未解锁时 loadFromStore 走 pendingUnlock 挂起不填 form.password，
      // 用户手动设 form.password 触发 onSave，doSave 按需解锁 resolver(true) 后 setUnlocked+setKey
      // 触发 watch(isUnlocked)→loadFromStore 重新解密填 form.password；同时 doSave 重试走 encrypt 分支。
      // 锁「按需解锁成功后重试 doSave 成功保存且 password 加密落库」契约（不纠结 form.password 具体来源）。
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com', password: mkEncryptedPw('cipher') })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      e2eStore.setUnlocked(false)
      e2eStore.setKey(null)
      encryptMock.mockResolvedValue('es.ei.ed')
      decryptMock.mockResolvedValue('decrypted-pw')
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const w = mountComp('child-x')
      await nextTick()
      await nextTick()
      w.vm.$.setupState.form.url = 'https://x.example.com'
      w.vm.$.setupState.form.password = 'user-pw' // 用户手动设密码触发 doSave 按需解锁
      const saveP = w.vm.$.setupState.onSave()
      // doSave 按需解锁分支：resolver(true) 后 setUnlocked+setKey 模拟解锁成功 + 重试 doSave
      const resolver = e2eStore.pendingUnlock.pop()
      e2eStore.setUnlocked(true)
      e2eStore.setKey(cryptoKeyMock)
      resolver!(true)
      await saveP
      await nextTick()
      await nextTick()
      // 重试 doSave 此时已解锁走 encrypt 分支，updateBookmark 被调且 password 是加密对象
      expect(updateSpy).toHaveBeenCalledTimes(1)
      const changes = updateSpy.mock.calls[0][1]
      expect(changes.password).toEqual({ encrypted: true, salt: 'es', iv: 'ei', data: 'ed' })
      expect(encryptMock).toHaveBeenCalled()
      updateSpy.mockRestore()
      w.unmount()
    })
  })

  describe('⑤ doSave encrypt 降级（格式异常 + 抛错）', () => {
    it('encrypt 返回非 3-part 格式异常 toast 不保存', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      await unlockOk(e2eStore)
      encryptMock.mockResolvedValue('only-one-part') // 非 3-part
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const w = mountComp('child-x')
      await nextTick()
      w.vm.$.setupState.form.url = 'https://x.example.com'
      w.vm.$.setupState.form.password = '明文'
      await w.vm.$.setupState.onSave()
      expect(toastMock).toHaveBeenCalledWith('密码加密失败：输出格式异常，已取消保存', false)
      expect(updateSpy).not.toHaveBeenCalled()
      updateSpy.mockRestore()
      w.unmount()
    })

    it('encrypt 抛错 catch toast 不保存', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      await unlockOk(e2eStore)
      encryptMock.mockRejectedValue(new Error('encrypt boom'))
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const w = mountComp('child-x')
      await nextTick()
      w.vm.$.setupState.form.url = 'https://x.example.com'
      w.vm.$.setupState.form.password = '明文'
      await w.vm.$.setupState.onSave()
      expect(toastMock).toHaveBeenCalledWith('密码加密失败，请重试或稍后解锁 E2E 后再保存', false)
      expect(updateSpy).not.toHaveBeenCalled()
      updateSpy.mockRestore()
      w.unmount()
    })
  })

  describe('⑥ doSave E2E 密文保护', () => {
    it('原书签含三段密文字段 toast 阻止保存不 updateBookmark', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com', notes: 's.i.d' }) // notes 密文
      isThreePartCipherMock.mockImplementation((s: string) => s === 's.i.d')
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      await unlockOk(e2eStore)
      const updateSpy = vi.spyOn(ds, 'updateBookmark')
      const w = mountComp('child-x')
      await nextTick()
      w.vm.$.setupState.form.url = 'https://x.example.com'
      w.vm.$.setupState.form.password = '' // 空密码跳加密直接到密文保护检查
      await w.vm.$.setupState.onSave()
      expect(toastMock).toHaveBeenCalledWith('该书签含加密字段，请先解锁主密码后再编辑', false)
      expect(updateSpy).not.toHaveBeenCalled()
      isThreePartCipherMock.mockReset()
      updateSpy.mockRestore()
      w.unmount()
    })
  })

  describe('⑦ onE2EHintClick 3 分支', () => {
    it('已解锁：无副作用（不 open 任何 modal）', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const ui = useUIStore()
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      e2eStore.setUnlocked(true)
      e2eState.enabled.value = true
      e2eState.unlocked.value = true
      const w = mountComp('child-x')
      await nextTick()
      ui.modals.e2eUnlock = false
      ui.modals.e2eSetup = false
      w.vm.$.setupState.onE2EHintClick()
      expect(ui.modals.e2eUnlock).toBe(false)
      expect(ui.modals.e2eSetup).toBe(false)
      w.unmount()
    })

    it('已 enabled 未解锁：open e2eUnlock', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const ui = useUIStore()
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      e2eStore.setUnlocked(false)
      e2eState.enabled.value = true
      e2eState.unlocked.value = false
      const w = mountComp('child-x')
      await nextTick()
      ui.modals.e2eUnlock = false
      ui.modals.e2eSetup = false
      w.vm.$.setupState.onE2EHintClick()
      expect(ui.modals.e2eUnlock).toBe(true)
      expect(ui.modals.e2eSetup).toBe(false)
      w.unmount()
    })

    it('未 enabled：open e2eSetup', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { url: 'https://x.example.com' })
      const ui = useUIStore()
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(false)
      e2eState.enabled.value = false
      e2eState.unlocked.value = false
      const w = mountComp('child-x')
      await nextTick()
      ui.modals.e2eUnlock = false
      ui.modals.e2eSetup = false
      w.vm.$.setupState.onE2EHintClick()
      expect(ui.modals.e2eSetup).toBe(true)
      expect(ui.modals.e2eUnlock).toBe(false)
      w.unmount()
    })
  })

  describe('⑧ loadFromStore 分支', () => {
    it('bm 不存在：emit close', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      // 不 seed child-x
      const w = mountComp('nonexistent')
      await nextTick()
      await nextTick()
      expect(w.emitted('close')).toBeTruthy()
      w.unmount()
    })

    it('非 E2E 明文密码：safeDecodePassword 直接进表单', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { password: 'PLAIN' })
      safeDecodePasswordMock.mockReturnValue('PLAIN-DECODED')
      const w = mountComp('child-x')
      await nextTick()
      await nextTick()
      expect(safeDecodePasswordMock).toHaveBeenCalledWith('PLAIN')
      expect(w.vm.$.setupState.form.password).toBe('PLAIN-DECODED')
      w.unmount()
    })

    it('E2E 已解锁 decrypt 成功：明文进表单', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { password: mkEncryptedPw('secret-data') })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      decryptMock.mockResolvedValue('DECRYPTED-PW')
      const w = mountComp('child-x')
      await unlockOk(e2eStore)
      await nextTick()
      await nextTick()
      expect(w.vm.$.setupState.form.password).toBe('DECRYPTED-PW')
      w.unmount()
    })

    it('E2E 已解锁 decrypt 抛错：catch 后 form.password 空', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { password: mkEncryptedPw('secret-data') })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      decryptMock.mockRejectedValue(new Error('decrypt boom'))
      const w = mountComp('child-x')
      await unlockOk(e2eStore)
      await nextTick()
      await nextTick()
      expect(w.vm.$.setupState.form.password).toBe('')
      w.unmount()
    })

    it('watch(isUnlocked)：解锁后触发重新 loadFromStore 解密密码', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { password: mkEncryptedPw('secret-data') })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      e2eStore.setUnlocked(false)
      e2eStore.setKey(null)
      decryptMock.mockResolvedValue('AFTER-UNLOCK-PW')
      const w = mountComp('child-x')
      await nextTick()
      await nextTick()
      // 初始未解锁走 pendingUnlock 分支
      expect(e2eStore.pendingUnlock.length).toBe(1)
      const [resolve] = e2eStore.pendingUnlock.splice(0)
      // 模拟解锁成功：setUnlocked(true)+setKey 触发 watch isUnlocked → 重新 loadFromStore
      await unlockOk(e2eStore)
      resolve(true)
      await nextTick()
      await nextTick()
      await nextTick()
      expect(w.vm.$.setupState.form.password).toBe('AFTER-UNLOCK-PW')
      w.unmount()
    })

    it('loadFromStore 按需解锁成功且 decrypt 成功：pendingUnlock 路径填密码', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { password: mkEncryptedPw('cipher-x') })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      e2eStore.setUnlocked(false)
      e2eStore.setKey(null)
      decryptMock.mockResolvedValue('PENDING-DECRYPT-OK')
      const w = mountComp('child-x')
      await nextTick()
      await nextTick()
      // 未解锁 → loadFromStore 走 pendingUnlock 分支挂起
      expect(e2eStore.pendingUnlock.length).toBe(1)
      const resolve = e2eStore.pendingUnlock[0]
      // 只 setKey（不 setUnlocked，避免 watch(isUnlocked) 触发新 loadFromStore 推进 _loadGen）：
      // resolver 传 true 让 await 返回 unlocked=true，cryptoKey 经 setKey 可用 → 进 decrypt 分支，
      // 旧 await 的 localGen 仍有效不被短路，覆盖 line 143-148。
      e2eStore.setKey(cryptoKeyMock)
      resolve(true)
      await nextTick()
      await nextTick()
      await nextTick()
      expect(w.vm.$.setupState.form.password).toBe('PENDING-DECRYPT-OK')
      w.unmount()
    })

    it('loadFromStore 按需解锁成功但 decrypt 抛错：catch 后 form.password 空', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { password: mkEncryptedPw('cipher-x') })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      e2eStore.setUnlocked(false)
      e2eStore.setKey(null)
      decryptMock.mockRejectedValue(new Error('decrypt boom'))
      const w = mountComp('child-x')
      await nextTick()
      await nextTick()
      expect(e2eStore.pendingUnlock.length).toBe(1)
      const resolve = e2eStore.pendingUnlock[0]
      e2eStore.setKey(cryptoKeyMock)
      resolve(true)
      await nextTick()
      await nextTick()
      await nextTick()
      // 覆盖 line 149 catch 分支：decrypt 抛错 → form.password=''
      expect(w.vm.$.setupState.form.password).toBe('')
      w.unmount()
    })

    it('loadFromStore 按需解锁返回 true 但 cryptoKey 仍空：else 分支 form.password 空', async () => {
      const ds = useDataStore()
      seedBm(ds, 'parent-root')
      seedBm(ds, 'child-x', { password: mkEncryptedPw('cipher-x') })
      const e2eStore = (await import('../../stores/e2e.js')).useE2EStore()
      e2eStore.setEnabled(true)
      e2eStore.setUnlocked(false)
      e2eStore.setKey(null)
      const w = mountComp('child-x')
      await nextTick()
      await nextTick()
      expect(e2eStore.pendingUnlock.length).toBe(1)
      const resolve = e2eStore.pendingUnlock[0]
      // resolver 传 true 但不 setKey（cryptoKey 仍 null）→ if(unlocked && cryptoKey) false → else 空
      resolve(true)
      await nextTick()
      await nextTick()
      await nextTick()
      // 覆盖 line 150 else 分支
      expect(w.vm.$.setupState.form.password).toBe('')
      w.unmount()
    })
  })
})
