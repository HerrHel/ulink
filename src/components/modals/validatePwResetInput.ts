/**
 * validatePwResetInput — 主密码重置/修改前置校验纯函数
 *
 * 从 E2EUnlockModal.onReset/onChangePw 与 VaultUnlockModal.onReset 抽出。
 * 原校验段是 ref side-effect 内联 `if (...) { error.value=X; return }`，无护栏
 * （E2E 只测 happy path、unit-test 对 '请输入 Recovery Key'/'新主密码至少 8 位'/
 * '两次新主密码不一致' 零命名断言）。抽出纯函数后 onReset/onChangePw 调用早返回，
 * 行为零变化，护栏锁全部校验分支 + 8 位下界（length<8 非 <=8）防漂移。
 */

/** Recovery Key 空校验：trim 后空串 → 错误文案，否则 null */
export function recoveryKeyEmptyError(rk: string): string | null {
  return rk.trim().length === 0 ? '请输入 Recovery Key' : null
}

/** 新主密码长度校验：<8 位 → 错误文案（锁 length<8 非 <=8 下界，8 位合法防误拒） */
export function newPasswordLengthError(pw: string): string | null {
  return pw.length < 8 ? '新主密码至少 8 位' : null
}

/** 两次新主密码一致性校验：不等 → 错误文案 */
export function newPasswordMismatchError(pw1: string, pw2: string): string | null {
  return pw1 !== pw2 ? '两次新主密码不一致' : null
}

/** 旧主密码空校验：空串 → 错误文案（仅 changePw 已解锁态跳过此校验） */
export function oldPasswordEmptyError(oldPw: string): string | null {
  return oldPw.length === 0 ? '请输入旧主密码' : null
}
