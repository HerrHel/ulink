<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="分类管理" id="catModal" :class="{ open: store.modals.category }" @click.self="onClose">
    <div class="modal">
      <div class="modal-head">
        <h2>{{ isVault ? '管理分类（私密）' : '管理分类' }}</h2>
        <button v-if="!isVault" class="btn btn-sm btn-ghost" data-testid="btnVaultEntry" style="margin-right:auto" @click="onVaultEntry">
          <span aria-hidden="true" v-html="I.lock"></span> 私密空间
        </button>
        <button class="modal-close" @click="onClose" title="关闭" aria-label="关闭" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <div class="flex-center gap-2 mb-3">
          <input type="text" class="form-input flex-1" v-model="newName" ref="newNameRef" placeholder="新分类名称" aria-label="新分类名称" @keydown.enter="onAddCat">
          <button class="btn btn-primary btn-sm" @click="onAddCat">添加</button>
        </div>
        <div class="cat-sort-list" ref="catListRef">
          <div class="cat-list-item cat-no-drag">
            <span class="flex-1">{{ uncategorizedCat.name }}</span>
          </div>
          <div v-for="cat in sortableList" :key="cat.id" class="cat-list-item" :data-cat-id="cat.id">
            <span class="cat-drag-handle" aria-hidden="true" v-html="I.grip"></span>
            <template v-if="editingId === cat.id">
              <input class="form-input flex-1 form-input-sm" v-model="editingName" aria-label="分类名称" @keydown.enter="confirmRename" @keydown.escape="cancelRename" :ref="setEditInputRef">
              <button class="btn btn-primary btn-sm" @click="confirmRename" title="确认重命名" v-html="I.listCheck"></button>
            </template>
            <template v-else>
              <span class="flex-1">{{ cat.name }}</span>
              <button class="btn-xs icon-xs" @click="startRename(cat)" title="编辑" v-html="I.edit"></button>
              <button class="btn-xs btn-danger icon-xs" @click="onDelete(cat.id)" title="删除" v-html="I.trash"></button>
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
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useVaultStore } from '../../stores/vault.js'
import { addNewCategory } from '../../utils.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { I } from '../../config/icons.js'
import { useInlineRename } from '../../composables/ui/useInlineRename.js'
import { useMobileDragReorder } from '../../composables/interaction/useMobileDragReorder.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Category } from '../../types.js'

const store = useAppStore()
const dataStore = useDataStore()
const uiStore = useUIStore()
const vaultStore = useVaultStore()
const newName = ref('')
const newNameRef = ref<HTMLInputElement | null>(null)
const { editingId, editingName, setEditInputRef, startRename, confirmRename, cancelRename } = useInlineRename(store, 'renameCategory')
const catListRef = ref<HTMLElement | null>(null)

// 当前是否在私密空间数据集（决定标题与"移入私密"按钮/入口可见性）
const isVault = computed(() => uiStore.curSpace === 'vault')

const uncategorizedCat = computed(() => dataStore.categoryMap[CAT_UNCATEGORIZED] || { id: CAT_UNCATEGORIZED, name: '未分类' })

const sortableList = ref<Category[]>([])

watch(() => store.modals.category, (open) => {
  if (open) nextTick(() => newNameRef.value?.focus())
})

watch(() => dataStore.selectableCategories, (val) => {
  sortableList.value = val.filter(c => c.id !== CAT_UNCATEGORIZED).map(c => ({ ...c }))
}, { immediate: true, deep: true })

// ── 拖拽排序：复用移动端通用实现 ──
useMobileDragReorder(catListRef, sortableList, {
  enabled: computed(() => store.modals.category),
  handleSelector: '.cat-drag-handle',
  itemSelector: '.cat-list-item[data-cat-id]',
  placeholderClass: 'cat-list-item cat-placeholder',
  draggingClass: 'cat-dragging',
  // modal 带 transform 进出场动画 + overflow:hidden，fixed 被拖元素会被裁切 → 移到 body 跟手
  portalToBody: true,
  onReorder: (from, to) => {
    const moved = sortableList.value[from]
    if (!moved) return
    const arr = sortableList.value.slice()
    arr.splice(from, 1)
    const toIdx = to > from ? to - 1 : to
    arr.splice(toIdx, 0, moved)
    sortableList.value = arr

    const special = dataStore.categories.filter(c => c.id === CAT_ALL || c.id === CAT_UNCATEGORIZED)
    // B-11：写 order/updatedAt + dirty/track，保证跨设备 pull 能应用顺序
    dataStore.reorderCategories([...special, ...arr])
    store.debouncedSave()
    toast('分类顺序已更新')
  }
})

function onClose() { store.modals.category = false }

/** 私密空间入口：未启用保险柜 → 弹设置；已启用未解锁 → 弹解锁（解锁成功后 App.vue 接 switchSpace，进私密后自动关本弹窗） */
function onVaultEntry() {
  if (!vaultStore.isVaultEnabled) {
    uiStore.modals.vaultSetup = true
    return
  }
  // 关分类弹窗避免进私密后还有遮挡；解锁成功后 App.vue 切空间
  store.modals.category = false
  uiStore.modals.vaultUnlock = true
}

function onAddCat() {
  if (addNewCategory(newName.value, store)) newName.value = ''
}

function onDelete(id: string) {
  const cat = dataStore.categoryMap[id]
  const catName = cat?.name || '此分类'
  const bmCount = dataStore.bookmarks.filter(b => b.categoryId === id).length
  const msg = bmCount > 0
    ? `删除「${catName}」后，其中 ${bmCount} 个书签将移至"未分类"，确定删除吗？`
    : `确定删除「${catName}」吗？`
  showConfirm(msg).then(ok => {
    if (!ok) return
    store.deleteCategory(id)
    store.save()
    toast('分类已删除')
  })
}
</script>


