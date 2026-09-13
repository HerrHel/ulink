<template>
  <svg
    :width="svgSize"
    :height="svgSize"
    viewBox="0 0 240 240"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    class="brand-logo-icon"
  >
    <defs>
      <mask :id="maskBlue">
        <rect width="240" height="240" fill="white" />
        <line x1="173" y1="144" x2="211" y2="144" stroke="black" stroke-width="38" stroke-linecap="round" />
      </mask>
      <mask :id="maskGreen">
        <rect width="240" height="240" fill="white" />
        <line x1="29" y1="96" x2="67" y2="96" stroke="black" stroke-width="38" stroke-linecap="round" />
      </mask>
    </defs>
    <path
      class="brand-logo-blue"
      d="M 24 96 L 120 96 C 176 96 192 104 192 144 C 192 184 176 192 120 192 L 48 192"
      fill="none"
      :style="blueColor ? { stroke: blueColor } : undefined"
      stroke-width="26"
      stroke-linecap="round"
      stroke-linejoin="round"
      :mask="`url(#${maskBlue})`"
    />
    <path
      class="brand-logo-green"
      d="M 216 144 L 120 144 C 64 144 48 136 48 96 C 48 56 64 48 120 48 L 192 48"
      fill="none"
      :style="greenColor ? { stroke: greenColor } : undefined"
      stroke-width="26"
      stroke-linecap="round"
      stroke-linejoin="round"
      :mask="`url(#${maskGreen})`"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

let uidCounter = 0

const props = defineProps<{
  size?: number | string
  blueColor?: string
  greenColor?: string
}>()

const uid = ++uidCounter
const maskBlue = `bl-mb-${uid}`
const maskGreen = `bl-mg-${uid}`

const svgSize = computed(() => {
  const s = props.size ?? 24
  return typeof s === 'number' ? `${s}px` : s
})
</script>

<style scoped>
.brand-logo-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
.brand-logo-blue,
.brand-logo-green {
  transition: stroke 0.3s ease;
}
.brand-logo-blue {
  stroke: var(--brand-logo-blue, #122E8A);
}
.brand-logo-green {
  stroke: var(--brand-logo-green, #10B981);
}
:global([data-theme="dark"]) .brand-logo-blue {
  stroke: var(--brand-logo-blue, #4F6BFF);
}
:global([data-theme="dark"]) .brand-logo-green {
  stroke: var(--brand-logo-green, #34D399);
}
:global([data-theme="light"]) .brand-logo-blue {
  stroke: var(--brand-logo-blue, #122E8A);
}
:global([data-theme="light"]) .brand-logo-green {
  stroke: var(--brand-logo-green, #10B981);
}
</style>
