<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="Group Edit" :class="{ open: store.groupEditOpen }" @click.self="onMaskClick">
    <div class="modal">
      <div class="modal-head"><h2>编辑组</h2><button class="modal-close" @click="onClose" title="关闭" v-html="I.close"></button></div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label" for="geName">组名称</label><input type="text" class="form-input" id="geName" ref="geNameRef" v-model="geForm.name" placeholder="组名称"></div>
        <div class="form-group"><label class="form-label" for="geCatId">分类</label><select class="form-select" id="geCatId" v-model="geForm.catId"><option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
        <div class="form-group">
          <label class="form-label" for="geIcon">自定义图标</label>
          <input type="url" class="form-input" id="geIcon" v-model="geForm.icon" placeholder="https://… 输入图标URL" @input="onPreviewGeIconUrl">
          <button v-show="geForm.clearIconVisible" class="btn btn-ghost btn-sm mt-1" @click="onClearGeIcon">清除图标</button>
          <div class="logo-preview" v-show="geForm.iconPreviewVisible">
            <img :src="geForm.iconPreviewUrl" alt="">
            <span>图标预览</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">属性标记</label>
          <div class="check-group">
            <label v-for="a in store.customAttributes" :key="a.id" class="check-chip">
              <input type="checkbox" :checked="!!geForm.attrs[a.id]" @change="geForm.attrs[a.id] = $event.target.checked">
              {{ a.name }}
            </label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">内含书签</label>
          <div>
            <div v-if="!geBookmarkList.length" class="text-muted-sm pt-1">暂无书签</div>
            <div v-for="bm in geBookmarkList" :key="bm.id" class="list-item ge-bm-item">
              <img :src="bm.icon || faviconUrl(bm.url)" class="icon-xs" alt="">
              <span class="flex-1 text-sm text-ellipsis">{{ bm.title }}</span>
              <span class="text-xs text-muted">{{ domainName(bm.url) }}</span>
              <button class="btn-xs btn-danger icon-xs" @click="onRemoveBm(bm.id)" title="移除" v-html="I.trash"></button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn btn-secondary" @click="onClose">取消</button><button class="btn btn-primary" @click="onSave">保存</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { favicon, domain } from '../../utils.js'
import { I } from '../../config/icons.js'
import { geForm, saveGroupEdit, closeGroupEdit, previewGeIconUrl, clearGeIcon } from '../../composables/domain/useGroup.js'
import { EditorManager } from '../../lib/editor.js'

const store = useAppStore()
const geNameRef = ref(null)

const categoryOptions = computed(() => store.selectableCategories)

watch(() => store.groupEditOpen, (open) => {
  if (open) nextTick(() => geNameRef.value?.focus())
})

const geBookmarkList = computed(() => {
  const gId = geForm.id || store.editingGeId
  if (!gId) return []
  const sg = store.groupMap[gId]
  if (!sg) return []
  return sg.bookmarkIds
    .map(id => store.bookmarkMap[id])
    .filter(Boolean)
})

function faviconUrl(url) { return favicon(url || '') }
function domainName(url) { return domain(url || '') }

function onRemoveBm(bmId) {
  const gId = geForm.id || store.editingGeId
  if (!gId) return
  const sg = store.groupMap[gId]
  if (!sg) return
  const idx = sg.bookmarkIds.indexOf(bmId)
  if (idx >= 0) sg.bookmarkIds.splice(idx, 1)
  EditorManager.deleteNode(gId, 'data-bm-id', bmId)
  store.save()
}

function onMaskClick() { onClose() }
function onClose() {
  closeGroupEdit()
  if (store.lastFocusedEl) store.lastFocusedEl.focus()
  store.lastFocusedEl = null
}

function onPreviewGeIconUrl() { previewGeIconUrl() }
function onClearGeIcon() { clearGeIcon() }

function onSave() { saveGroupEdit() }
</script>
