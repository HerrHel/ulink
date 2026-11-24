import type { AppData } from '../types.js'
import { t, getLocale, type Locale } from '../i18n/index.js'
export { WELCOME_NOTES, getWelcomeNotes } from './welcome-data.js'
import { WELCOME_NOTES, getWelcomeNotes } from './welcome-data.js'

export const STORAGE_KEY = 'linkvault_v2'
/** 私密空间独立数据集的本地存储键（localStorage 同名字符串；IDB key 见 persist.ts） */
export const STORAGE_KEY_VAULT = 'linkvault_vault_v1'
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

// ── 网络请求超时（毫秒）──
/** 公开分享组 RPC 拉取超时。后端挂起时避免一直转圈（TECH_DEBT D2）。 */
export const SHARE_RPC_TIMEOUT_MS = 15000

// ── 外部服务 URL 常量已迁至 src/config/urls.ts ──
// 刻意独立成无依赖模块，避免 constants.ts（DEFAULTS 引用 welcome-data 的 WELCOME_NOTES）
// 与 welcome-data.ts（引入 favicon 基址）形成循环依赖，导致 DEFAULTS 初始化取到 undefined。

export const ACTIONS: Record<string, string> = {
  VISIT: 'visit',
  EDIT: 'edit',
  DELETE: 'delete',
  MOVE_TO_CAT: 'moveToCat',
  MOVE_TO_SPACE: 'moveToSpace',
  SHARE_GROUP: 'shareGroup',
  ADD_BOOKMARK: 'addbookmark',
  ADD_GROUP: 'addgroup',
  ADD_CAT: 'addcat',
  MULTI_SELECT: 'multiSelect',
  HISTORY: 'history',
  RENAME_ATTR: 'renameAttr',
  DETAIL: 'detail',
  PIN: 'pin',
  /** 复制网址（右键/长按菜单书签主项，替代打开网站——行主体单击即主操作） */
  COPY_URL: 'copyUrl',
  /** 列表模式展开/收起（长按菜单条件项） */
  EXPAND: 'expand',
  /** 聚焦编辑组（长按菜单） */
  FOCUS: 'focus',
  /** 添加子网站（顶层书签菜单项） */
  ADD_SUB: 'addSub',
  /** 添加书签或组到组（组菜单项，替代原 foot + 按钮） */
  ADD_TO_GROUP: 'addToGroup',
  /** 分享分类（分类菜单项：分享该分类及其全部书签与组，不含敏感内容，热更新） */
  SHARE_CATEGORY: 'shareCategory',
  /** 导出分类（分类菜单项：导出该分类及其全部书签与组） */
  EXPORT_CATEGORY: 'exportCategory',
  /** 智能补齐与润色信息 */
  AI_ENRICH: 'aiEnrich',
  /** 询问 AI / 探讨此卡片或笔记 */
  AI_CHAT: 'aiChat',
}

export const DEFAULTS: AppData = {
  categories: [
    { id: 'all', name: '全部', icon: 'grid', color: '#122E8A', order: 0 },
    { id: 'uncategorized', name: '未分类', icon: 'bookmark', color: '#6E6860', order: 1 },
    { id: 'email', name: '邮箱', icon: 'mail', color: '#e11d48', order: 2 },
    { id: 'tools', name: '工具', icon: 'tool', color: '#d97706', order: 3 },
    { id: 'ai', name: 'AI', icon: 'ai-icon', color: '#8b5cf6', order: 4 },
    { id: 'social', name: '娱乐', icon: 'social-icon', color: '#1d9bf0', order: 5 },
    { id: 'game', name: '游戏平台', icon: 'game-icon', color: '#16a34a', order: 6 }
  ],
  bookmarks: [
    { id: 'b1', title: 'GitHub', url: 'https://github.com', username: '', password: '', notes: '代码托管平台', icon: '', categoryId: 'tools', parentId: null, order: 2, useCount: 15, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000 },
    // D2-007：示例数据不放任何伪密码（原 base64「123」易被误用/误导）
    { id: 'b2', title: 'QQ邮箱', url: 'https://mail.qq.com', username: '@qq.com', password: '', notes: '', icon: '', categoryId: 'email', parentId: null, order: 6, useCount: 8, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 172800000, updatedAt: Date.now() - 172800000 },
    { id: 'b3', title: 'DeepSeek', url: 'https://www.deepseek.com/', username: '', password: '', notes: 'API key:', icon: '', categoryId: 'ai', parentId: null, order: 4, useCount: 5, attributes: { 'ai': true }, isExpanded: false, createdAt: Date.now() - 40000000, updatedAt: Date.now() - 40000000 },
    { id: 'sb1', title: '开始对话', url: 'https://chat.deepseek.com/', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 0, useCount: 3, attributes: { 'ai': true }, isExpanded: false, createdAt: Date.now() - 30000000, updatedAt: Date.now() - 30000000 },
    { id: 'sb2', title: 'API开发平台', url: 'https://platform.deepseek.com/usage', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 1, useCount: 2, attributes: { 'ai': true }, isExpanded: false, createdAt: Date.now() - 20000000, updatedAt: Date.now() - 20000000 },
    { id: 'b4', title: '抖音', url: 'https://www.douyin.com', username: '', password: '', notes: '短视频平台', icon: '', categoryId: 'social', parentId: null, order: 5, useCount: 0, attributes: {}, isExpanded: false, createdAt: Date.now() - 345600000, updatedAt: Date.now() - 345600000 },
    { id: 'b5', title: 'Steam', url: 'https://store.steampowered.com', username: '', password: '', notes: '游戏平台', icon: '', categoryId: 'game', parentId: null, order: 3, useCount: 0, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 100000, updatedAt: Date.now() - 100000 },
    { id: 'b6', title: 'I Love PDF', url: 'https://www.ilovepdf.com/', username: '', password: '', notes: '在线PDF工具', icon: '', categoryId: 'tools', parentId: null, order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: Date.now() - 50000, updatedAt: Date.now() - 50000 },
  ],
  customAttributes: [
    { id: 'requires-login', name: '需要登录', type: 'boolean' },
    { id: 'ai', name: 'AI', type: 'boolean' },
    { id: 'is-group', name: '笔记', type: 'boolean' }
  ],
  siblingGroups: [
    {
      id: 'sg_welcome',
      name: '上手指南',
      categoryId: 'uncategorized',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: { 'is-group': true },
      bookmarkIds: ['b1', 'b6'],
      notes: WELCOME_NOTES,
      updatedAt: 1704067200000,
      useCount: 0,
      isPublic: false,
    },
  ],
  _schemaVersion: 4,
  _dataVersion: 4, // 兼容旧读者；迁移门控以 _schemaVersion 为准
}

/**
 * 首装 / 重置数据时使用的种子数据（按 locale 本地化分类名 / 属性名 / 书签备注 / 欢迎笔记）。
 *
 * DEFAULTS 保留为静态 zh 版本——迁移层（migrations.ts）按 category id 兜底补齐默认
 * 分类，id 与 icons/colors 与语言无关，name 字段不被迁移逻辑读取。
 *
 * 使用：persist.ts 首次空数据 seed、useDataIO.resetToDefaults 重置。locale 不传则
 * 读 i18n.getLocale()；调用方一般无需显式传。
 */
export function buildSeedDefaults(locale?: Locale): AppData {
  const loc: Locale = locale || getLocale()
  const isEn = loc === 'en-US'
  // 属性/分类/书签/组的内容：英文 vs 中文 差异只在 name/notes/notes 文案。
  const catName = (id: string): string => t(`cat.${id}` as never) as unknown as string
  const seedNotes: Record<string, string> = isEn
    ? {
        b1: 'Code hosting platform',
        b3: 'API key:',
        b5: 'Gaming platform',
        b8: 'Google Mail',
        b14: 'Video platform',
        b6: 'Online PDF tools',
      }
    : {
        b1: '代码托管平台',
        b3: 'API key:',
        b4: '短视频平台',
        b5: '游戏平台',
        b6: '在线PDF工具',
      }
  const attrName = (id: string, zh: string, en: string): string => isEn ? en : zh
  const bmTitle = (id: string, zh: string, en: string): string => isEn ? en : zh

  const now = Date.now()
  return {
    categories: [
      { id: 'all', name: catName('all'), icon: 'grid', color: '#122E8A', order: 0 },
      { id: 'uncategorized', name: catName('uncategorized'), icon: 'bookmark', color: '#6E6860', order: 1 },
      { id: 'email', name: catName('email'), icon: 'mail', color: '#e11d48', order: 2 },
      { id: 'tools', name: catName('tools'), icon: 'tool', color: '#d97706', order: 3 },
      { id: 'ai', name: catName('ai'), icon: 'ai-icon', color: '#8b5cf6', order: 4 },
      { id: 'social', name: catName('social'), icon: 'social-icon', color: '#1d9bf0', order: 5 },
      { id: 'game', name: catName('game'), icon: 'game-icon', color: '#16a34a', order: 6 },
    ],
    // 示例书签只为演示功能，每个分类留一个代表（2026-11-25 精简：去掉重复演示同一功能的
    // 163/豆包/WorkBuddy/ChatGPT/Claude/Gemini）。列表按 order 倒序显示，order 决定首屏：
    // 邮箱 → 视频 → DeepSeek → Steam → GitHub → I Love PDF，与链官网书签 order 0 垫底。
    // GitHub 与 I Love PDF 被上手指南正文内嵌引用（bookmarkIds），不可删。
    //
    // 邮箱与视频两条按首次打开时的界面语言出不同网站：中文 QQ邮箱(b2) / 抖音(b4)，英文 Gmail(b8) / YouTube(b14)。
    // 这两条刻意用不同 id：同一账号在另一种语言的新设备上首次登录时，示例书签与云端按 id 合并，
    // 共用 id 会让新设备那份（修改时间更新）把云端的 QQ邮箱 覆盖成 Gmail，等于悄悄改了用户数据；
    // 不同 id 最坏只是多出两条另一语言的示例，删掉即可。b8 沿用旧版 Gmail 的 id，云端已删的墓地照常拦截复活。
    // 初始书签只在首次打开 / 重置数据时按当时语言生成一次，之后切换界面语言不改动任何书签。
    bookmarks: [
      { id: 'b1', title: bmTitle('b1', 'GitHub', 'GitHub'), url: 'https://github.com', username: '', password: '', notes: seedNotes.b1, icon: '', categoryId: 'tools', parentId: null, order: 2, useCount: 15, attributes: { 'requires-login': true }, isExpanded: false, createdAt: now - 86400000, updatedAt: now - 86400000 },
      // D2-007：示例数据不放任何伪密码（原 base64「123」易被误用/误导）
      isEn
        ? { id: 'b8', title: 'Gmail', url: 'https://mail.google.com/', username: '@gmail.com', password: '', notes: seedNotes.b8, icon: '', categoryId: 'email', parentId: null, order: 6, useCount: 8, attributes: { 'requires-login': true }, isExpanded: false, createdAt: now - 172800000, updatedAt: now - 172800000 }
        : { id: 'b2', title: 'QQ邮箱', url: 'https://mail.qq.com', username: '@qq.com', password: '', notes: '', icon: '', categoryId: 'email', parentId: null, order: 6, useCount: 8, attributes: { 'requires-login': true }, isExpanded: false, createdAt: now - 172800000, updatedAt: now - 172800000 },
      { id: 'b3', title: bmTitle('b3', 'DeepSeek', 'DeepSeek'), url: 'https://www.deepseek.com/', username: '', password: '', notes: seedNotes.b3, icon: '', categoryId: 'ai', parentId: null, order: 4, useCount: 5, attributes: { 'ai': true }, isExpanded: false, createdAt: now - 40000000, updatedAt: now - 40000000 },
      { id: 'sb1', title: bmTitle('sb1', '开始对话', 'Start chat'), url: 'https://chat.deepseek.com/', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 0, useCount: 3, attributes: { 'ai': true }, isExpanded: false, createdAt: now - 30000000, updatedAt: now - 30000000 },
      { id: 'sb2', title: bmTitle('sb2', 'API开发平台', 'API platform'), url: 'https://platform.deepseek.com/usage', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 1, useCount: 2, attributes: { 'ai': true }, isExpanded: false, createdAt: now - 20000000, updatedAt: now - 20000000 },
      isEn
        ? { id: 'b14', title: 'YouTube', url: 'https://www.youtube.com/', username: '', password: '', notes: seedNotes.b14, icon: '', categoryId: 'social', parentId: null, order: 5, useCount: 0, attributes: {}, isExpanded: false, createdAt: now - 345600000, updatedAt: now - 345600000 }
        : { id: 'b4', title: '抖音', url: 'https://www.douyin.com', username: '', password: '', notes: seedNotes.b4, icon: '', categoryId: 'social', parentId: null, order: 5, useCount: 0, attributes: {}, isExpanded: false, createdAt: now - 345600000, updatedAt: now - 345600000 },
      { id: 'b5', title: bmTitle('b5', 'Steam', 'Steam'), url: 'https://store.steampowered.com', username: '', password: '', notes: seedNotes.b5, icon: '', categoryId: 'game', parentId: null, order: 3, useCount: 0, attributes: { 'requires-login': true }, isExpanded: false, createdAt: now - 100000, updatedAt: now - 100000 },
      { id: 'b6', title: bmTitle('b6', 'I Love PDF', 'I Love PDF'), url: 'https://www.ilovepdf.com/', username: '', password: '', notes: seedNotes.b6, icon: '', categoryId: 'tools', parentId: null, order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: now - 50000, updatedAt: now - 50000 },
    ],
    customAttributes: [
      { id: 'requires-login', name: attrName('requires-login', '需要登录', 'Requires login'), type: 'boolean' },
      { id: 'ai', name: attrName('ai', 'AI', 'AI'), type: 'boolean' },
      { id: 'is-group', name: attrName('is-group', '笔记', 'Note'), type: 'boolean' },
    ],
    siblingGroups: [
      {
        id: 'sg_welcome',
        name: isEn ? 'Getting Started' : '上手指南',
        categoryId: 'uncategorized',
        icon: '',
        order: 0,
        isExpanded: false,
        attributes: { 'is-group': true },
        bookmarkIds: ['b1', 'b6'],
        notes: getWelcomeNotes(loc),
        updatedAt: now,
        useCount: 0,
        isPublic: false,
      },
    ],
    _schemaVersion: 4,
    _dataVersion: 4,
  }
}
