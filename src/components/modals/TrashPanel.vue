<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="回收站" :class="{ open }" @click.self="emit('close')">
    <div class="modal modal-md">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.trash" class="sp-icon"></span>回收站</span>
        <button class="modal-close" @click="emit('close')" aria-label="关闭">&times;</button>
      </div>
      <!-- 批量操作条：常驻，0 选中时按钮禁用；介于 head 与 body 之间需 flex-shrink:0 不挤压滚动区 -->
      <div v-if="trashCount > 0" class="trash-batch">
        <label class="trash-batch-all">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate="someSelected && !allSelected"
            @change="toggleAll"
          />
          <span>{{ allSelected ? '取消全选' : '全选' }}</span>
        </label>
        <span v-if="selectedCount > 0" class="trash-batch-count">已选 {{ selectedCount }} 项</span>
        <span class="trash-batch-actions">
          <button class="btn btn-ghost btn-xs" :disabled="selectedCount === 0" @click="batchRestore">批量恢复</button>
          <button class="btn btn-ghost btn-xs text-danger" :disabled="selectedCount === 0" @click="batchPermanent">批量删除</button>
        </span>
      </div>
      <div class="modal-body trash-body">
        <div v-if="trashCount === 0" class="trash-empty">回收站为空</div>
        <template v-else>
          <!-- 书签 -->
          <div v-if="ds.trashedBookmarks.length" class="trash-section">
            <div class="trash-section-title">书签 ({{ ds.trashedBookmarks.length }})</div>
            <div v-for="b in ds.trashedBookmarks" :key="b.id" class="trash-item" :class="{ 'trash-item-selected': isSelected('bookmark', b.id) }">
              <input
                type="checkbox"
                class="trash-item-check"
                :checked="isSelected('bookmark', b.id)"
                :aria-label="`选中 ${b.title || b.url}`"
                @change="toggle('bookmark', b.id)"
              />
              <span class="trash-item-icon" aria-hidden="true" v-html="I.link"></span>
              <span class="trash-item-name">{{ b.title || b.url }}</span>
              <span class="trash-item-time">{{ formatTime(b.deletedAt) }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('bookmark', b.id)">恢复</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('bookmark', b.id)">删除</button>
            </div>
          </div>
          <!-- 组 -->
          <div v-if="ds.trashedGroups.length" class="trash-section">
            <div class="trash-section-title">组 ({{ ds.trashedGroups.length }})</div>
            <div v-for="g in ds.trashedGroups" :key="g.id" class="trash-item" :class="{ 'trash-item-selected': isSelected('group', g.id) }">
              <input
                type="checkbox"
                class="trash-item-check"
                :checked="isSelected('group', g.id)"
                :aria-label="`选中 ${g.name || '未命名'}`"
                @change="toggle('group', g.id)"
              />
              <span class="trash-item-icon" aria-hidden="true" v-html="I.folder"></span>
              <span class="trash-item-name">{{ g.name || '未命名' }}</span>
              <span class="trash-item-time">{{ formatTime(g.deletedAt) }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('group', g.id)">恢复</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('group', g.id)">删除</button>
            </div>
          </div>
          <!-- 分类 -->
          <div v-if="ds.trashedCategories.length" class="trash-section">
            <div class="trash-section-title">分类 ({{ ds.trashedCategories.length }})</div>
            <div v-for="c in ds.trashedCategories" :key="c.id" class="trash-item" :class="{ 'trash-item-selected': isSelected('category', c.id) }">
              <input
                type="checkbox"
                class="trash-item-check"
                :checked="isSelected('category', c.id)"
                :aria-label="`选中 ${c.name}`"
                @change="toggle('category', c.id)"
              />
              <span class="trash-item-icon" aria-hidden="true" v-html="I.tag"></span>
              <span class="trash-item-name">{{ c.name }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('category', c.id)">恢复</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('category', c.id)">删除</button>
            </div>
          </div>
          <!-- 自定义属性 -->
          <div v-if="ds.trashedAttributes.length" class="trash-section">
            <div class="trash-section-title">属性 ({{ ds.trashedAttributes.length }})</div>
            <div v-for="a in ds.trashedAttributes" :key="a.id" class="trash-item" :class="{ 'trash-item-selected': isSelected('attribute', a.id) }">
              <input
                type="checkbox"
                class="trash-item-check"
                :checked="isSelected('attribute', a.id)"
                :aria-label="`选中 ${a.name}`"
                @change="toggle('attribute', a.id)"
              />
              <span class="trash-item-icon" aria-hidden="true" v-html="I.tag"></span>
              <span class="trash-item-name">{{ a.name }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('attribute', a.id)">恢复</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('attribute', a.id)">删除</button>
            </div>
          </div>
        </template>
      </div>
      <div class="modal-foot" v-if="trashCount > 0">
        <button class="btn btn-secondary" @click="emit('close')">关闭</button>
        <button class="btn btn-danger" @click="onEmptyTrash">清空回收站</button>
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
  toast('已恢复')
  selected.value.delete(trashKey(type, id))
}

async function permanent(type: TrashType, id: string) {
  const ok = await showConfirm('确定永久删除？此操作无法恢复。')
  if (!ok) return
  permanentDeleteItems(ds, [{ type, id }])
  appStore.save()
  toast('已永久删除')
  selected.value.delete(trashKey(type, id))
}

// ── 批量操作 ──
function batchRestore() {
  const items = effectiveKeys.value.map(splitTrashKey)
  if (!items.length) return
  restoreItems(ds, items)
  appStore.save()
  toast(`已恢复 ${items.length} 项`)
  selected.value.clear()
}

async function batchPermanent() {
  const items = effectiveKeys.value.map(splitTrashKey)
  if (!items.length) return
  const ok = await showConfirm(`确定永久删除选中的 ${items.length} 项？此操作无法恢复。`)
  if (!ok) return
  permanentDeleteItems(ds, items)
  appStore.save()
  toast(`已永久删除 ${items.length} 项`)
  selected.value.clear()
}

async function onEmptyTrash() {
  const ok = await showConfirm('确定清空回收站？所有内容将被永久删除，无法恢复。')
  if (!ok) return
  ds.emptyTrash()
  appStore.save()
  toast('回收站已清空')
  selected.value.clear()
  emit('close')
}

// 面板常驻挂载，open 只切 class；关闭时重置选中，避免残留跨次打开
watch(() => props.open, v => { if (!v) selected.value.clear() })
</script>
