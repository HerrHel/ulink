/**
 * 安全上下文判断（原 useBiometric.ts / useVaultBiometric.ts 逐字重复的环境判断，收口单源）。
 * 与 window.isSecureContext 语义对齐但保持显式判断：https 或 localhost / 127.0.0.1 才放行，
 * 不引入 file:// 等浏览器实现差异，WebAuthn PRF 派生仅在真安全上下文可用。
 */
export function isBiometricCapableContext(): boolean {
  return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
}
