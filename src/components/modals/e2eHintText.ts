/**
 * E2E 三态门控 hint 文案与字段开放判定（A6-004/A2-004）
 *
 * 从 BookmarkModal.vue / ChildBookmarkEditModal.vue 抽出的纯逻辑——两消费方此前内联同形
 * 重复实现，抽独立纯模块供单测护栏 + 单一真相源防两份漂移。
 *
 * 三态语义（E2E 启用 × 解锁）：
 *   - disabled  | unlocked?  → fieldsOpen=false | hint 「开启 E2E 后可存储 X」（引导用户去开启）
 *   - enabled   | locked     → fieldsOpen=false | hint 「点击解锁后可编辑 X」（引导用户去解锁）
 *   - enabled   | unlocked   → fieldsOpen=true  | hint 不显示（字段已开放，E2ELockOverlay 不渲染遮罩）
 *
 * 安全引导价值：错配 hint 文案会让用户误判当前为何不能编辑
 *   - 「不能编辑=没开 E2E」误判 → 用户去重置主密码而非解锁，丢失已加密数据
 *   - 「不能编辑=没解锁」误判 → 用户去开启 E2E 而非解锁，误覆盖已有加密态
 */

export interface E2EState {
  enabled: boolean
  unlocked: boolean
}

/** 字段开放：仅「已启用且已解锁」才开放账户/密码输入 */
export function e2eFieldsOpen(state: E2EState): boolean {
  return state.enabled && state.unlocked
}

/**
 * 账户 hint 文案：
 *   enabled && !unlocked → 「点击解锁后可编辑账户」
 *   否则（disabled 或 unlocked）→ 「开启 E2E 后可存储账户」
 *
 * 注：unlocked 态下 E2ELockOverlay 不渲染遮罩故 hint 不展示，但此函数返回值在
 * unlocked 时也走 else 分支（前半 !unlocked=false 失败，联 enabled 是 false 时整体 false）——
 * 实际 unlocked 时 enabled=true → !unlocked=false → 走 else 返「开启 E2E 后可存储账户」，
 * 但 UI 不展示此 hint（遮罩已移除）。文案值仅当 !unlocked 时实际可见。
 */
export function e2eHintAccount(state: E2EState): string {
  return state.enabled && !state.unlocked
    ? '点击解锁后可编辑账户'
    : '开启 E2E 后可存储账户'
}

/** 密码 hint 文案：与 e2eHintAccount 同形仅末词不同（账户→密码） */
export function e2eHintPassword(state: E2EState): string {
  return state.enabled && !state.unlocked
    ? '点击解锁后可编辑密码'
    : '开启 E2E 后可存储密码'
}
