<template>
  <div class="batch-bottom" :class="{ show: uiStore.batchMode }">
    <div class="batch-bottom-inner">
      <div class="batch-actions">
        <button class="batch-btn batch-btn-move" @click.stop="$emit('batch-move')" title="移动到">
          <span aria-hidden="true" aria-hidden="true" v-html="I.move" class="batch-btn-icon"></span>
          <span class="batch-btn-label">移动到</span>
        </button>
        <button class="batch-btn batch-btn-delete" @click.stop="$emit('batch-delete')" title="删除所选">
          <span aria-hidden="true" aria-hidden="true" v-html="I.trash" class="batch-btn-icon"></span>
          <span class="batch-btn-label">删除</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUIStore } from '../../stores/ui.js'
import { I } from '../../config/icons.js'

const uiStore = useUIStore()
defineEmits(['batch-move', 'batch-delete'])
</script>