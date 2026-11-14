/**
 * 后端形态探针（仅供单测使用）。
 *
 * 同一份单测会在两种后端形态下各跑一遍：
 *   - 默认套件（vitest.config.ts）：VITE_BACKEND = '' → Supabase 形态
 *   - vitest.cloudbase.config.ts：VITE_BACKEND = 'cloudbase' → 生产形态
 *
 * 绝大多数用例应当写成「形态无关」；只有在**契约本身就不同**的地方才用
 * `it.runIf(...)` / `it.skipIf(...)` 分成两条断言 —— 分开写而不是跳过，
 * 这样两种形态下都锁着各自真实的行为。
 */
export function isCloudBaseForm(): boolean {
  return (import.meta.env.VITE_BACKEND as string | undefined) === 'cloudbase'
}

/** 形态名，用于用例标题，避免两条 runIf 用例重名 */
export function formLabel(): string {
  return isCloudBaseForm() ? 'CloudBase 形态' : 'Supabase 形态'
}
