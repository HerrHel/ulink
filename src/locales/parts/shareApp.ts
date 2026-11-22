/** 中文语言包 fragment：分享视图 + 应用外壳。由 src/locales/zh.ts 顶层 spread 合并。 */
export const shareAppZh = {
  shareView: {
    defaultGroupName: '未命名',
    forking: '复制中…',
    forkToMyLibrary: '复制到书签库',
    loginThenCopy: '登录后复制',
    loginRequiredToast: '请先登录后再复制',
    copyFailed: '复制失败：{msg}',
    notFound: '该私有分享链接不存在或已停止分享',
    loadFailed: '加载失败：{msg}',
    pageTitle: '{name} - 与链 分享',
    shareDesc: '{n} 个链接 · 凭专属私有链接访问',
    categoryPageTitle: '{name} - 与链 分类分享',
    categoryMeta: '{n} 个书签 · {groups} 个笔记',
    categoryShareDesc: '{n} 个书签 · {groups} 个笔记 · 凭专属私有链接访问',
    categoryEmpty: '这个分享分类还没有书签',
    // 分类页（卡片网格）：Hero 计数 / 组卡展开 / 空态
    catBookmarks: '{n} 个书签',
    catGroups: '{m} 个笔记',
    catExpand: '展开 / 收起笔记内书签',
    catGroupEmpty: '这个笔记还没有书签',
    catNoNotes: '暂无笔记',
    subBookmark: '子书签',
    catChildren: '{n} 个子书签',
    catHide: '收起',
    encryptedPlaceholder: '（内容已加密）',
  },
  /** 主应用内分享只读态（分享页改为只读态后的外壳文案） */
  share: {
    readonly: '只读',
    readonlyTitle: '这是他人分享的只读内容',
    denied: '这是他人分享的只读内容，无法修改',
    saveToLibrary: '保存到书签库',
    saving: '保存中…',
    loginThenSave: '登录后保存',
    loading: '正在加载分享内容…',
    backToMine: '返回书签库',
    bookmarksInGroup: '收录的书签',
  },
  appShell: {
    unlockChunkLoadFailed: '解锁组件加载失败，请刷新后重试',
    unlockTimeout: '解锁超时，请重试',
  },
} as const

/** English fragment：与 zh 键完全同构；复数用 key_one/key_other 平级追加。 */
