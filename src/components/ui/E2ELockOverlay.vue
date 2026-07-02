<template>
  <div class="e2e-lock-overlay" :class="{ disabled }">
    <div v-if="disabled" class="e2e-lock-hint">
      <span aria-hidden="true" class="e2e-lock-icon" v-html="I.password"></span>
      <span>{{ hint || '开启端到端加密后才可使用此功能' }}</span>
    </div>
    <slot v-else></slot>
  </div>
</template>
<script setup lang="ts">
import { I } from '../../config/icons.js'

defineProps<{
  disabled: boolean
  hint?: string
}>()
</script>
