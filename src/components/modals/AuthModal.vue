<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('modal.auth.ariaLabel')" :class="{ open: auth.authModalOpen }" @click.self="onClose">
    <div class="modal modal-md">
      <div class="modal-head">
        <h2>{{ step === 'email' ? t('settings.loginRegister') : t('modal.auth.enterCode') }}</h2>
        <button class="modal-close" @click="onClose" :title="t('common.close')" :aria-label="t('common.close')" v-html="I.close"></button>
      </div>
      <div class="modal-body auth-body">
        <!-- 邮箱图标装饰 -->
        <div class="auth-icon-wrap">
          <span class="auth-icon" v-html="I.mail"></span>
        </div>

        <!-- Step 1: 输入邮箱 -->
        <template v-if="step === 'email'">
          <p class="auth-hint">
            {{ t('modal.auth.emailHint') }}
          </p>
          <p class="auth-hint-sub">{{ t('modal.auth.noPasswordHint') }}</p>
          <div class="form-group">
            <input
              type="email" class="form-input auth-input" id="authEmailInput"
              v-model="email" placeholder="your@email.com"
              @keydown.enter="onSendCode" ref="inputRef" autocomplete="email"
            />
          </div>

          <div v-if="TURNSTILE_SITE_KEY" id="auth-turnstile" class="auth-turnstile"></div>

          <!-- 第三方登录快捷方式 -->
          <div class="auth-divider">
            <span class="auth-divider-line"></span>
            <span class="auth-divider-text">{{ t('modal.auth.orOAuth') }}</span>
            <span class="auth-divider-line"></span>
          </div>

          <div class="auth-oauth-group">
            <button
              type="button"
              class="auth-oauth-btn auth-oauth-btn--github"
              id="authGithubBtn"
              @click="onOAuth('github')"
              :disabled="oauthLoading !== null"
              :title="t('modal.auth.github')"
            >
              <span class="auth-oauth-icon" v-html="I.github"></span>
              <span class="auth-oauth-label">{{ t('modal.auth.github') }}</span>
            </button>
            <button
              type="button"
              class="auth-oauth-btn auth-oauth-btn--google"
              id="authGoogleBtn"
              @click="onOAuth('google')"
              :disabled="oauthLoading !== null"
              :title="t('modal.auth.google')"
            >
              <span class="auth-oauth-icon" v-html="I.google"></span>
              <span class="auth-oauth-label">{{ t('modal.auth.google') }}</span>
            </button>
          </div>
        </template>

        <!-- Step 2: 输入验证码 -->
        <template v-if="step === 'code'">
          <p class="auth-hint">
            {{ t('modal.auth.codeSentTo') }}
          </p>
          <p class="auth-email-display">{{ email }}</p>
          <p class="auth-hint-sub">{{ t('modal.auth.checkEmailHint') }}</p>
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
        <div v-if="verified" class="auth-success"><span class="auth-success-icon" v-html="I.listCheck"></span>{{ t('modal.auth.loginSuccess') }}</div>
      </div>
      <div class="modal-foot gap-2">
        <button v-if="step === 'code'" class="btn btn-ghost" @click="onBack">{{ t('modal.auth.backToEdit') }}</button>
        <button v-if="step === 'code'" class="btn btn-ghost" @click="onSendCode"
          :disabled="sending || cooldownSec > 0">
          {{ sending ? t('modal.auth.sending')
            : (cooldownSec > 0 ? t('modal.auth.resendCountdown', { n: cooldownSec }) : t('modal.auth.resend')) }}
        </button>
        <span class="flex-1"></span>
        <button class="btn btn-secondary" @click="onClose">{{ t('common.cancel') }}</button>
        <button v-if="step === 'email'" class="btn btn-primary" @click="onSendCode"
          :disabled="!emailTrim || sending || cooldownSec > 0 || (!!TURNSTILE_SITE_KEY && !turnstileToken)">
          {{ sending ? t('modal.auth.sending')
            : (cooldownSec > 0 ? t('modal.auth.resendCountdownFull', { n: cooldownSec }) : t('modal.auth.sendCode')) }}
        </button>
        <button v-if="step === 'code'" class="btn btn-primary" @click="onVerify"
          :disabled="code.length < 6 || verifying || lockSec > 0">
          {{ verifying ? t('modal.auth.verifying') : t('modal.auth.login') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onBeforeUnmount } from 'vue'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'

const TURNSTILE_SITE_KEY = import.meta.env.MODE === 'test' ? '' : String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '')
const turnstileToken = ref('')
const oauthLoading = ref<'github' | 'google' | null>(null)

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => void
  reset: (el?: HTMLElement) => void
}
function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}
function renderTurnstile(): void {
  const api = turnstileApi()
  const el = document.getElementById('auth-turnstile')
  if (!api || !el) return
  api.render(el, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: 'auto',
    callback: (token: string) => { turnstileToken.value = token },
    'expired-callback': () => { turnstileToken.value = '' },
    'error-callback': () => { turnstileToken.value = '' },
  })
}
function ensureTurnstile(): void {
  if (!TURNSTILE_SITE_KEY) return
  if (turnstileApi()) { renderTurnstile(); return }
  if (document.getElementById('lv-turnstile-script')) return
  const s = document.createElement('script')
  s.id = 'lv-turnstile-script'
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  s.async = true
  s.defer = true
  s.onload = renderTurnstile
  document.head.appendChild(s)
}

const auth = useAuth()
const sync = useCloudSync()
const e2e = useE2E()
const email = ref('')
const code = ref('')
const step = ref<'email' | 'code'>('email')
const sending = ref(false)
const verifying = ref(false)
const verified = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const codeInputRef = ref<HTMLInputElement | null>(null)
// onVerify 成功后延迟关闭弹窗的 timer。需在弹窗提前关闭（手动 X / 遮罩 / 取消 / Esc）
// 时清掉，否则 800ms 到点回调仍会跑 checkE2EStatus + initialSync —— 用户已明确取消登录流程
// 后系统不应再自作主张触发全量云端同步。
const syncTimer = ref<number | null>(null)

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
    oauthLoading.value = null
    turnstileToken.value = ''
    auth.authError = null
    nextTick(() => {
      inputRef.value?.focus()
      ensureTurnstile()
    })
  } else {
    turnstileToken.value = ''
    turnstileApi()?.reset()
    if (syncTimer.value !== null) {
      // 弹窗关闭（含手动 X / 遮罩 / 取消 / Esc 任一路径，均会置 authModalOpen=false）时
      // 取消 pending 的成功回调 timer，防 800ms 后仍触发 checkE2EStatus + initialSync。
      clearTimeout(syncTimer.value)
      syncTimer.value = null
    }
  }
})

async function onSendCode() {
  const e = emailTrim.value
  if (!e) return
  const remain = cooldownSec.value
  if (remain > 0) {
    auth.authError = t('modal.auth.cooldownError', { n: remain })
    return
  }
  if (TURNSTILE_SITE_KEY && !turnstileToken.value) {
    auth.authError = t('modal.auth.turnstileRequired')
    return
  }
  sending.value = true
  auth.authError = null
  const ok = turnstileToken.value
    ? await auth.sendOtp(e, turnstileToken.value)
    : await auth.sendOtp(e)
  sending.value = false
  if (ok) {
    step.value = 'code'
    nextTick(() => codeInputRef.value?.focus())
  } else {
    turnstileToken.value = ''
    turnstileApi()?.reset()
  }
}

async function onOAuth(provider: 'github' | 'google') {
  auth.authError = null
  oauthLoading.value = provider
  try {
    const ok = await auth.signInWithOAuth(provider)
    if (!ok && !auth.authError) {
      auth.authError = t('modal.auth.oauthFailed')
    }
  } catch (err: unknown) {
    auth.authError = err instanceof Error ? err.message : String(err)
  } finally {
    oauthLoading.value = null
  }
}

async function onVerify() {
  const c = code.value.trim()
  if (c.length < 6) return
  const lockRemain = lockSec.value
  if (lockRemain > 0) {
    auth.authError = t('modal.auth.lockError', { n: lockRemain })
    return
  }
  verifying.value = true
  auth.authError = null
  const ok = await auth.verifyOtp(emailTrim.value, c)
  verifying.value = false
  if (ok) {
    verified.value = true
    // 防御：若上次成功回调 timer 仍在 pending（用户在 800ms 内重复点登录）先清掉，
    // 否则旧 id 被新 setTimeout 覆盖后无法 clearTimeout，旧回调仍会跑一次。
    if (syncTimer.value !== null) clearTimeout(syncTimer.value)
    syncTimer.value = window.setTimeout(async () => {
      syncTimer.value = null
      auth.authModalOpen = false
      // 登录后刷新 E2E 状态：checkE2EStatus 在未登录时只能判本地 canary（判不到云端），
      // 登录后才能读云端 master_canary。不刷新则「本地无 canary、云端有」的账户登录后
      // isE2EEnabled 停留 false → 编辑加密书签解锁成功仍提示设置主密码，且新建密码会
      // 误走 base64 而非 E2E 加密。
      await e2e.checkE2EStatus()
      sync.initialSync()
    }, 800)
  }
}

function onBack() {
  step.value = 'email'
  code.value = ''
  auth.authError = null
  auth.resetVerifyState(emailTrim.value)
  turnstileToken.value = ''
  nextTick(() => {
    inputRef.value?.focus()
    ensureTurnstile()
  })
}

function focusCodeInput() {
  codeInputRef.value?.focus()
}

function onClose() {
  auth.authModalOpen = false
  turnstileToken.value = ''
  turnstileApi()?.reset()
}

// 兜底：组件真卸载（如 SPA 路由切走 AuthModal 父组件）时清 timer，
// 防 timer 回调访问已卸载组件作用域内的 store 引用。
onBeforeUnmount(() => {
  if (syncTimer.value !== null) {
    clearTimeout(syncTimer.value)
    syncTimer.value = null
  }
  turnstileToken.value = ''
  turnstileApi()?.reset()
})
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

/* ── 人机验证 ── */
.auth-turnstile{
  margin:10px auto;
  display:flex;
  justify-content:center;
  min-height:65px;
}

/* ── 第三方快捷登录 ── */
.auth-divider{
  display:flex;
  align-items:center;
  gap:12px;
  margin:18px 0 12px;
}
.auth-divider-line{
  flex:1;
  height:1px;
  background:var(--border);
}
.auth-divider-text{
  font-size:0.75rem;
  color:var(--text-muted);
  white-space:nowrap;
}

.auth-oauth-group{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
}

.auth-oauth-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:8px 12px;
  border-radius:var(--radius-sm);
  border:1px solid var(--border);
  background:var(--surface);
  color:var(--text);
  font-size:0.82rem;
  font-weight:500;
  cursor:pointer;
  transition:background 0.15s ease,border-color 0.15s ease;
  user-select:none;
}
.auth-oauth-btn:hover:not(:disabled){
  background:var(--surface-hover);
  border-color:var(--accent);
}
.auth-oauth-btn:disabled{
  opacity:0.6;
  cursor:not-allowed;
}
.auth-oauth-icon{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:16px;
  height:16px;
  flex-shrink:0;
}
.auth-oauth-icon :deep(svg){
  width:16px;
  height:16px;
}
.auth-oauth-label{
  white-space:nowrap;
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
