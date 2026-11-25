/**
 * AI 对话「预判快捷回复」胶囊：预置文案走 i18n，点击后的意图判定中英文都认。
 *
 * 胶囊文字点下去既是「要发送的话」也是「要触发的动作」，所以判定不能只认当前语言的文案：
 *  - 历史会话里存的是生成当时的语言（切换语言后旧胶囊仍是另一种语言）；
 *  - 模型按系统提示词自己生成的胶囊（<!-- suggestions: [...] -->）措辞不固定，只能按关键词认。
 */
import { t } from '../../i18n/index.js'

/** 预置胶囊组：按产物类型给出 */
export type ReplyPreset = 'sites' | 'sitesShort' | 'action' | 'note'

/** 生成预置胶囊（随当前界面语言） */
export function presetReplies(kind: ReplyPreset): string[] {
  switch (kind) {
    case 'sites': return [t('ai.reply.saveAll'), t('ai.reply.narrow'), t('ai.reply.more')]
    case 'sitesShort': return [t('ai.reply.saveAll'), t('ai.reply.more')]
    case 'action': return [t('ai.reply.doIt'), t('ai.reply.another'), t('ai.reply.adjust')]
    case 'note': return [t('ai.reply.saveAsNote'), t('ai.reply.findSimilar')]
  }
}

/** 点击胶囊对应的本地动作；null = 当作普通提问发给 AI */
export type ReplyIntent = 'confirm' | 'saveAll' | 'saveAsNote' | null

const CONFIRM_ZH = ['执行', '确认', '合并', '应用', '方案A', '方案 A']
const CONFIRM_EN = /\b(go ahead|do it|execute|confirm|apply|merge|plan a)\b/i
const SAVE_ALL_EN = /\b(save|add|bookmark) (them )?all\b/i
const SAVE_NOTE_EN = /\bsave (it |this )?as (a )?(card )?note\b/i

export function classifyReply(reply: string): ReplyIntent {
  if (CONFIRM_ZH.some((w) => reply.includes(w)) || CONFIRM_EN.test(reply)) return 'confirm'
  if (reply.includes('加入收藏') || SAVE_ALL_EN.test(reply)) return 'saveAll'
  if (reply.includes('存为卡片笔记') || SAVE_NOTE_EN.test(reply)) return 'saveAsNote'
  return null
}
