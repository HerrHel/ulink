<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('ctx.editGroup')" :class="{ open: store.modals.groupEdit }" @click.self="onMaskClick">
    <div class="modal">
      <div class="modal-head"><h2>{{ t('ctx.editGroup') }}</h2><button class="modal-close" @click="onClose" :title="t('common.close')" :aria-label="t('common.close')" v-html="I.close"></button></div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label" for="geName">{{ t('modal.groupEdit.name') }}</label><input type="text" class="form-input" id="geName" ref="geNameRef" v-model="geForm.name" :placeholder="t('modal.groupEdit.name')"></div>
        <div class="form-group"><label class="form-label" for="geCatId">{{ t('modal.bookmark.category') }}</label><select class="form-select" id="geCatId" v-model="geForm.catId"><option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
        <div class="form-group">
          <label class="form-label" for="geIcon">{{ t('modal.bookmark.customIcon') }}</label>
          <input type="url" class="form-input" id="geIcon" v-model="geForm.icon" :placeholder="t('modal.bookmark.iconUrlPlaceholder')" @input="onPreviewGeIconUrl">
          <button v-show="geForm.clearIconVisible" class="btn btn-ghost btn-sm mt-1" @click="onClearGeIcon">{{ t('modal.bookmark.clearIcon') }}</button>
          <div class="logo-preview" v-show="geForm.iconPreviewVisible">
            <img :src="geForm.iconPreviewUrl" alt="">
            <span>{{ t('modal.groupEdit.iconPreview') }}</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('modal.bookmark.attributes') }}</label>
          <div class="check-group">
            <label v-for="a in selectableAttrs" :key="a.id" class="check-chip" :class="{ 'is-system-attr': a.id === ATTR_IS_GROUP }">
              <input type="checkbox" :checked="a.id === ATTR_IS_GROUP || !!geForm.attrs[a.id]" :disabled="a.id === ATTR_IS_GROUP" @change="geForm.attrs[a.id] = ($event.target as HTMLInputElement).checked">
              {{ a.name }}
            </label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('modal.groupEdit.memberBookmarks') }}</label>
          <div>
            <div v-if="!geBookmarkList.length" class="text-muted-sm pt-1">{{ t('cards.emptyTitle') }}</div>
            <div v-for="bm in geBookmarkList" :key="bm.id" class="list-item ge-bm-item">
              <img :src="bm.icon || faviconUrl(bm.url)" class="icon-xs" alt="">
              <span class="flex-1 text-sm text-ellipsis">{{ bm.title }}</span>
              <span class="text-xs text-muted">{{ domainName(bm.url) }}</span>
              <button class="btn-xs btn-danger icon-xs" @click="onRemoveBm(bm.id)" :title="t('modal.groupEdit.remove')" v-html="I.trash"></button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn btn-secondary" @click="onClose">{{ t('common.cancel') }}</button><button class="btn btn-primary" @click="onSave">{{ t('common.save') }}</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { I } from '../../config/icons.js'
import { ATTR_IS_GROUP } from '../../config/constants.js'
import { faviconUrl, domainName } from './groupEditUrl.js'
import { geForm, saveGroupEdit, closeGroupEdit, previewGeIconUrl, clearGeIcon } from '../../composables/domain/useGroup.js'
import { EditorManager } from '../../lib/editor.js'
import { t } from '../../i18n/index.js'

const store = useAppStore()
const geNameRef = ref<HTMLInputElement | null>(null)

const categoryOptions = computed(() => store.selectableCategories)
// A2-007：不展示软删属性
const selectableAttrs = computed(() => store.selectableAttributes)

watch(() => store.modals.groupEdit, (open) => {
  if (open) nextTick(() => geNameRef.value?.focus())
})

// A2-003：列表读 geForm 草稿，取消不写 store
const geBookmarkList = computed(() => {
  return geForm.bookmarkIds
    .map(id => store.bookmarkMap[id])
    .filter(Boolean)
})

function onRemoveBm(bmId: string) {
  const gId = geForm.id || store.editingGeId
  if (!gId) return
  geForm.bookmarkIds = geForm.bookmarkIds.filter(id => id !== bmId)
  // A2-003：silent 删除节点，避免 onUpdate→syncToStore 提前写 store
  EditorManager.withSilent(() => {
    EditorManager.deleteNode(gId, 'data-bm-id', bmId)
  })
}

function onMaskClick() { onClose() }
function onClose() {
  // L8：焦点恢复已并入 closeGroupEdit，避免双重 focus
  closeGroupEdit({ discard: true })
}

function onPreviewGeIconUrl() { previewGeIconUrl() }
function onClearGeIcon() { clearGeIcon() }

function onSave() { saveGroupEdit() }
</script>
