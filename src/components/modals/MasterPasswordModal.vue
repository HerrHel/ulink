<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="Master Password" :class="{ open: store.masterPasswordOpen }" @click.self="onClose">
    <div class="modal modal-md">
      <div class="modal-head">
        <h2>{{ store.masterPassword ? '验证主密码' : '设置主密码' }}</h2>
        <button class="modal-close" @click="onClose" title="关闭" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <p class="modal-hint">
          主密码用于加密存储的书签密码（AES-256-GCM）。<br>
          设置后所有书签密码将使用此密码加密保护。
        </p>
        <div class="form-group">
          <label class="form-label" for="masterPwInput">主密码</label>
          <div class="pw-wrap">
            <input :type="showPw ? 'text' : 'password'" class="form-input pw-input" id="masterPwInput" v-model="inputPw"
                   placeholder="输入主密码" @keydown.enter="onSubmit" ref="inputRef"
                   autocomplete="off">
            <button class="pw-toggle" type="button" :title="showPw ? '隐藏密码' : '显示密码'" @click="showPw = !showPw"
                    v-html="showPw ? I.eyeOff : I.eye"></button>
          </div>
        </div>
        <div v-if="error" class="form-error">{{ error }}</div>
        <div v-if="store.masterPassword && !error" class="form-success">
          ✓ 主密码已设置
        </div>
      </div>
      <div class="modal-foot gap-2">
        <button v-if="store.masterPassword" class="btn btn-ghost" @click="onClear">清除主密码</button>
        <span class="flex-1"></span>
        <button class="btn btn-secondary" @click="onClose">取消</button>
        <button class="btn btn-primary" @click="onSubmit" :disabled="!inputPw.trim()">
          {{ store.masterPassword ? '验证' : '设置' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { I } from '../../config/icons.js'

const store = useAppStore()
const inputPw = ref('')
const showPw = ref(false)
const error = ref('')
const inputRef = ref(null)

watch(() => store.masterPasswordOpen, (open) => {
  if (open) {
    inputPw.value = ''
    error.value = ''
    showPw.value = false
    nextTick(() => inputRef.value?.focus())
  }
})

async function onSubmit() {
  const pw = inputPw.value.trim()
  if (!pw) return
  error.value = ''
  const ok = await store.verifyMasterPassword(pw)
  if (ok) {
    await store.setMasterPassword(pw)
    store.masterPasswordOpen = false
  } else {
    error.value = '主密码错误，请重试'
    inputPw.value = ''
    inputRef.value?.focus()
  }
}

function onClear() {
  store.clearMasterPassword()
  store.masterPasswordOpen = false
}

function onClose() {
  store.masterPasswordOpen = false
}
</script>
