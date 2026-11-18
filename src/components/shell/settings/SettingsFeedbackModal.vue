<template>
  <!-- 反馈 / 建议 弹窗：直接填写内容提交到企业邮箱（保留复制 / mailto 兜底） -->
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="uiStore.overlays.feedback" class="modal-mask open" role="dialog" aria-modal="true" :aria-label="t('settings.feedback')" @mousedown="onFeedbackMaskMouseDown" @click="onFeedbackMaskClick">
        <div class="modal modal-sm">
          <div class="modal-body">
            <div class="confirm-msg">{{ t('settings.feedbackFormHint') }}</div>
            <textarea
              class="form-textarea sp-feedback-text"
              rows="5"
              maxlength="2000"
              :placeholder="t('settings.feedbackPlaceholder')"
              :aria-label="t('settings.feedback')"
              v-model="feedbackText"
            ></textarea>
            <label class="sp-feedback-label" for="lv-feedback-contact">{{ t('settings.feedbackContact') }}</label>
            <input
              id="lv-feedback-contact"
              class="form-input sp-feedback-contact"
              type="text"
              maxlength="200"
              :placeholder="t('settings.feedbackContactPlaceholder')"
              v-model="feedbackContact"
            />
            <!-- honeypot：真人看不到也填不到，机器人填了就在服务端被静默丢弃 -->
            <input class="sp-feedback-hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" v-model="feedbackHoneypot" />
            <!-- 图形人机验证（CloudBase auth captcha，按需挑战：服务端回 captcha_required 才出现） -->
            <div v-if="captcha.visible" class="sp-feedback-captcha">
              <div class="sp-feedback-captcha-label">{{ t('settings.captchaPrompt') }}</div>
              <div class="sp-feedback-captcha-row">
                <img
                  v-if="captcha.imageData"
                  :src="captcha.imageData"
                  class="sp-feedback-captcha-img"
                  :alt="t('settings.captchaPrompt')"
                  @click="refreshCaptcha"
                />
                <input
                  id="lv-feedback-captcha"
                  v-model="captcha.input"
                  class="form-input sp-feedback-captcha-input"
                  type="text"
                  maxlength="8"
                  autocomplete="off"
                  :placeholder="t('settings.captchaPlaceholder')"
                  @keyup.enter="submitCaptchaAndRetry"
                />
              </div>
              <button type="button" class="sp-feedback-link" :disabled="captcha.busy" @click="refreshCaptcha">
                {{ t('settings.captchaRefresh') }}
              </button>
            </div>
            <div class="sp-feedback-meta">
              <!-- 按钮被禁用时必须给出原因：只显示计数的话，用户不知道还差几个字 -->
              <span :class="{ 'sp-feedback-short': feedbackTooShort }">
                {{ feedbackTooShort ? t('settings.feedbackTooShort') : t('settings.feedbackCount', { n: feedbackText.length }) }}
              </span>
              <span>{{ t('settings.feedbackOrEmail') }}
                <button class="sp-feedback-link" @click="openFeedbackMail">{{ FEEDBACK_EMAIL }}</button>
              </span>
            </div>
          </div>
          <div class="modal-foot confirm-foot">
            <button class="btn btn-secondary" @click="copyFeedbackEmail">{{ t('settings.copyEmail') }}</button>
            <button class="btn btn-primary" :disabled="!canSendFeedback" @click="captcha.visible ? submitCaptchaAndRetry() : submitFeedback()">
              {{ feedbackSending ? t('settings.feedbackSending') : t('settings.feedbackSend') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 设置面板 · 反馈 / 建议弹窗（入口在「关于与帮助」页）。
 * 打开状态为 uiStore.overlays.feedback；每次打开自动重置表单并后台预解 PoW。
 * 人机验证：PoW 无感放行，失效时回落 CloudBase 图形验证码。
 */
import { computed, nextTick, ref, reactive, watch } from 'vue'
import { useMaskClose } from '../../../composables/ui/useMaskClose.js'
import { useUIStore } from '../../../stores/ui.js'
import { isCloudBaseBackend, invokeCbFunction, getCbFnBase, getCbAuth } from '../../../lib/cloudbase.js'
import { solvePow } from '../../../lib/pow.js'
import { toast } from '../../../lib/toast.js'
import { APP_VERSION } from '../../../version.js'
import { t, useI18n } from '../../../i18n/index.js'

const uiStore = useUIStore()

const { locale } = useI18n()

const { onMaskMouseDown: onFeedbackMaskMouseDown, onMaskClick: onFeedbackMaskClick } = useMaskClose(() => {
  uiStore.overlays.feedback = false
})

// ── 反馈（A4-007：状态进 overlays.feedback，支持 Esc / popstate）──
const FEEDBACK_EMAIL = 'support@ulink.ren'

/** 反馈接口 = Supabase Edge Function（--no-verify-jwt，凭 anon key 调用）。 */
const FEEDBACK_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/send-feedback`

const FEEDBACK_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')

/** 服务端错误码 → 提示文案键（未列出的错误统一走 feedbackFailed）。 */
const FEEDBACK_ERROR_KEYS: Record<string, string> = {
  message_too_short: 'settings.feedbackTooShort',
  message_too_long: 'settings.feedbackTooLong',
  rate_limited: 'settings.feedbackRateLimited',
}

const feedbackText = ref('')

const feedbackContact = ref('')

const feedbackHoneypot = ref('')

const feedbackSending = ref(false)

/**
 * 图形人机验证（CloudBase auth captcha，按需挑战）。
 * 流程：首次提交放行 → 服务端回 captcha_required → 弹验证码 →
 * verifyCaptchaData 通过拿 captcha_token → 带 token 重交。
 * token 由网关签发（opaque + expires_in），服务端做一次性消费防重放。
 */
const captcha = reactive({
  visible: false,
  imageData: '',
  input: '',
  busy: false,
})

/** createCaptchaData 的 token（verifyCaptchaData 入参） */
let captchaChallengeToken = ''

/** verifyCaptchaData 通过后的 captcha_token（提交携带） */
let captchaVerifiedToken = ''

/**
 * PoW 无感验证（客户端后台解题，用户零感知）。
 * 流程：开弹窗即预取挑战并后台解题（~200ms）→ 提交携带解答 → 服务端验签+难度，
 * jti 一次性消费。**有效 PoW 直接放行**（跳过图形验证码）；缺失/失效才回落
 * captcha_required 图形验证码兜底。
 */
type PowChallenge = { challenge: string; difficulty: number; exp: number; jti: string; signature: string }

type PowSolution = PowChallenge & { nonce: string }

let powStash: PowSolution | null = null

async function fetchPowChallenge(): Promise<PowChallenge | null> {
  try {
    const base = getCbFnBase()
    if (!base) return null
    const res = await fetch(`${base}/send-feedback`, { method: 'GET' })
    const d = (await res.json().catch(() => ({}))) as { pow?: PowChallenge }
    return d?.pow?.challenge ? d.pow : null
  } catch {
    return null
  }
}

async function solvePowChallenge(ch: PowChallenge): Promise<PowSolution | null> {
  const nonce = await solvePow(ch.challenge, ch.difficulty)
  return nonce ? { ...ch, nonce } : null
}

/** 取一份 PoW 解答；stash 用后即清（jti 一次性，服务端防重放） */
async function ensurePowSolution(): Promise<PowSolution | null> {
  if (!isCloudBaseBackend()) return null
  if (powStash) {
    const s = powStash
    powStash = null
    return s
  }
  const ch = await fetchPowChallenge()
  return ch ? solvePowChallenge(ch) : null
}

/** 后台预解题（开弹窗时调用，提交时零等待）；失败静默——提交时现解或回落图形验证 */
async function primePow(): Promise<void> {
  try {
    const ch = await fetchPowChallenge()
    if (!ch) return
    powStash = await solvePowChallenge(ch)
  } catch {
    /* 预解失败静默 */
  }
}

/** 正文最小长度（与 Edge Function 的 MIN_MESSAGE 保持一致）。 */
const MIN_FEEDBACK = 5

const canSendFeedback = computed(
  () =>
    feedbackText.value.trim().length >= MIN_FEEDBACK &&
    !feedbackSending.value &&
    (!captcha.visible || captcha.input.trim().length > 0),
)

/** 已输入但未达最小长度——此时按钮是禁用的，必须让用户知道原因。 */
const feedbackTooShort = computed(() => {
  const n = feedbackText.value.trim().length
  return n > 0 && n < MIN_FEEDBACK
})

/** 弹窗每次打开：清空表单与验证状态，并后台预解 PoW（用户打字期间解完，提交零等待、零感知） */
function resetFeedbackForm() {
  feedbackText.value = ''
  feedbackContact.value = ''
  feedbackHoneypot.value = ''
  captcha.visible = false
  captcha.imageData = ''
  captcha.input = ''
  captchaChallengeToken = ''
  captchaVerifiedToken = ''
  void primePow()
}

watch(() => uiStore.overlays.feedback, (open) => { if (open) resetFeedbackForm() })

// ── 图形人机验证（CloudBase auth captcha）──
type CbAuthCaptcha = {
  createCaptchaData: (p: { state?: string }) => Promise<{ data?: string; token?: string }>
  verifyCaptchaData: (p: { token: string; key: string }) => Promise<{ data?: { captcha_token?: string }; captcha_token?: string }>
}

/** 拉起图形验证码（服务端 captcha_required 或主动挑战） */
async function startCaptcha(): Promise<void> {
  try {
    const auth = getCbAuth() as CbAuthCaptcha | null
    if (!auth?.createCaptchaData) throw new Error('captcha unavailable')
    const r = await auth.createCaptchaData({ state: 'feedback' })
    if (!r?.data || !r?.token) throw new Error('captcha empty')
    captchaChallengeToken = r.token
    captcha.imageData = r.data
    captcha.input = ''
    captcha.visible = true
    nextTick(() => document.getElementById('lv-feedback-captcha')?.focus())
  } catch {
    toast(t('settings.feedbackFailed'), false)
  }
}

/** 刷新验证码图（看不清换一张） */
async function refreshCaptcha(): Promise<void> {
  if (captcha.busy) return
  captcha.busy = true
  try {
    const auth = getCbAuth() as CbAuthCaptcha | null
    if (!auth?.createCaptchaData) throw new Error('captcha unavailable')
    const r = await auth.createCaptchaData({ state: 'feedback' })
    if (!r?.data || !r?.token) throw new Error('captcha empty')
    captchaChallengeToken = r.token
    captcha.imageData = r.data
    captcha.input = ''
  } catch {
    toast(t('settings.captchaWrong'), false)
  } finally {
    captcha.busy = false
  }
}

/** 验证图形码 → 拿 captcha_token → 带 token 重交反馈 */
async function submitCaptchaAndRetry(): Promise<void> {
  if (!canSendFeedback.value || captcha.busy) return
  const key = captcha.input.trim()
  if (!key) return
  captcha.busy = true
  feedbackSending.value = true
  try {
    const auth = getCbAuth() as CbAuthCaptcha | null
    if (!auth?.verifyCaptchaData) throw new Error('captcha unavailable')
    const res = await auth.verifyCaptchaData({ token: captchaChallengeToken, key })
    const verified = res?.data?.captcha_token || res?.captcha_token
    if (!verified) throw new Error('verify failed')
    captchaVerifiedToken = verified
    captcha.visible = false
    await submitFeedback()
  } catch {
    toast(t('settings.captchaWrong'), false)
    captcha.input = ''
    captcha.busy = false
    await refreshCaptcha()
  } finally {
    captcha.busy = false
    feedbackSending.value = false
  }
}

async function copyFeedbackEmail() {
  try {
    await navigator.clipboard.writeText(FEEDBACK_EMAIL)
    toast(t('settings.emailCopied'), true)
  } catch {
    // clipboard API 不可用（旧浏览器/非安全上下文）：提示手动选中复制
    toast(t('settings.copyEmailFailed'), false)
  }
  uiStore.overlays.feedback = false
}

function openFeedbackMail() {
  window.open('mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(t('settings.feedbackSubject')), '_blank')
  uiStore.overlays.feedback = false
}

async function submitFeedback() {
  if (!canSendFeedback.value) return
  feedbackSending.value = true
  try {
    // PoW 无感解答（预解过则零等待）；有效 PoW 服务端直接放行
    const pow = isCloudBaseBackend() ? await ensurePowSolution() : null
    const payload: Record<string, unknown> = {
      message: feedbackText.value.trim(),
      contact: feedbackContact.value.trim(),
      locale: locale.value,
      appVersion: APP_VERSION,
      captcha_token: captchaVerifiedToken,
      website: feedbackHoneypot.value,
    }
    if (pow) payload.pow = pow
    let ok = false
    let errCode = ''
    if (isCloudBaseBackend()) {
      if (!getCbFnBase()) { toast(t('settings.feedbackFailed'), false); return }
      // 服务端成功回 {ok:true}（honeypot 也回 ok——对机器人保持静默）；失败回 {error:'...'}。
      // 非 2xx 时 invokeCbFunction 仍读 body，所以错误码在 data.error 里。
      let r = await invokeCbFunction('send-feedback', payload)
      let d = (r.data || {}) as { error?: string; ok?: boolean; pow?: PowChallenge }
      // PoW 失效（过期/重放）且服务端附新挑战 → 自动重解重交一次（仍无感）
      if (d.error === 'pow_required' && d.pow) {
        const retried = await solvePowChallenge(d.pow)
        if (retried) {
          payload.pow = retried
          r = await invokeCbFunction('send-feedback', payload)
          d = (r.data || {}) as { error?: string; ok?: boolean; pow?: PowChallenge }
        }
      }
      // 图形人机验证兜底（PoW 失败/缺失时）：弹验证码，验证后带 captcha_token 重交
      if (d.error === 'captcha_required' && !captcha.visible) {
        feedbackSending.value = false
        await startCaptcha()
        return
      }
      ok = !r.error || d.ok === true
      errCode = d.error || ''
    } else {
      if (!FEEDBACK_ENDPOINT || !FEEDBACK_ANON_KEY) { toast(t('settings.feedbackFailed'), false); return }
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: FEEDBACK_ANON_KEY },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      ok = res.ok
      errCode = data.error || ''
    }
    if (!ok) {
      toast(t(FEEDBACK_ERROR_KEYS[errCode] || 'settings.feedbackFailed'), false)
      return
    }
    toast(t('settings.feedbackSent'), true)
    feedbackText.value = ''
    feedbackContact.value = ''
    uiStore.overlays.feedback = false
  } catch {
    toast(t('settings.feedbackFailed'), false)
  } finally {
    feedbackSending.value = false
  }
}
</script>
