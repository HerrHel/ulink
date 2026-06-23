<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="开启端到端加密" :class="{ open }" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">🔐 开启端到端加密</span>
        <button class="modal-close" @click="emit('close')" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body">
        <div v-if="step === 1" class="e2e-step">
          <div class="e2e-info">
            <p>端到端加密确保您的密码和敏感数据在上传到云端前已在本地加密。</p>
            <p>服务器永远无法读取您的加密内容。</p>
          </div>
          <div class="form-group">
            <label class="form-label">设置主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" v-model="masterPw" placeholder="输入主密码（至少 8 位）" @keydown.enter="onNext">
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">确认主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw2 ? 'text' : 'password'" class="form-input" v-model="masterPw2" placeholder="再次输入主密码" @keydown.enter="onNext">
              <button class="pw-toggle" @click="showPw2 = !showPw2" v-html="showPw2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
        </div>

        <div v-else-if="step === 2" class="e2e-step">
          <div class="e2e-info e2e-warn">
            <p><strong>⚠️ 重要提醒</strong></p>
            <p>请立即保存以下 Recovery Key。它是您恢复数据的唯一方式。</p>
            <p>忘记主密码且丢失 Recovery Key 将导致数据<strong>永久丢失，无法恢复</strong>。</p>
          </div>
          <div class="recovery-key-box">
            <code class="recovery-key">{{ recoveryKey }}</code>
          </div>
          <div class="e2e-actions">
            <button class="btn btn-primary" @click="downloadPDF">📄 下载 Recovery Key PDF</button>
            <button class="btn btn-ghost" @click="copyKey">📋 复制</button>
          </div>
          <div class="form-group" style="margin-top:16px">
            <label class="check-chip">
              <input type="checkbox" v-model="saved"> 我已保存 Recovery Key
            </label>
          </div>
        </div>

        <div v-else-if="step === 3" class="e2e-step">
          <div class="e2e-success">
            <div class="e2e-success-icon">✅</div>
            <p><strong>端到端加密已开启</strong></p>
            <p>您的密码和敏感数据现在已加密存储。</p>
            <p>每次使用需要输入主密码解锁。</p>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button v-if="step === 1" class="btn btn-primary" :disabled="masterPw.length < 8" @click="onNext">下一步</button>
        <button v-if="step === 2" class="btn btn-primary" :disabled="!saved" @click="onComplete">确认开启</button>
        <button v-if="step === 3" class="btn btn-primary" @click="emit('close')">完成</button>
        <button class="btn btn-secondary" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { I } from '../../config/icons.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { generateRecoveryKeyPDF } from '../../lib/recoveryKeyPDF.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const e2e = useE2E()
const step = ref(1)
const masterPw = ref('')
const masterPw2 = ref('')
const showPw = ref(false)
const showPw2 = ref(false)
const error = ref('')
const recoveryKey = ref('')
const saved = ref(false)

function onNext() {
  error.value = ''
  if (masterPw.value.length < 8) { error.value = '主密码至少 8 位'; return }
  if (masterPw.value !== masterPw2.value) { error.value = '两次密码不一致'; return }
  recoveryKey.value = e2e.generateRecoveryKey(masterPw.value)
  step.value = 2
}

async function onComplete() {
  const ok = await e2e.setupMasterPassword(masterPw.value, recoveryKey.value)
  if (!ok) { error.value = '设置失败，请重试'; return }
  step.value = 3
}

function downloadPDF() {
  generateRecoveryKeyPDF(recoveryKey.value)
}

function copyKey() {
  navigator.clipboard.writeText(recoveryKey.value)
}
</script>
