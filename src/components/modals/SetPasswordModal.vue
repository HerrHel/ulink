<template>
  <div
    class="modal-mask" role="dialog" aria-modal="true"
    :aria-label="t('settings.setPassword')"
    :class="{ open }" @mousedown="onMaskMouseDown" @click="onMaskClick"
  >
    <div class="modal">
      <div class="modal-head">
        <h2>{{ t('settings.setPassword') }}</h2>
        <button class="modal-close" @click="onCancel" :title="t('common.close')" :aria-label="t('common.close')" v-html="I.close"></button>
      </div>

      <div class="modal-body">
        <!-- 第一步：确认发码。与登录弹窗同构——先一个决定，再填表 -->
        <template v-if="step === 'intro'">
          <div class="spm-hero">
            <span class="spm-hero-icon" aria-hidden="true" v-html="I.mail"></span>
            <p class="spm-hero-text">{{ t('settings.passwordCodeSentTo', { email: auth.userEmail }) }}</p>
          </div>
        </template>

        <!-- 第二步：6 格验证码 + 新密码 -->
        <template v-else>
          <p class="spm-sent-to">
            {{ t('modal.auth.codeSentTo') }} <strong class="spm-email">{{ auth.userEmail }}</strong>
          </p>

          <div class="form-group">
            <label class="form-label" for="spPasswordCodeInput">{{ t('settings.passwordCode') }}</label>
            <div class="code-boxes spm-code-row" @click="focusCode">
              <input
                type="text" class="code-hidden-input" id="spPasswordCodeInput" ref="codeRef"
                v-model="code" maxlength="6" inputmode="numeric" pattern="[0-9]*"
                autocomplete="one-time-code" @keydown.enter="onSave"
              />
              <div
                v-for="i in 6" :key="i"
                class="code-box"
                :class="{ 'code-box--cursor': code.length === i - 1 }"
              >{{ code[i - 1] || '' }}</div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="spNewPasswordInput">{{ t('settings.passwordLabel') }}</label>
            <div class="pw-input-wrap">
              <input
                :type="showPw ? 'text' : 'password'" class="form-input" id="spNewPasswordInput"
                v-model="password" :placeholder="t('settings.passwordPlaceholder')"
                autocomplete="new-password" @keydown.enter="onSave"
              />
              <button
                type="button" class="pw-toggle"
                :title="showPw ? t('cards.hidePassword') : t('cards.showPassword')"
                :aria-label="showPw ? t('cards.hidePassword') : t('cards.showPassword')"
                @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"
              ></button>
            </div>
            <p class="spm-rule">{{ t('settings.passwordRule') }}</p>
          </div>
        </template>

        <p v-if="msg" class="spm-msg" :class="msgKind === 'ok' ? 'spm-msg--ok' : 'spm-msg--err'" role="status">
          <span class="spm-msg-icon" v-html="msgKind === 'ok' ? I.listCheck : I.alert"></span>
          <span>{{ msg }}</span>
        </p>
      </div>

      <div class="modal-foot gap-2">
        <button
          v-if="step === 'form'" class="btn btn-ghost"
          :disabled="sending || cooldown > 0" @click="onSendCode"
        >
          {{ cooldown > 0 ? t('modal.auth.resendCountdown', { n: cooldown })
            : (sending ? t('modal.auth.sending') : t('settings.sendPasswordCode')) }}
        </button>
        <span class="flex-1"></span>
        <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
        <button
          v-if="step === 'intro'" class="btn btn-primary" id="spSendPwCodeBtn"
          :disabled="sending || cooldown > 0 || !auth.userEmail" @click="onSendCode"
        >
          {{ sending ? t('modal.auth.sending')
            : (cooldown > 0 ? t('modal.auth.resendCountdownFull', { n: cooldown }) : t('settings.sendPasswordCode')) }}
        </button>
        <button
          v-else class="btn btn-primary" id="spSavePwBtn"
          :disabled="saving || code.length < 6 || !password" @click="onSave"
        >
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * SetPasswordModal — 设置 / 重设登录密码（邮箱验证码 + 新密码）
 *
 * 两步，刻意与 AuthModal 的验证码登录同构：
 *   ① 「将向 … 发送验证码」+ 主按钮「发送验证码」——这一步只有一个决定；
 *   ② 6 格验证码 + 新密码 + 「保存」。
 * 单屏同时摆出「6 个空格子 + 新密码框」会让人不知道先做什么（空格子在催你填，
 * 但码还没发），所以拆成两步，每屏只有一个主操作。
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useUIStore } from '../../stores/ui.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const auth = useAuth()
const ui = useUIStore()

const step = ref<'intro' | 'form'>('intro')
const code = ref('')
const password = ref('')
const showPw = ref(false)
const sending = ref(false)
const saving = ref(false)
const msg = ref('')
const msgKind = ref<'ok' | 'err'>('ok')
const codeRef = ref<HTMLInputElement | null>(null)

const cooldown = computed(() => auth.sendCooldownRemaining(auth.userEmail))

function reset() {
  step.value = 'intro'
  code.value = ''
  password.value = ''
  showPw.value = false
  sending.value = false
  saving.value = false
  msg.value = ''
  msgKind.value = 'ok'
}

watch(() => props.open, (open) => {
  if (!open) return
  reset()
  auth.authError = null
  // 冷却中说明刚发过码（例如关掉弹窗又打开）：直接进第二步。
  // 否则会停在第一步，而「发送验证码」被倒计时禁用，用户拿着邮件里的码却无处可填。
  if (cooldown.value > 0) {
    step.value = 'form'
    nextTick(() => codeRef.value?.focus())
  }
})

/** 关闭：保存中不响应，避免半途丢掉请求结果 */
function onCancel() {
  if (saving.value) return
  ui.modals.setPassword = false
  emit('close')
}

// 遮罩关闭统一走 useMaskClose：只有「在遮罩上按下、又在遮罩上松开」才算点击外部。
// 裸 @click.self 的坑：在弹窗内按下、滑到遮罩上松开时，click 事件的 target 是
// 两者的共同祖先（遮罩），.self 判定照样通过 → 误关闭，正在填的验证码/密码全丢。
const { onMaskMouseDown, onMaskClick } = useMaskClose(onCancel)

/** 6 格验证码是「一个隐形 input + 6 个展示格」，点格子要把焦点交回 input */
function focusCode() {
  codeRef.value?.focus()
}

async function onSendCode() {
  if (sending.value || cooldown.value > 0 || !auth.userEmail) return
  sending.value = true
  msg.value = ''
  const ok = await auth.sendPasswordReset(auth.userEmail)
  sending.value = false
  if (ok) {
    // 只有「重发」才播报已发送；第一次进第二步不重复提示，页面本身已说明
    if (step.value === 'form') {
      msgKind.value = 'ok'
      msg.value = t('settings.passwordCodeSent')
    }
    step.value = 'form'
    nextTick(() => codeRef.value?.focus())
  } else {
    msgKind.value = 'err'
    msg.value = auth.authError || t('settings.passwordSaveFailed')
  }
}

async function onSave() {
  if (saving.value) return
  if (code.value.length < 6 || !password.value) return
  saving.value = true
  msg.value = ''
  const ok = await auth.confirmSetPassword(auth.userEmail, code.value, password.value)
  saving.value = false
  if (ok) {
    toast(t('settings.passwordSaved'))
    ui.modals.setPassword = false
    emit('close')
  } else {
    // store 会把具体原因（长度/字符类型/验证码错误/平台错误）写进 authError
    msgKind.value = 'err'
    msg.value = auth.authError || t('settings.passwordSaveFailed')
  }
}
</script>

<style scoped>
/* ── 第一步：发码说明 ── */
.spm-hero{
  display:flex;flex-direction:column;align-items:center;gap:14px;
  padding:12px 8px 6px;text-align:center;
}
.spm-hero-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:48px;height:48px;border-radius:14px;
  background:var(--accent-light);color:var(--accent);
}
.spm-hero-icon svg{width:24px;height:24px}
.spm-hero-text{
  margin:0;font-size:0.86rem;line-height:1.65;
  color:var(--text-secondary);max-width:340px;
}

/* ── 第二步：已发送提示 ── */
.spm-sent-to{
  margin:0 0 16px;font-size:0.78rem;line-height:1.55;
  color:var(--text-muted);
}
.spm-email{color:var(--text);font-weight:600}

/* 6 格验证码：沿用全局 .code-boxes/.code-box（与登录弹窗同一套控件），
   左对齐撑满整行，与下方新密码输入框左右边缘对齐。 */
.spm-code-row{justify-content:flex-start}
.spm-code-row .code-box{flex:1;width:auto;min-width:0}

.spm-rule{
  margin:6px 0 0;
  font-size:0.72rem;line-height:1.5;
  color:var(--text-muted);
}

.spm-msg{
  display:flex;align-items:flex-start;gap:6px;
  margin:0;padding:8px 12px;
  border-radius:var(--radius-sm);
  font-size:0.78rem;line-height:1.5;
}
.spm-msg--ok{color:var(--green);background:var(--green-light)}
.spm-msg--err{color:var(--danger);background:var(--rose-light)}
.spm-msg-icon{display:inline-flex;flex-shrink:0;margin-top:1px}
.spm-msg-icon svg{width:14px;height:14px}
</style>
