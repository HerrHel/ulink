<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="解锁数据" :class="{ open }" @click.self="onCancel">
    <div class="modal modal-sm">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> {{ mode === 'reset' ? '重置主密码' : mode === 'changePw' ? '修改主密码' : '解锁数据' }}</span>
      </div>
      <div class="modal-body">
        <!-- 解锁模式 -->
        <template v-if="mode === 'unlock'">
          <div class="e2e-info">
            <p>输入主密码以解密您的数据</p>
          </div>
          <div v-if="e2e.isBiometricEnrolled.value && bioAvailable" class="form-group">
            <button class="btn btn-primary btn-block" :disabled="bioLoading" @click="onBiometricUnlock">
              <span aria-hidden="true" v-html="I.lock"></span> {{ bioLoading ? '验证中…' : '指纹解锁' }}
            </button>
            <div class="e2e-separator" style="display:flex;align-items:center;gap:10px;margin:12px 0;color:var(--text-muted);font-size:0.8rem">
              <span style="flex:1;height:1px;background:var(--border)"></span>
              <span>或</span>
              <span style="flex:1;height:1px;background:var(--border)"></span>
            </div>
          </div>
          <div class="form-group">
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-unlock-password" v-model="masterPw" placeholder="主密码" @keydown.enter="onUnlock" autofocus>
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div class="e2e-link" @click="enterReset">忘记主密码？使用 Recovery Key 重置</div>
        </template>

        <!-- 重置模式（必须 v-else-if，否则 changePw 模式会误渲染本块） -->
        <template v-else-if="mode === 'reset'">
          <div class="e2e-info e2e-warn">
            <p>使用 Recovery Key 设置新的主密码。原主密码将被替换。</p>
            <p style="margin-top:6px">重设后会用新主密码派生新密钥，此前用旧主密码加密且本地无明文副本的数据将无法解密。</p>
          </div>
          <div class="form-group">
            <label class="form-label">Recovery Key</label>
            <div class="pw-input-wrap">
              <input :type="showRk ? 'text' : 'password'" class="form-input" v-model="recoveryKey" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" @keydown.enter="onReset" autocomplete="off">
              <button class="pw-toggle" @click="showRk = !showRk" v-html="showRk ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">新主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" v-model="newPw" placeholder="输入新主密码（至少 8 位）" @keydown.enter="onReset">
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">确认新主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw2 ? 'text' : 'password'" class="form-input" v-model="newPw2" placeholder="再次输入新主密码" @keydown.enter="onReset">
              <button class="pw-toggle" @click="showPw2 = !showPw2" v-html="showPw2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div v-else-if="newPw.length > 0 && newPw.length < 8" class="e2e-error" style="background:transparent;padding:4px 8px;font-size:0.75rem">还需 {{ 8 - newPw.length }} 位（至少 8 位）</div>
          <div class="e2e-link" @click="enterUnlock">← 返回解锁</div>
        </template>

        <!-- 修改主密码模式 -->
        <template v-if="mode === 'changePw'">
          <div class="e2e-info">
            <p>修改主密码会用旧密码解密所有数据、用新密码重新加密并同步到云端。</p>
            <p style="margin-top:6px">若当前已解锁，旧密码无需再输入。</p>
          </div>
          <div v-if="alreadyUnlocked" class="e2e-info">
            <p>当前已解锁，将直接解密并重新加密。</p>
          </div>
          <div v-else class="form-group">
            <label class="form-label">旧主密码</label>
            <div class="pw-input-wrap">
              <input :type="showOldPw ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-changepw-old" v-model="oldPw" placeholder="当前主密码" @keydown.enter="onChangePw" autofocus>
              <button class="pw-toggle" @click="showOldPw = !showOldPw" v-html="showOldPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">新主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-changepw-new" v-model="newPw" placeholder="输入新主密码（至少 8 位）" @keydown.enter="onChangePw">
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">确认新主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw2 ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-changepw-new2" v-model="newPw2" placeholder="再次输入新主密码" @keydown.enter="onChangePw">
              <button class="pw-toggle" @click="showPw2 = !showPw2" v-html="showPw2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div v-else-if="newPw.length > 0 && newPw.length < 8" class="e2e-error" style="background:transparent;padding:4px 8px;font-size:0.75rem">还需 {{ 8 - newPw.length }} 位（至少 8 位）</div>
          <div class="e2e-link" @click="enterUnlock">← 返回解锁</div>
        </template>
      </div>
      <div class="modal-foot">
        <template v-if="mode === 'unlock'">
          <button class="btn btn-primary" data-testid="lv-e2e-unlock-submit" :disabled="!masterPw" @click="onUnlock">解锁</button>
          <button class="btn btn-secondary" @click="onCancel">跳过</button>
        </template>
        <template v-else-if="mode === 'reset'">
          <button class="btn btn-primary" :disabled="!canReset || loading" @click="onReset">{{ loading ? '重置中…' : '重置主密码' }}</button>
          <button class="btn btn-secondary" @click="onCancel">取消</button>
        </template>
        <template v-if="mode === 'changePw'">
          <button class="btn btn-primary" data-testid="lv-e2e-changepw-submit" :disabled="!canChangePw || loading" @click="onChangePw">{{ loading ? '重新加密中…' : '修改主密码' }}</button>
          <button class="btn btn-secondary" @click="onCancel">取消</button>
        </template>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { I } from '../../config/icons.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { showConfirm } from '../../lib/toast.js'
import { recoveryKeyEmptyError, newPasswordLengthError, newPasswordMismatchError, oldPasswordEmptyError } from './validatePwResetInput.js'

const props = defineProps<{ open: boolean; initialMode?: 'unlock' | 'reset' | 'changePw' }>()
const emit = defineEmits<{ close: []; unlocked: [] }>()

const e2e = useE2E()
const mode = ref<'unlock' | 'reset' | 'changePw'>(props.initialMode ?? 'unlock')
const masterPw = ref('')
const recoveryKey = ref('')
const newPw = ref('')
const newPw2 = ref('')
const oldPw = ref('')
const showPw = ref(false)
const showPw2 = ref(false)
const showOldPw = ref(false)
const showRk = ref(false)
const error = ref('')
const loading = ref(false)
const bioAvailable = ref(false)
const bioLoading = ref(false)

// onBiometricUnlock 跨 await 解锁窗口的 orphan 竞态守门：与 VaultUnlockModal 同根漏守。
// 弹窗已录入指纹且可用时 watch(props.open) 正向分支 nextTick 起指纹链，await navigator.credentials.get
// 是平台模态秒级阻塞窗口——此期间用户可点遮罩 onCancel emit('close')。本组件裸挂无外层 v-if，
// 关闭后实例常驻、负向分支仅重置 ref 不短路在途异步。指纹后续 resolve → unlock → emit('unlocked')
// 仍触发 → App.vue onE2EUnlocked 跑 drainPendingUnlock+debouncedSync，取消语义被吞（key 进内存）。
// 代际 token 对齐 ChildBookmarkEditModal._loadGen / VaultUnlockModal._bioGen 模式：
// 每次 onBiometricUnlock 自增 gen 使旧 await 的 emit 短路；watch 负向分支推进 gen 让关闭时在途链失效。
let _bioGen = 0

// onUnlock/onReset/onChangePw 密码路径跨 await 解锁窗口的 orphan 竞态守门：与 onBiometricUnlock
// 同根漏守（bug1 commit 803f16be 只修指纹路径，密码路径未触及）。onReset 经 resetWithRecoveryKey
// 含 3×PBKDF2 + 重写 canary +（登录用户）Supabase upsert 网络往返；onChangePw 经 changeMasterPassword
// 含 3×PBKDF2 + 重加密本机所有数据 + push 新 key 密文到云——弱网数秒 awaiting 窗口。此期间用户可点
// 遮罩 onCancel emit('close') 使 store.modals.e2eUnlock=false。watch 负向分支 reset loading.value=false
// 恰好绕过 onUnlock/onReset/onChangePw 顶部 `if (loading.value) return` 守门——await 完成后 if (ok) 的
// emit('unlocked') 仍触发 → App.vue onE2EUnlocked 跑 drainPendingUnlock(true)+debouncedSync，取消语义
// 被吞（key 进内存 + 敏感字段推云）。代际 token 对齐 _bioGen 模式：每次密码路径自增 gen 使旧 await 的
// emit 短路；watch 负向分支推进 gen 让关闭时在途链失效。
let _pwGen = 0

const alreadyUnlocked = computed(() => !!e2e.isUnlocked.value)

const canReset = computed(() =>
  recoveryKey.value.trim().length > 0 &&
  newPw.value.length >= 8 &&
  newPw.value === newPw2.value
)

const canChangePw = computed(() =>
  (alreadyUnlocked.value || oldPw.value.length > 0) &&
  newPw.value.length >= 8 &&
  newPw.value === newPw2.value
)

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    mode.value = props.initialMode ?? 'unlock'
    masterPw.value = ''
    recoveryKey.value = ''
    newPw.value = ''
    newPw2.value = ''
    oldPw.value = ''
    showPw.value = false
    showPw2.value = false
    showOldPw.value = false
    showRk.value = false
    error.value = ''
    loading.value = false
    bioLoading.value = false
    // 关闭时推进代际 token，短路在途 onBiometricUnlock 的 emit（取消语义生效）
    _bioGen++
    // 同步推进密码路径代际 token，短路在途 onUnlock/onReset/onChangePw 的 emit
    _pwGen++
  } else {
    mode.value = props.initialMode ?? 'unlock'
    bioAvailable.value = e2e.isBiometricAvailable()
    if (e2e.isBiometricEnrolled.value && bioAvailable.value && mode.value === 'unlock') {
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
  const ok = await e2e.unlock(masterPw.value)
  // await 期间用户可能已点遮罩取消（watch 负向分支已推进 _pwGen）
  if (localGen !== _pwGen) { loading.value = false; return }
  loading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = '主密码错误'
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
  const ok = await e2e.resetWithRecoveryKey(recoveryKey.value.trim(), newPw.value)
  // await 期间用户可能已点遮罩取消（watch 负向分支已推进 _pwGen）
  if (localGen !== _pwGen) { loading.value = false; return }
  loading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = 'Recovery Key 错误或重置失败'
  }
}

async function onChangePw() {
  if (loading.value) return
  error.value = ''
  if (!alreadyUnlocked.value) {
    const oldErr = oldPasswordEmptyError(oldPw.value)
    if (oldErr) { error.value = oldErr; return }
  }
  const pwLenErr = newPasswordLengthError(newPw.value)
  if (pwLenErr) { error.value = pwLenErr; return }
  const pwMismatchErr = newPasswordMismatchError(newPw.value, newPw2.value)
  if (pwMismatchErr) { error.value = pwMismatchErr; return }
  // 代际 token 防跨取消 await 窗口 orphan emit（changeMasterPassword 重加密本机全部数据 + 推新 key 密文到云，弱网数秒 awaiting 窗口）
  const localGen = ++_pwGen
  loading.value = true
  const ok = await e2e.changeMasterPassword(alreadyUnlocked.value ? '' : oldPw.value, newPw.value)
  // await 期间用户可能已点遮罩取消（watch 负向分支已推进 _pwGen）——不短路会继续 await showConfirm + emit('unlocked')
  if (localGen !== _pwGen) { loading.value = false; return }
  loading.value = false
  if (ok) {
    if (e2e.cloudCanaryStale.value) {
      // 本机重加密成功，但 canary 云端写失败：其他设备仍持旧 canary/旧主密码，解不开
      // 本设备 push 的新 key 密文 → 业务数据对它们永久不可读。引导用户在其他设备用
      // Recovery Key 走「重置主密码」（清空重建空库），把"永久丢失卡死"降级为"需重置"。
      await showConfirm(
        '本机主密码已修改，但云端同步失败：其他设备将无法解密已同步的加密内容。\n\n请在其他设备上用恢复密钥（Recovery Key）执行「重置主密码」以清空重建数据，否则那些设备上的加密内容将永久丢失。'
      )
    }
    emit('unlocked')
    emit('close')
  } else {
    error.value = '修改失败：旧密码错误或重加密/同步异常，已保持原密码'
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
  const pw = await e2e.unlockWithBiometric()
  // await 指纹平台模态秒级窗口期间用户可能已点遮罩取消（watch 负向分支已推进 _bioGen）
  if (localGen !== _bioGen) { bioLoading.value = false; return }
  if (!pw) {
    bioLoading.value = false
    // 用户取消静默，不设 error；失败带提示
    return
  }
  const ok = await e2e.unlock(pw)
  // 二次 await 后再判一次 gen：unlock 期间用户也可能取消
  if (localGen !== _bioGen) { bioLoading.value = false; return }
  bioLoading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = '指纹解锁失败，请手动输入主密码'
  }
}
</script>
