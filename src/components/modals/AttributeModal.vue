<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('modal.attribute.ariaLabel')" :class="{ open: store.modals.attribute }" @click.self="onClose">
    <div class="modal">
      <div class="modal-head"><h2>{{ t('modal.attribute.manage') }}</h2><button class="modal-close" @click="onClose" :title="t('common.close')" :aria-label="t('common.close')" v-html="I.close"></button></div>
      <div class="modal-body">
        <div class="flex-center gap-2 mb-3">
          <input type="text" class="form-input flex-1" v-model="newName" ref="newNameRef" :placeholder="t('modal.attribute.name')" :aria-label="t('modal.attribute.name')" @keydown.enter="onAddAttr">
          <button class="btn btn-primary btn-sm" @click="onAddAttr">{{ t('common.add') }}</button>
        </div>
        <div>
          <div v-for="attr in attributes" :key="attr.id" class="list-item">
            <template v-if="editingId === attr.id">
              <input class="form-input flex-1 form-input-sm" v-model="editingName" :aria-label="t('modal.attribute.name')" @keydown.enter="confirmRename" @keydown.escape="cancelRename" :ref="setEditInputRef">
              <button class="btn btn-primary btn-sm" @click="confirmRename" :title="t('modal.category.confirmRename')" v-html="I.listCheck"></button>
            </template>
            <template v-else>
              <span class="flex-1">{{ attr.name }}</span>
              <button class="btn-xs icon-xs" @click="startRename(attr)" :title="t('common.edit')" v-html="I.edit"></button>
              <button class="btn-xs btn-danger icon-xs" @click="onDelete(attr.id)" :title="t('common.delete')" v-html="I.trash"></button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { gid } from '../../utils.js'
import { attrSlug } from '../../composables/domain/attrSlug.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { I } from '../../config/icons.js'
import { useInlineRename } from '../../composables/ui/useInlineRename.js'
import { t } from '../../i18n/index.js'

const store = useAppStore()
const newName = ref('')
const newNameRef = ref<HTMLInputElement | null>(null)
const { editingId, editingName, setEditInputRef, startRename, confirmRename, cancelRename } = useInlineRename(store, 'renameAttribute')

// A2-007：管理列表仅展示未软删属性
const attributes = computed(() => store.selectableAttributes)

watch(() => store.modals.attribute, (open) => {
  if (open) nextTick(() => newNameRef.value?.focus())
})

function onClose() { store.modals.attribute = false }

function onAddAttr() {
  const name = newName.value.trim()
  if (!name) return
  const id = attrSlug(name) || gid()
  // A2-007：查重仅对未软删属性，允许与回收站同名重建
  const byId = store.attributeMap[id]
  if ((byId && !byId.deletedAt) || store.attributeByName[name]) {
    toast(t('attr.existsToast'), false); return
  }
  store.addAttribute({ id, name, type: 'boolean' })
  store.save()
  newName.value = ''
  toast(t('attr.addedToast'))
}

async function onDelete(id: string) {
  // A2-002：删除前确认；软删定义时会快照实体 attributes，恢复时可回写
  const attr = store.attributeMap[id]
  const name = attr?.name || id
  const ok = await showConfirm(t('modal.attribute.confirmDelete', { name }))
  if (!ok) return
  store.deleteAttribute(id)
  store.save()
  toast(t('modal.attribute.deleted'))
}
</script>
