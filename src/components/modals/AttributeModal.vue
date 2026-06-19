<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="属性管理" :class="{ open: store.attrModalOpen }" @click.self="onClose">
    <div class="modal">
      <div class="modal-head"><h2>管理属性</h2><button class="modal-close" @click="onClose" title="关闭" v-html="I.close"></button></div>
      <div class="modal-body">
        <div class="flex-center gap-2 mb-3">
          <input type="text" class="form-input flex-1" v-model="newName" ref="newNameRef" placeholder="属性名称" aria-label="属性名称" @keydown.enter="onAddAttr">
          <button class="btn btn-primary btn-sm" @click="onAddAttr">添加</button>
        </div>
        <div>
          <div v-for="attr in attributes" :key="attr.id" class="list-item">
            <template v-if="editingId === attr.id">
              <input class="form-input flex-1 form-input-sm" v-model="editingName" aria-label="属性名称" @keydown.enter="confirmRename" @keydown.escape="cancelRename" :ref="setEditInputRef">
              <button class="btn btn-primary btn-sm" @click="confirmRename" title="确认重命名">✓</button>
            </template>
            <template v-else>
              <span class="flex-1">{{ attr.name }}</span>
              <button class="btn-xs icon-xs" @click="startRename(attr)" title="编辑" v-html="I.edit"></button>
              <button class="btn-xs btn-danger icon-xs" @click="onDelete(attr.id)" title="删除" v-html="I.trash"></button>
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
import { toast } from '../../lib/toast.js'
import { I } from '../../config/icons.js'
import { useInlineRename } from '../../composables/ui/useInlineRename.js'

const store = useAppStore()
const newName = ref('')
const newNameRef = ref(null)
const { editingId, editingName, setEditInputRef, startRename, confirmRename, cancelRename } = useInlineRename(store, 'renameAttribute')

const attributes = computed(() => store.customAttributes)

watch(() => store.attrModalOpen, (open) => {
  if (open) nextTick(() => newNameRef.value?.focus())
})

function onClose() { store.attrModalOpen = false }

function onAddAttr() {
  const name = newName.value.trim()
  if (!name) return
  const id = name.replace(/[\s]+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || gid()
  if (store.customAttributes.find(a => a.id === id || a.name === name)) { toast('属性已存在', false); return }
  store.customAttributes.push({ id, name, type: 'boolean' })
  store.save()
  newName.value = ''
  toast('属性已添加')
}

function onDelete(id) {
  store.deleteAttribute(id)
  store.save()
  toast('属性已删除')
}
</script>
