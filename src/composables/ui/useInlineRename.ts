/**
 * useInlineRename — 行内重命名编辑逻辑
 * 供 CategoryModal 和 AttributeModal 复用。
 */
import { ref, nextTick } from 'vue'
import { toast } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'
import { displayText } from '../../utils.js'
import { isThreePartCipher } from '../../crypto.js'
import { useE2EStore } from '../../stores/e2e.js'

/** 行内重命名目标：任意含 save() 与动态重命名方法的对象（CategoryModal / AttributeModal 等） */
export interface RenameTarget {
  save: () => void
  [method: string]: unknown
}

export function useInlineRename(store: RenameTarget, renameMethod: string) {
  const editingId = ref<string | null>(null)
  const editingName = ref('')
  let editInputElement: HTMLInputElement | null = null

  function setEditInputRef(el: Element | null) {
    editInputElement = el as HTMLInputElement | null
  }

  function startRename(item: { id: string; name: string }) {
    editingId.value = item.id
    editingName.value = displayText(item.name)
    nextTick(() => editInputElement?.focus())
  }

  function confirmRename() {
    const name = editingName.value.trim()
    if (name && editingId.value) {
      const e2eStore = useE2EStore()
      if (e2eStore.isE2EEnabled && !e2eStore.isUnlocked) {
        const storeAny = store as Record<string, unknown>
        const curName = (storeAny.categoryMap as Record<string, { name?: string }> | undefined)?.[editingId.value]?.name
          ?? (storeAny.customAttributes as Array<{ id: string; name?: string }> | undefined)?.find(a => a.id === editingId.value)?.name
        if (typeof curName === 'string' && isThreePartCipher(curName)) {
          toast(t('modal.childBm.encryptedBlocked'), false)
          editingId.value = null
          return
        }
      }
      const method = store[renameMethod]
      if (typeof method === 'function') {
        (method as (id: string, name: string) => void)(editingId.value, name)
      }
      store.save()
      toast(t('msg.renamed'))
    }
    editingId.value = null
  }

  function cancelRename(e?: KeyboardEvent) {
    // M12：阻止 Esc 冒泡到 document 全局处理，避免连带关闭整个模态框
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    editingId.value = null
  }

  return { editingId, editingName, setEditInputRef, startRename, confirmRename, cancelRename }
}
