/**
 * E2EUnlockModal.validatePwReset.test.ts — 主密码重置/修改前置校验护栏
 *
 * Explore 报告 #1：E2EUnlockModal.onReset/onChangePw + VaultUnlockModal.onReset
 * 的同步校验段（rk 空 / pw<8 / 不一致 / 旧密码空）此前 E2E 只测 happy-path 提示
 * recovery-key，unit-test 对 4 错误文案零命名断言。抽出纯函数后锁全部分支 + 8 位
 * 下界（length<8 非 <=8 防误拒 8 位合法主密码）防漂移。
 */
import { describe, it, expect } from 'vitest'
import {
  recoveryKeyEmptyError,
  newPasswordLengthError,
  newPasswordMismatchError,
  oldPasswordEmptyError,
} from '../../components/modals/validatePwResetInput.js'

describe('recoveryKeyEmptyError', () => {
  it('空串 → 错误文案', () => {
    expect(recoveryKeyEmptyError('')).toBe('请输入 Recovery Key')
  })

  it('纯空白 → trim 后空串仍判错（trim 契约直锁）', () => {
    expect(recoveryKeyEmptyError('   ')).toBe('请输入 Recovery Key')
    expect(recoveryKeyEmptyError('\t\n')).toBe('请输入 Recovery Key')
  })

  it('有内容 → null 通过', () => {
    expect(recoveryKeyEmptyError('XXXX-XXXX')).toBeNull()
    expect(recoveryKeyEmptyError('  valid key  ')).toBeNull()
  })
})

describe('newPasswordLengthError', () => {
  it('空串 → 错误文案', () => {
    expect(newPasswordLengthError('')).toBe('新主密码至少 8 位')
  })

  it('7 位 → 错误文案（<8 不达下界）', () => {
    expect(newPasswordLengthError('1234567')).toBe('新主密码至少 8 位')
  })

  it('8 位 → null 通过（锁 length<8 非 <=8：8 位合法防误拒）', () => {
    expect(newPasswordLengthError('12345678')).toBeNull()
  })

  it('20 位 → null 通过', () => {
    expect(newPasswordLengthError('a'.repeat(20))).toBeNull()
  })

  it('9 位 → null 通过', () => {
    expect(newPasswordLengthError('123456789')).toBeNull()
  })
})

describe('newPasswordMismatchError', () => {
  it('两串不等 → 错误文案', () => {
    expect(newPasswordMismatchError('aaa12345', 'bbb12345')).toBe('两次新主密码不一致')
  })

  it('两串相等 → null 通过', () => {
    expect(newPasswordMismatchError('aaa12345', 'aaa12345')).toBeNull()
  })

  it('均为空串相等 → null 通过（一致性校验不重复一次密码长度校验）', () => {
    expect(newPasswordMismatchError('', '')).toBeNull()
  })

  it('一空一非空 → 错误文案', () => {
    expect(newPasswordMismatchError('', 'aaa12345')).toBe('两次新主密码不一致')
    expect(newPasswordMismatchError('aaa12345', '')).toBe('两次新主密码不一致')
  })

  it('大小写敏感：Aaa vs aaa 视为不等', () => {
    expect(newPasswordMismatchError('Aaa12345', 'aaa12345')).toBe('两次新主密码不一致')
  })
})

describe('oldPasswordEmptyError', () => {
  it('空串 → 错误文案', () => {
    expect(oldPasswordEmptyError('')).toBe('请输入旧主密码')
  })

  it('有内容 → null 通过', () => {
    expect(oldPasswordEmptyError('oldpw123')).toBeNull()
  })

  it('注意：旧密码校验不 trim，仅 length===0 判空（与 recoveryKey 的 trim 语义不同）', () => {
    // 纯空白长度>0 视为非空（不与 recoveryKey trim 一致），直锁此差异防未来误统一
    expect(oldPasswordEmptyError('   ')).toBeNull()
  })
})
