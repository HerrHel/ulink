import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useBatchMoveStore = defineStore('batchMove', () => {
  const open = ref(false)
  function show() { open.value = true }
  function hide() { open.value = false }
  return { open, show, hide }
})

export const useMfbStore = defineStore('mfb', () => {
  const open = ref(false)
  function show() { open.value = true }
  function hide() { open.value = false }
  return { open, show, hide }
})

export const useMentionStore = defineStore('mention', () => {
  const open = ref(false)
  function show() { open.value = true }
  function hide() { open.value = false }
  return { open, show, hide }
})
