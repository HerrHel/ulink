/**
 * editorOverlay.ts 的英文分片（与 ../editorOverlay.ts 的中文分片一一对应）。
 * 单独成文件：英文包经 i18n 动态 import 按需加载，不进中文用户的首屏包。
 */
export const editorOverlayEn = {
  toolbar: {
    deleted: '(deleted)',
    deletedGroup: '(deleted note)',
    deletedWithName: '{name} (deleted)',
    placeholder: 'Type text…, press @ to insert a bookmark, press # to insert a note reference',
    default: 'Default',
  },
  shortcut: {
    groupGlobal: 'Global',
    groupEditor: 'Note editor',
    groupBatch: 'Batch mode',
    groupList: 'List mode (desktop)',
    macTip: 'On Mac, replace Ctrl with ⌘ Cmd',
    cmdPanel: 'Command palette / search bookmarks and notes',
    aiSidebar: 'Toggle AI Workspace',
    panelShortcut: 'Keyboard shortcuts (this panel)',
    esc: 'Close dialog / exit focus / exit batch mode',
    cycleFocus: 'Cycle focus between fields in a dialog',
    boldText: 'Bold selected text',
    setH1: 'Set as H1 heading',
    setH2: 'Set as H2 heading',
    setH3: 'Set as H3 heading',
    undoGroup: 'Undo edits in note',
    redoGroup: 'Redo last undone action',
    insertBookmarkSearch: 'Search bookmarks and insert inline',
    insertGroupSearch: 'Search notes and insert a note reference',
    selectAllVisible: 'Select all visible cards',
    deleteSelected: 'Delete all selected items',
    openBookmarkFocus: 'Open bookmark / focus note (title area or Enter)',
    openDetail: 'Open right details (click blank or Space)',
    expandCollapse: 'Expand / collapse',
    prevNext: 'Previous / next',
    firstLast: 'First / last',
  },
  boundary: {
    e2eLockedHint: 'Enable end-to-end encryption to use this feature',
  },
} as const
