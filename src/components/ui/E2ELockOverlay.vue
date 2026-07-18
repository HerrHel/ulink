<template>
  <div class="e2e-lock-overlay" :class="{ disabled }">
    <div
      v-if="disabled"
      class="e2e-lock-hint"
      :class="{ clickable: hintClickable }"
      role="button"
      tabindex="0"
      @click="onHintActivate"
      @keydown.enter.prevent="onHintActivate"
      @keydown.space.prevent="onHintActivate"
    >
      <span aria-hidden="true" class="e2e-lock-icon" v-html="I.password"></span>
      <span>{{ hint || '开启端到端加密后才可使用此功能' }}</span>
    </div>
    <slot v-else></slot>
  </div>
</template>
<script setup lang="ts">
import { I } from '../../config/icons.js'

const props = withDefaults(defineProps<{
  disabled: boolean
  hint?: string
  hintClickable?: boolean
}>(), {
  hintClickable: true,
})

const emit = defineEmits<{
  'hint-click': []
}>()

function onHintActivate() {
  if (!props.disabled) return
  emit('hint-click')
}
</script>
<style scoped>
.e2e-lock-hint.clickable {
  cursor: pointer;
  text-underline-offset: 2px;
  text-decoration: underline;
}
.e2e-lock-hint.clickable:hover {
  opacity: 0.9;
}
</style>
