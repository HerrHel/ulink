<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="登录" :class="{ open: auth.authModalOpen.value }" @click.self="onClose">
    <div class="modal modal-md">
      <div class="modal-head">
        <h2>{{ step === 'email' ? '登录 / 注册' : '输入验证码' }}</h2>
        <button class="modal-close" @click="onClose" title="关闭" aria-label="关闭" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <!-- Step 1: 输入邮箱 -->
        <template v-if="step === 'email'">
          <p class="modal-hint">
            输入邮箱，我们将发送一个 6 位验证码。<br>
            无需密码，首次登录即自动注册。
          </p>
          <div class="form-group">
            <label class="form-label" for="authEmailInput">邮箱地址</label>
            <input type="email" class="form-input" id="authEmailInput" v-model="email"
                   placeholder="your@email.com" @keydown.enter="onSendCode" ref="inputRef"
                   autocomplete="email">
          </div>
        </template>

        <!-- Step 2: 输入验证码 -->
        <template v-if="step === 'code'">
          <p class="modal-hint">
            验证码已发送到 <strong>{{ email }}</strong><br>
            <span style="font-size:0.72rem">请查收邮件（含垃圾邮件），输入 6 位验证码</span>
          </p>
          <div class="form-group">
            <label class="form-label" for="authCodeInput">验证码</label>
            <input type="text" class="form-input code-input" id="authCodeInput" v-model="code"
                   placeholder="000000" maxlength="6" @keydown.enter="onVerify" ref="codeInputRef"
                   autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*">
          </div>
        </template>

        <div v-if="auth.authError.value" class="form-error">{{ auth.authError.value }}</div>
        <div v-if="verified" class="form-success">✓ 登录成功</div>
      </div>
      <div class="modal-foot gap-2">
        <button v-if="step === 'code'" class="btn btn-ghost" @click="onBack">返回</button>
        <span class="flex-1"></span>
        <button class="btn btn-secondary" @click="onClose">取消</button>
        <button v-if="step === 'email'" class="btn btn-primary" @click="onSendCode" :disabled="!email.trim() || sending">
          {{ sending ? '发送中...' : '发送验证码' }}
        </button>
        <button v-if="step === 'code'" class="btn btn-primary" @click="onVerify" :disabled="code.length < 6 || verifying">
          {{ verifying ? '验证中...' : '登录' }}
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
const code = ref('')
const step = ref<'email' | 'code'>('email')
const sending = ref(false)
const verifying = ref(false)
const verified = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const codeInputRef = ref<HTMLInputElement | null>(null)

watch(() => auth.authModalOpen.value, (open) => {
  if (open) {
    email.value = ''
    code.value = ''
    step.value = 'email'
    sending.value = false
    verifying.value = false
    verified.value = false
    auth.authError.value = null
    nextTick(() => inputRef.value?.focus())
  }
})

async function onSendCode() {
  const e = email.value.trim()
  if (!e) return
  sending.value = true
  auth.authError.value = null
  const ok = await auth.sendOtp(e)
  sending.value = false
  if (ok) {
    step.value = 'code'
    nextTick(() => codeInputRef.value?.focus())
  }
}

async function onVerify() {
  const c = code.value.trim()
  if (c.length < 6) return
  verifying.value = true
  auth.authError.value = null
  const ok = await auth.verifyOtp(email.value.trim(), c)
  verifying.value = false
  if (ok) {
    verified.value = true
    setTimeout(() => {
      auth.authModalOpen.value = false
      sync.initialSync()
    }, 800)
  }
}

function onBack() {
  step.value = 'email'
  code.value = ''
  auth.authError.value = null
  nextTick(() => inputRef.value?.focus())
}

function onClose() {
  auth.authModalOpen.value = false
}
</script>
