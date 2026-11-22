/**
 * useFileDropImport — 从系统拖入文件时的全局分流
 *
 * - 拖到 AI 页或右侧 AI 栏：由对应组件作为附件引用（这里不处理）；
 * - AI 页的其余位置（如顶栏）：同样作为附件引用；
 * - 主界面其余位置：拖入 .html / .json / .csv 时显示投放提示，松手后确认导入；
 * - 笔记编辑器：图片由编辑器自己插入，其余可导入文件仍走导入；
 * - 分享只读页：拒收，避免浏览器直接打开文件、离开网站。
 *
 * 站内卡片拖动（带 PAYLOAD_KEY）不含 Files 类型，不会进入这里的分支。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'
import { attachFilesToAi } from '../../lib/ai/attachFiles.js'
import { importData } from '../domain/useDataIO.js'

/** AI 页与右侧 AI 栏：组件自带文件拖放处理 */
export const AI_DROP_ZONES = '#aiWorkspace, .ai-workspace, #detailPanel'
/** 笔记编辑器：图片拖入由 TipTap 插入 */
export const EDITOR_DROP_ZONE = '.ProseMirror'

export type FileDropMode = 'ai-zone' | 'editor' | 'ai' | 'import' | 'reject'

/** 是否为从系统拖入的文件（站内卡片拖动不含 Files） */
export function isFileDrag(dt: DataTransfer | null | undefined): boolean {
  const types = dt?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

/** 可导入的书签文件：浏览器导出的 HTML、与链 / Raindrop 的 JSON、CSV */
export function isImportableFile(name: string): boolean {
  return /\.(html?|json|csv)$/i.test(name)
}

/** 按落点与当前视图决定文件拖放的去向 */
export function resolveFileDropMode(
  target: EventTarget | null,
  state: { shareMode: boolean; activeView: string },
): FileDropMode {
  if (state.shareMode) return 'reject'
  const el = target instanceof Element ? target : null
  if (el?.closest(AI_DROP_ZONES)) return 'ai-zone'
  if (el?.closest(EDITOR_DROP_ZONE)) return 'editor'
  if (state.activeView === 'ai') return 'ai'
  return 'import'
}

/** 导入拖入的文件：只取第一个可导入文件，确认后按合并模式导入 */
export async function importDroppedFiles(files: File[]): Promise<boolean> {
  const importable = files.filter((f) => isImportableFile(f.name))
  if (!importable.length) {
    toast(t('msg.dropImportUnsupported'), false)
    return false
  }
  const file = importable[0]
  const msg = files.length > 1
    ? t('msg.dropImportConfirmMulti', { name: file.name })
    : t('msg.dropImportConfirm', { name: file.name })
  const ok = await showConfirm(msg)
  if (!ok) return false
  importData(file)
  return true
}

export function useFileDropImport() {
  const ui = useUIStore()
  /** 投放提示：null 为隐藏 */
  const overlayMode = ref<'ai' | 'import' | null>(null)
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function hideOverlay() {
    overlayMode.value = null
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  }

  /** dragover 会在拖动期间持续触发；停止触发（拖出窗口、按 Esc）后自动隐藏提示 */
  function keepOverlay(mode: 'ai' | 'import') {
    overlayMode.value = mode
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(hideOverlay, 250)
  }

  function currentMode(e: DragEvent): FileDropMode {
    return resolveFileDropMode(e.target, { shareMode: !!ui.shareMode, activeView: ui.activeView })
  }

  function onDragOver(e: DragEvent) {
    if (!isFileDrag(e.dataTransfer)) return
    const mode = currentMode(e)
    if (mode === 'ai-zone' || mode === 'editor') { hideOverlay(); return }
    // 主动接管，避免浏览器把文件当网页打开、离开网站
    e.preventDefault()
    if (mode === 'reject') {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
      return
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    keepOverlay(mode)
  }

  function onDrop(e: DragEvent) {
    if (!isFileDrag(e.dataTransfer)) return
    hideOverlay()
    const mode = currentMode(e)
    if (mode === 'ai-zone') return
    // 编辑器已处理（插入图片）时不再重复处理
    if (mode === 'editor' && e.defaultPrevented) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files || [])
    if (!files.length || mode === 'reject') return
    if (mode === 'ai') { void attachFilesToAi(files); return }
    if (mode === 'editor' && !files.some((f) => isImportableFile(f.name))) return
    void importDroppedFiles(files)
  }

  onMounted(() => {
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', hideOverlay)
  })
  onUnmounted(() => {
    document.removeEventListener('dragover', onDragOver)
    document.removeEventListener('drop', onDrop)
    window.removeEventListener('dragend', hideOverlay)
    hideOverlay()
  })

  return { overlayMode, onDragOver, onDrop }
}
