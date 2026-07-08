/**
 * useInlineRename — 行内重命名编辑逻辑
 * 供 CategoryModal 和 AttributeModal 复用。
 */
import { ref, nextTick } from 'vue'
import { toast } from '../../lib/toast.js'

interface InlineRenameStore {
  [key: string]: (...args: any[]) => void
  save: () => void
}

export function useInlineRename(store: InlineRenameStore, renameMethod: string) {
  const editingId = ref<string | null>(null)
  const editingName = ref('')
  let editInputElement: HTMLInputElement | null = null

  function setEditInputRef(el: HTMLElement | null) {
    editInputElement = el as HTMLInputElement | null
  }

  function startRename(item: { id: string; name: string }) {
    editingId.value = item.id
    editingName.value = item.name
    nextTick(() => editInputElement?.focus())
  }

  function confirmRename() {
    const name = editingName.value.trim()
    if (name && editingId.value) {
      store[renameMethod](editingId.value, name)
      store.save()
      toast('已重命名')
    }
    editingId.value = null
  }

  function cancelRename() { editingId.value = null }

  return { editingId, editingName, setEditInputRef, startRename, confirmRename, cancelRename }
}
