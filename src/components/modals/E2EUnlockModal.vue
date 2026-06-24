<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="解锁数据" :class="{ open }" @click.self="onCancel">
    <div class="modal modal-sm">
      <div class="modal-head">
        <span class="modal-title">🔐 解锁数据</span>
      </div>
      <div class="modal-body">
        <div class="e2e-info">
          <p>输入主密码以解密您的数据</p>
        </div>
        <div class="form-group">
          <div class="pw-input-wrap">
            <input :type="showPw ? 'text' : 'password'" class="form-input" v-model="masterPw" placeholder="主密码" @keydown.enter="onUnlock" autofocus>
            <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
          </div>
        </div>
        <div v-if="error" class="e2e-error">{{ error }}</div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" :disabled="!masterPw" @click="onUnlock">解锁</button>
        <button class="btn btn-secondary" @click="onCancel">跳过</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { I } from '../../config/icons.js'
import { useE2E } from '../../composables/domain/useE2E.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; unlocked: [] }>()

const e2e = useE2E()
const masterPw = ref('')
const showPw = ref(false)
const error = ref('')
const loading = ref(false)

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    masterPw.value = ''
    showPw.value = false
    error.value = ''
    loading.value = false
  }
})

async function onUnlock() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  const ok = await e2e.unlock(masterPw.value)
  loading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = '主密码错误'
  }
}

function onCancel() {
  emit('close')
}
</script>
