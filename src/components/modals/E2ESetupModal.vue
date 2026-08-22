<template>
  <div class="modal-mask" data-testid="lv-e2e-setup-modal" role="dialog" aria-modal="true" :aria-label="t('e2e.setupTitle')" :class="{ open }" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> {{ t('e2e.setupTitle') }}</span>
        <button class="modal-close" @click="emit('close')" :aria-label="t('common.close')">&times;</button>
      </div>
      <div class="modal-body">
        <div v-if="step === 1" class="e2e-step">
          <div class="e2e-info">
            <p>{{ t('e2e.intro1') }}</p>
            <p>{{ t('e2e.intro2') }}</p>
          </div>
          <div v-if="legacyDataDetected" class="e2e-info e2e-warn" style="margin-top:8px">
            <p><strong><span class="sp-icon" v-html="I.alert"></span> {{ t('e2e.legacyDetected') }}</strong></p>
            <p v-html="t('e2e.legacyBody')"></p>
            <p>{{ t('e2e.legacyHint') }}</p>
          </div>
          <div class="form-group">
            <label class="form-label">{{ t('e2e.setMasterPwLabel') }}</label>
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-setup-password" v-model="masterPw" :placeholder="t('e2e.pwPlaceholder')" @keydown.enter="onNext">
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">{{ t('e2e.confirmPwLabel') }}</label>
            <div class="pw-input-wrap">
              <input :type="showPw2 ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-setup-password2" v-model="masterPw2" :placeholder="t('e2e.confirmPwPlaceholder')" @keydown.enter="onNext">
              <button class="pw-toggle" @click="showPw2 = !showPw2" v-html="showPw2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div v-else-if="masterPw.length > 0 && masterPw.length < 8" class="e2e-error" style="background:transparent;padding:4px 8px;font-size:0.75rem">{{ t('e2e.pwRemaining', { n: 8 - masterPw.length }) }}</div>
        </div>

        <div v-else-if="step === 2" class="e2e-step">
          <div class="e2e-info e2e-warn">
            <p><strong><span class="sp-icon" v-html="I.alert"></span> {{ t('e2e.importantNotice') }}</strong></p>
            <p>{{ t('e2e.recoveryKeyIntro1') }}</p>
            <p>{{ t('e2e.recoveryKeyIntro2') }}</p>
          </div>
          <div class="recovery-key-box">
            <code class="recovery-key">{{ recoveryKey }}</code>
          </div>
          <div class="e2e-actions">
            <button class="btn btn-primary" @click="downloadPDF"><span class="sp-icon" v-html="I.export"></span> {{ t('e2e.downloadRecoveryPdf') }}</button>
            <button class="btn btn-ghost" @click="copyKey"><span class="sp-icon" v-html="I.copy"></span> {{ t('common.copy') }}</button>
          </div>
          <div class="form-group" style="margin-top:16px">
            <label class="check-chip">
              <input type="checkbox" data-testid="lv-e2e-setup-saved" v-model="saved"> {{ t('e2e.iSavedRecoveryKey') }}
            </label>
          </div>
        </div>

        <div v-else-if="step === 3" class="e2e-step">
          <div class="e2e-success">
            <div class="e2e-success-icon" v-html="I.listCheck"></div>
            <p><strong>{{ t('e2e.enabledTitle') }}</strong></p>
            <p>{{ t('e2e.enabledIntro1') }}</p>
            <p>{{ t('e2e.enabledIntro2') }}</p>
          </div>
          <div v-if="bioAvailable" class="form-group" style="margin-top:16px">
            <div class="e2e-info" style="font-size:0.85rem">
              <p>{{ t('e2e.bioHint') }}</p>
            </div>
            <button class="btn btn-primary" :disabled="bioLoading || bioDone" @click="onEnrollBiometric">
              {{ bioLoading ? t('e2e.enrolling') : bioDone ? t('e2e.enabled') : t('e2e.enableBiometric') }}
            </button>
            <div v-if="bioError" class="e2e-error" style="margin-top:8px">{{ bioError }}</div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button v-if="step === 1" class="btn btn-primary" data-testid="lv-e2e-setup-next" :disabled="masterPw.length < 8" @click="onNext">{{ t('e2e.next') }}</button>
        <button v-if="step === 2" class="btn btn-primary" data-testid="lv-e2e-setup-confirm" :disabled="!saved || loading" @click="onComplete">{{ t('e2e.confirmEnable') }}</button>
        <button v-if="step === 3" class="btn btn-primary" data-testid="lv-e2e-setup-done" @click="emit('close')">{{ t('common.done') }}</button>
        <button class="btn btn-secondary" @click="emit('close')">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { I } from '../../config/icons.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { generateRecoveryKeyPDF } from '../../lib/recoveryKeyPDF.js'
import { toast } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const e2e = useE2E()
// 代际 token（对齐 VaultUnlockModal._pwGen / VaultSetupModal._setupGen）：onComplete 跨取消 await 窗口短路旧 await 的 step=3
let _setupGen = 0
const step = ref(1)
// 换设备防呆：本机无 canary 却已有历史密文时，重新设置主密码会生成新 key 解不开旧数据，
// 弹窗打开即给出警告，引导用户走「原主密码解锁」而非静默覆盖（见 useE2E.hasEncryptedData）。
const legacyDataDetected = computed(() => e2e.hasEncryptedData())
const masterPw = ref('')
const masterPw2 = ref('')
const showPw = ref(false)
const showPw2 = ref(false)
const error = ref('')
const recoveryKey = ref('')
const saved = ref(false)
const loading = ref(false)
const bioAvailable = ref(false)
const bioLoading = ref(false)
const bioDone = ref(false)
const bioError = ref('')

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    step.value = 1
    masterPw.value = ''
    masterPw2.value = ''
    showPw.value = false
    showPw2.value = false
    error.value = ''
    recoveryKey.value = ''
    saved.value = false
    loading.value = false
    bioAvailable.value = false
    bioLoading.value = false
    bioDone.value = false
    bioError.value = ''
    _setupGen++  // 层一：关闭时推进，让在途 onComplete 的 localGen 失效短路 step=3
    e2e.cancelSetup()  // 层二：推进 useE2E 的 _setupGen，短路 setupMasterPassword 写路径副作用
  } else {
    bioAvailable.value = e2e.isBiometricAvailable()
  }
})

function onNext() {
  error.value = ''
  if (masterPw.value.length < 8) { error.value = t('e2e.masterPwTooShort'); return }
  if (masterPw.value !== masterPw2.value) { error.value = t('e2e.pwMismatch'); return }
  try {
    recoveryKey.value = e2e.generateRecoveryKey()
    step.value = 2
  } catch (e) {
    error.value = t('e2e.recoveryKeyGenFail', { msg: e instanceof Error ? e.message : String(e) })
  }
}

async function onComplete() {
  // A2-009：防重入，避免连点覆写 canary
  if (loading.value) return
  const localGen = ++_setupGen
  loading.value = true
  error.value = ''
  try {
    const ok = await e2e.setupMasterPassword(masterPw.value, recoveryKey.value)
    // 层一守门：await 窗口用户点遮罩取消（watch 负向分支已推进 _setupGen）→ 短路不 push step=3
    if (localGen !== _setupGen) return
    // 层二：setupMasterPassword 返回 'cancelled'（取消时写路径内 _saveCanaryData 后也被终止）
    if (ok === 'cancelled') return
    if (!ok) { error.value = t('e2e.setupFailed'); return }
    step.value = 3
  } finally {
    if (localGen === _setupGen) loading.value = false
  }
}

function downloadPDF() {
  generateRecoveryKeyPDF(recoveryKey.value)
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(recoveryKey.value)
    toast(t('e2e.recoveryKeyCopied'), true)
  } catch {
    toast(t('e2e.copyFailManually'), false)
  }
}

async function onEnrollBiometric() {
  if (bioLoading.value || bioDone.value) return
  bioLoading.value = true
  bioError.value = ''
  try {
    const ok = await e2e.enrollBiometric(masterPw.value)
    if (ok) {
      bioDone.value = true
      toast(t('e2e.biometricEnrolled'), true)
    } else {
      bioError.value = t('e2e.biometricEnrollFail')
    }
  } catch (e) {
    bioError.value = t('e2e.biometricEnrollFailDetail', { msg: e instanceof Error ? e.message : String(e) })
  } finally {
    bioLoading.value = false
  }
}
</script>
