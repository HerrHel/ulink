<template>
  <Transition name="staging-dock-trans">
    <aside
      v-if="entries.length > 0"
      id="stagingDock"
      class="staging-dock"
      role="region"
      :aria-label="t('staging.shelf')"
    >
      <div class="staging-dock-inner">
        <!-- Dock Lead: Title & Counter -->
        <div class="staging-dock-lead" :title="t('staging.shelf')">
          <span class="dock-lead-icon" aria-hidden="true" v-html="bookmarkIcon"></span>
          <span class="dock-lead-title">{{ t('staging.title') }}</span>
          <span class="dock-count-badge">{{ entries.length }}</span>
        </div>

        <div class="staging-dock-divider" aria-hidden="true"></div>

        <!-- Micro-Capsules Shelf (Horizontal scroll) -->
        <div
          ref="shelfRef"
          class="staging-dock-shelf"
          @wheel.passive="onShelfWheel"
        >
          <div
            v-for="entry in entries"
            :key="entry.rawId"
            class="staging-capsule detail-card-wrap"
            :class="{ 'is-group': entry.isGroup }"
            :data-bm-id="entry.rawId"
            :data-didx="entry.realIdx"
            draggable="true"
            @click="handleCapsuleClick(entry)"
          >
            <!-- Favicon / Group Folder -->
            <div class="capsule-icon-wrap" aria-hidden="true">
              <span v-if="entry.isGroup" class="capsule-group-icon" v-html="folderIcon"></span>
              <BrandLogo v-else-if="isOfficialBrand(entry.data as Bookmark)" :size="16" />
              <template v-else>
                <img
                  v-if="!imgErrors[entry.rawId]"
                  :src="getFaviconUrl(entry.data as Bookmark)"
                  alt=""
                  class="capsule-img"
                  loading="lazy"
                  @error="onImgError(entry.rawId)"
                />
                <span v-else class="capsule-initial">{{ getInitials(entry.name) }}</span>
              </template>
            </div>

            <!-- Title & Domain -->
            <div class="capsule-text-wrap" :title="entry.name">
              <span class="capsule-name">{{ displayText(entry.name) }}</span>
              <span v-if="entry.domain" class="capsule-domain">{{ entry.domain }}</span>
            </div>

            <!-- Quick Actions -->
            <div class="capsule-actions" @click.stop>
              <!-- Open link in new tab -->
              <button
                v-if="!entry.isGroup && (entry.data as Bookmark).url"
                class="capsule-action-btn"
                :title="t('common.open')"
                :aria-label="t('common.open')"
                @click.stop="openBookmarkItem(entry.data as Bookmark)"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
              <!-- Remove from staging shelf -->
              <button
                class="capsule-action-btn remove"
                :title="t('common.close')"
                :aria-label="t('common.close')"
                @click.stop="removeEntry(entry.rawId)"
              >
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="staging-dock-divider" aria-hidden="true"></div>

        <!-- Dock Tail Batch Actions -->
        <div class="staging-dock-tail">
          <button
            v-if="hasBookmarks"
            class="dock-tail-btn"
            @click="openAllBookmarks"
            :title="t('staging.openAll')"
          >
            <span>{{ t('staging.openAll') }}</span>
          </button>
          <button
            class="dock-tail-btn is-clear"
            @click="clearAll"
            :title="t('staging.clearAll')"
          >
            <span>{{ t('staging.clearAll') }}</span>
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { buildDetailCards, type DetailEntry } from './buildDetailCards.js'
import { domain, displayText, favicon, faviconInitials } from '../../utils.js'
import { I } from '../../config/icons.js'
import BrandLogo from '../ui/BrandLogo.vue'
import { useI18n } from '../../i18n/index.js'
import { openBookmark } from '../../composables/domain/useBookmark.js'
import { OFFICIAL_SITE_BM_ID } from '../../stores/dataActionsBookmarks.js'
import type { Bookmark } from '../../types.js'

const { t } = useI18n()
const ui = useUIStore()
const ds = useDataStore()

const shelfRef = ref<HTMLElement | null>(null)
const imgErrors = ref<Record<string, boolean>>({})

const bookmarkIcon = I.bookmark
const folderIcon = I.folder

const entries = computed<DetailEntry[]>(() =>
  buildDetailCards(ui.detailCards, ds.groupMap, ds.bookmarkMap, domain),
)

const hasBookmarks = computed(() =>
  entries.value.some((e) => !e.isGroup && !!(e.data as Bookmark).url),
)

function isOfficialBrand(bm: Bookmark): boolean {
  return (
    bm.id === OFFICIAL_SITE_BM_ID ||
    bm.icon === '/logo.svg' ||
    bm.icon === '/favicon.svg'
  )
}

function getFaviconUrl(bm: Bookmark): string {
  return favicon(bm.url, bm.icon)
}

function onImgError(rawId: string) {
  imgErrors.value[rawId] = true
}

function getInitials(name: string): string {
  return faviconInitials(displayText(name)) || displayText(name).charAt(0) || '?'
}

function handleCapsuleClick(entry: DetailEntry) {
  if (entry.isGroup) {
    ui.focusedGroupId = entry.data.id
  } else {
    openBookmarkItem(entry.data as Bookmark)
  }
}

function openBookmarkItem(bm: Bookmark) {
  if (bm.url) {
    openBookmark(bm)
  }
}

function removeEntry(rawId: string) {
  const idx = ui.detailCards.indexOf(rawId)
  if (idx > -1) {
    ui.detailCards.splice(idx, 1)
  }
}

function openAllBookmarks() {
  for (const entry of entries.value) {
    if (!entry.isGroup && (entry.data as Bookmark).url) {
      openBookmark(entry.data as Bookmark)
    }
  }
}

function clearAll() {
  ui.detailCards.splice(0)
}

function onShelfWheel(e: WheelEvent) {
  const shelf = shelfRef.value
  if (shelf && shelf.scrollWidth > shelf.clientWidth) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      shelf.scrollLeft += e.deltaY
    }
  }
}
</script>

<style scoped>
.staging-dock {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 45;
  max-width: min(840px, calc(100% - 32px));
  pointer-events: auto;
}

.staging-dock-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 8px 0 12px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: 9999px;
  box-shadow: 0 10px 30px -4px rgba(44, 40, 36, 0.12), 0 2px 8px -2px rgba(44, 40, 36, 0.05);
  box-sizing: border-box;
  user-select: none;
}

.staging-dock-lead {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  cursor: default;
}

.dock-lead-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  color: var(--accent);
}

.dock-lead-icon :deep(svg) {
  width: 14px;
  height: 14px;
}

.dock-lead-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.2px;
}

.dock-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: var(--accent-light);
  color: var(--accent);
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
  box-sizing: border-box;
}

.staging-dock-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  flex-shrink: 0;
}

.staging-dock-shelf {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 540px;
  padding: 2px 0;
  scrollbar-width: none;
  scroll-behavior: smooth;
}

.staging-dock-shelf::-webkit-scrollbar {
  display: none;
}

.staging-capsule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 6px 0 8px;
  background: var(--bg);
  border: 1px solid var(--border-light);
  border-radius: 9999px;
  cursor: grab;
  transition: all 0.14s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
  max-width: 200px;
  box-sizing: border-box;
}

.staging-capsule:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(44, 40, 36, 0.05);
}

.staging-capsule:active {
  cursor: grabbing;
}

.staging-capsule.detail-drag-over {
  border-color: var(--accent);
  background: var(--accent-light);
  transform: scale(1.02);
}

.capsule-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 3px;
  overflow: hidden;
}

.capsule-img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.capsule-group-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.capsule-group-icon :deep(svg) {
  width: 14px;
  height: 14px;
}

.capsule-initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 10px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-light);
  border-radius: 3px;
  text-transform: uppercase;
}

.capsule-text-wrap {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.capsule-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px;
}

.capsule-domain {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70px;
}

.capsule-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
  flex-shrink: 0;
}

.capsule-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  transition: all 0.12s ease;
}

.capsule-action-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.capsule-action-btn.remove:hover {
  background: var(--rose-light, #fee2e2);
  color: var(--rose, #e11d48);
}

.staging-dock-tail {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.dock-tail-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 8px;
  font-size: 11.5px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: var(--text);
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.dock-tail-btn:hover {
  background: var(--surface-hover);
  color: var(--accent);
}

.dock-tail-btn.is-clear {
  color: var(--text-muted);
}

.dock-tail-btn.is-clear:hover {
  color: var(--rose, #e11d48);
  background: var(--rose-light, #fee2e2);
}

/* 动效 */
.staging-dock-trans-enter-active,
.staging-dock-trans-leave-active {
  transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.staging-dock-trans-enter-from,
.staging-dock-trans-leave-to {
  opacity: 0;
  transform: translate(-50%, 18px) scale(0.95);
}

@media (max-width: 640px) {
  .staging-dock {
    bottom: 14px;
    max-width: calc(100% - 20px);
  }

  .staging-dock-shelf {
    max-width: 220px;
  }

  .capsule-domain {
    display: none;
  }
}
</style>
