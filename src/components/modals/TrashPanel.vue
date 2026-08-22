<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('settings.trash')" :class="{ open }" @click.self="emit('close')">
    <div class="modal modal-md">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.trash" class="sp-icon"></span>{{ t('settings.trash') }}</span>
        <button class="modal-close" @click="emit('close')" :aria-label="t('common.close')">&times;</button>
      </div>
      <!-- 批量操作条：常驻（全选/计数 + 清空回收站）；介于 head 与 body 之间需 flex-shrink:0 不挤压滚动区 -->
      <div v-if="trashCount > 0" class="trash-batch">
        <label class="trash-batch-all">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate="someSelected && !allSelected"
            @change="toggleAll"
          />
          <span>{{ allSelected ? t('deadlinks.deselectAll') : t('batch.selectAll') }}</span>
        </label>
        <span v-if="selectedCount > 0" class="trash-batch-count">{{ t('batch.selected', { n: selectedCount }) }}</span>
        <span class="trash-batch-actions">
          <button class="btn btn-ghost btn-xs text-danger" @click="onEmptyTrash">{{ t('modal.trash.emptyTrash') }}</button>
        </span>
      </div>
      <div class="modal-body trash-body">
        <div v-if="trashCount === 0" class="trash-empty">{{ t('modal.trash.empty') }}</div>
        <template v-else>
          <!-- 书签 -->
          <div v-if="ds.trashedBookmarks.length" class="trash-section">
            <div class="trash-section-title">{{ t('modal.trash.bmCount', { n: ds.trashedBookmarks.length }) }}</div>
            <div v-for="b in ds.trashedBookmarks" :key="b.id" class="trash-item" :class="{ 'trash-item-selected': isSelected('bookmark', b.id) }">
              <input
                type="checkbox"
                class="trash-item-check"
                :checked="isSelected('bookmark', b.id)"
                :aria-label="t('modal.trash.selectItem', { name: b.title || b.url })"
                @change="toggle('bookmark', b.id)"
              />
              <span class="trash-item-icon" aria-hidden="true" v-html="I.link"></span>
              <span class="trash-item-name">{{ b.title || b.url }}</span>
              <span class="trash-item-time">{{ formatTime(b.deletedAt) }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('bookmark', b.id)">{{ t('modal.trash.restore') }}</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('bookmark', b.id)">{{ t('common.delete') }}</button>
            </div>
          </div>
          <!-- 组 -->
          <div v-if="ds.trashedGroups.length" class="trash-section">
            <div class="trash-section-title">{{ t('modal.trash.groupCount', { n: ds.trashedGroups.length }) }}</div>
            <div v-for="g in ds.trashedGroups" :key="g.id" class="trash-item" :class="{ 'trash-item-selected': isSelected('group', g.id) }">
              <input
                type="checkbox"
                class="trash-item-check"
                :checked="isSelected('group', g.id)"
                :aria-label="t('modal.trash.selectItem', { name: g.name || t('common.unnamed') })"
                @change="toggle('group', g.id)"
              />
              <span class="trash-item-icon" aria-hidden="true" v-html="I.folder"></span>
              <span class="trash-item-name">{{ g.name || t('common.unnamed') }}</span>
              <span class="trash-item-time">{{ formatTime(g.deletedAt) }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('group', g.id)">{{ t('modal.trash.restore') }}</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('group', g.id)">{{ t('common.delete') }}</button>
            </div>
          </div>
          <!-- 分类 -->
          <div v-if="ds.trashedCategories.length" class="trash-section">
            <div class="trash-section-title">{{ t('modal.trash.catCount', { n: ds.trashedCategories.length }) }}</div>
            <div v-for="c in ds.trashedCategories" :key="c.id" class="trash-item" :class="{ 'trash-item-selected': isSelected('category', c.id) }">
              <input
                type="checkbox"
                class="trash-item-check"
                :checked="isSelected('category', c.id)"
                :aria-label="t('modal.trash.selectItem', { name: c.name })"
                @change="toggle('category', c.id)"
              />
              <span class="trash-item-icon" aria-hidden="true" v-html="I.tag"></span>
              <span class="trash-item-name">{{ c.name }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('category', c.id)">{{ t('modal.trash.restore') }}</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('category', c.id)">{{ t('common.delete') }}</button>
            </div>
          </div>
          <!-- 自定义属性 -->
          <div v-if="ds.trashedAttributes.length" class="trash-section">
            <div class="trash-section-title">{{ t('modal.trash.attrCount', { n: ds.trashedAttributes.length }) }}</div>
            <div v-for="a in ds.trashedAttributes" :key="a.id" class="trash-item" :class="{ 'trash-item-selected': isSelected('attribute', a.id) }">
              <input
                type="checkbox"
                class="trash-item-check"
                :checked="isSelected('attribute', a.id)"
                :aria-label="t('modal.trash.selectItem', { name: a.name })"
                @change="toggle('attribute', a.id)"
              />
              <span class="trash-item-icon" aria-hidden="true" v-html="I.tag"></span>
              <span class="trash-item-name">{{ a.name }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('attribute', a.id)">{{ t('modal.trash.restore') }}</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('attribute', a.id)">{{ t('common.delete') }}</button>
            </div>
          </div>
        </template>
      </div>
      <div class="modal-foot" v-if="trashCount > 0">
        <button class="btn btn-secondary" :disabled="selectedCount === 0" @click="batchRestore">{{ t('modal.trash.batchRestore') }}</button>
        <button class="btn btn-danger" :disabled="selectedCount === 0" @click="batchPermanent">{{ t('modal.trash.batchDelete') }}</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { I } from '../../config/icons.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { formatTime } from './formatTimeEpoch.js'
import { restoreItems, permanentDeleteItems, trashKey, splitTrashKey, type TrashType } from './trashOps.js'
import { t, tN } from '../../i18n/index.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const ds = useDataStore()
const appStore = useAppStore()

const trashCount = computed(() => ds.trashCount)

// ── 多选状态：key 为 `type:id`，与 4 个 trashed getter 求交集过滤脏 key ──
const selected = ref<Set<string>>(new Set())
const isSelected = (t: TrashType, id: string) => selected.value.has(trashKey(t, id))
function toggle(t: TrashType, id: string) {
  const k = trashKey(t, id)
  if (selected.value.has(k)) selected.value.delete(k)
  else selected.value.add(k)
}

const allTrashKeys = computed(() => {
  const s = new Set<string>()
  for (const b of ds.trashedBookmarks) s.add(trashKey('bookmark', b.id))
  for (const g of ds.trashedGroups) s.add(trashKey('group', g.id))
  for (const c of ds.trashedCategories) s.add(trashKey('category', c.id))
  for (const a of ds.trashedAttributes) s.add(trashKey('attribute', a.id))
  return s
})
/** 有效选中：单行操作/清空回收站/外部同步后残留的 key 不计入 */
const effectiveKeys = computed(() => [...selected.value].filter(k => allTrashKeys.value.has(k)))
const selectedCount = computed(() => effectiveKeys.value.length)
const someSelected = computed(() => selectedCount.value > 0)
const allSelected = computed(() => selectedCount.value > 0 && selectedCount.value === allTrashKeys.value.size)
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(allTrashKeys.value)
}

// ── 单条操作 ──
function restore(type: TrashType, id: string) {
  restoreItems(ds, [{ type, id }])
  appStore.save()
  toast(t('deadlinks.restored'))
  selected.value.delete(trashKey(type, id))
}

async function permanent(type: TrashType, id: string) {
  const ok = await showConfirm(t('modal.trash.confirmPermanent'))
  if (!ok) return
  permanentDeleteItems(ds, [{ type, id }])
  appStore.save()
  toast(t('modal.trash.permanentToast'))
  selected.value.delete(trashKey(type, id))
}

// ── 批量操作 ──
function batchRestore() {
  const items = effectiveKeys.value.map(splitTrashKey)
  if (!items.length) return
  restoreItems(ds, items)
  appStore.save()
  toast(tN('modal.trash.restoredCount', items.length))
  selected.value.clear()
}

async function batchPermanent() {
  const items = effectiveKeys.value.map(splitTrashKey)
  if (!items.length) return
  const ok = await showConfirm(t('modal.trash.confirmBatchPermanent', { n: items.length }))
  if (!ok) return
  permanentDeleteItems(ds, items)
  appStore.save()
  toast(tN('modal.trash.permanentCount', items.length))
  selected.value.clear()
}

async function onEmptyTrash() {
  const ok = await showConfirm(t('modal.trash.confirmEmpty'))
  if (!ok) return
  ds.emptyTrash()
  appStore.save()
  toast(t('modal.trash.emptiedToast'))
  selected.value.clear()
  emit('close')
}

// 面板常驻挂载，open 只切 class；关闭时重置选中，避免残留跨次打开
watch(() => props.open, v => { if (!v) selected.value.clear() })
</script>
