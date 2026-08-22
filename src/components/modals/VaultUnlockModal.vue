<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('vaultModal.enterPrivateSpace')" :class="{ open }" @click.self="onCancel">
    <div class="modal modal-sm">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> {{ mode === 'reset' ? t('vaultModal.resetMasterPw') : t('vaultModal.enterPrivateSpace') }}</span>
      </div>
      <div class="modal-body">
        <!-- 解锁模式 -->
        <template v-if="mode === 'unlock'">
          <div class="e2e-info">
            <p>{{ t('vaultModal.unlockIntro') }}</p>
          </div>
          <div v-if="vault.isVaultBiometricEnrolled.value && bioAvailable" class="form-group">
            <button class="btn btn-primary btn-block" :disabled="bioLoading" @click="onBiometricUnlock">
              <span aria-hidden="true" v-html="I.lock"></span> {{ bioLoading ? t('e2e.verifying') : t('settings.biometricUnlock') }}
            </button>
            <div class="e2e-separator" style="display:flex;align-items:center;gap:10px;margin:12px 0;color:var(--text-muted);font-size:0.8rem">
              <span style="flex:1;height:1px;background:var(--border)"></span>
              <span>{{ t('e2e.or') }}</span>
              <span style="flex:1;height:1px;background:var(--border)"></span>
            </div>
          </div>
          <div class="form-group">
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" data-testid="lv-vault-unlock-password" v-model="masterPw" :placeholder="t('vaultModal.masterPwPlaceholder')" @keydown.enter="onUnlock" autofocus>
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div class="e2e-link" @click="enterReset">{{ t('vaultModal.forgotRecoveryReset') }}</div>
        </template>

        <!-- 重置模式 -->
        <template v-else>
          <div class="e2e-info e2e-warn">
            <p>{{ t('vaultModal.resetIntro1') }}</p>
            <p style="margin-top:6px">{{ t('vaultModal.resetIntro2') }}</p>
          </div>
          <div class="form-group">
            <label class="form-label">Recovery Key</label>
            <div class="pw-input-wrap">
              <input :type="showRk ? 'text' : 'password'" class="form-input" v-model="recoveryKey" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" @keydown.enter="onReset" autocomplete="off">
              <button class="pw-toggle" @click="showRk = !showRk" v-html="showRk ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">{{ t('vaultModal.newMasterPwLabel') }}</label>
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" v-model="newPw" :placeholder="t('e2e.newMasterPwPlaceholder')" @keydown.enter="onReset">
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">{{ t('e2e.confirmNewPwLabel') }}</label>
            <div class="pw-input-wrap">
              <input :type="showPw2 ? 'text' : 'password'" class="form-input" v-model="newPw2" :placeholder="t('e2e.confirmNewPwPlaceholder')" @keydown.enter="onReset">
              <button class="pw-toggle" @click="showPw2 = !showPw2" v-html="showPw2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div v-else-if="newPw.length > 0 && newPw.length < 8" class="e2e-error" style="background:transparent;padding:4px 8px;font-size:0.75rem">{{ t('e2e.pwRemaining', { n: 8 - newPw.length }) }}</div>
          <div class="e2e-link" @click="enterUnlock">← {{ t('e2e.backToUnlock') }}</div>
        </template>
      </div>
      <div class="modal-foot">
        <template v-if="mode === 'unlock'">
          <button class="btn btn-primary" data-testid="lv-vault-unlock-submit" :disabled="!masterPw" @click="onUnlock">{{ t('settings.unlock') }}</button>
          <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
        </template>
        <template v-else>
          <button class="btn btn-primary" :disabled="!canReset || loading" @click="onReset">{{ loading ? t('e2e.resetting') : t('e2e.resetMasterPassword') }}</button>
          <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
        </template>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { I } from '../../config/icons.js'
import { useVault } from '../../composables/domain/useVault.js'
import { recoveryKeyEmptyError, newPasswordLengthError, newPasswordMismatchError } from './validatePwResetInput.js'
import { t } from '../../i18n/index.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; unlocked: [] }>()

const vault = useVault()
const mode = ref<'unlock' | 'reset'>('unlock')
const masterPw = ref('')
const recoveryKey = ref('')
const newPw = ref('')
const newPw2 = ref('')
const showPw = ref(false)
const showPw2 = ref(false)
const showRk = ref(false)
const error = ref('')
const loading = ref(false)
const bioAvailable = ref(false)
const bioLoading = ref(false)

// onBiometricUnlock 跨 await 解锁窗口的 orphan 竞态守门：弹窗已录入指纹且可用时
// watch(props.open) 正向分支 nextTick 起指纹链，await navigator.credentials.get 是平台
// 模态秒级阻塞窗口——此期间用户可点遮罩 onCancel emit('close') 使 store.modals.vaultUnlock=false。
// 本组件裸挂无外层 v-if（与 BookmarkModal/CategoryModal 不同），关闭后实例常驻、负向分支仅重置
// ref 不短路在途异步。指纹后续 resolve → unlockVault → emit('unlocked') 仍触发 → App.vue
// onVaultUnlocked 跑 switchSpace('vault') 把用户强行切进私密空间，取消语义被吞。
// 代际 token 对齐 ChildBookmarkEditModal._loadGen / HistoryPanel._gen / bdPwShow._detailGen：
// 每次 onBiometricUnlock 自增 gen 使旧 await 的 emit 短路；watch 负向分支推进 gen 让关闭时在途链失效。
let _bioGen = 0

// onUnlock/onReset 密码路径跨 await 解锁窗口的 orphan 竞态守门：与 onBiometricUnlock 同根漏守
// （bug1 commit 803f16be 只修指纹路径，密码路径未触及）。onReset 经 resetVaultWithRecoveryKey
// 含 3×PBKDF2 + generateCanary + _saveCanaryData（含 Supabase upsert 网络往返，弱网秒级 awaiting
// 窗口），此期间用户可点遮罩 onCancel emit('close') 使 store.modals.vaultUnlock=false。watch
// 负向分支 reset loading.value=false 恰好绕过 onUnlock/onReset 顶部 `if (loading.value) return`
// 守门——await 完成后 if (ok) 的 emit('unlocked') 仍触发 → App.vue onVaultUnlocked 跑
// switchSpace('vault') 把用户强行切进私密空间，取消语义被吞。代际 token 对齐 _bioGen 模式：
// 每次密码路径自增 gen 使旧 await 的 emit 短路；watch 负向分支推进 gen 让关闭时在途链失效。
let _pwGen = 0

const canReset = computed(() =>
  recoveryKey.value.trim().length > 0 &&
  newPw.value.length >= 8 &&
  newPw.value === newPw2.value
)

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    mode.value = 'unlock'
    masterPw.value = ''
    recoveryKey.value = ''
    newPw.value = ''
    newPw2.value = ''
    showPw.value = false
    showPw2.value = false
    showRk.value = false
    error.value = ''
    loading.value = false
    bioLoading.value = false
    // 关闭时推进代际 token，短路在途 onBiometricUnlock 的 emit（取消语义生效）
    _bioGen++
    // 同步推进密码路径代际 token，短路在途 onUnlock/onReset 的 emit
    _pwGen++
  } else {
    bioAvailable.value = vault.isBiometricAvailable()
    // 已录入指纹且可用时自动弹指纹
    if (vault.isVaultBiometricEnrolled.value && bioAvailable.value) {
      nextTick(() => onBiometricUnlock())
    }
  }
})

function enterReset() {
  mode.value = 'reset'
  error.value = ''
}

function enterUnlock() {
  mode.value = 'unlock'
  error.value = ''
}

async function onUnlock() {
  if (loading.value) return
  // 代际 token 防跨取消 await 窗口 orphan emit：watch 负向分支会推进 _pwGen 让旧 await 短路
  const localGen = ++_pwGen
  loading.value = true
  error.value = ''
  const ok = await vault.unlockVault(masterPw.value)
  // await 期间用户可能已点遮罩取消（watch 负向分支已推进 _pwGen）
  if (localGen !== _pwGen) { loading.value = false; return }
  loading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = t('vaultModal.masterPwWrong')
  }
}

async function onReset() {
  if (loading.value) return
  error.value = ''
  const rkErr = recoveryKeyEmptyError(recoveryKey.value)
  if (rkErr) { error.value = rkErr; return }
  const pwLenErr = newPasswordLengthError(newPw.value)
  if (pwLenErr) { error.value = pwLenErr; return }
  const pwMismatchErr = newPasswordMismatchError(newPw.value, newPw2.value)
  if (pwMismatchErr) { error.value = pwMismatchErr; return }
  // 代际 token 防跨取消 await 窗口 orphan emit（重置路径含云端 upsert，弱网数秒 awaiting 窗口）
  const localGen = ++_pwGen
  loading.value = true
  const ok = await vault.resetVaultWithRecoveryKey(recoveryKey.value.trim(), newPw.value)
  // await 期间用户可能已点遮罩取消（watch 负向分支已推进 _pwGen）
  if (localGen !== _pwGen) { loading.value = false; return }
  loading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = t('e2e.resetFailed')
  }
}

function onCancel() {
  emit('close')
}

async function onBiometricUnlock() {
  if (bioLoading.value || loading.value) return
  const localGen = ++_bioGen
  bioLoading.value = true
  error.value = ''
  const pw = await vault.unlockWithBiometric()
  // await 指纹平台模态秒级窗口期间用户可能已点遮罩取消（watch 负向分支已推进 _bioGen）
  if (localGen !== _bioGen) { bioLoading.value = false; return }
  if (!pw) {
    bioLoading.value = false
    // 用户取消静默，不设 error；失败带提示
    return
  }
  const ok = await vault.unlockVault(pw)
  // 二次 await 后再判一次 gen：unlockVault 期间用户也可能取消
  if (localGen !== _bioGen) { bioLoading.value = false; return }
  bioLoading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = t('vaultModal.biometricUnlockFailed')
  }
}
</script>
