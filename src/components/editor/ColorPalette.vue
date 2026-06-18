<template>
  <div class="color-palette-popup" :class="$attrs.class" :style="$attrs.style" @mousedown.stop>
    <div class="color-palette-grid">
      <button v-for="c in palette" :key="c.hex" class="color-swatch"
              :class="{ active: c.hex === activeColor }"
              :style="{ background: c.hex }" :data-tooltip="c.name" @click="$emit('apply', c.hex)">
        <span class="swatch-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
      </button>
    </div>
    <button class="color-reset-btn" @click="$emit('apply', null)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      默认
    </button>
  </div>
</template>

<script setup lang="ts">
import { PALETTE } from '../../composables/ui/useEditorFormat.js'

defineProps({
  activeColor: { type: String, default: '' }
})
defineEmits(['apply'])

const palette = PALETTE
</script>
