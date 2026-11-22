/**
 * attachFiles.ts — 把用户拖入 / 选择 / 粘贴的文件统一挂到 AI 对话附件
 *
 * AI 页（AiWorkspace）、右侧 AI 栏（DetailPanel / ChatInputDock）共用同一入口，
 * 保证大小上限、失败提示与成功提示在各处一致。
 */
import { useUIStore } from '../../stores/ui.js'
import { toast } from '../toast.js'
import { t } from '../../i18n/index.js'
import { processFileForAi } from './attachmentHelper.js'
import { MAX_VIDEO_BYTES } from './deepMediaUpload.js'

/** 单个附件大小上限：与视频直传上限一致（200MB） */
export const MAX_AI_ATTACH_BYTES = MAX_VIDEO_BYTES

/**
 * 逐个解析文件并挂到 AI 对话附件，返回成功添加的数量。
 * 超限或解析失败的文件给出提示后跳过，不影响其余文件。
 */
export async function attachFilesToAi(files: FileList | File[] | null | undefined): Promise<number> {
  if (!files || files.length === 0) return 0
  const ui = useUIStore()
  const list = Array.from(files)
  let added = 0
  let lastName = ''
  for (const f of list) {
    if (f.size > MAX_AI_ATTACH_BYTES) {
      toast(t('ai.fileTooLarge'), false)
      continue
    }
    try {
      const processed = await processFileForAi(f)
      ui.attachFileToAi(processed)
      added++
      lastName = f.name
    } catch (err: unknown) {
      toast((err as Error).message || t('ai.fileProcessFailed'), false)
    }
  }
  if (added === 1) toast(t('ai.fileAttachedToast', { name: lastName }))
  else if (added > 1) toast(t('ai.attachedFilesCount', { n: added }))
  return added
}
