<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="回收站" :class="{ open }" @click.self="emit('close')">
    <div class="modal modal-md">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.trash" class="sp-icon"></span>回收站</span>
        <button class="modal-close" @click="emit('close')" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body trash-body">
        <div v-if="trashCount === 0" class="trash-empty">回收站为空</div>
        <template v-else>
          <!-- 书签 -->
          <div v-if="ds.trashedBookmarks.length" class="trash-section">
            <div class="trash-section-title">书签 ({{ ds.trashedBookmarks.length }})</div>
            <div v-for="b in ds.trashedBookmarks" :key="b.id" class="trash-item">
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
            <div v-for="g in ds.trashedGroups" :key="g.id" class="trash-item">
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
            <div v-for="c in ds.trashedCategories" :key="c.id" class="trash-item">
              <span class="trash-item-icon" aria-hidden="true" v-html="I.tag"></span>
              <span class="trash-item-name">{{ c.name }}</span>
              <button class="btn btn-ghost btn-xs" @click="restore('category', c.id)">恢复</button>
              <button class="btn btn-ghost btn-xs text-danger" @click="permanent('category', c.id)">删除</button>
            </div>
          </div>
          <!-- 自定义属性 -->
          <div v-if="ds.trashedAttributes.length" class="trash-section">
            <div class="trash-section-title">属性 ({{ ds.trashedAttributes.length }})</div>
            <div v-for="a in ds.trashedAttributes" :key="a.id" class="trash-item">
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
import { computed } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { I } from '../../config/icons.js'
import { toast, showConfirm } from '../../lib/toast.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const ds = useDataStore()
const appStore = useAppStore()

const trashCount = computed(() => ds.trashCount)

function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function restore(type: string, id: string) {
  if (type === 'bookmark') ds.restoreBookmark(id)
  else if (type === 'group') ds.restoreGroup(id)
  else if (type === 'category') ds.restoreCategory(id)
  else if (type === 'attribute') ds.restoreAttribute(id)
  appStore.save()
  toast('已恢复')
}

async function permanent(type: string, id: string) {
  const ok = await showConfirm('确定永久删除？此操作无法恢复。')
  if (!ok) return
  if (type === 'bookmark') ds.permanentDeleteBookmark(id)
  else if (type === 'group') ds.permanentDeleteGroup(id)
  else if (type === 'category') ds.permanentDeleteCategory(id)
  else if (type === 'attribute') ds.permanentDeleteAttribute(id)
  appStore.save()
  toast('已永久删除')
}

async function onEmptyTrash() {
  const ok = await showConfirm('确定清空回收站？所有内容将被永久删除，无法恢复。')
  if (!ok) return
  ds.emptyTrash()
  appStore.save()
  toast('回收站已清空')
  emit('close')
}
</script>
