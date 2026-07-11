<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="登录" :class="{ open: auth.authModalOpen }" @click.self="onClose">
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
            <div class="code-boxes" @click="focusCodeInput">
              <input
                id="authCodeInput" ref="codeInputRef" v-model="code"
                type="text" maxlength="6" inputmode="numeric" pattern="[0-9]*"
                autocomplete="one-time-code"
                class="code-hidden-input"
                @keydown.enter="onVerify"
              />
              <div
                v-for="i in 6" :key="i"
                class="code-box"
                :class="{ 'code-box--cursor': code.length === i - 1 }"
              >{{ code[i - 1] || '' }}</div>
            </div>
          </div>
        </template>

        <div v-if="auth.authError" class="form-error">{{ auth.authError }}</div>
        <div v-if="verified" class="form-success">✓ 登录成功</div>
      </div>
      <div class="modal-foot gap-2">
        <button v-if="step === 'code'" class="btn btn-ghost" @click="onBack">返回</button>
        <button v-if="step === 'code'" class="btn btn-ghost" @click="onSendCode"
          :disabled="sending || auth.sendCooldownRemaining(email.trim()) > 0">
          {{ sending ? '发送中...'
            : (auth.sendCooldownRemaining(email.trim()) > 0 ? `重发 (${auth.sendCooldownRemaining(email.trim())}s)` : '重发验证码') }}
        </button>
        <span class="flex-1"></span>
        <button class="btn btn-secondary" @click="onClose">取消</button>
        <button v-if="step === 'email'" class="btn btn-primary" @click="onSendCode"
          :disabled="!email.trim() || sending || auth.sendCooldownRemaining(email.trim()) > 0">
          {{ sending ? '发送中...'
            : (auth.sendCooldownRemaining(email.trim()) > 0 ? `重新发送 (${auth.sendCooldownRemaining(email.trim())}s)` : '发送验证码') }}
        </button>
        <button v-if="step === 'code'" class="btn btn-primary" @click="onVerify"
          :disabled="code.length < 6 || verifying || auth.verifyLockRemaining(email.trim()) > 0">
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

watch(() => auth.authModalOpen, (open) => {
  if (open) {
    email.value = ''
    code.value = ''
    step.value = 'email'
    sending.value = false
    verifying.value = false
    verified.value = false
    auth.authError = null
    nextTick(() => inputRef.value?.focus())
  }
})

async function onSendCode() {
  const e = email.value.trim()
  if (!e) return
  // S12：冷却中由 store 返 false 并写 authError，这里读剩余秒数禁用按钮并提前 return
  const remain = auth.sendCooldownRemaining(e)
  if (remain > 0) {
    auth.authError = `验证码已发送，请 ${remain} 秒后再试`
    return
  }
  sending.value = true
  auth.authError = null
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
  // S12：锁定中由 store 返 false 并写 authError
  const lockRemain = auth.verifyLockRemaining(email.value.trim())
  if (lockRemain > 0) {
    auth.authError = `验证失败次数过多，请 ${lockRemain} 秒后重试或重新获取验证码`
    return
  }
  verifying.value = true
  auth.authError = null
  const ok = await auth.verifyOtp(email.value.trim(), c)
  verifying.value = false
  if (ok) {
    verified.value = true
    setTimeout(() => {
      auth.authModalOpen = false
      sync.initialSync()
    }, 800)
  }
}

function onBack() {
  step.value = 'email'
  code.value = ''
  auth.authError = null
  // S12：返回邮箱步视为重新开始，清掉验证失败计数与锁，给用户重试机会
  auth.resetVerifyState(email.value.trim())
  nextTick(() => inputRef.value?.focus())
}

function focusCodeInput() {
  codeInputRef.value?.focus()
}

function onClose() {
  auth.authModalOpen = false
}
</script>
