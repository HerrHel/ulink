import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useAttrDropdownStore = defineStore('attrDropdown', () => {
  const open = ref(false)

  function toggle() { open.value = !open.value }
  function close() { open.value = false }

  return { open, toggle, close }
})
