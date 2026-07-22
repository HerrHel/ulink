<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="选择操作" :class="{ open: store.choiceOpen }" @click.self="store.resolveChoice(null)">
    <div class="modal modal-sm">
      <div class="modal-body modal-body-center">
        <div class="choice-msg">{{ store.choiceDialog?.message }}</div>
        <div class="choice-options">
          <button
            v-for="option in store.choiceDialog?.options"
            :key="option.id"
            class="btn btn-outline choice-option"
            @click="store.resolveChoice(option.id)"
          >
            <span class="choice-option-label">{{ option.label }}</span>
            <span v-if="option.description" class="choice-option-desc">{{ option.description }}</span>
          </button>
        </div>
      </div>
      <div class="modal-foot choice-foot">
        <button class="btn btn-secondary" @click="store.resolveChoice(null)">
          {{ store.choiceDialog?.cancelLabel || '取消' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, onUnmounted, nextTick } from 'vue'
import { useToastStore } from '../../stores/toast.js'

const store = useToastStore()

function onKeydown(e: KeyboardEvent) {
  if (!store.choiceOpen) return
  // A2-001：stopPropagation 防止全局 Esc 连带关闭底层 Category/Attribute 等模态
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); store.resolveChoice(null) }
}

watch(() => store.choiceOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
    nextTick(() => {
      const firstBtn = document.querySelector('.choice-option') as HTMLElement
      firstBtn?.focus()
    })
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.choice-msg {
  margin-bottom: 16px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
}

.choice-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 16px;
  text-align: left;
  transition: all 0.2s ease;
}

.choice-option:hover {
  background: var(--bg-hover);
  border-color: var(--border-hover);
}

.choice-option:focus {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.choice-option-label {
  font-weight: 500;
  color: var(--text-primary);
}

.choice-option-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.choice-foot {
  justify-content: flex-end;
}
</style>
