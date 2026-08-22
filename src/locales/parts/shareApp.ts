/** 中文语言包 fragment：分享视图 + 应用外壳。由 src/locales/zh.ts 顶层 spread 合并。 */
export const shareAppZh = {
  shareView: {
    defaultGroupName: '分享组',
    forking: '复制中…',
    forkToMyLibrary: '复制到我的库',
    loginThenCopy: '登录后复制',
    loginRequiredToast: '请先登录后再复制',
    copyFailed: '复制失败：{msg}',
    notFound: '该分享链接不存在或已取消公开',
    loadFailed: '加载失败：{msg}',
    pageTitle: '{name} - 与链 分享',
    shareDesc: '{n} 个链接 · 由与链公开分享',
  },
  appShell: {
    unlockChunkLoadFailed: '解锁组件加载失败，请刷新后重试',
    unlockTimeout: '解锁超时，请重试',
  },
} as const

/** English fragment：与 zh 键完全同构；复数用 key_one/key_other 平级追加。 */
export const shareAppEn = {
  shareView: {
    defaultGroupName: 'Shared group',
    forking: 'Copying…',
    forkToMyLibrary: 'Copy to my library',
    loginThenCopy: 'Sign in to copy',
    loginRequiredToast: 'Please sign in first to copy',
    copyFailed: 'Copy failed: {msg}',
    notFound: 'This share link no longer exists or is no longer public',
    loadFailed: 'Failed to load: {msg}',
    pageTitle: '{name} - shared via ulink',
    shareDesc: '{n} links · publicly shared via ulink',
    shareDesc_one: '{n} link · publicly shared via ulink',
  },
  appShell: {
    unlockChunkLoadFailed: 'Failed to load the unlock dialog — please refresh and retry',
    unlockTimeout: 'Unlock timed out — please retry',
  },
} as const
