<template>
  <div class="ai-pref-chips" role="group" :aria-label="t('ai.preferences')">
    <button
      v-for="pref in PRESET_PREFERENCES"
      :key="pref.id"
      type="button"
      class="ai-pref-chip"
      :class="{ active: isSelected(pref.id) }"
      @click="togglePref(pref.id)"
      :title="t(pref.hintKey)"
    >
      <span class="ai-pref-emoji">{{ pref.emoji }}</span>
      <span class="ai-pref-label">{{ t(pref.labelKey) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { AiSearchPreference } from '../../types/ai.js'
import { t } from '../../i18n/index.js'

const props = defineProps<{
  modelValue: AiSearchPreference[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: AiSearchPreference[]): void
}>()

interface PrefItem {
  id: AiSearchPreference
  emoji: string
  labelKey: string
  hintKey: string
}

const PRESET_PREFERENCES: PrefItem[] = [
  { id: 'free', emoji: '🏷️', labelKey: 'ai.prefFree', hintKey: 'ai.prefFreeHint' },
  { id: 'no_proxy', emoji: '🇨🇳', labelKey: 'ai.prefNoProxy', hintKey: 'ai.prefNoProxyHint' },
  { id: 'lightweight', emoji: '🪶', labelKey: 'ai.prefLightweight', hintKey: 'ai.prefLightweightHint' },
  { id: 'open_source', emoji: '⚡', labelKey: 'ai.prefOpenSource', hintKey: 'ai.prefOpenSourceHint' },
  { id: 'professional', emoji: '💼', labelKey: 'ai.prefProfessional', hintKey: 'ai.prefProfessionalHint' },
]

function isSelected(id: AiSearchPreference): boolean {
  return props.modelValue.includes(id)
}

function togglePref(id: AiSearchPreference) {
  const current = props.modelValue.slice()
  const idx = current.indexOf(id)
  if (idx > -1) {
    current.splice(idx, 1)
  } else {
    current.push(id)
  }
  emit('update:modelValue', current)
}
</script>

<style scoped>
.ai-pref-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}
.ai-pref-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-full, 9999px);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 0.73rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
  user-select: none;
}
.ai-pref-chip:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--surface-hover);
}
.ai-pref-chip.active {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
  font-weight: 600;
}
.ai-pref-emoji {
  font-size: 0.8rem;
  line-height: 1;
}
</style>
