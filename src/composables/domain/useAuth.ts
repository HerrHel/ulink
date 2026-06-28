/**
 * useAuth — 认证 composable（兼容层）
 *
 * 职责委托至 useAuthStore。保持向后兼容的 API 签名。
 * 新代码建议直接使用 useAuthStore。
 */
import { useAuthStore } from '../../stores/auth.js'

export function useAuth() {
  return useAuthStore()
}
