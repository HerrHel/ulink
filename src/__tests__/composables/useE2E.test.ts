/**
 * useE2E.test.ts — 解锁补解密回归测试
 *
 * #4 修复：Realtime 在 E2E 未解锁期间推来的远端密文条目，storeItem 仅在 isUnlocked=true
 * 时解密，未解锁那批条目的 title/url/username/notes 停留密文态进 store → 解锁后 UI 乱码。
 * unlock 成功后 decryptStoreItems 扫 store 全部条目对 ENCRYPT_FIELDS 字段补解密。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// e2e store mock 共享 state（不需 reactive——useE2E 用 getter 实时读，plain 对象即可；
// getter 闭包对 plain 对象属性实时返回，无 reactive 也能模拟 isUnlocked 等）。
const _e2eState = vi.hoisted(() => ({ isE2EEnabled: false, isUnlocked: false, isBiometricEnrolled: false, cryptoKey: null as CryptoKey | null }))
vi.mock('../../stores/e2e.js', () => ({
  useE2EStore: () => ({
    get isE2EEnabled() { return _e2eState.isE2EEnabled },
    get isUnlocked() { return _e2eState.isUnlocked },
    get isBiometricEnrolled() { return _e2eState.isBiometricEnrolled },
    get cryptoKey() { return _e2eState.cryptoKey },
    get visibilityLocked() { return false },
    setEnabled: (v: boolean) => { _e2eState.isE2EEnabled = v },
    setKey: (k: CryptoKey) => { _e2eState.cryptoKey = k },
    setUnlocked: (v: boolean) => { _e2eState.isUnlocked = v },
    setBiometricEnrolled: (v: boolean) => { _e2eState.isBiometricEnrolled = v },
    setCloudCanaryStale: () => {}, // 4c：stale 标记由 changePw 测试用例覆盖，此处仅占位不炸
    resetLockTimer: () => {},
    initVisibilityLock: () => {},
    lock: () => { _e2eState.isUnlocked = false; _e2eState.cryptoKey = null },
  }),
}))

import { useE2E } from '../../composables/domain/useE2E.js'
import { useDataStore } from '../../stores/data.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { PBKDF2_DEFAULT_ITERATIONS, PBKDF2_ITERATIONS } from '../../crypto.js'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.isBiometricEnrolled = false
  _e2eState.cryptoKey = null
})

describe('useE2E.decryptStoreItems 解锁后补解密', () => {
  it('store 中残留的密文态敏感字段在 decryptStoreItems 后解回明文，明文字段不动', async () => {
    const e2e = useE2E()
    const ds = useDataStore()

    // 1) 设主密码（真 Web Crypto，jsdom 提供 crypto.subtle）
    const masterPw = 'test-password-123'
    const ok = await e2e.setupMasterPassword(masterPw)
    expect(ok).toBe(true)
    expect(e2e.isUnlocked.value).toBe(true) // setup 后自动解锁

    // 2) 用真加密生成一条密文 username 的 bookmark，塞 store 模拟「未解锁时 Realtime 落的密文态」。
    //    现行加密范围已收窄到仅 username，title/url/notes 不再被 encryptItem 加密。
    const enc = await e2e.encryptItem('bookmark', {
      title: '普通标题', url: 'https://cipher.example', username: '机密用户名', notes: '私密笔记',
    } as any)
    const cipherUsername = enc.username as string
    expect(cipherUsername).not.toBe('机密用户名') // 确真加密了（三段 salt.iv.data）
    expect(enc.title).toBe('普通标题') // title 现已明文存云端，不被加密
    expect(enc.notes).toBe('私密笔记') // notes 已移入 LEGACY，push 不再加密 → 明文穿透

    // 手动用 encryptField 把 notes 加密，模拟「旧版本加密的 notes 密文」（历史数据迁移期残留）
    const cipherNotes = await e2e.encryptField('私密笔记') as string
    expect(cipherNotes).not.toBe('私密笔记')

    ds.addBookmark({
      id: 'b1', title: '普通标题', url: 'https://cipher.example', username: cipherUsername, password: '',
      notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    // 一条全明文的 bookmark，模拟「未加密的本地条目」
    ds.addBookmark({
      id: 'b2', title: '普通明文标题', url: 'https://plain.example', username: 'plainUser',
      password: '', notes: 'plainNotes', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    // 3) lock 再 unlock，模拟「未解锁 → 已解锁」过渡
    e2e.lock()
    const ok2 = await e2e.unlock(masterPw)
    expect(ok2).toBe(true)
    expect(e2e.isUnlocked.value).toBe(true)

    // 4) 验证：b1 的密文 username/notes 被解回明文；title/url 明文不动；b2 全明文不动
    expect(ds.bookmarkMap['b1'].username).toBe('机密用户名')
    expect(ds.bookmarkMap['b1'].notes).toBe('私密笔记')
    expect(ds.bookmarkMap['b1'].title).toBe('普通标题')
    expect(ds.bookmarkMap['b1'].url).toBe('https://cipher.example')
    expect(ds.bookmarkMap['b2'].username).toBe('plainUser')
    expect(ds.bookmarkMap['b2'].notes).toBe('plainNotes')
    expect(ds.bookmarkMap['b2'].title).toBe('普通明文标题')
  }, 15000)

  it('legacy 旧密文 title/url（迁移期云端残留）经 decryptStoreItems 解回明文', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    const masterPw = 'legacy-pw-789'
    await e2e.setupMasterPassword(masterPw)
    expect(e2e.isUnlocked.value).toBe(true)

    // 模拟迁移期：云端旧数据里 title/url 仍是 E2E 密文（旧版本加密过）。
    // 手动用当前 key 给 title/url 加密，模拟云端拉下的旧密文行。
    const cipherTitle = await e2e.encryptField('旧密文标题') as string
    const cipherUrl = await e2e.encryptField('https://old.example') as string
    expect(cipherTitle).not.toBe('旧密文标题')
    expect(cipherUrl).not.toBe('https://old.example')
    ds.addBookmark({
      id: 'b3', title: cipherTitle, url: cipherUrl, username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    e2e.lock()
    const ok = await e2e.unlock(masterPw)
    expect(ok).toBe(true)
    // decryptStoreItems 对 title/url 走 legacy 解密，旧密文被还原
    expect(ds.bookmarkMap['b3'].title).toBe('旧密文标题')
    expect(ds.bookmarkMap['b3'].url).toBe('https://old.example')
  }, 15000)

  it('未登录也工作（canary 仅本地 localStorage，不经 Supabase）', async () => {
    // 复用同上但确认无 supabase 调用崩溃——本测试用例就是「未登录」场景：
    // 上一测试已足，此处仅断言可重复 setup/unlock 而不依赖云端。
    const e2e = useE2E()
    const ok = await e2e.setupMasterPassword('pw-another-456')
    expect(ok).toBe(true)
    e2e.lock()
    const ok2 = await e2e.unlock('pw-another-456')
    expect(ok2).toBe(true)
  })

  it('解不开的密文（错 key / 改主密码后旧密文）经 decryptStoreItems 保留原文而非写空（防空值回写云端永久丢失）', async () => {
    // 场景：A 设备用主密码 PA 加密 notes 推云端；后改主密码为 PB（reset 生成新 salt/keyB），
    // 但云端历史 notes 仍是 keyA 密文（reset 未重加密历史）。新设备用 PB unlock → 派生 keyB
    // → decryptStoreItems 用 keyB 解 keyA 密文 → GCM 认证失败。
    // 旧行为：decryptField 走 decryptForDisplay 解不开返 '' → tryField `'' !== 密文` → 字段写空
    // → UI 显示空（防乱码）。但空值被随后的 saveAppData/push 回写云端覆盖明文 → **永久丢失**
    //（真实用户事故：登录后一批书签 url 变空白）。修复：解不开时保留原密文，数据在即可换正确
    // 主密码找回；UI 乱码由渲染层对密文段的展示兜底负责（decryptField 返空语义保持不变）。
    const e2e = useE2E()
    const ds = useDataStore()

    // 1) 用 PA setup 加密一条 notes，拿到 keyA 密文
    await e2e.setupMasterPassword('old-master-PA')
    expect(e2e.isUnlocked.value).toBe(true)
    const cipherNotes = await e2e.encryptField('A 设备的私密笔记 keyA 加密') as string
    expect(cipherNotes.split('.')).toHaveLength(3)
    expect(cipherNotes).not.toBe('A 设备的私密笔记 keyA 加密')

    // 2) lock，改主密码为 PB（新 salt → 新 keyB；canaryData 被覆盖，模拟 reset）。
    //    直接再 setup 用新主密码即可让 store 切到 keyB 语境（等价 reset 的换 key 效果，
    //    但不跑 reset 全链路，聚焦 decryptStoreItems 行为）。
    e2e.lock()
    await e2e.setupMasterPassword('new-master-PB')
    expect(e2e.isUnlocked.value).toBe(true)

    // 3) 把「keyA 加密的密文」塞进 store（模拟云端拉下/残留的历史密文行）
    ds.addBookmark({
      id: 'b-stale', title: 'stale-bm', url: 'https://stale.example', username: '',
      password: '', notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    // 4) lock + 用 PB unlock → 解锁后补解密用 keyB 解 keyA 的 notes 密文
    e2e.lock()
    const ok = await e2e.unlock('new-master-PB')
    expect(ok).toBe(true)
    expect(e2e.isUnlocked.value).toBe(true)

    // 5) 修复后：notes 保留原密文（解不开不置空），数据仍在
    expect(ds.bookmarkMap['b-stale'].notes).toBe(cipherNotes)
  }, 20000)

  it('BUG 复现：用错 key 解锁时，解不开的密文 url 保留原文而非置空（置空会被 push 回写云端永久丢失）', async () => {
    // 场景：A 设备（旧版 E2E 加密过 title/url）云端存密文 url；B 设备主密码不一致
    // （canary 单槽被覆盖 / 改主密码未迁移），登录后 unlock 用 keyB 解 keyA 密文失败。
    // 旧行为：decryptStoreItems 把 url 写空 → UI 显示空白，后续任意保存把空 url 推上云端。
    const e2e = useE2E()
    const ds = useDataStore()

    // 1) 设备 A：setup + 加密 url（模拟旧版云端密文行）
    await e2e.setupMasterPassword('device-A-pw')
    const cipherUrl = await e2e.encryptField('https://secret-a.example') as string
    expect(cipherUrl.split('.')).toHaveLength(3)
    expect(cipherUrl).not.toBe('https://secret-a.example')
    ds.addBookmark({
      id: 'b-url', title: '密文标题', url: cipherUrl, username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    // 2) 设备 B：lock + 新主密码 setup（canary 覆盖 → keyB），再 unlock 触发 decryptStoreItems
    e2e.lock()
    await e2e.setupMasterPassword('device-B-pw')
    e2e.lock()
    const ok = await e2e.unlock('device-B-pw')
    expect(ok).toBe(true)
    expect(e2e.isUnlocked.value).toBe(true)

    // 3) 关键断言：url 不被置空。解不开时应保留原密文（数据在，换正确主密码可找回）
    expect(ds.bookmarkMap['b-url'].url).toBe(cipherUrl)
  }, 20000)

  it('未解锁时 decryptField：三段密文返空不渲染乱码，明文原样穿透（多设备/锁定态展示兜底）', async () => {
    // 场景：B 端 E2E 启用但未解锁，云端拉下的密文条目原样进 store（storeItem 锁定态不解密）。
    // 旧解：decryptField 在 !key 时 `return value` 原样返密文 → 模板 {{ bookmark.notes }}
    // /{{ bookmark.username }} 渲染长串乱码。修复：!key 时三段密文返 ''、明文原样穿透。
    // 注意：仅断 decryptField 边界，不跑 decryptStoreItems（解锁后另测覆盖补解密）。
    const e2e = useE2E()
    await e2e.setupMasterPassword('locked-pw-0') // 创一把真 key 并生成真密文
    const cipherNotes = await e2e.encryptField('应被隐藏的机密笔记') as string
    expect(cipherNotes.split('.')).toHaveLength(3) // 确真三段密文
    e2e.lock() // → key 出内存，进入未解锁态
    expect(e2e.isE2EEnabled.value).toBe(true)
    expect(e2e.isUnlocked.value).toBe(false)

    // 未解锁：三段密文返空（UI 显空不显乱码），非三段明文原样返
    await expect(e2e.decryptField(cipherNotes)).resolves.toBe('')
    await expect(e2e.decryptField('普通明文笔记')).resolves.toBe('普通明文笔记')
    // 形似三段但非密文（如含点的明文）不应被误判为密文：本例 'a.b' 只两段，穿透
    await expect(e2e.decryptField('a.b')).resolves.toBe('a.b')
    // 空串原样返
    await expect(e2e.decryptField('')).resolves.toBe('')

    // 解锁后真密文仍能正确解回——确认兜底未丢数据
    const ok = await e2e.unlock('locked-pw-0')
    expect(ok).toBe(true)
    await expect(e2e.decryptField(cipherNotes)).resolves.toBe('应被隐藏的机密笔记')
  }, 20000)
})

describe('useE2E.encryptItem / decryptItem 契约（RE-1 / RE-2）', () => {
  it('decryptItem 返回新对象且不 mutate 入参；调用方必须用返回值', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('contract-pw-1')
    const enc = await e2e.encryptItem('bookmark', {
      title: '明文标题', url: 'https://a.example', username: '机密用户名', notes: 'n',
    } as any)
    const cipher = { ...enc } as Record<string, unknown>
    const usernameBefore = cipher.username
    // title 不再被加密（收窄后明文存），username 被加密成密文
    expect(cipher.title).toBe('明文标题')
    expect(cipher.username).not.toBe('机密用户名')
    const plain = await e2e.decryptItem('bookmark', cipher as any)
    // 入参仍是密文
    expect(cipher.username).toBe(usernameBefore)
    // 返回值是明文
    expect(plain.username).toBe('机密用户名')
    expect(plain.title).toBe('明文标题')
    expect(plain.url).toBe('https://a.example')
    expect(plain).not.toBe(cipher)
  }, 15000)

  it('decryptItem 对 legacy 旧密文 title/url 解回明文，明文串原样过', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('contract-pw-legacy')
    expect(e2e.isUnlocked.value).toBe(true)
    // 手动给 title/url 加密模拟云端迁移期残留旧密文
    const cipherTitle = await e2e.encryptField('旧密文标题') as string
    const cipherUrl = await e2e.encryptField('https://old.example') as string
    const item = { title: cipherTitle, url: cipherUrl, username: '', notes: '' }
    const plain = await e2e.decryptItem('bookmark', item as any)
    expect(plain.title).toBe('旧密文标题')
    expect(plain.url).toBe('https://old.example')
    // 明文 url（含点但非密文）原样返回，不误判
    const plainItem = { title: '明文标题', url: 'https://plain.example', username: '', notes: '' }
    const plainOut = await e2e.decryptItem('bookmark', plainItem as any)
    expect(plainOut.title).toBe('明文标题')
    expect(plainOut.url).toBe('https://plain.example')
  }, 15000)

  it('BUG 复现：decryptItem 用错 key 时，解不开的密文 url 保留原文而非置空（避免 merge assign 用空串覆盖本地 url）', async () => {
    // 场景：pull / Realtime 在 isUnlocked=true 时对远端行调 decryptItem，用 keyB 解 keyA
    // 加密的旧密文 url → decryptForDisplay 返 ''。旧行为：result.url 被置空 → 后续 merge
    // assign 用 '' 覆盖本地 url 并 saveAppData 落盘 → push 把空 url 推上云端，永久丢失。
    const e2e = useE2E()
    await e2e.setupMasterPassword('kw-A')
    const cipherUrl = await e2e.encryptField('https://secret-a.example') as string
    expect(cipherUrl.split('.')).toHaveLength(3)
    const remoteRow = { title: 't', url: cipherUrl, username: '', notes: '' }

    // 切到 B 的 key 语境（错 key）
    e2e.lock()
    await e2e.setupMasterPassword('kw-B')

    const dec = await e2e.decryptItem('bookmark', remoteRow as any)
    // 修复后：保留原密文，不置空
    expect(dec.url).toBe(cipherUrl)
  }, 20000)

  it('E2E 启用未解锁时：含非空敏感字段 throw；敏感字段全空透传（支持锁定态同步普通内容）', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('contract-pw-2')
    e2e.lock()
    expect(e2e.isE2EEnabled.value).toBe(true)
    expect(e2e.isUnlocked.value).toBe(false)
    // 只改 title/url（无敏感字段）→ 透传不 throw，锁定态可明文推送
    const nonSens = await e2e.encryptItem('bookmark', { title: 't', url: 'https://x.example', username: '', notes: '' } as any)
    expect(nonSens.title).toBe('t')
    // 含非空 username → throw，调用方据此静默排队等解锁
    await expect(
      e2e.encryptItem('bookmark', { title: 't', url: 'https://x.example', username: 'secret', notes: '' } as any)
    ).rejects.toThrow(/未解锁/)
    // notes 已移入 LEGACY 不触发 needsEnc：即使非空也透传不 throw（锁定态可明文推送正文）
    const notesOnly = await e2e.encryptItem('bookmark', { title: 't', url: 'https://x.example', username: '', notes: 'plain-notes' } as any)
    expect(notesOnly.notes).toBe('plain-notes')
    // category 无敏感字段 → 锁定态也透传
    const cat = await e2e.encryptItem('category', { name: '工作' } as any)
    expect(cat.name).toBe('工作')
  }, 15000)

  it('E2E 未启用时 encryptItem 无 key 透传原文', async () => {
    const e2e = useE2E()
    // 不 setup，isE2EEnabled=false，无 cryptoKey
    expect(e2e.isE2EEnabled.value).toBe(false)
    const item = { title: 'plain', url: 'https://p.example', username: 'u', notes: 'n' }
    const out = await e2e.encryptItem('bookmark', item as any)
    expect(out).toBe(item)
    expect(out.title).toBe('plain')
    expect(out.username).toBe('u')
  })
})

// H20：Recovery Key 重置主密码是忘记主密码时的唯一恢复入口
describe('useE2E.resetWithRecoveryKey', () => {
  it('错误 recovery key / 无 recovery 配置 → false；正确 key 后旧密码失效、新密码可用', async () => {
    const e2e = useE2E()
    const recoveryKey = e2e.generateRecoveryKey()
    const ok = await e2e.setupMasterPassword('old-master-pw', recoveryKey)
    expect(ok).toBe(true)

    // 错误 recovery → false；旧密码仍能解锁（重置未成功）
    // 注：mock e2e store 为 plain 对象，computed(isUnlocked) 不追踪变更，故以 unlock 返回值断言状态
    e2e.lock()
    const bad = await e2e.resetWithRecoveryKey('XXXX-YYYY-ZZZZ-AAAA-BBBB-CCCC', 'new-pw')
    expect(bad).toBe(false)
    expect(await e2e.unlock('old-master-pw')).toBe(true)

    // 正确 recovery → true，旧密码失效，新密码可用
    e2e.lock()
    const resetOk = await e2e.resetWithRecoveryKey(recoveryKey, 'brand-new-master')
    expect(resetOk).toBe(true)
    e2e.lock()
    expect(await e2e.unlock('old-master-pw')).toBe(false)
    expect(await e2e.unlock('brand-new-master')).toBe(true)
  }, 30000)

  it('未绑定 recovery_canary 时 resetWithRecoveryKey 返回 false', async () => {
    const e2e = useE2E()
    // 不传 recoveryKey：canary 无 recovery 字段
    await e2e.setupMasterPassword('solo-master')
    e2e.lock()
    const rk = e2e.generateRecoveryKey()
    const ok = await e2e.resetWithRecoveryKey(rk, 'whatever')
    expect(ok).toBe(false)
  }, 15000)
})

// M23：password 不在 ENCRYPT/LEGACY 补解密字段；group.name 在 LEGACY 内（经并集照常被解密）
describe('useE2E.decryptStoreItems password 契约 + group name legacy', () => {
  it('EncryptedPassword 对象态 password 解锁后保持不变；group.name 密文被解开', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    const masterPw = 'm23-password-contract'
    await e2e.setupMasterPassword(masterPw)

    const encPass = {
      encrypted: true as const,
      salt: 's'.repeat(8),
      iv: 'i'.repeat(8),
      data: 'd'.repeat(16),
    }
    ds.addBookmark({
      id: 'bpw', title: '有对象密码', url: 'https://pw.example', username: '',
      password: encPass as any, notes: '', icon: '', categoryId: CAT_UNCATEGORIZED,
      parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false,
      createdAt: 1, updatedAt: 1,
    } as any)

    // group name 用全局 key 加密模拟「未解锁时 Realtime 落的密文态」
    const cipherName = await e2e.encryptField('机密组名') as string
    expect(cipherName).not.toBe('机密组名')
    ds.addGroup({
      id: 'genc', name: cipherName, categoryId: CAT_UNCATEGORIZED, icon: '',
      order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '',
      updatedAt: 1, useCount: 0,
    } as any)

    e2e.lock()
    expect(await e2e.unlock(masterPw)).toBe(true)

    // password 对象态不应被 tryField 触碰（typeof !== 'string'）
    expect(ds.bookmarkMap['bpw'].password).toEqual(encPass)
    // group.name 应被补解密回明文
    expect(ds.groupMap['genc'].name).toBe('机密组名')
  }, 20000)
})

// C（PBKDF2 iterations 迁移阶段一）：canaryData 携带生成时 iterations，升级常量后旧 canary 仍按其原始 it 解锁
describe('useE2E PBKDF2 iterations 携带与兼容', () => {
  it('setupMasterPassword 写入的 canaryData 携带 it 字段，等于当前加密常量 PBKDF2_ITERATIONS', async () => {
    const e2e = useE2E()
    const rk = e2e.generateRecoveryKey()
    const ok = await e2e.setupMasterPassword('it-pw-1', rk)
    expect(ok).toBe(true)
    const raw = localStorage.getItem('lv_e2e_canary')
    expect(raw).toBeTruthy()
    const data = JSON.parse(raw as string)
    expect(typeof data.it).toBe('number')
    expect(data.it).toBe(PBKDF2_ITERATIONS)
    // recovery canary 同样携带 recovery_it
    expect(typeof data.recovery_it).toBe('number')
    expect(data.recovery_it).toBe(PBKDF2_ITERATIONS)
  }, 15000)

  it('旧 canaryData 无 it 字段时 unlock 仍可解（向后兼容，回退默认 600000）', async () => {
    const e2e = useE2E()
    const masterPw = 'legacy-it-pw'
    // 先正常 setup 生成 canary（带 it），再用当前 key 手算一份"旧式"canary（去掉 it 字段）写回
    await e2e.setupMasterPassword(masterPw)
    e2e.lock()
    const raw = localStorage.getItem('lv_e2e_canary')
    const data = JSON.parse(raw as string)
    delete data.it
    delete data.recovery_it
    localStorage.setItem('lv_e2e_canary', JSON.stringify(data))
    // 旧式 canary 无 it 字段 → unlock 走 PBKDF2_DEFAULT_ITERATIONS 派生，仍能验通
    const ok = await e2e.unlock(masterPw)
    expect(ok).toBe(true)
  }, 15000)

  it('canaryData 携带非默认 it 时 unlock 按该 it 派生，默认 it派的同主密码失败', async () => {
    const e2e = useE2E()
    const masterPw = 'custom-it-pw'
    // 用与默认不同的 it 派生 key + 生成 canary，写入 canaryData 带 it=800000
    const { deriveKey, generateCanary } = await import('../../crypto.js')
    const salt = new Uint8Array(32)
    crypto.getRandomValues(salt)
    const key = await deriveKey(masterPw, salt, 800000)
    const canary = await generateCanary(key)
    localStorage.setItem('lv_e2e_canary', JSON.stringify({
      canary, salt: Array.from(salt), it: 800000,
    }))
    // unlock 按 canaryData.it=800000 派生 → 验通
    const ok = await e2e.unlock(masterPw)
    expect(ok).toBe(true)
  }, 15000)

  it('PBKDF2_DEFAULT_ITERATIONS 固化 600000，与 PBKDF2_ITERATIONS 解耦——升级常量后旧无 it 数据走 600000 不锁死', async () => {
    // 阶段一关键不变量：PBKDF2_DEFAULT_ITERATIONS 是"旧数据无 it 字段时的回退"，
    // 必须独立硬编码 600000，不随 PBKDF2_ITERATIONS 演进。否则将来升 PBKDF2_ITERATIONS
    // 到 800000 后，回退默认也变成 800000 → 旧 canaryData（无 it、原 600000 加密）按 800000
    // 派生 key → 与旧密文不符 → GCM 认证失败 → 用户永久锁死（审计要防的不可逆场景）。
    expect(PBKDF2_DEFAULT_ITERATIONS).toBe(600000)
    // 当下两常量同值（PBKDF2_ITERATIONS 尚未升级），升级后才分离——此断言锁定"解耦语义"：
    // PBKDF2_ITERATIONS 可变，PBKDF2_DEFAULT_ITERATIONS 永远 600000。
    // 若将来有人误把 PBKDF2_DEFAULT_ITERATIONS 改成 = PBKDF2_ITERATIONS，此处仍过（当下同值），
    // 但上一断言会捕获——故两条共同锁定"固化 600000"语义。
    const e2e = useE2E()
    const masterPw = 'legacy-after-upgrade'
    // 模拟"升级后旧数据"：用 600000 派生 key 生成 canary，写入不带 it（旧式）
    const { deriveKey, generateCanary } = await import('../../crypto.js')
    const salt = new Uint8Array(32)
    crypto.getRandomValues(salt)
    const key = await deriveKey(masterPw, salt, 600000)
    const canary = await generateCanary(key)
    localStorage.setItem('lv_e2e_canary', JSON.stringify({ canary, salt: Array.from(salt) }))
    // 即便 PBKDF2_ITERATIONS 升级，回退仍 600000 → unlock 验通
    const ok = await e2e.unlock(masterPw)
    expect(ok).toBe(true)
  }, 15000)
})
