import type { SyncConflict } from '../../stores/sync.js'
import { t } from '../../i18n/index.js'

/**
 * 同步冲突横幅分类徽章文案：把 SyncConflict.type（bookmark/group/category/attribute）
 * 映射成当前语言标签，未知 type 透传原值（fallback `|| type`）。
 *
 * 真纯函数：仅依赖入参 + i18n 语言包（无 DOM / store 依赖）。
 * 从 src/components/overlays/SyncConflictBanner.vue script setup 内联函数抽出
 * （逻辑逐字保留，零行为变化），使该用户可见文案承载逻辑可被直接单测，
 * 锁定「type→标签」契约与 fallback 透传语义防未来回归。
 */
export function typeLabel(type: SyncConflict['type']): string {
  const map: Record<string, string> = {
    bookmark: t('conflict.typeBookmark'),
    group: t('conflict.typeGroup'),
    category: t('conflict.typeCategory'),
    attribute: t('conflict.typeAttribute'),
  }
  return map[type] || type
}
