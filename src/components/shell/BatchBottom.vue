<template>
  <div class="batch-bottom" :class="{ show: uiStore.batchMode }">
    <div class="batch-bottom-inner">
      <div class="batch-actions">
        <button class="batch-btn batch-btn-move" @click.stop="$emit('batch-move')" :title="t('batch.moveTo')">
          <span aria-hidden="true" v-html="I.move" class="batch-btn-icon"></span>
          <span class="batch-btn-label">{{ t('batch.moveTo') }}</span>
        </button>
        <button class="batch-btn batch-btn-delete" @click.stop="$emit('batch-delete')" :title="t('batch.deleteSelected')">
          <span aria-hidden="true" v-html="I.trash" class="batch-btn-icon"></span>
          <span class="batch-btn-label">{{ t('common.delete') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUIStore } from '../../stores/ui.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'

const uiStore = useUIStore()
defineEmits(['batch-move', 'batch-delete'])
</script>