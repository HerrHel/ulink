/** 中文语言包 fragment：程序化消息（toast/confirm）。zh 文案与原代码逐字一致。 */
export const programmaticZh = {
  msg: {
    // ── 导入导出（useDataIO）──
    dataExported: '数据已导出',
    exportFailed: '导出失败',
    exportedBookmarks: '已导出 {n} 个书签（{format}）',
    raindropInvalid: 'Raindrop JSON 格式不正确或为空',
    jsonFormatUnrecognized: 'JSON 格式不识别，请确认是与链（ulink）或 Raindrop.io 导出文件',
    otherCategory: '其他',
    exportHtmlTitle: '与链 书签导出',
    exportHtmlH1: '与链 书签',
    noBookmarksInHtml: '未在 HTML 中找到书签',
    csvInvalid: 'CSV 文件为空或格式不正确',
    unsupportedFormat: '不支持的文件格式',
    importFailed: '导入失败：{msg}',
    importAllExists: '从 {source} 导入：所有数据已存在，无新增项',
    importSkippedSuffix: '（{n} 条格式错误已跳过）',
    importedBookmarks: '{n} 个书签',
    importedCategories: '{n} 个分类',
    importedGroups: '{n} 个笔记',
    importedAttributes: '{n} 个标签',
    importSummary: '从 {source} 导入：{list}',
    listSeparator: '、',
    dataResetToDefault: '数据已重置为默认',
    dataRestored: '数据已恢复',
    resetAllConfirmLoggedIn: '确认清除本机所有数据并恢复默认？不会删除云端数据；下次同步时云端内容可能重新合并回本机。',
    resetAllConfirm: '确认清除所有数据？将恢复为默认状态。',

    // ── 书签（useBookmark）──
    unsafeUrlBlocked: '该链接地址不安全，已阻止打开',
    urlExistsBookmark: '该网址已存在书签「{title}」',
    bookmarkUpdated: '书签已更新',
    bookmarkAdded: '书签已添加',
    bookmarkDeleted: '书签已删除',
    confirmDeleteBookmark: '确认删除书签「{title}」？',
    dataNotReady: '数据尚未就绪，请稍后重试',
    cannotSaveLink: '无法保存该链接',
    savedToBookmarks: '已保存到书签',
    undone: '已撤销',
    dupeFound: '发现已有书签「{title}」',
    dupeSameDomain: '，网址域名相同但路径不同。',
    dupeSimilar: '，网址相似。',
    dupeHowProceed: '\n\n如何处理新书签？',
    dupeChildLabel: '成为「{title}」的子书签',
    dupeChildDesc: '将新书签作为已有书签的子项保存',
    dupeSiblingLabel: '作为独立书签添加',
    dupeSiblingDesc: '与已有书签平级保存',

    // ── 笔记（useGroup / useDragDrop / useMention）──
    groupDeleted: '已删除笔记',
    groupRestored: '笔记已恢复',
    confirmDeleteGroup: '确认删除笔记「{name}」？',
    bookmarkAlreadyInGroup: '书签已在笔记内',
    addedToGroup: '已添加到笔记',
    removedFromGroup: '已从笔记移除',
    groupUpdated: '笔记已更新',
    groupRefMoved: '已移动笔记引用',
    joinedGroup: '已加入笔记',
    movedOutOfGroup: '已移出笔记',
    onlySameLevelReorder: '只能在同级书签间拖拽排序',
    movedToCategory: '已移动到分类: {name}',
    imageNeedFocus: '请先聚焦一个笔记再插入图片',
    imageInvalid: '仅支持 PNG/JPEG/WebP/GIF/SVG 图片，且单张不超过 {n}MB',
    imageSkipped: '部分图片超过体积上限或类型不支持，已跳过',
    groupRefAdded: '已添加笔记引用',

    // ── 私密空间（useSpaceMove）──
    alreadyInVault: '已在私密空间内，无法再移入',
    movedToVault: '已移入私密空间：{n} 个书签',
    movedGroupsSuffix: '、{n} 个笔记',
    categoryMovedToVault: '已把分类「{name}」连同 {bookmarks} 个书签、{groups} 个笔记移入私密空间',
    groupsMovedToVault: '已移入私密空间：{groups} 个笔记、{bookmarks} 个书签',

    // ── 图片上传（useImageUpload）──
    imageUploadLoginRequired: '上传图片需先登录云端账号',
    imageUploadFailedRetry: '图片上传失败，请稍后重试',
    imageUploadFailed: '图片上传失败',
    imagesInserted: '已插入 {n} 张图片',

    // ── 批量操作（useBatch）──
    confirmDeleteSelectedItems: '确认删除选中的 {n} 项？',
    deletedItems: '已删除 {n} 项',
    movedItems: '已移动 {n} 项',

    // ── 分类（utils / useUI）──
    enterCategoryName: '请输入分类名称',
    categoryNameExists: '分类名称已存在',
    categoryAdded: '分类已添加',
    cannotDeleteDefaultCategory: '无法删除默认分类',
    confirmDeleteCategory: '确认删除此分类？',

    // ── 分享 / Fork（useDataShare）──
    groupNotExist: '笔记不存在',
    shareLoginRequired: '分享需要登录云同步，请先登录',
    shareLinkLabel: '分享链接',
    forkedGroup: '已复制「{name}」到你的库（{count} 个书签）',
    categoryNotExist: '分类不存在',
    exportedCategory: '已导出分类「{name}」（{n} 个书签 · {groups} 个笔记）',
    forkedCategory: '已复制分类「{name}」到你的库（{count} 个书签 · {groups} 个笔记）',

    // ── 撤销 / 前进（useUndo）──
    redone: '已前进',

    // ── 其它（stores / ui）──
    storageUnavailable: '存储不可用（如隐私模式/配额满），刷新后数据可能丢失，请尽快导出备份',
    storageInvalidSnapshot: '数据结构异常，本次未写入（已保留上一次正常快照）；请导出备份并反馈',
    movedTo: '已移动到 {name}',
    renamed: '已重命名',
    orderUpdated: '排序已更新',
    groupsOnTopNotice: '已开启笔记置顶',
  },
} as const

/** English fragment：与 zh 键完全同构；复数用 key_one/key_other 平级追加。 */
