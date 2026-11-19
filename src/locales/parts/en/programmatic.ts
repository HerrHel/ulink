/**
 * programmatic.ts 的英文分片（与 ../programmatic.ts 的中文分片一一对应）。
 * 单独成文件：英文包经 i18n 动态 import 按需加载，不进中文用户的首屏包。
 */
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
    importedGroups: '{n} notes',
    importedGroups_one: '{n} note',
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

    // ── Notes (useGroup / useDragDrop / useMention) ──
    groupDeleted: 'Note deleted',
    groupRestored: 'Note restored',
    confirmDeleteGroup: 'Delete note "{name}"?',
    bookmarkAlreadyInGroup: 'Bookmark is already in the note',
    addedToGroup: 'Added to note',
    removedFromGroup: 'Removed from note',
    groupUpdated: 'Note updated',
    groupRefMoved: 'Note reference moved',
    joinedGroup: 'Added to note',
    movedOutOfGroup: 'Moved out of note',
    onlySameLevelReorder: 'Can only reorder bookmarks at the same level',
    movedToCategory: 'Moved to category: {name}',
    imageNeedFocus: 'Focus a note before inserting images',
    imageInvalid: 'Only PNG/JPEG/WebP/GIF/SVG images up to {n}MB are supported',
    imageSkipped: 'Some images were skipped (size limit or unsupported type)',
    groupRefAdded: 'Note reference added',

    // ── Private space (useSpaceMove) ──
    alreadyInVault: 'Already in the private space — cannot move again',
    movedToVault: 'Moved to private space: {n} bookmarks',
    movedToVault_one: 'Moved to private space: {n} bookmark',
    movedGroupsSuffix: ', {n} notes',
    movedGroupsSuffix_one: ', {n} note',
    categoryMovedToVault: 'Moved category "{name}" along with {bookmarks} bookmarks and {groups} notes to the private space',
    groupsMovedToVault: 'Moved to private space: {groups} notes, {bookmarks} bookmarks',

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
    groupNotExist: 'Note does not exist',
    shareLoginRequired: 'Sharing requires signing in to cloud sync — please sign in first',
    shareLinkLabel: 'Share link',
    forkedGroup: 'Copied "{name}" to your library ({count} bookmarks)',
    forkedGroup_one: 'Copied "{name}" to your library ({count} bookmark)',
    categoryNotExist: 'Category does not exist',
    exportedCategory: 'Exported category "{name}" ({n} bookmarks · {groups} notes)',
    exportedCategory_one: 'Exported category "{name}" ({n} bookmark · {groups} notes)',
    forkedCategory: 'Copied category "{name}" to your library ({count} bookmarks · {groups} notes)',
    forkedCategory_one: 'Copied category "{name}" to your library ({count} bookmark · {groups} notes)',

    // ── Undo / Redo (useUndo) ──
    redone: 'Redone',

    // ── Others (stores / ui) ──
    storageUnavailable: 'Storage unavailable (e.g. private mode or quota full) — data may be lost after refresh, please export a backup soon',
    storageInvalidSnapshot: 'Data structure is invalid, so this save was skipped (the last good snapshot is kept). Please export a backup and report it.',
    movedTo: 'Moved to {name}',
    renamed: 'Renamed',
    orderUpdated: 'Order updated',
    groupsOnTopNotice: 'Notes on top is enabled',
  },
} as const
