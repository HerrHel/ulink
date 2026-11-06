/**
 * aiEnabled.ts — AI 功能总开关的唯一读取入口（零依赖、测试友好）。
 *
 * 为什么不用 Pinia：本模块会被 lib/ 下的纯函数与云函数调用点复用，那些地方
 * 没有 active pinia（vitest 里尤其如此）。UI 状态的持久化真源是 localStorage
 * 的 UI_STATE_KEY，stores/ui.ts 的 saveUIState() 每次切换都会同步写入，
 * 因此直接读它即可，且与 UI 显示保持一致。
 *
 * 默认 true：读不到状态 / 解析失败 / 测试环境一律视为开启，绝不因开关本身
 * 故障而误伤用户（fail-open 只针对「开关可用性」，不针对数据外发策略）。
 */
import { UI_STATE_KEY } from '../../config/constants.js'
import { safeGetItem } from '../storageSafe.js'

export function isAiEnabled(): boolean {
  try {
    const raw = safeGetItem(UI_STATE_KEY)
    if (!raw) return true
    const state = JSON.parse(raw) as { aiEnabled?: unknown } | null
    return typeof state?.aiEnabled === 'boolean' ? state.aiEnabled : true
  } catch {
    return true
  }
}
