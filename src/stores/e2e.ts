import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useE2EStore = defineStore('e2e', () => {
  const isE2EEnabled = ref(false)
  const isUnlocked = ref(false)

  function setEnabled(v: boolean) { isE2EEnabled.value = v }
  function setUnlocked(v: boolean) { isUnlocked.value = v }

  return { isE2EEnabled, isUnlocked, setEnabled, setUnlocked }
})
