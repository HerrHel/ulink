<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="书签编辑" :class="{ open: bmForm.isOpen }" @click.self="onClose">
    <div class="modal">
      <div class="modal-head">
        <h2>{{ bmForm.isEdit ? '编辑书签' : bmForm.addToGroupMode ? '新建书签并添加到组' : bmForm.parentId ? '添加子书签' : '添加书签' }}</h2>
        <button class="modal-close" @click="onClose" title="关闭" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label" for="bmUrl">网址 *</label>
          <input type="text" class="form-input" id="bmUrl" v-model="bmForm.url" placeholder="例如：github.com" @input="onUrlInput" autocomplete="off">
          <div class="logo-preview" v-show="bmForm.logoPreviewVisible">
            <img :src="bmForm.logoPreviewUrl" alt="">
            <span>{{ bmForm.logoPreviewText }}</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="bmTitle">网站名称</label>
          <input type="text" class="form-input" id="bmTitle" v-model="bmForm.title" placeholder="留空将自动识别" ref="titleRef">
        </div>
        <div v-if="aiSuggestionText" class="ai-suggest-bar">
          <span class="ai-suggest-icon">✨</span>
          <span class="ai-suggest-text">{{ aiSuggestionText }}</span>
          <button class="btn btn-xs btn-primary" @click="onApplyAi">采纳</button>
          <button class="btn btn-xs btn-ghost" @click="onDismissAi">忽略</button>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="bmUsername">账户</label>
            <E2ELockOverlay :disabled="!e2eEnabled" hint="开启 E2E 后可存储账户">
              <input type="text" class="form-input" id="bmUsername" v-model="bmForm.username" placeholder="用户名">
            </E2ELockOverlay>
          </div>
          <div class="form-group">
            <label class="form-label" for="bmPassword">密码</label>
            <E2ELockOverlay :disabled="!e2eEnabled" hint="开启 E2E 后可存储密码">
              <div class="pw-wrap">
                <input :type="bmForm.showPassword ? 'text' : 'password'" class="form-input pw-input" id="bmPassword" v-model="bmForm.password" placeholder="密码">
                <button class="pw-toggle" type="button" :title="bmForm.showPassword ? '隐藏密码' : '显示密码'" @click="bmForm.showPassword = !bmForm.showPassword" v-html="bmForm.showPassword ? I.eyeOff : I.eye"></button>
              </div>
            </E2ELockOverlay>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="bmNotes">备注</label>
          <textarea class="form-textarea" id="bmNotes" v-model="bmForm.notes" placeholder="备注…"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label" for="bmIcon">自定义图标</label>
          <input type="url" class="form-input" id="bmIcon" v-model="bmForm.icon" placeholder="https://… 输入图标URL" @input="onPreviewIconUrl">
          <button class="btn btn-ghost btn-sm mt-1" v-show="bmForm.clearIconVisible" @click="onClearIcon">清除图标</button>
          <div class="logo-preview" v-show="bmForm.iconPreviewVisible">
            <img :src="bmForm.iconPreviewUrl" alt="">
            <span>图标预览</span>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="bmCategoryId">分类</label>
            <select class="form-select" id="bmCategoryId" v-model="bmForm.categoryId">
              <option value="">未分类</option>
              <option v-for="cat in categoryOptions" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="bmParentId">父级（子网站）</label>
            <select class="form-select" id="bmParentId" v-model="bmForm.parentId">
              <option :value="null">无</option>
              <option v-for="b in parentOptions" :key="b.id" :value="b.id">{{ b.title }}</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">属性标记</label>
          <div class="check-group">
            <label v-for="attr in store.customAttributes.filter(a => a.id !== 'is-group')" :key="attr.id" class="check-chip" :class="{ 'ai-highlight': bmForm.aiSuggestAttrIds.includes(attr.id) }">
              <input type="checkbox" :checked="bmForm.attributes[attr.id]"
                     @change="toggleAttr(attr.id, $event)">
              {{ attr.name }}
            </label>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" @click="onClose">取消</button>
        <button class="btn btn-primary" @click="onSave">{{ bmForm.isEdit ? '更新' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, ref } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { bmForm, closeBmModal, saveBm, previewLogo, previewIconUrl, clearIcon, autoFetchFromUrl, applyAiCategory, applyAiAttributes, dismissAiSuggestions } from '../../composables/domain/useBookmark.js'
import { I } from '../../config/icons.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import E2ELockOverlay from '../ui/E2ELockOverlay.vue'

const store = useAppStore()
const titleRef = ref<HTMLInputElement | null>(null)
const e2e = useE2E()
const e2eEnabled = computed(() => e2e.isE2EEnabled.value && e2e.isUnlocked.value)

const categoryOptions = computed(() => store.selectableCategories)
const parentOptions = computed(() =>
  store.bookmarks.filter(b => !b.parentId && b.id !== bmForm.id)
)

const aiSuggestionText = computed(() => {
  const parts: string[] = []
  if (bmForm.aiSuggestCatId) {
    const cat = store.categories.find(c => c.id === bmForm.aiSuggestCatId)
    if (cat) parts.push(`建议分类「${cat.name}」`)
  }
  if (bmForm.aiSuggestAttrIds.length) {
    const names = bmForm.aiSuggestAttrIds
      .map(id => store.customAttributes.find(a => a.id === id)?.name)
      .filter(Boolean)
    if (names.length) parts.push(`建议标签「${names.join('」「')}」`)
  }
  return parts.length ? parts.join('，') : ''
})

function toggleAttr(attrId: string, event: Event) {
  const target = event.target as HTMLInputElement
  if (target.checked) bmForm.attributes[attrId] = true
  else delete bmForm.attributes[attrId]
}

function onClose() { closeBmModal() }
function onSave() { saveBm() }
function onPreviewLogo() { previewLogo() }
function onPreviewIconUrl() { previewIconUrl() }
function onClearIcon() { clearIcon() }
function onUrlInput() { autoFetchFromUrl() }
function onApplyAi() {
  applyAiCategory()
  applyAiAttributes()
}
function onDismissAi() { dismissAiSuggestions() }

// Auto-focus title input when modal opens
watch(() => bmForm.isOpen, (open) => {
  if (open) nextTick(() => titleRef.value?.focus())
})
</script>
