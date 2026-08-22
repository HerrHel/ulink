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
    importedGroups: '{n} 个组',
    importedAttributes: '{n} 个属性',
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

    // ── 组（useGroup / useDragDrop / useMention）──
    groupCreated: '组已创建',
    groupDeleted: '已删除组',
    groupRestored: '组已恢复',
    confirmDeleteGroup: '确认删除组「{name}」？',
    bookmarkAlreadyInGroup: '书签已在组内',
    addedToGroup: '已添加到组',
    removedFromGroup: '已从组移除',
    groupUpdated: '组已更新',
    groupRefMoved: '已移动组引用',
    joinedGroup: '已加入组',
    movedOutOfGroup: '已移出组',
    onlySameLevelReorder: '只能在同级书签间拖拽排序',
    movedToCategory: '已移动到分类: {name}',
    groupRefAdded: '已添加组引用',

    // ── 私密空间（useSpaceMove）──
    alreadyInVault: '已在私密空间内，无法再移入',
    movedToVault: '已移入私密空间：{n} 个书签',
    movedGroupsSuffix: '、{n} 个组',
    categoryMovedToVault: '已把分类「{name}」连同 {bookmarks} 个书签、{groups} 个组移入私密空间',
    groupsMovedToVault: '已移入私密空间：{groups} 个组、{bookmarks} 个书签',

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
    groupNotExist: '组不存在',
    shareLoginRequired: '分享需要登录云同步，请先登录',
    shareLinkLabel: '分享链接',
    forkedGroup: '已复制「{name}」到你的库（{count} 个书签）',

    // ── 撤销 / 前进（useUndo）──
    redone: '已前进',

    // ── 其它（stores / ui）──
    storageUnavailable: '存储不可用（如隐私模式/配额满），刷新后数据可能丢失，请尽快导出备份',
    movedTo: '已移动到 {name}',
    renamed: '已重命名',
    orderUpdated: '排序已更新',
  },
} as const

/** English fragment：与 zh 键完全同构；复数用 key_one/key_other 平级追加。 */
export const programmaticEn = {
  msg: {
    // ── Import / Export (useDataIO) ──
    dataExported: 'Data exported',
    exportFailed: 'Export failed',
    exportedBookmarks: 'Exported {n} bookmarks ({format})',
    exportedBookmarks_one: 'Exported {n} bookmark ({format})',
    raindropInvalid: 'Raindrop JSON is invalid or empty',
    jsonFormatUnrecognized: 'Unrecognized JSON format — please confirm the file was exported from ulink or Raindrop.io',
    otherCategory: 'Other',
    exportHtmlTitle: 'ulink bookmarks export',
    exportHtmlH1: 'ulink bookmarks',
    noBookmarksInHtml: 'No bookmarks found in the HTML',
    csvInvalid: 'CSV file is empty or malformed',
    unsupportedFormat: 'Unsupported file format',
    importFailed: 'Import failed: {msg}',
    importAllExists: 'Imported from {source}: everything already exists, nothing new added',
    importSkippedSuffix: ' ({n} rows skipped for format errors)',
    importedBookmarks: '{n} bookmarks',
    importedBookmarks_one: '{n} bookmark',
    importedCategories: '{n} categories',
    importedCategories_one: '{n} category',
    importedGroups: '{n} groups',
    importedGroups_one: '{n} group',
    importedAttributes: '{n} attributes',
    importedAttributes_one: '{n} attribute',
    importSummary: 'Imported from {source}: {list}',
    listSeparator: ', ',
    dataResetToDefault: 'Data reset to defaults',
    dataRestored: 'Data restored',
    resetAllConfirmLoggedIn: 'Clear all local data and restore defaults? Cloud data will not be deleted; on the next sync, cloud content may be merged back to this device.',
    resetAllConfirm: 'Clear all data? This will restore the default state.',

    // ── Bookmarks (useBookmark) ──
    unsafeUrlBlocked: 'This link is unsafe and has been blocked',
    urlExistsBookmark: 'A bookmark already exists for this URL: "{title}"',
    bookmarkUpdated: 'Bookmark updated',
    bookmarkAdded: 'Bookmark added',
    bookmarkDeleted: 'Bookmark deleted',
    confirmDeleteBookmark: 'Delete bookmark "{title}"?',
    dataNotReady: 'Data is not ready yet — please try again later',
    cannotSaveLink: 'Unable to save this link',
    savedToBookmarks: 'Saved to bookmarks',
    undone: 'Undone',
    dupeFound: 'An existing bookmark "{title}" was found',
    dupeSameDomain: ', same domain but a different path.',
    dupeSimilar: ', similar URL.',
    dupeHowProceed: '\n\nHow do you want to proceed?',
    dupeChildLabel: 'Save as a sub-bookmark of "{title}"',
    dupeChildDesc: 'Save the new bookmark as a sub-item of the existing one',
    dupeSiblingLabel: 'Add as a separate bookmark',
    dupeSiblingDesc: 'Save alongside the existing bookmark',

    // ── Groups (useGroup / useDragDrop / useMention) ──
    groupCreated: 'Group created',
    groupDeleted: 'Group deleted',
    groupRestored: 'Group restored',
    confirmDeleteGroup: 'Delete group "{name}"?',
    bookmarkAlreadyInGroup: 'Bookmark is already in the group',
    addedToGroup: 'Added to group',
    removedFromGroup: 'Removed from group',
    groupUpdated: 'Group updated',
    groupRefMoved: 'Group reference moved',
    joinedGroup: 'Added to group',
    movedOutOfGroup: 'Moved out of group',
    onlySameLevelReorder: 'Can only reorder bookmarks at the same level',
    movedToCategory: 'Moved to category: {name}',
    groupRefAdded: 'Group reference added',

    // ── Private space (useSpaceMove) ──
    alreadyInVault: 'Already in the private space — cannot move again',
    movedToVault: 'Moved to private space: {n} bookmarks',
    movedToVault_one: 'Moved to private space: {n} bookmark',
    movedGroupsSuffix: ', {n} groups',
    movedGroupsSuffix_one: ', {n} group',
    categoryMovedToVault: 'Moved category "{name}" along with {bookmarks} bookmarks and {groups} groups to the private space',
    groupsMovedToVault: 'Moved to private space: {groups} groups, {bookmarks} bookmarks',

    // ── Image upload (useImageUpload) ──
    imageUploadLoginRequired: 'Sign in to the cloud account before uploading images',
    imageUploadFailedRetry: 'Image upload failed — please try again later',
    imageUploadFailed: 'Image upload failed',
    imagesInserted: 'Inserted {n} images',
    imagesInserted_one: 'Inserted {n} image',

    // ── Batch operations (useBatch) ──
    confirmDeleteSelectedItems: 'Delete the selected {n} items?',
    confirmDeleteSelectedItems_one: 'Delete the selected {n} item?',
    deletedItems: 'Deleted {n} items',
    deletedItems_one: 'Deleted {n} item',
    movedItems: 'Moved {n} items',
    movedItems_one: 'Moved {n} item',

    // ── Categories (utils / useUI) ──
    enterCategoryName: 'Please enter a category name',
    categoryNameExists: 'Category name already exists',
    categoryAdded: 'Category added',
    cannotDeleteDefaultCategory: 'Default categories cannot be deleted',
    confirmDeleteCategory: 'Delete this category?',

    // ── Share / Fork (useDataShare) ──
    groupNotExist: 'Group does not exist',
    shareLoginRequired: 'Sharing requires signing in to cloud sync — please sign in first',
    shareLinkLabel: 'Share link',
    forkedGroup: 'Copied "{name}" to your library ({count} bookmarks)',

    // ── Undo / Redo (useUndo) ──
    redone: 'Redone',

    // ── Others (stores / ui) ──
    storageUnavailable: 'Storage unavailable (e.g. private mode or quota full) — data may be lost after refresh, please export a backup soon',
    movedTo: 'Moved to {name}',
    renamed: 'Renamed',
    orderUpdated: 'Order updated',
  },
} as const
