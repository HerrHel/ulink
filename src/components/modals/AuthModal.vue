<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('modal.auth.ariaLabel')" :class="{ open: auth.authModalOpen }" @mousedown="onMaskMouseDown" @click="onMaskClick">
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
          <!-- 登录方式切换：下划线标签（无填充轨道块，天然适配明暗双主题） -->
          <div
            class="auth-tabs" role="tablist"
            :style="{ '--tab-x': mode === 'password' ? '100%' : '0%' }"
          >
            <button
              type="button" role="tab" id="authTabOtp" class="auth-tab"
              :class="{ 'auth-tab--active': mode === 'otp' }"
              :aria-selected="mode === 'otp'"
              @click="setMode('otp')"
            >{{ t('modal.auth.tabOtp') }}</button>
            <button
              type="button" role="tab" id="authTabPassword" class="auth-tab"
              :class="{ 'auth-tab--active': mode === 'password' }"
              :aria-selected="mode === 'password'"
              @click="setMode('password')"
            >{{ t('modal.auth.tabPassword') }}</button>
          </div>

          <p class="auth-hint">
            {{ mode === 'otp' ? t('modal.auth.emailHint') : t('modal.auth.passwordHint') }}
          </p>
          <p class="auth-hint-sub">
            {{ mode === 'otp' ? t('modal.auth.noPasswordHint') : t('modal.auth.noPasswordGuide') }}
          </p>
          <div class="form-group">
            <input
              type="email" class="form-input auth-input" id="authEmailInput"
              v-model="email" placeholder="your@email.com"
              @keydown.enter="onEmailEnter" ref="inputRef" autocomplete="email"
            />
          </div>

          <!-- 密码字段：用 0fr→1fr 的网格行高过渡展开，让「多一个输入框」
               成为一次有意的形变，而不是切 tab 时凭空多出一块把下面全顶下去 -->
          <div class="auth-pw-slot" :class="{ 'auth-pw-slot--open': mode === 'password' }">
            <div class="auth-pw-slot-inner">
              <div class="form-group">
                <input
                  type="password" class="form-input auth-input" id="authPasswordInput"
                  v-model="password" :placeholder="t('modal.auth.passwordPlaceholder')"
                  autocomplete="current-password"
                  @keydown.enter="onPasswordLogin"
                />
              </div>
            </div>
          </div>

          <!-- 第三方登录是一条与「邮箱内用验证码还是密码」无关的独立通道：
               它必须待在 tab 面板之外，否则切到密码登录时整块消失，
               底部会凭空少一截，看起来像漏渲染而不是有意设计。 -->
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

        <!-- Step 2: 输入验证�?-->
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
        <button v-if="step === 'email' && mode === 'otp'" class="btn btn-primary" @click="onSendCode"
          :disabled="!emailTrim || sending || cooldownSec > 0">
          {{ sending ? t('modal.auth.sending')
            : (cooldownSec > 0 ? t('modal.auth.resendCountdownFull', { n: cooldownSec }) : t('modal.auth.sendCode')) }}
        </button>
        <button v-if="step === 'email' && mode === 'password'" id="authPasswordLoginBtn"
          class="btn btn-primary" @click="onPasswordLogin"
          :disabled="!emailTrim || !password || pwBusy || lockSec > 0">
          {{ pwBusy ? t('modal.auth.loggingIn') : t('modal.auth.login') }}
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
import { toast } from '../../lib/toast.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'

const oauthLoading = ref<'github' | 'google' | null>(null)

const auth = useAuth()
const sync = useCloudSync()
const e2e = useE2E()
const email = ref('')
const code = ref('')
const step = ref<'email' | 'code'>('email')
/** 邮箱步骤下的登录方式：验证码 / 密码 */
const mode = ref<'otp' | 'password'>('otp')
const password = ref('')
const pwBusy = ref(false)
const sending = ref(false)
const verifying = ref(false)
const verified = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const codeInputRef = ref<HTMLInputElement | null>(null)
// onVerify 成功后延迟关闭弹窗的 timer。需在弹窗提前关闭（手动 X / 遮罩 / 取消 / Esc�?
// 时清掉，否则 800ms 到点回调仍会�?checkE2EStatus + initialSync —�?用户已明确取消登录流�?
// 后系统不应再自作主张触发全量云端同步�?
const syncTimer = ref<number | null>(null)

const emailTrim = computed(() => email.value.trim())
const cooldownSec = computed(() => auth.sendCooldownRemaining(emailTrim.value))
const lockSec = computed(() => auth.verifyLockRemaining(emailTrim.value))

watch(() => auth.authModalOpen, (open) => {
  if (open) {
    email.value = ''
    code.value = ''
    step.value = 'email'
    mode.value = 'otp'
    password.value = ''
    pwBusy.value = false
    sending.value = false
    verifying.value = false
    verified.value = false
    oauthLoading.value = null
    auth.authError = null
    nextTick(() => {
      inputRef.value?.focus()
    })
  } else {
    if (syncTimer.value !== null) {
      // 弹窗关闭（含手动 X / 遮罩 / 取消 / Esc 任一路径，均会置 authModalOpen=false）时
      // 取消 pending 的成功回�?timer，防 800ms 后仍触发 checkE2EStatus + initialSync�?
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
  sending.value = true
  auth.authError = null
  const ok = await auth.sendOtp(e)
  sending.value = false
  if (ok) {
    step.value = 'code'
    nextTick(() => codeInputRef.value?.focus())
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
    schedulePostLogin()
  }
}

/** 登录成功后的统一收尾：显示成功态，800ms 后关弹窗并刷�?E2E 状�?+ 触发首同�?*/
function schedulePostLogin() {
  verified.value = true
  // 防御：若上次成功回调 timer 仍在 pending（用户在 800ms 内重复点登录）先清掉�?
  // 否则�?id 被新 setTimeout 覆盖后无�?clearTimeout，旧回调仍会跑一次�?
  if (syncTimer.value !== null) clearTimeout(syncTimer.value)
  syncTimer.value = window.setTimeout(async () => {
    syncTimer.value = null
    auth.authModalOpen = false
    // 登录后刷�?E2E 状态：checkE2EStatus 在未登录时只能判本地 canary（判不到云端），
    // 登录后才能读云端 master_canary。不刷新则「本地无 canary、云端有」的账户登录�?
    // isE2EEnabled 停留 false �?编辑加密书签解锁成功仍提示设置主密码，且新建密码�?
    // 误走 base64 而非 E2E 加密�?
    await e2e.checkE2EStatus()
    await sync.initialSync()
    // CloudBase 迁移：老用户首次登录会认领历史数据，认领到东西时给个明确反馈，
    // 否则用户只会看到书架「突然有了东西」而不知道发生了什么�?
    // 用可选链：部分单测会 mock 一个精简�?useCloudSync，未必带 lastClaim�?
    const claim = sync.lastClaim?.value ?? null
    if (claim && claim.count > 0) {
      toast(t('settings.legacyDataRestored', { n: claim.count }))
    }
  }, 800)
}

/** 切换登录方式：清掉上一次的错误与重置成功态，避免串味 */
function setMode(m: 'otp' | 'password') {
  if (mode.value === m) return
  mode.value = m
  auth.authError = null
  password.value = ''
  nextTick(() => inputRef.value?.focus())
}

function onEmailEnter() {
  if (mode.value === 'otp') onSendCode()
  else onPasswordLogin()
}

async function onPasswordLogin() {
  const e = emailTrim.value
  const pw = password.value
  if (!e || !pw || pwBusy.value) return
  const lockRemain = lockSec.value
  if (lockRemain > 0) {
    auth.authError = t('modal.auth.lockError', { n: lockRemain })
    return
  }
  pwBusy.value = true
  auth.authError = null
  const ok = await auth.signInWithPassword(e, pw)
  pwBusy.value = false
  if (ok) schedulePostLogin()
}

function onBack() {
  step.value = 'email'
  code.value = ''
  auth.authError = null
  auth.resetVerifyState(emailTrim.value)
  nextTick(() => {
    inputRef.value?.focus()
  })
}

function focusCodeInput() {
  codeInputRef.value?.focus()
}

function onClose() {
  auth.authModalOpen = false
}

// 兜底：组件真卸载（如 SPA 路由切走 AuthModal 父组件）时清 timer�?
// �?timer 回调访问已卸载组件作用域内的 store 引用�?
onBeforeUnmount(() => {
  if (syncTimer.value !== null) {
    clearTimeout(syncTimer.value)
    syncTimer.value = null
  }
})

// 遮罩关闭统一走 useMaskClose：只有「在遮罩上按下、又在遮罩上松开」才算点击外部。
// 裸 @click.self 的坑：在弹窗内按下、滑到遮罩上松开时，click 事件的 target 是两者的
// 共同祖先（遮罩），.self 判定照样通过 -> 误关闭，正在填的内容全丢。
const { onMaskMouseDown, onMaskClick } = useMaskClose(onClose)
</script>

<style scoped>
.auth-body{text-align:center;padding:24px 28px 16px}

/* ── 图标装饰 ── */
.auth-icon-wrap{margin-bottom:16px}
.auth-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:48px;height:48px;border-radius:var(--radius-lg);
  background:var(--accent-light);color:var(--accent);
}
.auth-icon svg{width:24px;height:24px}

/* ── 提示文字 ── */
.auth-hint{
  font-size:var(--fs-base);color:var(--text);margin:0 0 4px;
  line-height:1.5;font-weight:500;
}
.auth-hint-sub{
  font-size:var(--fs-xs);color:var(--text-muted);
  margin:0 0 16px;line-height:1.5;
}

/* ── 登录方式切换：下划线标签 ──
   参考 GitHub / Stripe / Linear 的 tab 排版：不用填充色块轨道，只用
   共享基线 + 强调色滑块表达选中。这样在明暗两套主题下都不会出现
   「暗色页面里一块浅色板」的割裂感，也不需要为每个主题单独调色。 */
.auth-tabs{
  position:relative;display:flex;margin:0 0 16px;
  border-bottom:1px solid var(--border-light);
  --tab-x:0%;
}
/* 滑块：外框恒定半个轨道用于 100% 平移，内框用 padding+background-clip
   收窄成一条比标签略窄的强调线，避免横贯半个弹窗显得笨重。 */
.auth-tabs::after{
  content:'';position:absolute;left:0;bottom:-1px;
  width:50%;height:2px;box-sizing:border-box;
  padding:0 20px;
  background:var(--accent);
  background-clip:content-box;
  transform:translateX(var(--tab-x));
  transition:transform .26s var(--ease-out);
  pointer-events:none;
}
@media (prefers-reduced-motion:reduce){
  .auth-tabs::after{transition:none}
}
.auth-tab{
  flex:1;min-width:0;
  appearance:none;border:0;margin:0;
  padding:9px 8px 10px;
  background:transparent;
  color:var(--text-muted);
  font-family:inherit;font-size:var(--fs-sm);font-weight:500;
  letter-spacing:0.01em;
  cursor:pointer;
  border-radius:var(--radius-sm) var(--radius-sm) 0 0;
  transition:color .16s ease,background-color .16s ease;
  -webkit-tap-highlight-color:transparent;
}
@media (hover:hover) and (pointer:fine){
  .auth-tab:hover{color:var(--text);background:var(--surface-hover)}
  .auth-tab--active:hover{background:transparent}
}
.auth-tab:active{color:var(--text)}
.auth-tab:focus-visible{outline:2px solid var(--accent);outline-offset:-3px;border-radius:var(--radius-sm)}
/* 选中态用「字色 + 字重 + 滑块」三重信号，不依赖低对比的底色差异 */
.auth-tab--active{color:var(--text);font-weight:600}
.auth-email-display{
  font-size:var(--fs-md);font-weight:600;color:var(--accent);
  margin:0 0 4px;word-break:break-all;
}

/* ── 输入�?── */
.auth-input{
  text-align:center;font-size:var(--fs-md);
  padding:11px 16px;
}

/* 密码字段折叠槽：展开/收起都走 grid-template-rows 过渡，弹窗高度随之
   连续变化，切换 tab 时不会出现「下面整块跳一下」。
   visibility 负责把收起状态的输入框移出 Tab 键序列（height:0 仍可聚焦）。 */
.auth-pw-slot{
  display:grid;grid-template-rows:0fr;
  visibility:hidden;
  transition:grid-template-rows .24s var(--ease-out),visibility 0s .24s;
}
.auth-pw-slot--open{
  grid-template-rows:1fr;
  visibility:visible;
  transition:grid-template-rows .24s var(--ease-out),visibility 0s 0s;
}
.auth-pw-slot-inner{
  min-height:0;overflow:hidden;
  opacity:0;transition:opacity 0.2s ease;
}
.auth-pw-slot--open .auth-pw-slot-inner{opacity:1}
@media (prefers-reduced-motion:reduce){
  .auth-pw-slot,.auth-pw-slot--open{transition:none}
}

/* ── 第三方快捷登�?── */
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
  font-size:var(--fs-xs);
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
  font-size:var(--fs-sm);
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

/* ── 消息状�?── */
.auth-error,.auth-success{
  display:flex;align-items:center;justify-content:center;gap:6px;
  font-size:var(--fs-sm);margin-top:8px;padding:8px 12px;
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

