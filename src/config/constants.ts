import type { AppData } from '../types.js'
import { WELCOME_NOTES, TIPS_NOTES } from './welcome-data.js'

export const STORAGE_KEY = 'linkvault_v2'
export const CAT_ALL = 'all'
export const CAT_UNCATEGORIZED = 'uncategorized'
export const ATTR_IS_GROUP = 'is-group'
export const MAX_SUGGESTIONS = 8
export const TOAST_FADE_MS = 2200
export const TOAST_REMOVE_MS = 2600
export const PAYLOAD_KEY = 'application/x-linkvault'
export const DRAG_SRC_DETAIL = '__detail__'
export const UI_STATE_KEY = 'lv_uiState'
export const MAX_UNDO = 20
export const UNDO_WINDOW = 500
export const MAX_UNDO_BYTES = 512 * 1024

export const ACTIONS: Record<string, string> = {
  VISIT: 'visit',
  EDIT: 'edit',
  DELETE: 'delete',
  MOVE_TO_CAT: 'moveToCat',
  SHARE_GROUP: 'shareGroup',
  ADD_BOOKMARK: 'addbookmark',
  ADD_GROUP: 'addgroup',
  ADD_CAT: 'addcat',
  MULTI_SELECT: 'multiSelect',
  HISTORY: 'history',
  RENAME_ATTR: 'renameAttr',
  DETAIL: 'detail',
}

export const DEFAULTS: AppData = {
  categories: [
    { id: 'all', name: '全部', icon: 'grid', color: '#122E8A', order: 0 },
    { id: 'uncategorized', name: '未分类', icon: 'bookmark', color: '#6E6860', order: 1 },
    { id: 'email', name: '邮箱', icon: 'mail', color: '#e11d48', order: 2 },
    { id: 'tools', name: '工具', icon: 'tool', color: '#d97706', order: 3 },
    { id: 'ai', name: 'AI', icon: 'ai-icon', color: '#8b5cf6', order: 4 },
    { id: 'social', name: '社交', icon: 'social-icon', color: '#1d9bf0', order: 5 },
    { id: 'game', name: '游戏平台', icon: 'game-icon', color: '#16a34a', order: 6 }
  ],
  bookmarks: [
    { id: 'b1', title: 'GitHub', url: 'https://github.com', username: '', password: '', notes: '代码托管平台', icon: '', categoryId: 'tools', parentId: null, order: 0, useCount: 15, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000 },
    { id: 'b2', title: 'QQ邮箱', url: 'https://mail.qq.com', username: '@qq.com', password: 'MTIz', notes: '', icon: '', categoryId: 'email', parentId: null, order: 1, useCount: 8, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 172800000, updatedAt: Date.now() - 172800000 },
    { id: 'b3', title: 'DeepSeek', url: 'https://www.deepseek.com/', username: '', password: '', notes: 'API key:', icon: '', categoryId: 'ai', parentId: null, order: 2, useCount: 5, attributes: { 'ai': true }, isExpanded: false, createdAt: Date.now() - 40000000, updatedAt: Date.now() - 40000000 },
    { id: 'sb1', title: '开始对话', url: 'https://chat.deepseek.com/', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 0, useCount: 3, attributes: { 'ai': true }, isExpanded: false, createdAt: Date.now() - 30000000, updatedAt: Date.now() - 30000000 },
    { id: 'sb2', title: 'API开发平台', url: 'https://platform.deepseek.com/usage', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 1, useCount: 2, attributes: { 'ai': true }, isExpanded: false, createdAt: Date.now() - 20000000, updatedAt: Date.now() - 20000000 },
    { id: 'b4', title: '抖音', url: 'https://www.douyin.com', username: '', password: '', notes: '短视频平台', icon: '', categoryId: 'social', parentId: null, order: 3, useCount: 0, attributes: {}, isExpanded: false, createdAt: Date.now() - 345600000, updatedAt: Date.now() - 345600000 },
    { id: 'b5', title: 'Steam', url: 'https://store.steampowered.com', username: '', password: '', notes: '游戏平台', icon: '', categoryId: 'game', parentId: null, order: 4, useCount: 0, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 100000, updatedAt: Date.now() - 100000 }
  ],
  customAttributes: [
    { id: 'requires-login', name: '需要登录', type: 'boolean' },
    { id: 'ai', name: 'Ai', type: 'boolean' },
    { id: 'is-group', name: '组', type: 'boolean' }
  ],
  siblingGroups: [
    {
      id: 'sg_welcome', name: '欢迎使用', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: { 'is-group': true },
      bookmarkIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
      notes: WELCOME_NOTES,
      updatedAt: 0, useCount: 0,
    },
    {
      id: 'sg_tips', name: '使用技巧', categoryId: 'uncategorized', icon: '', order: 1, isExpanded: false,
      attributes: { 'is-group': true },
      bookmarkIds: ['b3', 'b4'],
      notes: TIPS_NOTES,
      updatedAt: 0, useCount: 0,
    }
  ],
  _schemaVersion: 2,
  _dataVersion: 2, // 兼容旧读者；迁移门控以 _schemaVersion 为准
}
