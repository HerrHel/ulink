<template>
  <div class="batch-bar" :class="{ show: uiStore.batchMode }">
    <span class="batch-count">已选 {{ uiStore.batchSelected.length }} 项</span>
    <button class="btn btn-ghost btn-sm" @click.stop="selectAll">全选</button>
    <span class="flex-1"></span>
    <button class="btn btn-secondary btn-sm" @click.stop="cancel">取消</button>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'

const dataStore = useDataStore()
const uiStore = useUIStore()

function selectAll() {
  const filtered = dataStore.filteredBookmarks
  const groups = dataStore.filteredGroups
  const allIds = filtered.map(b => b.id).concat(groups.map(g => 'group:' + g.id))
  const allSelected = allIds.length > 0 && allIds.every(id => uiStore.batchSelected.indexOf(id) !== -1)
  if (allSelected) {
    uiStore.batchSelected.splice(0)
  } else {
    uiStore.batchSelected.splice(0)
    allIds.forEach(id => uiStore.batchSelected.push(id))
  }
}

function cancel() {
  uiStore.batchMode = false
  uiStore.batchSelected.splice(0)
}
</script>
