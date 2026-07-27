<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="登录" :class="{ open: auth.authModalOpen }" @click.self="onClose">
    <div class="modal modal-md">
      <div class="modal-head">
        <h2>{{ step === 'email' ? '登录 / 注册' : '输入验证码' }}</h2>
        <button class="modal-close" @click="onClose" title="关闭" aria-label="关闭" v-html="I.close"></button>
      </div>
      <div class="modal-body auth-body">
        <!-- 邮箱图标装饰 -->
        <div class="auth-icon-wrap">
          <span class="auth-icon" v-html="I.mail"></span>
        </div>

        <!-- Step 1: 输入邮箱 -->
        <template v-if="step === 'email'">
          <p class="auth-hint">
            输入邮箱地址，我们将发送一个 6 位验证码
          </p>
          <p class="auth-hint-sub">无需密码，首次登录即自动注册</p>
          <div class="form-group">
            <input
              type="email" class="form-input auth-input" id="authEmailInput"
              v-model="email" placeholder="your@email.com"
              @keydown.enter="onSendCode" ref="inputRef" autocomplete="email"
            />
          </div>
        </template>

        <!-- Step 2: 输入验证码 -->
        <template v-if="step === 'code'">
          <p class="auth-hint">
            验证码已发送至
          </p>
          <p class="auth-email-display">{{ email }}</p>
          <p class="auth-hint-sub">请查收邮件（含垃圾箱），输入 6 位验证码</p>
          <div class="form-group">
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

        <div v-if="auth.authError" class="auth-error"><span class="auth-error-icon" v-html="I.alert"></span>{{ auth.authError }}</div>
        <div v-if="verified" class="auth-success"><span class="auth-success-icon" v-html="I.listCheck"></span>登录成功</div>
      </div>
      <div class="modal-foot gap-2">
        <button v-if="step === 'code'" class="btn btn-ghost" @click="onBack">返回修改</button>
        <button v-if="step === 'code'" class="btn btn-ghost" @click="onSendCode"
          :disabled="sending || cooldownSec > 0">
          {{ sending ? '发送中...'
            : (cooldownSec > 0 ? `重发 (${cooldownSec}s)` : '重发验证码') }}
        </button>
        <span class="flex-1"></span>
        <button class="btn btn-secondary" @click="onClose">取消</button>
        <button v-if="step === 'email'" class="btn btn-primary" @click="onSendCode"
          :disabled="!emailTrim || sending || cooldownSec > 0">
          {{ sending ? '发送中...'
            : (cooldownSec > 0 ? `重新发送 (${cooldownSec}s)` : '发送验证码') }}
        </button>
        <button v-if="step === 'code'" class="btn btn-primary" @click="onVerify"
          :disabled="code.length < 6 || verifying || lockSec > 0">
          {{ verifying ? '验证中...' : '登录' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
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

const emailTrim = computed(() => email.value.trim())
const cooldownSec = computed(() => auth.sendCooldownRemaining(emailTrim.value))
const lockSec = computed(() => auth.verifyLockRemaining(emailTrim.value))

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
  const e = emailTrim.value
  if (!e) return
  const remain = cooldownSec.value
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
  const lockRemain = lockSec.value
  if (lockRemain > 0) {
    auth.authError = `验证失败次数过多，请 ${lockRemain} 秒后重试或重新获取验证码`
    return
  }
  verifying.value = true
  auth.authError = null
  const ok = await auth.verifyOtp(emailTrim.value, c)
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
  auth.resetVerifyState(emailTrim.value)
  nextTick(() => inputRef.value?.focus())
}

function focusCodeInput() {
  codeInputRef.value?.focus()
}

function onClose() {
  auth.authModalOpen = false
}
</script>

<style scoped>
.auth-body{text-align:center;padding:24px 28px 16px}

/* ── 图标装饰 ── */
.auth-icon-wrap{margin-bottom:16px}
.auth-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:48px;height:48px;border-radius:14px;
  background:var(--accent-light);color:var(--accent);
}
.auth-icon svg{width:24px;height:24px}

/* ── 提示文字 ── */
.auth-hint{
  font-size:0.88rem;color:var(--text);margin:0 0 4px;
  line-height:1.5;font-weight:500;
}
.auth-hint-sub{
  font-size:0.76rem;color:var(--text-muted);
  margin:0 0 16px;line-height:1.5;
}
.auth-email-display{
  font-size:0.92rem;font-weight:600;color:var(--accent);
  margin:0 0 4px;word-break:break-all;
}

/* ── 输入框 ── */
.auth-input{
  text-align:center;font-size:0.95rem;
  padding:11px 16px;
}

/* ── 消息状态 ── */
.auth-error,.auth-success{
  display:flex;align-items:center;justify-content:center;gap:6px;
  font-size:0.8rem;margin-top:8px;padding:8px 12px;
  border-radius:var(--radius-sm);
}
.auth-error{
  color:var(--danger);background:var(--rose-light);
}
.auth-error-icon svg{width:14px;height:14px}
.auth-success{
  color:var(--green);background:var(--green-light);
}
.auth-success-icon svg{width:16px;height:16px}
</style>
