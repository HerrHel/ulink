<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="登录" :class="{ open: auth.authModalOpen.value }" @click.self="onClose">
    <div class="modal modal-md">
      <div class="modal-head">
        <h2>登录 / 注册</h2>
        <button class="modal-close" @click="onClose" title="关闭" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <p class="modal-hint">
          输入邮箱，我们将发送一个登录链接。<br>
          无需密码，首次登录即自动注册。
        </p>
        <div class="form-group">
          <label class="form-label" for="authEmailInput">邮箱地址</label>
          <input type="email" class="form-input" id="authEmailInput" v-model="email"
                 placeholder="your@email.com" @keydown.enter="onSubmit" ref="inputRef"
                 autocomplete="email">
        </div>
        <div v-if="auth.authError.value" class="form-error">{{ auth.authError.value }}</div>
        <div v-if="sent" class="form-success">
          ✓ 登录链接已发送到 <strong>{{ email }}</strong>，请查收邮件。
        </div>
      </div>
      <div class="modal-foot gap-2">
        <span class="flex-1"></span>
        <button class="btn btn-secondary" @click="onClose">取消</button>
        <button class="btn btn-primary" @click="onSubmit" :disabled="!email.trim() || sending">
          {{ sending ? '发送中...' : '发送登录链接' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { I } from '../../config/icons.js'

const auth = useAuth()
const sync = useCloudSync()
const email = ref('')
const sent = ref(false)
const sending = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

watch(() => auth.authModalOpen.value, (open) => {
  if (open) {
    email.value = ''
    sent.value = false
    sending.value = false
    auth.authError.value = null
    nextTick(() => inputRef.value?.focus())
  }
})

async function onSubmit() {
  const e = email.value.trim()
  if (!e) return
  sending.value = true
  auth.authError.value = null
  const ok = await auth.signInWithEmail(e)
  sending.value = false
  if (ok) {
    sent.value = true
    // 监听登录状态变化，登录成功后自动同步
    const unwatch = watch(() => auth.isLoggedIn.value, (loggedIn) => {
      if (loggedIn) {
        unwatch()
        auth.authModalOpen.value = false
        sync.initialSync()
      }
    })
  }
}

function onClose() {
  auth.authModalOpen.value = false
}
</script>
