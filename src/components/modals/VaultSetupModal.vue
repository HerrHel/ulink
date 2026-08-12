<template>
  <div class="modal-mask" data-testid="lv-vault-setup-modal" role="dialog" aria-modal="true" aria-label="开启保险柜" :class="{ open }" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> 开启保险柜</span>
        <button class="modal-close" @click="emit('close')" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body">
        <div v-if="step === 1" class="e2e-step">
          <div class="e2e-info">
            <p>保险柜为私密空间提供独立加密保护。设主密码后，私密空间仅在解锁后可进入。</p>
            <p>保险柜主密码独立于端到端加密主密码，互不影响。</p>
          </div>
          <div class="form-group">
            <label class="form-label">设置保险柜主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" data-testid="lv-vault-setup-password" v-model="masterPw" placeholder="输入主密码（至少 8 位）" @keydown.enter="onNext">
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">确认主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw2 ? 'text' : 'password'" class="form-input" data-testid="lv-vault-setup-password2" v-model="masterPw2" placeholder="再次输入主密码" @keydown.enter="onNext">
              <button class="pw-toggle" @click="showPw2 = !showPw2" v-html="showPw2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div v-else-if="masterPw.length > 0 && masterPw.length < 8" class="e2e-error" style="background:transparent;padding:4px 8px;font-size:0.75rem">还需 {{ 8 - masterPw.length }} 位（至少 8 位）</div>
        </div>

        <div v-else-if="step === 2" class="e2e-step">
          <div class="e2e-info e2e-warn">
            <p><strong><span class="sp-icon" v-html="I.alert"></span> 重要提醒</strong></p>
            <p>请立即保存以下 Recovery Key。它是您在忘记保险柜主密码时重设的唯一方式。</p>
            <p>忘记主密码且丢失此 Key，将无法重设，私密空间内的内容将永久无法访问。</p>
          </div>
          <div class="recovery-key-box">
            <code class="recovery-key">{{ recoveryKey }}</code>
          </div>
          <div class="e2e-actions">
            <button class="btn btn-primary" @click="downloadPDF"><span class="sp-icon" v-html="I.export"></span> 下载 Recovery Key PDF</button>
            <button class="btn btn-ghost" @click="copyKey"><span class="sp-icon" v-html="I.copy"></span> 复制</button>
          </div>
          <div class="form-group" style="margin-top:16px">
            <label class="check-chip">
              <input type="checkbox" data-testid="lv-vault-setup-saved" v-model="saved"> 我已保存 Recovery Key
            </label>
          </div>
        </div>

        <div v-else-if="step === 3" class="e2e-step">
          <div class="e2e-success">
            <div class="e2e-success-icon" v-html="I.listCheck"></div>
            <p><strong>保险柜已开启</strong></p>
            <p>现在您可以在「管理分类」弹窗点「私密空间」入口进入。</p>
            <p>每次进入私密空间需输入保险柜主密码解锁。</p>
          </div>
          <div v-if="bioAvailable" class="form-group" style="margin-top:16px">
            <div class="e2e-info" style="font-size:0.85rem">
              <p>启用指纹快速解锁，免去每次输入保险柜主密码</p>
            </div>
            <button class="btn btn-primary" :disabled="bioLoading || bioDone" @click="onEnrollBiometric">
              {{ bioLoading ? '录入中…' : bioDone ? '已启用' : '启用指纹解锁' }}
            </button>
            <div v-if="bioError" class="e2e-error" style="margin-top:8px">{{ bioError }}</div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button v-if="step === 1" class="btn btn-primary" data-testid="lv-vault-setup-next" :disabled="masterPw.length < 8" @click="onNext">下一步</button>
        <button v-if="step === 2" class="btn btn-primary" data-testid="lv-vault-setup-confirm" :disabled="!saved || loading" @click="onComplete">确认开启</button>
        <button v-if="step === 3" class="btn btn-primary" data-testid="lv-vault-setup-done" @click="emit('close')">完成</button>
        <button class="btn btn-secondary" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { I } from '../../config/icons.js'
import { useVault } from '../../composables/domain/useVault.js'
import { generateRecoveryKeyPDF } from '../../lib/recoveryKeyPDF.js'
import { toast } from '../../lib/toast.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const vault = useVault()
// 代际 token（对齐 VaultUnlockModal._pwGen）：onComplete 跨取消 await 窗口短路旧 await 的 step=3
let _setupGen = 0
const step = ref(1)
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
    vault.cancelSetup()  // 层二：推进 useVault 的 _setupGen，短路 setupVaultPassword 写路径副作用
  } else {
    bioAvailable.value = vault.isBiometricAvailable()
  }
})

function onNext() {
  error.value = ''
  if (masterPw.value.length < 8) { error.value = '主密码至少 8 位'; return }
  if (masterPw.value !== masterPw2.value) { error.value = '两次密码不一致'; return }
  try {
    recoveryKey.value = vault.generateRecoveryKey()
    step.value = 2
  } catch (e) {
    error.value = '生成 Recovery Key 失败：' + (e instanceof Error ? e.message : String(e))
  }
}

async function onComplete() {
  if (loading.value) return
  const localGen = ++_setupGen
  loading.value = true
  error.value = ''
  try {
    const ok = await vault.setupVaultPassword(masterPw.value, recoveryKey.value)
    // 层一守门：await 窗口用户点遮罩取消（watch 负向分支已推进 _setupGen）→ 短路不 push step=3
    if (localGen !== _setupGen) return
    // 层二：setupVaultPassword 返回 'cancelled'（取消时写路径内 _saveCanaryData 后也被终止）
    if (ok === 'cancelled') return
    if (!ok) { error.value = '设置失败，请重试'; return }
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
    toast('Recovery Key 已复制，请妥善保存', true)
  } catch {
    toast('复制失败，请手动选中上方 Recovery Key 复制', false)
  }
}

async function onEnrollBiometric() {
  if (bioLoading.value || bioDone.value) return
  bioLoading.value = true
  bioError.value = ''
  try {
    const ok = await vault.enrollBiometric(masterPw.value)
    if (ok) {
      bioDone.value = true
      toast('指纹解锁已启用', true)
    } else {
      bioError.value = '录入失败，当前设备不支持、存储空间不足或已取消'
    }
  } catch (e) {
    bioError.value = '录入失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    bioLoading.value = false
  }
}
</script>
